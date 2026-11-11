// Core data structures (matches the "Core data structures" section of the PRD)

export type ChannelType = "media" | "smb_site" | "community" | "newsletter";

export const CHANNEL_TYPE_LABEL: Record<ChannelType, string> = {
  media: "Industry media",
  smb_site: "Small-business site",
  community: "Community",
  newsletter: "Newsletter",
};

export type CollabForm = "guest_post" | "article" | "demo";

export const COLLAB_FORM_LABEL: Record<CollabForm, string> = {
  guest_post: "Guest post",
  article: "How-to article",
  demo: "Product demo",
};

export interface ResearchInput {
  product: string; // Product description (required)
  audience: string; // Target customers (required)
  market: string; // Target market (required)
  productName?: string;
  productUrl?: string;
  collabForms: CollabForm[];
  excludeUrls: string[]; // URLs the user chose to exclude
}

export type Paid = "paid" | "free" | "unknown";
export const PAID_LABEL: Record<Paid, string> = { paid: "Paid", free: "Free", unknown: "Payment unknown" };

export type CheckKey = "audience" | "market" | "accepts" | "paid";
export const CHECK_LABEL: Record<CheckKey, string> = {
  audience: "Audience match",
  market: "Targets the market",
  accepts: "Accepts collaboration",
  paid: "Requires payment",
};

export type CheckAnswer = "yes" | "no" | "unclear";

export interface Check {
  key: CheckKey;
  answer: CheckAnswer;
  note: string; // short explanation from the model
  quote: string; // verbatim quote from the page
  sourceUrl: string;
  verified: boolean; // whether the quote was found word-for-word in the fetched page
}

export interface Evidence {
  claim: string; // the claim this evidence supports
  quote: string; // verbatim quote from the page
  sourceUrl: string;
  verified: boolean;
}

export interface Channel {
  name: string;
  url: string; // filled in by code from the search results
  homepage: string;
  type: ChannelType;
  reason: string; // why it fits
  paid: Paid;
  checks: Check[];
  evidence: Evidence[];
  recentTitles: { title: string; verified: boolean }[]; // recent content, used to open the email
  scores: { audience: number; reachability: number; evidenceRatio: number; total: number };
  fetchedTitle: string;
  sig?: string; // server signature; checked when drafting to make sure the evidence was not altered
}

export interface RejectedCandidate {
  name: string;
  url: string;
  reason: string; // why it was excluded
  stage: "fetch" | "judge" | "verify" | "rank" | "duplicate";
}

// ---------- Pipeline checkpoint: completed steps are never re-run ----------

export interface SearchHit {
  id: string; // R1, R2 ...
  url: string;
  title: string;
  snippet: string;
  siteName: string | null;
  query: string;
  score: number;
}

export interface QueryPlan {
  keywords: { topic: string; audience: string; market: string; tld: string };
  queries: { type: ChannelType; q: string }[];
}

export interface ShortlistPick {
  id: string;
  type: ChannelType;
  why: string;
}

export interface FetchedPage {
  id: string;
  url: string;
  ok: boolean;
  title: string;
  content: string; // truncated Markdown body
  error?: string;
  transient?: boolean; // failed with a temporary error (rate limit, timeout…); a retry may succeed
}

export interface Judgement {
  id: string;
  raw: unknown; // model output that passed zod validation
}

export interface Checkpoint {
  plan?: QueryPlan;
  search?: { hits: SearchHit[]; queryStats: { q: string; count: number; error?: string }[] };
  shortlist?: ShortlistPick[];
  pages?: FetchedPage[];
  judgements?: Judgement[];
  v?: number; // schema version (CHECKPOINT_VERSION), covered by the signature
  sig?: string; // server signature; checked on retry to make sure the checkpoint was not altered
}

export type ResearchStatus = "running" | "done" | "partial" | "failed" | "incomplete";
export const STATUS_LABEL: Record<ResearchStatus, string> = {
  running: "Running",
  done: "Done",
  partial: "Partly done",
  failed: "Failed",
  incomplete: "Incomplete",
};

