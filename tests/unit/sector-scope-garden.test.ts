import { describe, expect, it } from "vitest";
import {
  evaluateSectorScope,
  type ScopeInput,
} from "../../src/domain/sector-preflight/eligibility.js";
import { parseSectorProfile } from "../../src/domain/sector-preflight/profile.js";

const garden = parseSectorProfile({
  categories: [
    { key: "growing", label: "Growing", description: "Seeds, bulbs, plants, compost and soil care." },
    { key: "tools_watering", label: "Tools & watering", description: "Tools, hoses and irrigation." },
    { key: "outdoor_decor", label: "Outdoor decor", description: "Decor, furniture, lighting." },
  ],
  scope: { coreCategories: ["growing"], adjacentCategories: [], scopeKeywords: [] },
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

describe("garden sector scope (core-only profile)", () => {
  it("admits a D2C brand in the core category with no keyword logic", () => {
    const verdict = evaluateSectorScope(classified(), garden);
    expect(verdict.eligible).toBe(true);
    expect(verdict.reason).toBe("sector scope: D2C growing");
  });

  it("excludes non-core categories and non-D2C types", () => {
    expect(evaluateSectorScope(classified({ primaryCategory: "tools_watering" }), garden).eligible).toBe(false);
    expect(evaluateSectorScope(classified({ businessType: "retailer_marketplace" }), garden).eligible).toBe(false);
    expect(evaluateSectorScope(classified({ sellsOwnProducts: false }), garden).eligible).toBe(false);
    expect(evaluateSectorScope(classified({ hasOnlineStore: false }), garden).eligible).toBe(false);
  });
});
