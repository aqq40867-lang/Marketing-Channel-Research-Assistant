import { describe, expect, it } from "vitest";
import { funnel, maxStageOf } from "@/lib/leadStats";
import type { Lead, LeadStage } from "@/lib/types";

const lead = (stage: LeadStage, extra: Partial<Lead> = {}): Lead => ({
  url: `${Math.random()}.example`,
  link: "https://x.example",
  name: "x",
  source: "tool",
  stage,
  failed: false,
  notes: "",
  history: [],
  createdAt: "2026-01-01",
  ...extra,
});

describe("lead funnel", () => {
  it("counts the highest stage ever reached, not the current one", () => {
    // moved back to “Replied” after Won: still counts as having reached Sent and Won
    const l = lead("replied", { maxStage: "won" });
    expect(maxStageOf(l)).toBe("won");
    const f = funnel([l, lead("sent"), lead("todo")]);
    expect(f.reached.map((x) => x.n)).toEqual([3, 2, 1, 1, 1]);
    expect(f.sent).toBe(2);
    expect(f.won).toBe(1);
    expect(f.current.find((x) => x.s === "replied")?.n).toBe(1);
  });

  it("recovers the highest stage from history for leads saved before maxStage existed", () => {
    const old = lead("todo", {
      history: [
        { at: "1", action: "Added to follow-up (recommended): To contact" },
        { at: "2", action: "To contact → Sent" },
        { at: "3", action: "Sent → Negotiating" },
        { at: "4", action: "Marked failed at “Negotiating”: No reply" },
        { at: "5", action: "Negotiating → To contact" },
      ],
    });
    expect(maxStageOf(old)).toBe("negotiating");
  });

  it("failed leads count up to the stage they reached", () => {
    const f = funnel([lead("sent", { failed: true, failReason: "no_reply" })]);
    expect(f.sent).toBe(1);
    expect(f.current.every((x) => x.n === 0)).toBe(true);
  });
});
