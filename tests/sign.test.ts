import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("sign / verify", () => {
  let mod: typeof import("@/lib/sign");
  beforeAll(async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    mod = await import("@/lib/sign");
  });

  it("survives a JSON round trip through the browser", () => {
    const cp = { plan: { keywords: { topic: "a", audience: "b", market: "UK", tld: ".co.uk" } }, pages: [{ id: "R1", ok: true, error: undefined }] };
    const sig = mod.sign("checkpoint", cp);
    const back = JSON.parse(JSON.stringify(cp));
    expect(mod.verify("checkpoint", back, sig)).toBe(true);
  });
  it("rejects tampered data, wrong kind and missing signature", () => {
    const data = { pages: [{ id: "R1", content: "real page" }] };
    const sig = mod.sign("checkpoint", data);
    expect(mod.verify("checkpoint", { pages: [{ id: "R1", content: "forged page" }] }, sig)).toBe(false);
    expect(mod.verify("channel", data, sig)).toBe(false);
    expect(mod.verify("checkpoint", data, undefined)).toBe(false);
  });
  it("channel payload ignores fields the draft API does not use", () => {
    const base = {
      name: "X", url: "https://x.co.uk", type: "media",
      checks: [{ key: "audience", answer: "yes", note: "", quote: "q", sourceUrl: "u", verified: true }],
      evidence: [], recentTitles: [],
    };
    const sig = mod.sign("channel", mod.channelPayload(base));
    expect(mod.verify("channel", mod.channelPayload({ ...base, reason: "changed" } as typeof base), sig)).toBe(true);
    const forged = { ...base, checks: [{ ...base.checks[0], quote: "invented" }] };
    expect(mod.verify("channel", mod.channelPayload(forged), sig)).toBe(false);
  });
});
