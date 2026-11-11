import { describe, expect, it } from "vitest";
import { checkEmail } from "@/lib/emailCheck";
import { fillPlaceholders, fillRecipient, fillValues, hasFillablePlaceholders, normalizeProfile } from "@/lib/profile";
import type { ResearchInput } from "@/lib/types";

const input: ResearchInput = {
  product: "Task management product",
  audience: "UK small businesses",
  market: "UK",
  productName: "TaskFlow",
  productUrl: "https://taskflow.example",
  collabForms: [],
  excludeUrls: [],
};
const profile = { senderName: "Yan Wei", senderRole: "Founder" };

describe("fillPlaceholders", () => {
  it("fills sender info from the profile and product info from the research input", () => {
    const body = "I'm [Your name], [Your role] at [Product name].\n\n[Your name]\n[Product name] – [Product URL]";
    expect(fillPlaceholders(body, fillValues(profile, input))).toBe(
      "I'm Yan Wei, Founder at TaskFlow.\n\nYan Wei\nTaskFlow – https://taskflow.example",
    );
  });

  it("ignores case, spacing and common variants", () => {
    expect(fillPlaceholders("[your  NAME] / [Your Title] / [Product URL ] / [Website]", fillValues(profile, input))).toBe(
      "Yan Wei / Founder / https://taskflow.example / https://taskflow.example",
    );
  });

  it("keeps placeholders it cannot fill", () => {
    const v = fillValues({ senderName: "Yan Wei", senderRole: "" }, { productName: "", productUrl: "" });
    expect(fillPlaceholders("Hi [Editor's name], I'm [Your name], [Your role] at [Product name].", v)).toBe(
      "Hi [Editor's name], I'm Yan Wei, [Your role] at [Product name].",
    );
    expect(hasFillablePlaceholders("Hi [Editor's name], [Your role]", v)).toBe(false);
  });
});

describe("normalizeProfile", () => {
  it("keeps only sender fields from older saved data", () => {
    expect(normalizeProfile({ senderName: "A", senderRole: "B", productName: "old" })).toEqual({ senderName: "A", senderRole: "B" });
    expect(normalizeProfile(null)).toEqual({ senderName: "", senderRole: "" });
  });
});

describe("checkEmail after filling", () => {
  it("does not flag digits that come from the sender profile", () => {
    const p = { senderName: "Yan Wei", senderRole: "Head of Growth, Team 7" };
    const v = fillValues(p, input);
    const body = fillPlaceholders("Thanks,\n[Your name]\n[Your role]\n[Product name]", v);
    const flags = checkEmail("Hello", body, { input, allowedTexts: [v.senderName, v.senderRole] });
    expect(flags.filter((f) => f.kind === "number" || f.kind === "placeholder")).toHaveLength(0);
  });
});

describe("fillRecipient", () => {
  it("replaces the editor placeholder with the channel name", () => {
    expect(fillRecipient("Hi [Editor's name],\n\nI'm [Your name].", "UK Small Business Magazine")).toBe(
      "Hi UK Small Business Magazine team,\n\nI'm [Your name].",
    );
    expect(fillRecipient("Hi [editor\u2019s  Name],", "SmallBiz Weekly")).toBe("Hi SmallBiz Weekly team,");
  });

  it("leaves text alone when there is no channel name", () => {
    expect(fillRecipient("Hi [Editor's name],", "  ")).toBe("Hi [Editor's name],");
  });
});
