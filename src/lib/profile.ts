// Sender details: name and role. Entered once and stored locally; used to replace placeholders after an email is generated, never sent to the model.
// Product name and URL come straight from the research input.
import type { ResearchInput } from "./types";

export interface SenderProfile {
  senderName: string;
  senderRole: string;
}

export const EMPTY_PROFILE: SenderProfile = { senderName: "", senderRole: "" };

export const PROFILE_LABEL: Record<keyof SenderProfile, string> = {
  senderName: "Your name",
  senderRole: "Your role",
};

/** All values available for placeholders: sender details + product name and URL from the research input. */
export interface FillValues extends SenderProfile {
  productName: string;
  productUrl: string;
}

// The model doesn't always spell placeholders the same way, so common variants are listed here (compared ignoring case and extra spaces)
const ALIASES: Record<keyof FillValues, string[]> = {
  senderName: ["your name", "name", "sender name", "your full name", "full name", "first name", "your first name"],
  senderRole: ["your role", "role", "your title", "title", "job title", "your job title", "your position", "position"],
  productName: ["product name", "your product name", "product", "company name", "your company", "company"],
  productUrl: ["product url", "product link", "product website", "website", "website url", "url", "your website", "link"],
};

const ALIAS_TO_KEY = new Map<string, keyof FillValues>();
for (const k of Object.keys(ALIASES) as (keyof FillValues)[]) for (const a of ALIASES[k]) ALIAS_TO_KEY.set(a, k);

const PLACEHOLDER_RE = /\[([^\]\n]{1,60})\]/g;

/** Keep only known fields; anything else saved by older versions is ignored. */
export function normalizeProfile(raw: unknown): SenderProfile {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return { senderName: str(o.senderName), senderRole: str(o.senderRole) };
}

export function fillValues(profile: SenderProfile, input: Pick<ResearchInput, "productName" | "productUrl">): FillValues {
  return {
    senderName: profile.senderName.trim(),
    senderRole: profile.senderRole.trim(),
    productName: input.productName?.trim() ?? "",
    productUrl: input.productUrl?.trim() ?? "",
  };
}

/** Replace placeholders that are recognised and have a value; leave the rest as they are. */
export function fillPlaceholders(text: string, values: FillValues): string {
  return text.replace(PLACEHOLDER_RE, (whole, inner: string) => {
    const key = ALIAS_TO_KEY.get(inner.trim().toLowerCase().replace(/\s+/g, " "));
    const v = key ? values[key].trim() : "";
    return v || whole;
  });
}

/** Whether the text has any placeholders that can be filled. */
export function hasFillablePlaceholders(text: string, values: FillValues): boolean {
  return fillPlaceholders(text, values) !== text;
}

// Recipient placeholder spellings (compared ignoring case and extra spaces; straight and curly apostrophes both work)
const RECIPIENT_ALIASES = new Set([
  "editor's name", "editor name", "editor", "editor's first name", "name of editor",
  "recipient name", "recipient's name", "contact name", "contact's name", "organiser's name", "organizer's name",
]);

/** Replace recipient placeholders (like [Editor's name]) with “<channel name> team”, e.g. "Hi [Editor's name]," → "Hi UK Small Business Magazine team,". */
export function fillRecipient(text: string, channelName: string): string {
  const name = channelName.trim();
  if (!name) return text;
  return text.replace(PLACEHOLDER_RE, (whole, inner: string) => {
    const k = inner.trim().toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ");
    return RECIPIENT_ALIASES.has(k) ? `${name} team` : whole;
  });
}
