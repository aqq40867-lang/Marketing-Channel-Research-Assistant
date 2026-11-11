// Text and URL helpers: word-for-word quote matching, domain dedupe. Pure functions shared by server and browser, unit-tested.

/** Normalise text: ignore case, whitespace, Markdown symbols and common punctuation variants (curly quotes, dashes, etc.). */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // keep only the text of Markdown links
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[*_#>|~]/g, " ") // Markdown emphasis, heading, quote and table symbols
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip quotes and ellipses from both ends of a quote; models often add them. */
function trimQuote(q: string): string {
  return q
    .trim()
    .replace(/^["'“”‘’«»\s.…]+/, "")
    .replace(/["'“”‘’«»\s…]+$/, "")
    .replace(/\.{3}$/, "")
    .trim();
}

export const MIN_QUOTE_LENGTH = 12;

/**
 * Whether a quote appears word for word in the source text (after normalisation).
 * When the model elides the middle with "...", every segment must appear in the source in order.
 */
export function quoteInText(quote: string, source: string): boolean {
  const q = trimQuote(quote);
  if (q.length < MIN_QUOTE_LENGTH) return false;
  const src = normalizeText(source);
  const parts = q
    .split(/\.\.\.|…|\[\.\.\.\]/)
    .map((p) => normalizeText(p).replace(/^[\s.,;:]+|[\s.,;:]+$/g, ""))
    .filter((p) => p.length > 0);
  if (parts.length === 0) return false;
  // each segment between ellipses must have a minimum length, so fragments can't be stitched into a "match"
  if (parts.length > 1 && parts.some((p) => p.length < 8)) return false;
  let from = 0;
  for (const p of parts) {
    const idx = src.indexOf(p, from);
    if (idx < 0) return false;
    from = idx + p.length;
  }
  return true;
}

/** Whether a name (channel name) appears in the source text. */
export function nameInText(name: string, source: string): boolean {
  const n = normalizeText(name).replace(/^the /, "");
  if (n.length < 3) return false;
  const src = normalizeText(source);
  if (src.includes(n)) return true;
  // allow spacing differences such as "StartupDonut" vs "Startup Donut"
  return src.replace(/\s/g, "").includes(n.replace(/\s/g, ""));
}

export function safeUrl(u: string): URL | null {
  try {
    const withProto = /^https?:\/\//i.test(u.trim()) ? u.trim() : `https://${u.trim()}`;
    const url = new URL(withProto);
    if (!url.hostname.includes(".")) return null;
    return url;
  } catch {
    return null;
  }
}

/** Main domain (without www.), used to dedupe and exclude by site. */
export function domainOf(u: string): string {
  const url = safeUrl(u);
  return url ? url.hostname.toLowerCase().replace(/^www\./, "") : u.trim().toLowerCase();
}

/** Follow-up dedupe key: the normalised domain (different pages of one site count as one channel, consistent with the exclusion rules). */
export function leadKey(u: string): string {
  const url = safeUrl(u);
  if (!url) return u.trim().toLowerCase();
  return domainOf(u);
}

export function originOf(u: string): string {
  const url = safeUrl(u);
  return url ? `${url.protocol}//${url.hostname}/` : u;
}

/** Whether a URL is on the exclusion list (compared by domain). */
export function isExcluded(u: string, exclude: string[]): boolean {
  const d = domainOf(u);
  return exclude.some((e) => {
    const ed = domainOf(e);
    return ed.length > 0 && (d === ed || d.endsWith(`.${ed}`));
  });
}

// country codes commonly used as generic domains; they can't prove a site targets that country
const GENERIC_CC = new Set(["io", "co", "ai", "me", "tv", "cc", "ly", "fm", "gg", "to", "ws"]);

/**
 * Accept only country-code TLDs (e.g. .co.uk, .com.au, .de); generic domains (.com, .org, .io, etc.) return an empty string.
 * The model's tld must go through this first, otherwise ".com" would let every .com site pass the market check automatically.
 */
export function normalizeTld(t: string): string {
  const s = t.trim().toLowerCase().replace(/^\.?/, ".");
  if (!/^(\.[a-z]{2,4})?\.[a-z]{2}$/.test(s)) return "";
  const parts = s.split(".").filter(Boolean);
  if (parts.length === 1 && GENERIC_CC.has(parts[0])) return "";
  return s;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
