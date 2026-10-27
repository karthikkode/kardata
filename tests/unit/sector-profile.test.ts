import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  categoryKeys,
  parseSectorProfile,
  profileHash,
} from "../../src/domain/sector-preflight/profile.js";

const gardenInput = {
  categories: [
    { key: "growing", label: "Growing", description: "Seeds, bulbs, plants, compost." },
    { key: "tools_watering", label: "Tools & watering", description: "Tools, hoses, irrigation." },
  ],
  scope: { coreCategories: ["growing"], adjacentCategories: [], scopeKeywords: [], businessTypes: ["dtc_brand"], requireSellsOwnProducts: true, requireHasOnlineStore: true },
  tiering: { apolloMinPerStaff: 75000, staffEstimatePerHead: 175000, publicCheckPerStaff: 1000000, pressSources: [] },
  promptHints: { retailerExamples: "example retailers", priceTiers: "example tiers", productClaims: "example claims", positioningStory: "example story" },
  classifierHints: {
    serviceExamples: "landscaping, garden design",
    retailerExamples: "garden centres, DIY chains",
    supplierExamples: "growers selling only to trade",
  },
};

describe("parseSectorProfile", () => {
  it("auto-adds other and keeps declared categories", () => {
    const profile = parseSectorProfile(gardenInput);
    expect(categoryKeys(profile)).toEqual(["growing", "tools_watering", "other"]);
  });

  it("rejects unknown keys in scope", () => {
    expect(() =>
      parseSectorProfile({
        ...gardenInput,
        scope: { ...gardenInput.scope, coreCategories: ["nope"] },
      }),
    ).toThrowError(/unknown category "nope"/);
  });

  it("rejects core/adjacent overlap and duplicate keys", () => {
    expect(() =>
      parseSectorProfile({
        ...gardenInput,
        scope: { ...gardenInput.scope, adjacentCategories: ["growing"] },
      }),
    ).toThrowError(/both core and adjacent/);
    expect(() =>
      parseSectorProfile({
        ...gardenInput,
        categories: [...gardenInput.categories, gardenInput.categories[0]!],
      }),
    ).toThrowError(/duplicate/);
  });

  it("rejects non-snake-case keys and too many categories", () => {
    expect(() =>
      parseSectorProfile({
        ...gardenInput,
        categories: [{ key: "NotSnake", label: "X", description: "x" }],
      }),
    ).toThrowError(/snake_case/);
    const many = Array.from({ length: 20 }, (_, i) => ({
      key: `cat_${i}`,
      label: `Cat ${i}`,
      description: "x",
    }));
    expect(() => parseSectorProfile({ ...gardenInput, categories: many })).toThrowError(/at most 20/);
  });
});

describe("profile v2 fields", () => {
  it("rejects a business type outside BUSINESS_TYPES and an over-long prompt hint", () => {
    expect(() =>
      parseSectorProfile({
        ...gardenInput,
        scope: { ...gardenInput.scope, businessTypes: ["not_a_type"] },
      }),
    ).toThrowError(/invalid sector profile/);
    expect(() =>
      parseSectorProfile({
        ...gardenInput,
        promptHints: { ...gardenInput.promptHints, priceTiers: "x".repeat(301) },
      }),
    ).toThrowError(/invalid sector profile/);
  });

  it("rejects a profile carrying the removed rubric field", () => {
    expect(() => parseSectorProfile({ ...gardenInput, rubric: {} })).toThrowError(/invalid sector profile/);
  });

  it("profileHash covers category keys only", () => {
    const a = parseSectorProfile(gardenInput);
    const b = parseSectorProfile({
      ...gardenInput,
      promptHints: { ...gardenInput.promptHints, priceTiers: "different tiers" },
      tiering: { ...gardenInput.tiering, apolloMinPerStaff: 1 },
    });
    expect(profileHash(a)).toBe(profileHash(b));
  });
});

describe("neutral fixture profile", () => {
  it("parses tests/fixtures/sector-profile.json with invented categories", () => {
    const profile = parseSectorProfile(
      JSON.parse(readFileSync(resolve("tests/fixtures/sector-profile.json"), "utf8")),
    );
    expect(categoryKeys(profile)).toEqual(["widgets", "gadgets", "other"]);
    expect(profile.scope.coreCategories).toEqual(["widgets"]);
    expect(profile.scope.adjacentCategories).toEqual(["gadgets"]);
    expect(profile.scope.businessTypes).toEqual(["dtc_brand"]);
    expect(profile.tiering.pressSources).toEqual(["example trade press"]);
    expect(profileHash(profile)).toHaveLength(16);
  });
});
