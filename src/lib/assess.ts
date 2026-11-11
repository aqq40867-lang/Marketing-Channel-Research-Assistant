// Code gates: quote verification + admission rules + ranking (pure functions, testable)
import type { JudgementOut } from "./schemas";
import type { Channel, Check, CheckKey, FetchedPage, Paid, RejectedCandidate, SearchHit } from "./types";
import { CHECK_LABEL } from "./types";
import { domainOf, nameInText, normalizeTld, originOf, quoteInText } from "./text";

export const MAX_CHANNELS = 3;

export type AssessResult = { ok: true; channel: Channel } | { ok: false; rejected: RejectedCandidate };

export function assessCandidate(
  j: JudgementOut,
  page: FetchedPage,
  hit: SearchHit,
  marketName: string,
  tld = "",
): AssessResult {
  const src = `${page.title}\n${page.content}`;
  const reject = (reason: string, stage: RejectedCandidate["stage"] = "verify"): AssessResult => ({
    ok: false,
    rejected: { name: j.name || hit.title, url: hit.url, reason, stage },
  });

  if (!j.is_channel) return reject("The page shows this is not a media outlet, website, community or newsletter open to collaboration (e.g. a competitor, a shop or a listicle)", "judge");

  // Gate 1: channel is real — the URL is filled in by code (from search results), and the channel name must appear in the fetched page (title or body)
  if (!nameInText(j.name, src)) {
    return reject(`The channel name “${j.name}” does not appear on the fetched page, so its identity cannot be confirmed`);
  }

  // Gate 2: every quote must match the fetched page word for word
  const keys: CheckKey[] = ["audience", "market", "accepts", "paid"];
  const checks: Check[] = keys.map((k) => {
    const c = j.checks[k];
    const verified = c.quote.trim().length > 0 && quoteInText(c.quote, src);
    return { key: k, answer: c.answer, note: c.note, quote: c.quote, sourceUrl: page.url, verified };
  });
  const byKey = Object.fromEntries(checks.map((c) => [c.key, c])) as Record<CheckKey, Check>;

  // Verified negative answers: exclude immediately
  if (byKey.audience.verified && byKey.audience.answer === "no") return reject("The page shows its audience does not match the target customers");
  if (byKey.market.verified && byKey.market.answer === "no") return reject(`The page shows it is not aimed at the ${marketName} market`);
  if (byKey.accepts.verified && byKey.accepts.answer === "no") return reject("The page shows it does not accept outside contributions or partnerships");

  // The market must be confirmed: by a verified quote, or by the site using the target country's domain (checkable in code)
  const cc = normalizeTld(tld);
  const tldMatch = cc.length > 1 && domainOf(hit.url).endsWith(cc);
  const marketConfirmed = (byKey.market.verified && byKey.market.answer === "yes") || tldMatch;
  if (!marketConfirmed) return reject(`Cannot confirm it targets the ${marketName} market`);
  if (tldMatch && !(byKey.market.verified && byKey.market.answer === "yes")) {
    byKey.market.note = `${byKey.market.note ? `${byKey.market.note}; ` : ""}site uses the ${cc} domain`.trim();
  }

  // Most key checks (audience, market, collaboration) unverified → not eligible for the top 3
  const core = [byKey.audience, byKey.market, byKey.accepts];
  const isConfirmed = (c: Check) => (c.key === "market" ? marketConfirmed : c.verified && c.answer === "yes");
  const coreConfirmed = core.filter(isConfirmed).length;
  if (coreConfirmed < 2) {
    const missing = core
      .filter((c) => !isConfirmed(c))
      .map((c) => CHECK_LABEL[c.key])
      .join(", ");
    return reject(`Most key checks could not be confirmed from the page (unverified: ${missing})`);
  }

  const evidence = j.evidence
    .filter((e) => e.quote.trim().length > 0)
    .map((e) => ({ claim: e.claim, quote: e.quote, sourceUrl: page.url, verified: quoteInText(e.quote, src) }));
  // Recent titles are passed to the email model as verified evidence, so they must also match word for word
  const recentTitles = j.recent_titles.map((t) => ({ title: t, verified: quoteInText(t, src) }));

  const paid: Paid = byKey.paid.verified
    ? byKey.paid.answer === "yes"
      ? "paid"
      : byKey.paid.answer === "no"
        ? "free"
        : "unknown"
    : "unknown";

  const allQuotes = [...checks.filter((c) => c.quote.trim()), ...evidence];
  const evidenceRatio = allQuotes.length ? allQuotes.filter((x) => x.verified).length / allQuotes.length : 0;
  const total = round2(j.audience_relevance * j.reachability * (0.5 + evidenceRatio));

  return {
    ok: true,
    channel: {
      name: j.name,
      url: hit.url,
      homepage: originOf(hit.url),
      type: j.type,
      reason: j.reason,
      paid,
      checks,
      evidence,
      recentTitles,
      scores: { audience: j.audience_relevance, reachability: j.reachability, evidenceRatio: round2(evidenceRatio), total },
      fetchedTitle: page.title,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Ranking: audience relevance × reachability × evidence strength; take the top 3 and never pad. */
export function rankChannels(list: Channel[]): { top: Channel[]; overflow: Channel[] } {
  const sorted = [...list].sort((a, b) => b.scores.total - a.scores.total);
  return { top: sorted.slice(0, MAX_CHANNELS), overflow: sorted.slice(MAX_CHANNELS) };
}

/** Explanation when fewer than 3 are found, e.g. "2 excluded — cannot confirm it targets the UK market". */
export function shortfallNote(count: number, rejected: RejectedCandidate[], market: string): string {
  if (count >= MAX_CHANNELS) return "";
  if (rejected.length === 0) return `Only ${count} qualified channel(s) found: the search results had too few usable candidates.`;
  const groups = new Map<string, number>();
  for (const r of rejected) {
    const why = r.reason.toLowerCase();
    const key = why.includes("market")
      ? `cannot confirm it targets the ${market} market`
      : why.includes("fetch")
        ? "page fetch failed, could not verify"
        : why.includes("key checks")
          ? "key checks could not be confirmed from the page"
          : why.includes("audience")
            ? "audience mismatch"
            : why.includes("does not accept")
              ? "does not accept outside partnerships"
              : why.includes("channel name")
                ? "channel identity could not be confirmed"
                : "other reasons";
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const parts = [...groups.entries()].map(([k, n]) => `${n} excluded — ${k}`);
  return `Only ${count} qualified channel(s) found (not padded): ${parts.join("; ")}.`;
}
