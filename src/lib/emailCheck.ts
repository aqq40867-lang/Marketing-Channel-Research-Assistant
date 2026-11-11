// Automatic email checks (pure functions; run on the server after generation and in the browser while editing)
import type { FactItem, Flag, ResearchInput } from "./types";
import { normalizeText } from "./text";

export const SENSITIVE_TERMS = [
  "customers",
  "customer base",
  "clients",
  "users",
  "trusted by",
  "partnered with",
  "partnership with",
  "in partnership",
  "increase",
  "increased",
  "boost",
  "proven",
  "leading",
  "market leader",
  "best-in-class",
  "award-winning",
  "guarantee",
  "guaranteed",
  "thousands of",
  "millions of",
  "roi",
  "#1",
  "number one",
  "results",
  "used by",
];

export const INPUT_FIELD_LABEL: Record<string, string> = {
  product: "Product description",
  audience: "Target customers",
  market: "Target market",
  productName: "Product name",
  productUrl: "Product URL",
  collabForms: "Preferred collaboration forms",
};

export function userInputText(input: ResearchInput): string {
  return [input.product, input.audience, input.market, input.productName ?? "", input.productUrl ?? ""].join("\n");
}

// Do not match digits sitting between letters (e.g. B2B, H1)
const NUMBER_RE = /(?:[£$€¥]\s?\d[\d,.]*\s?(?:k|m|bn|million|billion)?|(?<![A-Za-z\d])\d[\d,]*(?:\.\d+)?(?![A-Za-z]{1}\d)\s?(?:%|percent|k\b|m\b|million|billion|x\b)?)/gi;
const CURRENCY_WORD_RE = /\b(?:gbp|usd|eur|pounds?|dollars?|euros?)\b/gi;
const PLACEHOLDER_RE = /\[[^\]\n]{1,60}\]/g;

/** Evidence marks the model puts after sentences, e.g. "[E2]" or "[E1][E3]"; the spaces before them are removed too. */
export const EVIDENCE_MARK_RE = /[ \t]*\[E\d{1,2}\]/g;

/** Remove all evidence marks ("…readers [E2]." → "…readers."). */
export function stripEvidenceMarks(text: string): string {
  return text.replace(EVIDENCE_MARK_RE, "");
}

/** Number of evidence marks still in the text. */
export function countEvidenceMarks(text: string): number {
  return text.match(EVIDENCE_MARK_RE)?.length ?? 0;
}

/** Keep only marks whose id is in validIds (upper-case "E1"…); marks citing evidence that doesn't exist are removed. */
export function keepValidEvidenceMarks(text: string, validIds: Set<string>): string {
  return text.replace(EVIDENCE_MARK_RE, (m) => (validIds.has(m.trim().slice(1, -1).toUpperCase()) ? m : ""));
}

function digitsOf(s: string): string {
  return s.replace(/[^\d.]/g, "").replace(/\.$/, "");
}

/** Split text into a set of numbers, used to tell whether the user ever provided a given number. */
function numberSet(text: string): Set<string> {
  const set = new Set<string>();
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) set.add(digitsOf(m[0]));
  return set;
}

/** Whether every number in a claim also appears in its source text. Used by the fact-check list; language-independent. */
export function numbersSupported(claim: string, refText: string): boolean {
  const have = numberSet(refText);
  for (const n of numberSet(claim)) if (n && !have.has(n)) return false;
  return true;
}

const STOP = new Set(["the", "and", "for", "with", "you", "your", "our", "are", "that", "this", "has", "have", "from", "who", "can", "will", "was", "were", "its", "they", "their", "about", "into", "also"]);

function words(s: string): string[] {
  return normalizeText(s)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/**
 * Whether a claim is still in the body. The model's claims are often paraphrases of the body and won't match word for word,
 * so compare keywords per sentence: if one sentence covers 60%+ of the claim's keywords, the claim is considered present.
 */
export function claimInText(claim: string, text: string): boolean {
  const cw = [...new Set(words(claim))];
  if (cw.length < 3) {
    const n = normalizeText(claim);
    return n.length > 0 && normalizeText(text).includes(n);
  }
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const sw = new Set(words(sentence));
    if (sw.size === 0) continue;
    const hit = cw.filter((w) => sw.has(w)).length;
    if (hit / cw.length >= 0.6) return true;
  }
  return false;
}

export interface CheckContext {
  input: ResearchInput;
  /** Verified evidence text (numbers in it may appear in the email, e.g. a number in one of their article titles) */
  allowedTexts: string[];
  factMap?: FactItem[];
}

export function checkEmail(subject: string, body: string, ctx: CheckContext): Flag[] {
  // evidence marks are review aids, not email content: check the text without them
  const text = stripEvidenceMarks(`${subject}\n${body}`);
  const flags: Flag[] = [];
  const seen = new Set<string>();
  const push = (f: Flag) => {
    const key = `${f.kind}:${f.text.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    flags.push(f);
  };

  // 1. Numbers, percentages, currency: red if not in the user input (or verified evidence)
  const sourceText = [userInputText(ctx.input), ...ctx.allowedTexts].join("\n");
  const allowed = numberSet(sourceText);
  const sourceLower = sourceText.toLowerCase();
  const withoutPlaceholders = text.replace(PLACEHOLDER_RE, " ");
  for (const line of withoutPlaceholders.split("\n")) {
    // List numbering at line start ("1. ", "2) ") is not a factual number
    const content = line.replace(/^\s*\d{1,2}[.)]\s+/, "");
    for (const m of content.matchAll(NUMBER_RE)) {
      const raw = m[0].trim();
      const d = digitsOf(raw);
      if (!d) continue;
      if (!allowed.has(d)) {
        push({
          level: "red",
          kind: "number",
          text: raw,
          message: `The number “${raw}” is not in your input or the verified evidence and may be made up. Verify or remove it.`,
        });
      }
    }
    for (const m of content.matchAll(CURRENCY_WORD_RE)) {
      if (sourceLower.includes(m[0].toLowerCase())) continue; // already in the user input or evidence
      push({
        level: "red",
        kind: "number",
        text: m[0],
        message: `The amount “${m[0]}” is not in your input or the verified evidence. Verify or remove it.`,
      });
    }
  }

  // 2. Sensitive wording: yellow warning
  const norm = ` ${normalizeText(text).replace(/[^a-z0-9#\- ]/g, " ")} `;
  for (const term of SENSITIVE_TERMS) {
    const t = term.toLowerCase();
    const re = new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&")}([^a-z0-9]|$)`);
    if (re.test(norm)) {
      push({
        level: "yellow",
        kind: "sensitive",
        text: term,
        message: `“${term}” refers to customers, results or partnerships. Make sure the sentence is backed by facts and not overstated.`,
      });
    }
  }

  // 3. Placeholders: remind the user to fill them in
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    push({ level: "yellow", kind: "placeholder", text: m[0], message: `Placeholder ${m[0]} has not been filled in.` });
  }

  // 4. Claims in the fact-check list with no valid source that are still in the body: red
  for (const f of ctx.factMap ?? []) {
    if (!f.ok && claimInText(f.claim, text)) {
      push({
        level: "red",
        kind: "unsupported_claim",
        text: f.claim,
        message: f.reason
          ? `${f.reason} Edit or remove it.`
          : "No source for this sentence in your input or the verified evidence. Edit or remove it.",
      });
    }
  }

  return flags;
}

export function hasBlockingIssues(flags: Flag[]): { red: number; placeholders: number } {
  return {
    red: flags.filter((f) => f.level === "red").length,
    placeholders: flags.filter((f) => f.kind === "placeholder").length,
  };
}
