// Query generation: four channel types × common outreach phrases (pure function, testable)
import type { ChannelType, QueryPlan } from "./types";

const MAX_QUERY = 128;

function clip(q: string): string {
  const s = q.replace(/\s+/g, " ").trim();
  if (s.length <= MAX_QUERY) return s;
  // when too long, shorten the topic first and keep the operators
  return s.slice(0, MAX_QUERY).replace(/\s\S*$/, "");
}

/**
 * Generate about 10 queries.
 * - Industry media / small-business sites: phrases like "write for us", "contributor guidelines", "guest post" to find submission pages
 * - Communities: community / forum / network
 * - Newsletters: newsletter / sponsor
 * Each query gets lang:en; when there is a country TLD, some queries add a site: filter.
 */
export function buildQueries(kw: QueryPlan["keywords"]): QueryPlan["queries"] {
  const { topic, audience, market, tld } = kw;
  const lang = "lang:en";
  const site = tld ? `site:${tld.replace(/^\.?/, ".")}` : "";
  const list: { type: ChannelType; q: string }[] = [
    { type: "media", q: `${audience} ${market} magazine "write for us" ${lang}` },
    { type: "media", q: `${topic} ${market} "contributor guidelines" ${lang}` },
    { type: "media", q: `${topic} blog "guest post" ${market} ${site} ${lang}` },
    { type: "smb_site", q: `${market} small business advice "write for us" ${lang}` },
    { type: "smb_site", q: `${audience} ${market} "submit an article" OR "become a contributor" ${lang}` },
    { type: "smb_site", q: `${audience} resources ${market} ${site} ${lang}` },
    { type: "community", q: `${audience} ${market} community members network ${lang}` },
    { type: "community", q: `${audience} ${market} forum OR "online community" ${lang}` },
    { type: "newsletter", q: `${audience} ${market} newsletter subscribe ${lang}` },
    { type: "newsletter", q: `${topic} newsletter "sponsor" OR "advertise" ${market} ${lang}` },
  ];
  const seen = new Set<string>();
  return list
    .map((x) => ({ ...x, q: clip(x.q) }))
    .filter((x) => (seen.has(x.q) ? false : (seen.add(x.q), true)));
}
