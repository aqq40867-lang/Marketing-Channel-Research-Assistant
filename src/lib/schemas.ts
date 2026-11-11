// zod validation: request bodies and model output
import { z } from "zod";

const collabForm = z.enum(["guest_post", "article", "demo"]);
export const channelTypeSchema = z.enum(["media", "smb_site", "community", "newsletter"]);

export const MIN_FIELD_LENGTH = 10;

export const researchInputSchema = z.object({
  product: z.string().trim().min(MIN_FIELD_LENGTH, "Product description needs at least 10 characters: say what the product does and who it is for"),
  audience: z.string().trim().min(MIN_FIELD_LENGTH, "Target customers needs at least 10 characters: describe the customer type and size"),
  market: z.string().trim().min(2, "Enter a target market, e.g. UK"),
  productName: z.string().trim().max(80).optional().default(""),
  productUrl: z.string().trim().max(300).optional().default(""),
  collabForms: z.array(collabForm).default([]),
  excludeUrls: z.array(z.string()).default([]),
});

// ---------- Model output ----------

export const keywordSchema = z.object({
  topic: z.string().min(2).max(60),
  audience: z.string().min(2).max(60),
  market: z.string().min(2).max(40),
  tld: z.string().max(10).default(""),
});

// The shortlist only requires the outer shape {"picks": [...]}; each item is cleaned up separately by normalizeShortlistPicks,
// so one bad item is dropped on its own instead of failing the whole batch.
export const shortlistSchema = z.object({
  picks: z.array(z.unknown()),
});

type ChannelTypeValue = z.infer<typeof channelTypeSchema>;

const TYPE_SYNONYMS: [RegExp, ChannelTypeValue][] = [
  [/newsletter|e-?mail/, "newsletter"],
  [/community|forum|network|association|group|club|chamber|meetup|event/, "community"],
  [/media|magazine|publication|publisher|news|journal|press|podcast/, "media"],
];

/** Map the model's type to one of the 4 fixed values; anything unrecognised (including a copied "a|b|c") becomes smb_site. */
export function normalizeChannelType(raw: unknown): ChannelTypeValue {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const exact = channelTypeSchema.safeParse(s);
  if (exact.success) return exact.data;
  if (s.includes("|")) return "smb_site";
  for (const [re, t] of TYPE_SYNONYMS) if (re.test(s)) return t;
  return "smb_site";
}

/** Normalise "r3", "R3.", 3, " R3 " etc. to "R3"; return null if that is not possible. */
export function normalizeResultId(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^\d+$/.test(s)) return `R${Number(s)}`;
  const m = /^R(\d+)$/.exec(s);
  return m ? `R${Number(m[1])}` : null;
}

export interface NormalizedPick {
  id: string;
  type: ChannelTypeValue;
  why: string;
}

/** Clean up shortlist items one by one. Returns the cleaned candidates and how many were dropped for unrecognised ids. */
export function normalizeShortlistPicks(raw: unknown[]): { picks: NormalizedPick[]; dropped: number } {
  const picks: NormalizedPick[] = [];
  let dropped = 0;
  for (const item of raw) {
    const o = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const id = o ? normalizeResultId(o.id) : null;
    if (!o || !id) {
      dropped++;
      continue;
    }
    picks.push({
      id,
      type: normalizeChannelType(o.type),
      why: typeof o.why === "string" ? o.why.trim().slice(0, 300) : "",
    });
  }
  return { picks, dropped };
}

const answer = z.enum(["yes", "no", "unclear"]);
const check = z.object({ answer, note: z.string().max(300).default(""), quote: z.string().max(600).default("") });

export const judgementSchema = z.object({
  is_channel: z.boolean(),
  name: z.string().min(1).max(120),
  type: channelTypeSchema,
  reason: z.string().max(400),
  checks: z.object({
    audience: check,
    market: check,
    accepts: check,
    paid: check,
  }),
  evidence: z
    .array(z.object({ claim: z.string().max(300), quote: z.string().max(600) }))
    .max(6)
    .default([]),
  recent_titles: z.array(z.string().max(200)).max(5).default([]),
  audience_relevance: z.number().min(1).max(5),
  reachability: z.number().min(1).max(5),
});
export type JudgementOut = z.infer<typeof judgementSchema>;

// ---------- Checkpoint (saved by the browser, sent back to the server, validated against the current shape on restore) ----------

/** Checkpoint schema version. Bump it when any schema below (or judgementSchema) changes incompatibly; old checkpoints are then discarded and redone from scratch. */
export const CHECKPOINT_VERSION = 1;

export const checkpointStepSchemas = {
  plan: z.object({
    keywords: z.object({ topic: z.string(), audience: z.string(), market: z.string(), tld: z.string() }),
    queries: z.array(z.object({ type: channelTypeSchema, q: z.string() })),
  }),
  search: z.object({
    hits: z.array(
      z.object({
        id: z.string(),
        url: z.string(),
        title: z.string(),
        snippet: z.string(),
        siteName: z.string().nullable(),
        query: z.string(),
        score: z.number(),
      }),
    ),
    queryStats: z.array(z.object({ q: z.string(), count: z.number(), error: z.string().optional() })),
  }),
  shortlist: z.array(z.object({ id: z.string(), type: channelTypeSchema, why: z.string() })),
  pages: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      ok: z.boolean(),
      title: z.string(),
      content: z.string(),
      error: z.string().optional(),
      transient: z.boolean().optional(),
    }),
  ),
};

export const draftSchema = z.object({
  subject: z.string().min(3).max(200),
  body: z.string().min(50).max(5000),
  claims: z
    .array(
      z.object({
        claim: z.string().max(400),
        source: z.enum(["user_input", "evidence"]),
        ref: z.string().max(60),
      }),
    )
    .max(20)
    .default([]),
});
export type DraftOut = z.infer<typeof draftSchema>;

// ---------- /api/draft request body ----------

export const draftRequestSchema = z.object({
  input: researchInputSchema,
  channel: z.object({
    name: z.string(),
    url: z.string(),
    type: channelTypeSchema,
    reason: z.string(),
    evidence: z.array(z.object({ claim: z.string(), quote: z.string(), sourceUrl: z.string(), verified: z.boolean() })),
    recentTitles: z.array(z.object({ title: z.string(), verified: z.boolean() })),
    checks: z.array(
      z.object({
        key: z.string(),
        answer: z.string(),
        note: z.string(),
        quote: z.string(),
        sourceUrl: z.string(),
        verified: z.boolean(),
      }),
    ),
    sig: z.string().optional(),
  }),
});
