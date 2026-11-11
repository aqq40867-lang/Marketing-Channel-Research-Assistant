import { describe, expect, it } from "vitest";
import { assessCandidate, rankChannels, shortfallNote } from "@/lib/assess";
import type { JudgementOut } from "@/lib/schemas";
import type { FetchedPage, SearchHit } from "@/lib/types";

const page: FetchedPage = {
  id: "R1",
  url: "https://www.example.co.uk/write-for-us",
  ok: true,
  title: "Write for Example Biz",
  content:
    "Example Biz is the UK's site for small business owners and start-ups. We welcome guest articles from experts. We do not charge for contributed articles.",
};
const hit: SearchHit = { id: "R1", url: page.url, title: "Write for us | Example Biz", snippet: "", siteName: null, query: "", score: 2 };

function j(over: Partial<JudgementOut> = {}): JudgementOut {
  return {
    is_channel: true,
    name: "Example Biz",
    type: "smb_site",
    reason: "Dedicated to UK small business owners; accepts expert contributions",
    checks: {
      audience: { answer: "yes", note: "", quote: "site for small business owners and start-ups" },
      market: { answer: "yes", note: "", quote: "Example Biz is the UK's site" },
      accepts: { answer: "yes", note: "", quote: "We welcome guest articles from experts" },
      paid: { answer: "no", note: "", quote: "We do not charge for contributed articles" },
    },
    evidence: [{ claim: "made up", quote: "Trusted by 10,000 businesses" }],
    recent_titles: [],
    audience_relevance: 5,
    reachability: 5,
    ...over,
  };
}

describe("assessCandidate", () => {
  it("accepts a well-evidenced channel and marks invented evidence unverified", () => {
    const r = assessCandidate(j(), page, hit, "UK", ".co.uk");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.channel.url).toBe(hit.url); // url comes from search result, not model
    expect(r.channel.paid).toBe("free");
    expect(r.channel.checks.every((c) => c.verified)).toBe(true);
    expect(r.channel.evidence[0].verified).toBe(false);
  });
  it("rejects when the channel name is not on the page", () => {
    const r = assessCandidate(j({ name: "Totally Real Magazine" }), page, hit, "UK");
    expect(r.ok).toBe(false);
  });
  it("rejects when the channel name only appears in the search result title", () => {
    const r = assessCandidate(j({ name: "Write for us" }), { ...page, title: "", content: page.content }, hit, "UK", ".co.uk");
    expect(r.ok).toBe(false);
  });
  it("does not treat a generic .com tld as market confirmation", () => {
    const j2 = j();
    j2.checks.market = { answer: "unclear", note: "", quote: "" };
    const r = assessCandidate(j2, { ...page, url: "https://example.com/x" }, { ...hit, url: "https://example.com/x" }, "US", ".com");
    expect(r.ok).toBe(false);
  });
  it("only verifies recent titles that appear verbatim", () => {
    const r = assessCandidate(j({ recent_titles: ["Example Biz", "We welcome guest articles from experts"] }), page, hit, "UK", ".co.uk");
    expect(r.ok && r.channel.recentTitles.map((t) => t.verified)).toEqual([false, true]);
  });
  it("rejects when market cannot be confirmed and domain is not local", () => {
    const j2 = j();
    j2.checks.market = { answer: "yes", note: "", quote: "Proudly serving British firms since forever" };
    const r = assessCandidate(j2, { ...page, url: "https://example.com/x" }, { ...hit, url: "https://example.com/x" }, "UK", ".co.uk");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejected.reason).toContain("Cannot confirm it targets the UK market");
  });
  it("accepts market via ccTLD when quote missing", () => {
    const j2 = j();
    j2.checks.market = { answer: "unclear", note: "", quote: "" };
    expect(assessCandidate(j2, page, hit, "UK", ".co.uk").ok).toBe(true);
  });
  it("rejects when key checks mostly unconfirmed", () => {
    const j2 = j();
    j2.checks.audience = { answer: "yes", note: "", quote: "made up audience sentence here" };
    j2.checks.accepts = { answer: "yes", note: "", quote: "made up accepts sentence here" };
    const r = assessCandidate(j2, page, hit, "UK", ".co.uk");
    expect(r.ok).toBe(false);
  });
  it("paid stays unknown when the quote is not verified", () => {
    const j2 = j();
    j2.checks.paid = { answer: "yes", note: "", quote: "Sponsored posts cost £500" };
    const r = assessCandidate(j2, page, hit, "UK", ".co.uk");
    expect(r.ok && r.channel.paid).toBe("unknown");
  });
});

describe("ranking", () => {
  it("takes top 3 and explains shortfall", () => {
    const r = assessCandidate(j(), page, hit, "UK", ".co.uk");
    if (!r.ok) throw new Error();
    const { top } = rankChannels([r.channel]);
    expect(top).toHaveLength(1);
    const note = shortfallNote(1, [
      { name: "a", url: "x", reason: "Cannot confirm it targets the UK market", stage: "verify" },
      { name: "b", url: "y", reason: "Cannot confirm it targets the UK market", stage: "verify" },
    ], "UK");
    expect(note).toContain("2 excluded — cannot confirm it targets the UK market");
  });
});
