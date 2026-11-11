// Prompts. Principle: the model understands and writes; facts may only come from search/fetched pages and user input.
import type { ChannelType, CollabForm, ResearchInput, SearchHit } from "./types";

const FORM_EN: Record<CollabForm, string> = {
  guest_post: "guest post / contributed article",
  article: "a practical how-to article for their readers",
  demo: "a product demo or Q&A session",
};

function inputBlock(input: ResearchInput): string {
  return [
    `Product description: ${input.product}`,
    `Target customers: ${input.audience}`,
    `Target market: ${input.market}`,
    input.productName ? `Product name: ${input.productName}` : "",
    input.productUrl ? `Product URL: ${input.productUrl}` : "",
    input.collabForms.length
      ? `Preferred collaboration forms: ${input.collabForms.map((f) => FORM_EN[f]).join("; ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------- 1. Understand input → English keywords ----------
export const KEYWORD_SYSTEM = `You turn a product brief (possibly not in English) into short English search keywords.
Return JSON: {"topic": string, "audience": string, "market": string, "tld": string}
- topic: 2-4 English words describing the product category (e.g. "task management").
- audience: 2-5 English words for the target customers (e.g. "small business owners").
- market: the country/region name in English (e.g. "UK").
- tld: the country-code top-level domain if the market is a single country with a common ccTLD used by local sites (e.g. ".co.uk" for UK, ".com.au" for Australia, ".de" for Germany), else "".
Do not add anything not implied by the brief.`;

export function keywordUser(input: ResearchInput): string {
  return inputBlock(input);
}

// ---------- 3. Shortlist ----------
export const SHORTLIST_SYSTEM = `You are a careful marketing researcher shortlisting promotion channels.
You will get a product brief and numbered search results (R1, R2, ...).
Pick 6 to 8 results that most likely are REAL channels where the product owner could publish or present to the target customers:
industry media / magazines, small-business advice websites, communities / networks, or email newsletters.
Rules:
- Refer to results ONLY by their id (e.g. "R3"). Never invent ids or URLs.
- Prefer niche channels that specifically serve the target customers over general mass media (affinity over raw traffic).
- Prefer pages that show a way to collaborate (write for us, contributor guidelines, events, newsletter sponsorship).
- Skip directories of listicles, SEO link farms, marketplaces selling guest posts, job boards, social media posts, and the product's competitors.
- At most one pick per website.
- Fewer picks is fine if results are weak. Do not pad.
- "type" must be exactly one of these four words: media, smb_site, community, newsletter.
- Keep each "why" to one short English sentence.
Return JSON, for example: {"picks": [{"id": "R3", "type": "media", "why": "one short sentence"}, {"id": "R7", "type": "newsletter", "why": "one short sentence"}]}`;

export function shortlistUser(input: ResearchInput, hits: SearchHit[]): string {
  const lines = hits.map(
    (h) => `${h.id} | ${h.title} | ${h.url} | ${h.snippet.replace(/\s+/g, " ").slice(0, 260)}`,
  );
  return `${inputBlock(input)}\n\nSearch results:\n${lines.join("\n")}`;
}

// ---------- 5. Judge (based on the fetched page) ----------
export const JUDGE_SYSTEM = `You assess ONE candidate promotion channel using ONLY the page text provided.
Every judgement must be backed by a VERBATIM quote copied character-for-character from the page text (one sentence or a short phrase, 15-200 characters). Code will check each quote against the page; paraphrased or invented quotes will be marked unverified.
If the page does not say something, answer "unclear" and leave quote empty. Never guess prices, traffic, audience size, or partnerships.

Return JSON:
{
 "is_channel": boolean,          // false if this is not a media/website/community/newsletter that could feature the product (e.g. a competitor, a shop, a listicle)
 "name": string,                 // the channel's own name exactly as written on the page
 "type": "media"|"smb_site"|"community"|"newsletter",
 "reason": string,               // English, 1-2 sentences: why the audience matches and how to collaborate. Do not mention "high traffic" or promise results
 "checks": {
   "audience": {"answer": "yes"|"no"|"unclear", "note": "short English note", "quote": "verbatim"},  // Does it serve the target customers?
   "market":   {"answer": ..., "note": ..., "quote": ...},  // Is it aimed at the target market/country?
   "accepts":  {"answer": ..., "note": ..., "quote": ...},  // Does it accept contributed articles / guest posts / demos / sponsors from outside?
   "paid":     {"answer": ..., "note": ..., "quote": ...}   // "yes" = collaboration requires payment, "no" = explicitly free, "unclear" = page doesn't say
 },
 "evidence": [{"claim": "English claim", "quote": "verbatim"}],   // 1-4 extra supporting quotes
 "recent_titles": [string],      // up to 3 recent article/post titles copied verbatim from the page, if visible
 "audience_relevance": 1-5,      // how specifically it serves the target customers (5 = dedicated to them)
 "reachability": 1-5             // how clearly an outsider can approach them (5 = explicit submission/sponsor page)
}`;

export function judgeUser(input: ResearchInput, url: string, title: string, content: string): string {
  return `${inputBlock(input)}\n\nCandidate URL: ${url}\nPage title: ${title}\n\nPAGE TEXT (Markdown):\n"""\n${content}\n"""`;
}

// ---------- Email ----------
const PROPOSAL_BY_TYPE: Record<ChannelType, string> = {
  media: "Propose 2-3 specific contributed-article (guest post) topics that would be useful to their readers.",
  smb_site: "Propose 2-3 specific practical article topics that fit their advice content.",
  newsletter: "Propose 2-3 practical article / tip ideas suitable for a newsletter issue.",
  community: "Propose one product demo or a Q&A / workshop session for members.",
};

export const DRAFT_SYSTEM = `You write a short, honest English outreach email from a product owner to the editor/organiser of a promotion channel.
STRICT FACT RULES (code will check):
- Use ONLY facts from the USER INPUT and the VERIFIED EVIDENCE (E1, E2...). Do not invent anything else.
- Never add numbers, prices, percentages, customer counts, user counts, results, awards, testimonials, or partnerships that are not in the user input.
- Do not use hype: no "leading", "proven", "trusted by", "increase", "boost", "guarantee".
- If information is missing (sender name, product name, URL, role), use placeholders like [Your name], [Product name], [Product URL], [Your role].
- When referring to the channel's content, only mention things present in the verified evidence or verified recent titles.
- Do not number list items with digits; use "-" bullets for topic ideas.
EVIDENCE MARKS (for the sender's review; they will be removed before sending):
- In the body, right after each sentence or bullet that uses verified evidence, put the evidence id(s) in square brackets before the final full stop, e.g. "...your guide to managing cash flow [E2]." or "[E1][E3]".
- Only use ids that appear under VERIFIED EVIDENCE. Do not mark facts from the user input. Do not put marks in the subject.
STRUCTURE of body (plain text, 120-220 words):
1. Greeting: "Hi <person's first name>," if an editor's name is in the evidence; otherwise "Hi <CHANNEL name> team," using the CHANNEL name exactly as given (never "[Editor's name]")
2. Who we are (1-2 sentences, from user input)
3. Why you (reference their specific content from evidence)
4. Proposal (follow the proposal instruction)
5. What we'd like them to reply with (one clear, low-effort ask)
6. Sign-off: "Thanks," then on separate lines the sender name, role and product URL (use [Your name], [Your role], [Product URL] where unknown). Do NOT put the product name in the sign-off.
Also return "claims": every factual statement in the email about the product or about the channel, each with its source:
 - {"claim": "...", "source": "user_input", "ref": one of "product"|"audience"|"market"|"productName"|"productUrl"}
 - {"claim": "...", "source": "evidence", "ref": "E1" (the evidence id)}
Return JSON: {"subject": string, "body": string, "claims": [...]}`;

export function draftUser(
  input: ResearchInput,
  ch: { name: string; url: string; type: ChannelType },
  evidence: { id: string; text: string }[],
  feedback?: string,
): string {
  const forms = input.collabForms.length
    ? `The sender prefers: ${input.collabForms.map((f) => FORM_EN[f]).join("; ")}.`
    : "";
  return [
    "USER INPUT:",
    `product: ${input.product}`,
    `audience: ${input.audience}`,
    `market: ${input.market}`,
    `productName: ${input.productName || "(not provided — use [Product name])"}`,
    `productUrl: ${input.productUrl || "(not provided — use [Product URL])"}`,
    "",
    `CHANNEL: ${ch.name} (${ch.url}), type: ${ch.type}`,
    `PROPOSAL INSTRUCTION: ${PROPOSAL_BY_TYPE[ch.type]} ${forms}`,
    "",
    "VERIFIED EVIDENCE:",
    ...(evidence.length ? evidence.map((e) => `${e.id}: ${e.text}`) : ["(none — keep 'why you' general and do not invent specifics)"]),
    feedback ? `\nYOUR PREVIOUS DRAFT HAD PROBLEMS. Fix them:\n${feedback}` : "",
  ].join("\n");
}
