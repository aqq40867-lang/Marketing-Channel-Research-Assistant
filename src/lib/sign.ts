// Server signatures: checkpoints and channel results are saved by the browser and sent back to the server.
// They are checked with HMAC on the way back so altered page text or “verified” flags can't bypass the code checks.
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string | null {
  const s = process.env.APP_SECRET || process.env.DEEPSEEK_API_KEY;
  return s && s.trim() ? `mcr-v1:${s.trim()}` : null;
}

/** JSON with sorted keys, so the signed content is identical before and after the browser stores it. undefined fields are ignored, as in JSON serialisation. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

export function sign(kind: string, data: unknown): string {
  const s = secret();
  if (!s) return "";
  return createHmac("sha256", s).update(`${kind}\n${stableStringify(data)}`).digest("base64url");
}

export function verify(kind: string, data: unknown, sig: unknown): boolean {
  if (typeof sig !== "string" || !sig) return false;
  const expected = sign(kind, data);
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Channel fields the draft API uses as verified evidence. */
export function channelPayload(c: {
  name: string;
  url: string;
  type: string;
  checks: { key: string; answer: string; note: string; quote: string; sourceUrl: string; verified: boolean }[];
  evidence: { claim: string; quote: string; sourceUrl: string; verified: boolean }[];
  recentTitles: { title: string; verified: boolean }[];
}) {
  return {
    name: c.name,
    url: c.url,
    type: c.type,
    checks: c.checks.map((x) => ({ key: x.key, answer: x.answer, note: x.note, quote: x.quote, sourceUrl: x.sourceUrl, verified: x.verified })),
    evidence: c.evidence.map((x) => ({ claim: x.claim, quote: x.quote, sourceUrl: x.sourceUrl, verified: x.verified })),
    recentTitles: c.recentTitles.map((x) => ({ title: x.title, verified: x.verified })),
  };
}
