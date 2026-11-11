import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const judgement = {
  is_channel: true,
  name: "Startup Donut",
  type: "smb_site",
  reason: "r",
  checks: {
    audience: { answer: "yes", note: "", quote: "" },
    market: { answer: "yes", note: "", quote: "" },
    accepts: { answer: "yes", note: "", quote: "" },
    paid: { answer: "unclear", note: "", quote: "" },
  },
  evidence: [],
  recent_titles: [],
  audience_relevance: 4,
  reachability: 4,
};

const full = {
  v: 1,
  plan: { keywords: { topic: "t", audience: "a", market: "UK", tld: ".co.uk" }, queries: [{ type: "media", q: "x" }] },
  search: { hits: [{ id: "R1", url: "https://x.co.uk", title: "X", snippet: "", siteName: null, query: "x", score: 1 }], queryStats: [] },
  shortlist: [{ id: "R1", type: "media", why: "w" }],
  pages: [{ id: "R1", url: "https://x.co.uk", ok: true, title: "X", content: "c" }],
  judgements: [{ id: "R1", raw: judgement }],
};

describe("restoreCheckpoint", () => {
  let sign: typeof import("@/lib/sign").sign;
  let restore: typeof import("@/lib/checkpoint").restoreCheckpoint;
  const signed = (data: object) => ({ ...data, sig: sign("checkpoint", data) });

  beforeAll(async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    sign = (await import("@/lib/sign")).sign;
    restore = (await import("@/lib/checkpoint")).restoreCheckpoint;
  });

  it("keeps a valid checkpoint, including one saved before versions existed", () => {
    expect(restore(signed(full)).checkpoint.judgements).toHaveLength(1);
    const { v: _v, ...old } = full;
    const r = restore(signed(old));
    expect(r.dropped).toEqual([]);
    expect(r.checkpoint.pages).toHaveLength(1);
  });

  it("drops everything on bad signature or another version", () => {
    expect(restore({ ...full, sig: "forged" }).checkpoint).toEqual({});
    expect(restore(signed({ ...full, v: 2 })).checkpoint).toEqual({});
    expect(restore(undefined).checkpoint).toEqual({});
  });

  it("redoes a step whose structure changed, and every step after it", () => {
    const r = restore(signed({ ...full, shortlist: [{ id: "R1", kind: "media" }] }));
    expect(r.checkpoint.plan).toBeDefined();
    expect(r.checkpoint.search).toBeDefined();
    expect(r.checkpoint.shortlist).toBeUndefined();
    expect(r.checkpoint.pages).toBeUndefined();
    expect(r.checkpoint.judgements).toBeUndefined();
  });

  it("re-validates each model judgement and drops only the stale ones", () => {
    const { recent_titles: _t, ...stale } = judgement;
    const r = restore(signed({ ...full, judgements: [{ id: "R1", raw: judgement }, { id: "R2", raw: { ...stale, audience_relevance: "high" } }] }));
    expect(r.checkpoint.judgements?.map((j) => j.id)).toEqual(["R1"]);
    expect(r.dropped).toEqual(["judgement R2"]);
  });
});
