import { describe, expect, it } from "vitest";
import { buildQueries } from "@/lib/queries";

describe("buildQueries", () => {
  it("covers four channel types with outreach phrases, lang and length limit", () => {
    const q = buildQueries({ topic: "task management", audience: "small business owners", market: "UK", tld: ".co.uk" });
    expect(q.length).toBeGreaterThanOrEqual(8);
    expect(new Set(q.map((x) => x.type))).toEqual(new Set(["media", "smb_site", "community", "newsletter"]));
    expect(q.some((x) => x.q.includes('"write for us"'))).toBe(true);
    expect(q.some((x) => x.q.includes("site:.co.uk"))).toBe(true);
    expect(q.every((x) => x.q.includes("lang:en") || x.q.length >= 120)).toBe(true);
    expect(q.every((x) => x.q.length <= 128)).toBe(true);
  });
});
