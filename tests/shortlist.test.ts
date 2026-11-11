import { describe, expect, it } from "vitest";
import { normalizeChannelType, normalizeResultId, normalizeShortlistPicks, shortlistSchema } from "../src/lib/schemas";

describe("shortlist normalisation", () => {
  it("ids: common spellings are normalised to R plus a number", () => {
    expect(normalizeResultId("R3")).toBe("R3");
    expect(normalizeResultId("r3")).toBe("R3");
    expect(normalizeResultId(" R3. ")).toBe("R3");
    expect(normalizeResultId(3)).toBe("R3");
    expect(normalizeResultId("R03")).toBe("R3");
    expect(normalizeResultId("abc")).toBeNull();
    expect(normalizeResultId(undefined)).toBeNull();
  });

  it("types: fixed values kept, synonyms mapped, unrecognised ones become smb_site", () => {
    expect(normalizeChannelType("newsletter")).toBe("newsletter");
    expect(normalizeChannelType("Media")).toBe("media");
    expect(normalizeChannelType("magazine")).toBe("media");
    expect(normalizeChannelType("forum")).toBe("community");
    expect(normalizeChannelType("email newsletter")).toBe("newsletter");
    expect(normalizeChannelType("media|smb_site|community|newsletter")).toBe("smb_site");
    expect(normalizeChannelType("blog")).toBe("smb_site");
    expect(normalizeChannelType(undefined)).toBe("smb_site");
  });

  it("one bad item is dropped on its own; the rest are kept", () => {
    const out = shortlistSchema.parse({
      picks: [
        { id: "R1", type: "media", why: "good" },
        { id: "??", type: "media", why: "broken id" },
        "not an object",
        { id: "r5", type: "media|smb_site|community|newsletter" },
      ],
    });
    const { picks, dropped } = normalizeShortlistPicks(out.picks);
    expect(dropped).toBe(2);
    expect(picks).toEqual([
      { id: "R1", type: "media", why: "good" },
      { id: "R5", type: "smb_site", why: "" },
    ]);
  });

  it("a wrong outer shape still throws (so chatJson retries)", () => {
    expect(shortlistSchema.safeParse({ results: [] }).success).toBe(false);
  });
});
