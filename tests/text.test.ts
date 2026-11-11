import { describe, expect, it } from "vitest";
import { domainOf, isExcluded, leadKey, nameInText, normalizeText, normalizeTld, quoteInText } from "@/lib/text";

const PAGE = `# Write for us\n\nWe welcome **contributions** from experts who want to help UK small business owners.\n\nArticles must be original — no promotional content. We don’t charge for publication.`;

describe("quoteInText", () => {
  it("matches verbatim ignoring case, whitespace and markdown", () => {
    expect(quoteInText("We welcome contributions from experts", PAGE)).toBe(true);
    expect(quoteInText("we  welcome\ncontributions FROM experts", PAGE)).toBe(true);
  });
  it("normalizes curly quotes and dashes", () => {
    expect(quoteInText("We don't charge for publication", PAGE)).toBe(true);
    expect(quoteInText("Articles must be original - no promotional content", PAGE)).toBe(true);
  });
  it("strips surrounding quotes", () => {
    expect(quoteInText('"help UK small business owners."', PAGE)).toBe(true);
  });
  it("rejects paraphrases and invented text", () => {
    expect(quoteInText("We accept guest posts from UK experts", PAGE)).toBe(false);
    expect(quoteInText("We charge £200 per post", PAGE)).toBe(false);
  });
  it("rejects too-short quotes", () => {
    expect(quoteInText("UK", PAGE)).toBe(false);
  });
  it("supports ellipsis only with ordered, substantial parts", () => {
    expect(quoteInText("We welcome contributions ... UK small business owners", PAGE)).toBe(true);
    expect(quoteInText("UK small business owners ... We welcome contributions", PAGE)).toBe(false);
  });
});

describe("nameInText / urls", () => {
  it("finds channel name with spacing differences", () => {
    expect(nameInText("Startup Donut", "Welcome to StartupDonut, the site for...")).toBe(true);
    expect(nameInText("Fake Media", PAGE)).toBe(false);
  });
  it("domain helpers", () => {
    expect(domainOf("https://www.smallbusiness.co.uk/write-for-us/")).toBe("smallbusiness.co.uk");
    expect(leadKey("smallbusiness.co.uk")).toBe("smallbusiness.co.uk");
    expect(isExcluded("https://blog.example.co.uk/x", ["example.co.uk"])).toBe(true);
    expect(isExcluded("https://notexample.co.uk/x", ["example.co.uk"])).toBe(false);
  });
  it("normalizeText collapses markdown links", () => {
    expect(normalizeText("[Read more](https://x.com) now")).toBe("read more now");
  });
});

describe("normalizeTld", () => {
  it("keeps country-code domains and drops generic ones", () => {
    expect(normalizeTld(".co.uk")).toBe(".co.uk");
    expect(normalizeTld("com.au")).toBe(".com.au");
    expect(normalizeTld(".DE")).toBe(".de");
    expect(normalizeTld(".com")).toBe("");
    expect(normalizeTld(".org")).toBe("");
    expect(normalizeTld(".io")).toBe("");
    expect(normalizeTld("")).toBe("");
  });
});