export interface AppError {
  code:
    | "validation"
    | "auth"
    | "balance"
    | "rate_limit"
    | "timeout"
    | "server"
    | "bad_output"
    | "network"
    | "config"
    | "no_results"
    | "fetch_blocked"
    | "unknown";
  message: string; // what happened
  suggestion: string; // what to do next
  step?: StepKey;
  retryable?: boolean; // results are in, but some candidates hit temporary errors; only those can be redone
}

export type StepKey = "plan" | "search" | "shortlist" | "fetch" | "judge" | "rank";
export const STEP_LABEL: Record<StepKey, string> = {
  plan: "Understand input",
  search: "Search candidates",
  shortlist: "Shortlist",
  fetch: "Fetch pages",
  judge: "Check evidence",
  rank: "Filter & rank",
};
export const STEP_ORDER: StepKey[] = ["plan", "search", "shortlist", "fetch", "judge", "rank"];

export interface StepProgress {
  step: StepKey;
  state: "pending" | "active" | "done" | "error" | "skipped";
  detail: string;
}

export interface ResearchSummary {
  queries: string[];
  hitCount: number;
  candidateCount: number;
  shortfallNote: string; // explanation when fewer than 3 are found
}

export interface Research {
  id: string;
  createdAt: string;
  updatedAt: string;
  input: ResearchInput;
  autoExcluded: string[]; // channels already being followed up, excluded automatically
  status: ResearchStatus;
  progress: StepProgress[];
  checkpoint: Checkpoint;
  channels: Channel[];
  rejected: RejectedCandidate[];
  summary?: ResearchSummary;
  error?: AppError;
}

// ---------- Email ----------

export type FlagLevel = "red" | "yellow";
export interface Flag {
  level: FlagLevel;
  kind: "number" | "sensitive" | "placeholder" | "unsupported_claim";
  text: string; // the matched text
  message: string; // explanation
}

export interface FactItem {
  claim: string; // the claim made in the email
  source: "user_input" | "evidence";
  ref: string; // user-input field name or evidence link
  refText: string; // the matching user-input text / evidence quote
  ok: boolean;
  reason?: string; // reason when ok is false
}

export interface Draft {
  researchId: string;
  channelUrl: string;
  channelName: string;
  subject: string;
  body: string;
  flags: Flag[];
  factMap: FactItem[];
  rewriteNote?: string; // note about the automatic rewrite
  allowedTexts: string[]; // verified evidence text, used to re-check numbers while editing
  updatedAt: string;
}

// ---------- Follow-up ----------

export type LeadStage = "todo" | "sent" | "replied" | "negotiating" | "won";
export const STAGES: LeadStage[] = ["todo", "sent", "replied", "negotiating", "won"];
export const STAGE_LABEL: Record<LeadStage, string> = {
  todo: "To contact",
  sent: "Sent",
  replied: "Replied",
  negotiating: "Negotiating",
  won: "Won",
};

export type FailReason =
  | "no_reply"
  | "no_guest"
  | "paid_only"
  | "audience_mismatch"
  | "bad_contact"
  | "other";
export const FAIL_REASON_LABEL: Record<FailReason, string> = {
  no_reply: "No reply",
  no_guest: "No outside contributions",
  paid_only: "Paid partnerships only",
  audience_mismatch: "Audience mismatch",
  bad_contact: "Invalid contact details",
  other: "Other",
};

export interface LeadHistoryItem {
  at: string;
  action: string; // e.g. "To contact → Sent", "Marked failed: No reply"
}

export interface Lead {
  url: string; // dedupe key (normalised domain)
  link: string; // original URL, used for opening
  name: string;
  type?: ChannelType;
  source: "tool" | "manual";
  stage: LeadStage;
  maxStage?: LeadStage; // highest stage ever reached (not lowered when moved back); used by the funnel
  failed: boolean;
  failReason?: FailReason;
  failNote?: string;
  notes: string;
  history: LeadHistoryItem[];
  researchId?: string;
  createdAt: string;
}
