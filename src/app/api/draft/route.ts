// POST /api/draft: takes product info + the chosen channel and its verified evidence, returns a draft and check results
import { chatJson, toAppError } from "@/lib/deepseek";
import { checkEmail, INPUT_FIELD_LABEL, keepValidEvidenceMarks, numbersSupported, stripEvidenceMarks } from "@/lib/emailCheck";
import { fillRecipient } from "@/lib/profile";
import { DRAFT_SYSTEM, draftUser } from "@/lib/prompts";
import { draftRequestSchema, draftSchema, type DraftOut } from "@/lib/schemas";
import { channelPayload, verify } from "@/lib/sign";
import { CHECK_LABEL, type CheckKey, type FactItem, type Flag, type ResearchInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Time limit for the whole request (first draft + automatic rewrite), with headroom so it stays under maxDuration and the page doesn't spin forever
const TOTAL_BUDGET_MS = 100_000;
// If less time than this is left, skip the automatic rewrite and hand the red flags to the user
const MIN_REWRITE_MS = 25_000;

interface EvidenceItem {
  id: string;
  text: string; // what the model sees: claim + quote
  quote: string;
  sourceUrl: string;
}

function buildFactMap(out: DraftOut, input: ResearchInput, ev: EvidenceItem[]): FactItem[] {
  const evById = new Map(ev.map((e) => [e.id.toUpperCase(), e]));
  return out.claims.map((c) => {
    if (c.source === "user_input") {
      const key = c.ref as keyof ResearchInput;
      // use hasOwn, not in: if the model writes a ref like "constructor", in returns true and .trim() below would crash
      const val = Object.hasOwn(INPUT_FIELD_LABEL, key) ? input[key] : undefined;
      const text = Array.isArray(val) ? val.join(", ") : (val ?? "");
      // What code can check: the source field exists and is non-empty, and every number in the claim appears in that field.
      // The claim and the input are often in different languages, so only a person can judge whether they mean the same thing; the UI shows them side by side.
      const reason = !text.trim()
        ? `The source “${c.ref}” given by the model does not exist or is empty.`
        : !numbersSupported(c.claim, text)
          ? `A number in this claim does not appear in your input “${INPUT_FIELD_LABEL[c.ref] ?? c.ref}”.`
          : undefined;
      return {
        claim: c.claim,
        source: "user_input",
        ref: INPUT_FIELD_LABEL[c.ref] ?? c.ref,
        refText: text,
        ok: !reason,
        ...(reason ? { reason } : {}),
      };
    }
    const e = evById.get(c.ref.toUpperCase());
    const reason = !e
      ? "The model cited an evidence id that does not exist."
      : !numbersSupported(c.claim, e.quote)
        ? "A number in this claim does not appear in the evidence quote."
        : undefined;
    return {
      claim: c.claim,
      source: "evidence",
      ref: e?.sourceUrl ?? c.ref,
      ...(e ? { id: e.id } : {}),
      refText: e ? e.quote : "(the model cited an evidence id that does not exist)",
      ok: !reason,
      ...(reason ? { reason } : {}),
    };
  });
}

function feedbackOf(flags: Flag[]): string {
  return flags
    .filter((f) => f.level === "red")
    .map((f) =>
      f.kind === "number"
        ? `- Remove the number/amount "${f.text}"; it is not in the user input or verified evidence.`
        : `- This statement has no source in the user input or verified evidence, remove or rewrite it: "${f.text}"`,
    )
    .join("\n");
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: { code: "validation", message: "Invalid request format", suggestion: "Refresh the page and try again" } }, { status: 400 });
  }
  const parsed = draftRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "validation", message: "Product or channel information is missing", suggestion: "Go back to the research results and click “Write email for this channel” again" } },
      { status: 400 },
    );
  }
  const { input, channel } = parsed.data;

  // “Verified” flags come from the browser: use them only if the signature checks out, otherwise give the model no evidence at all
  const trusted = verify("channel", channelPayload(channel), channel.sig);
  const trustNote = trusted
    ? undefined
    : "This channel's evidence failed verification (it may come from an older research record or have been altered), so no evidence was used in this email. Run the research again to restore it.";

  // give the model only verified evidence
  const ev: EvidenceItem[] = [];
  if (trusted) for (const c of channel.checks) {
    if (c.verified && c.answer === "yes" && c.quote && c.key !== "paid") {
      ev.push({ id: "", text: `${CHECK_LABEL[c.key as CheckKey] ?? c.key}: "${c.quote}"`, quote: c.quote, sourceUrl: c.sourceUrl });
    }
  }
  if (trusted) for (const e of channel.evidence) {
    if (e.verified) ev.push({ id: "", text: `"${e.quote}"`, quote: e.quote, sourceUrl: e.sourceUrl });
  }
  if (trusted) for (const t of channel.recentTitles) {
    if (t.verified) ev.push({ id: "", text: `Recent title on their site: "${t.title}"`, quote: t.title, sourceUrl: channel.url });
  }
  ev.forEach((e, i) => (e.id = `E${i + 1}`));

  const allowedTexts = [channel.name, channel.url, ...ev.map((e) => e.quote)];
  const ch = { name: channel.name, url: channel.url, type: channel.type };

  const deadline = Date.now() + TOTAL_BUDGET_MS;
  // greeting fallback: if the model still wrote [Editor's name] or similar, replace it with “<channel name> team”.
  // Evidence marks: none in the subject; in the body keep only marks that point to evidence actually given to the model.
  const validIds = new Set(ev.map((e) => e.id));
  const withRecipient = (o: DraftOut): DraftOut => ({
    ...o,
    subject: stripEvidenceMarks(o.subject),
    body: keepValidEvidenceMarks(fillRecipient(o.body, channel.name), validIds),
  });
  try {
    let out = withRecipient(await chatJson({
      system: DRAFT_SYSTEM,
      user: draftUser(input, ch, ev),
      schema: draftSchema,
      temperature: 0.4,
      maxTokens: 1500,
      deadline,
    }));
    let factMap = buildFactMap(out, input, ev);
    let flags = checkEmail(out.subject, out.body, { input, allowedTexts, factMap });
    let rewriteNote: string | undefined;

    // red flags: rewrite once automatically; if problems remain, keep the flags for the user
    if (flags.some((f) => f.level === "red")) {
      const before = flags.filter((f) => f.level === "red").length;
      if (deadline - Date.now() < MIN_REWRITE_MS) {
        rewriteNote = `The first draft had ${before} red flag(s). Generation took too long to rewrite automatically; please edit or remove the flagged sentences.`;
      } else {
        try {
          const out2 = withRecipient(await chatJson({
            system: DRAFT_SYSTEM,
            user: draftUser(input, ch, ev, feedbackOf(flags)),
            schema: draftSchema,
            temperature: 0.2,
            maxTokens: 1500,
            deadline,
          }));
          const fm2 = buildFactMap(out2, input, ev);
          const flags2 = checkEmail(out2.subject, out2.body, { input, allowedTexts, factMap: fm2 });
          const after = flags2.filter((f) => f.level === "red").length;
          if (after <= before) {
            out = out2;
            factMap = fm2;
            flags = flags2;
          }
          rewriteNote =
            after === 0
              ? `The first draft had ${before} red flag(s); it was rewritten once automatically and now passes the checks.`
              : `The first draft had ${before} red flag(s); after one automatic rewrite ${Math.min(after, before)} remain. Please edit or remove the flagged sentences.`;
        } catch {
          rewriteNote = `The first draft had ${before} red flag(s) and the automatic rewrite failed. Please edit or remove the flagged sentences.`;
        }
      }
    }

    return Response.json({
      draft: {
        subject: out.subject,
        body: out.body,
        flags,
        factMap,
        rewriteNote: [trustNote, rewriteNote].filter(Boolean).join(" ") || undefined,
      },
      allowedTexts,
      evidence: ev.map(({ id, quote, sourceUrl }) => ({ id, quote, sourceUrl })),
    });
  } catch (e) {
    const err = toAppError(e);
    const status = err.code === "auth" ? 401 : err.code === "balance" ? 402 : err.code === "timeout" ? 504 : 502;
    return Response.json({ error: err }, { status });
  }
}
