import { describe, expect, it } from "vitest";
import {
  evaluateSectorScope,
  type ScopeInput,
} from "../../src/domain/sector-preflight/eligibility.js";
import { parseSectorProfile } from "../../src/domain/sector-preflight/profile.js";

const sample = parseSectorProfile({
  categories: [
    { key: "growing", label: "Growing", description: "Seeds, bulbs, plants, compost and soil care." },
    { key: "tools_watering", label: "Tools & watering", description: "Tools, hoses and irrigation." },
    { key: "outdoor_decor", label: "Outdoor decor", description: "Decor, furniture, lighting." },
  ],
  scope: { coreCategories: ["growing"], adjacentCategories: [], scopeKeywords: [], businessTypes: ["dtc_brand"], requireSellsOwnProducts: true, requireHasOnlineStore: true },
  tiering: { apolloMinPerStaff: 75000, staffEstimatePerHead: 175000, publicCheckPerStaff: 1000000, pressSources: [] },
  promptHints: { retailerExamples: "example retailers", priceTiers: "example tiers", productClaims: "example claims", positioningStory: "example story" },
  classifierHints: {
    serviceExamples: "landscaping, garden design",
    retailerExamples: "garden centres",
    supplierExamples: "trade growers",
  },
});

function classified(overrides: Partial<ScopeInput> = {}): ScopeInput {
  return {
    businessType: "dtc_brand",
    primaryCategory: "growing",
    sellsOwnProducts: true,
    hasOnlineStore: true,
    confidence: "high",
    reason: "sells own-brand seed kits",
    quote: null,
    companyName: "Example Garden Co",
    apolloKeywords: [],
    ...overrides,
  };
}

describe("sample sector scope (core-only profile)", () => {
  it("admits a D2C brand in the core category with no keyword logic", () => {
    const verdict = evaluateSectorScope(classified(), sample);
    expect(verdict.eligible).toBe(true);
    expect(verdict.reason).toBe("sector scope: growing");
  });

  it("excludes non-core categories and non-D2C types", () => {
    expect(evaluateSectorScope(classified({ primaryCategory: "tools_watering" }), sample).eligible).toBe(false);
    expect(evaluateSectorScope(classified({ businessType: "retailer_marketplace" }), sample).eligible).toBe(false);
    expect(evaluateSectorScope(classified({ sellsOwnProducts: false }), sample).eligible).toBe(false);
    expect(evaluateSectorScope(classified({ hasOnlineStore: false }), sample).eligible).toBe(false);
  });
});
