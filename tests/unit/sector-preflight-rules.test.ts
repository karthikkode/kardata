import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateSectorScope, type ScopeInput } from "../../src/domain/sector-preflight/eligibility.js";
import { parseSectorProfile } from "../../src/domain/sector-preflight/profile.js";

const raw = JSON.parse(readFileSync(resolve("tests/fixtures/sector-profile.json"), "utf8"));
const profile = parseSectorProfile(raw);

function input(patch: Partial<ScopeInput> = {}): ScopeInput {
  return {
    businessType: "dtc_brand",
    primaryCategory: "widgets",
    sellsOwnProducts: true,
    hasOnlineStore: true,
    confidence: "high",
    reason: "Storefront sells its own widget line.",
    quote: null,
    companyName: "Widget Co",
    apolloKeywords: [],
    ...patch,
  };
}

describe("sector scope is driven by the profile, not by code defaults", () => {
  it("uses the profile business-type list", () => {
    expect(evaluateSectorScope(input(), profile).eligible).toBe(true);
    for (const businessType of ["clinic_medical", "spa_salon", "distributor_wholesaler", "retailer_marketplace"]) {
      expect(evaluateSectorScope(input({ businessType }), profile).eligible).toBe(false);
    }
    const wider = parseSectorProfile({
      ...raw,
      scope: { ...raw.scope, businessTypes: ["dtc_brand", "clinic_medical"] },
    });
    expect(evaluateSectorScope(input({ businessType: "clinic_medical" }), wider).eligible).toBe(true);
  });

  it("never produces a review state: scope is binary", () => {
    const cases: Partial<ScopeInput>[] = [
      { businessType: "unknown" },
      { businessType: "brand_retail_only" },
      { confidence: "low", primaryCategory: "gadgets" },
      { primaryCategory: "gadgets" },
      { primaryCategory: "other" },
    ];
    for (const patch of cases) {
      expect(evaluateSectorScope(input(patch), profile).eligible).toBe(false);
    }
  });
});
