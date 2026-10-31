import { describe, expect, it } from "vitest";
import { brochureDate, splitBrochureItems } from "../../src/domain/ria-steps/brochure.js";
import { pickFirmWebsite, feePrompt } from "../../src/domain/ria-steps/handlers.js";


describe("pickFirmWebsite (B3)", () => {
  it("drops social URLs and lower-cases the firm's own site", () => {
    expect(pickFirmWebsite("https://www.linkedin.com/company/acme")).toBeNull();
    expect(pickFirmWebsite("HTTPS://ACME-Wealth.COM/about")).toBe("https://www.acme-wealth.com");
    expect(pickFirmWebsite(null)).toBeNull();
  });
});


describe("splitBrochureItems / brochureDate (B4)", () => {
  const text = [
    "Form ADV Part 2A 03/15/2025",
    "Item 4 Advisory Business",
    "We provide wealth management to individuals and families across the country with discretionary authority.",
    "Item 5 Fees and Compensation",
    "Our fee is tiered from 1.00% to 0.50% of assets under management and billed quarterly in advance with proration.",
    "Item 9 Disciplinary Information",
    "We have no disciplinary events to report at this time for the firm or its management persons.",
  ].join("\n");

  it("splits Items 4, 5 and 9", () => {
    const items = splitBrochureItems(text);
    expect(Object.keys(items).sort()).toEqual(["4", "5", "9"]);
    expect(items["5"]).toContain("tiered");
  });

  it("reads the brochure date", () => {
    expect(brochureDate(text)).toBe("2025-03-15");
    expect(brochureDate("no date here")).toBeNull();
  });
});


describe("feePrompt (B5)", () => {
  it("carries the Item 5 text and the verbatim-quote rule", () => {
    const prompt = feePrompt("Fees are tiered and negotiable.", "");
    expect(prompt).toContain("Fees are tiered and negotiable.");
    expect(prompt).toContain("Never invent a quote");
  });
});

