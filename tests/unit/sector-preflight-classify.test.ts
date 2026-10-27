import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseClassification } from "../../src/domain/sector-preflight/classify.js";
import { parseSectorProfile } from "../../src/domain/sector-preflight/profile.js";

const profile = parseSectorProfile(
  JSON.parse(readFileSync(resolve("tests/fixtures/sector-profile.json"), "utf8")),
);

const GOOD = {
  business_type: "dtc_brand",
  primary_category: "widgets",
  sells_own_products: true,
  has_online_store: true,
  ships_to: ["Australia"],
  confidence: "high",
  reason: "Own-brand serum sold through an on-site cart.",
  quote: "buy our serum online today",
  quote_source_id: "123e4567-e89b-12d3-a456-426614174000",
};

describe("parseClassification", () => {
  it("accepts a valid classification", () => {
    expect(parseClassification(GOOD, profile)).toEqual(GOOD);
  });

  it("accepts an Apollo-only classification (null quote)", () => {
    expect(parseClassification({ ...GOOD, quote: null, quote_source_id: null, confidence: "low" }, profile).confidence).toBe("low");
  });

  it("rejects unknown enum values", () => {
    expect(() => parseClassification({ ...GOOD, business_type: "cult" }, profile)).toThrow(/business_type/);
    expect(() => parseClassification({ ...GOOD, primary_category: "teeth" }, profile)).toThrow(/primary_category/);
  });

  it("rejects a source id without a quote", () => {
    expect(() => parseClassification({ ...GOOD, quote: null }, profile)).toThrow(/without a quote/);
  });

  it("rejects missing keys and over-long reasons", () => {
    const { reason, ...rest } = GOOD;
    void reason;
    expect(() => parseClassification(rest, profile)).toThrow(/reason/);
    expect(() => parseClassification({ ...GOOD, reason: "x".repeat(501) }, profile)).toThrow(/reason/);
  });
});
