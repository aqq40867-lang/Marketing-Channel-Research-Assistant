import { describe, expect, it } from "vitest";
import { checkEmail, claimInText, numbersSupported } from "@/lib/emailCheck";
import type { ResearchInput } from "@/lib/types";

const input: ResearchInput = {
  product: "A task management product for small teams of 1 to 20 people: assign tasks and set deadline reminders.",
  audience: "Owners of UK small businesses with 1 to 20 people",
  market: "UK",
  productName: "",
  productUrl: "",
  collabForms: [],
  excludeUrls: [],
};

describe("checkEmail", () => {
  it("allows numbers from user input and list markers", () => {
    const body = "Hi,\nWe build a task tool for teams of 1 to 20 people.\n1. First idea\n2. Second idea\nB2B teams welcome.";
    const flags = checkEmail("Idea", body, { input, allowedTexts: [] });
    expect(flags.filter((f) => f.kind === "number")).toHaveLength(0);
  });
  it("flags invented numbers, percentages and currency", () => {
    const body = "Our customers save 30% of their time. Over 5,000 teams use it. Plans from £9.";
    const flags = checkEmail("Hello", body, { input, allowedTexts: [] });
    const nums = flags.filter((f) => f.kind === "number").map((f) => f.text);
    expect(nums.some((t) => t.includes("30"))).toBe(true);
    expect(nums.some((t) => t.includes("5,000"))).toBe(true);
    expect(nums.some((t) => t.includes("£9"))).toBe(true);
    expect(flags.every((f) => f.kind !== "number" || f.level === "red")).toBe(true);
  });
  it("allows numbers present in verified evidence", () => {
    const flags = checkEmail("Re: your piece", 'I enjoyed "7 tips for hiring your first employee".', {
      input,
      allowedTexts: ["7 tips for hiring your first employee"],
    });
    expect(flags.filter((f) => f.kind === "number")).toHaveLength(0);
  });
  it("flags sensitive wording yellow and placeholders", () => {
    const flags = checkEmail("Hi", "We are the leading tool, trusted by founders.\n\n[Your name]", { input, allowedTexts: [] });
    expect(flags.find((f) => f.text === "leading")?.level).toBe("yellow");
    expect(flags.find((f) => f.text === "trusted by")?.level).toBe("yellow");
    expect(flags.find((f) => f.kind === "placeholder")?.text).toBe("[Your name]");
  });
  it("does not flag substrings (users inside 'reusers' etc.)", () => {
    const flags = checkEmail("Hi", "Misleading headlines aside.", { input, allowedTexts: [] });
    expect(flags.find((f) => f.text === "leading")).toBeUndefined();
  });
  it("flags unsupported claims still present in body", () => {
    const flags = checkEmail("Hi", "We partner with your publisher.", {
      input,
      allowedTexts: [],
      factMap: [{ claim: "We partner with your publisher.", source: "evidence", ref: "E9", refText: "", ok: false }],
    });
    expect(flags.find((f) => f.kind === "unsupported_claim")?.level).toBe("red");
  });
  it("flags an unsupported claim even when the body paraphrases it", () => {
    const flags = checkEmail("Hi", "Hello there.\nOur small business clients have saved hours every week with the planner.", {
      input,
      allowedTexts: [],
      factMap: [{ claim: "Small business clients save hours every week using our planner", source: "user_input", ref: "Product description", refText: "", ok: false }],
    });
    expect(flags.find((f) => f.kind === "unsupported_claim")?.level).toBe("red");
  });
  it("does not flag an unsupported claim after the user removed it", () => {
    const flags = checkEmail("Hi", "We make a task tool for small teams.", {
      input,
      allowedTexts: [],
      factMap: [{ claim: "Small business clients save hours every week using our planner", source: "user_input", ref: "Product description", refText: "", ok: false }],
    });
    expect(flags.find((f) => f.kind === "unsupported_claim")).toBeUndefined();
  });
  it("allows currency words that the user provided", () => {
    const withPrice = { ...input, product: `${input.product} Priced in pounds per seat.` };
    const flags = checkEmail("Hi", "Pricing is in pounds.", { input: withPrice, allowedTexts: [] });
    expect(flags.filter((f) => f.kind === "number")).toHaveLength(0);
  });
});

describe("claim helpers", () => {
  it("numbersSupported requires every number in the claim to be in the source", () => {
    expect(numbersSupported("teams of 1 to 20 people", input.product)).toBe(true);
    expect(numbersSupported("teams of up to 50 people", input.product)).toBe(false);
    expect(numbersSupported("no numbers here", "")).toBe(true);
  });
  it("claimInText matches by keywords within one sentence", () => {
    expect(claimInText("We partner with your publisher", "Note: we partner with your publisher.")).toBe(true);
    expect(claimInText("Small business clients save hours every week", "We sell software. Clients like it.")).toBe(false);
  });
});
