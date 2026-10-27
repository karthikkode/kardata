import { describe, expect, it } from "vitest";
import { PRIMARY_CATEGORIES } from "../../src/domain/sector-preflight/classify.js";
import {
  DEFAULT_SKINCARE_RUBRIC,
  SCOPE_ADJACENT_CATEGORIES,
  SCOPE_CORE_CATEGORIES,
  SKIN_KEYWORDS,
} from "../../src/domain/sector-preflight/eligibility.js";
import {
  SKINCARE_PROFILE,
  categoryKeys,
  parseSectorProfile,
  profileHash,
  validateRubricAgainstProfile,
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

describe("rubric validation against the profile", () => {
  it("accepts the skincare rubric against the skincare profile", () => {
    expect(() => validateRubricAgainstProfile(DEFAULT_SKINCARE_RUBRIC, SKINCARE_PROFILE)).not.toThrow();
  });

  it("rejects rubric categories the profile does not declare", () => {
    const profile = parseSectorProfile(gardenInput);
    expect(() => validateRubricAgainstProfile(DEFAULT_SKINCARE_RUBRIC, profile)).toThrowError(
      /unknown category "skincare"/,
    );
  });
});

describe("SKINCARE_PROFILE matches the old constants field for field", () => {
  it("equals the pre-5.4 constants exactly: categories, scope, keywords, hints", () => {
    expect(SKINCARE_PROFILE).toEqual({
      categories: [
        { key: "skincare", label: "Skincare", description: "Skin care products: cleansers, serums, moisturisers, SPF, treatments." },
        { key: "haircare", label: "Haircare", description: "Hair care products: shampoo, conditioner, styling, treatments." },
        { key: "cosmetics_makeup", label: "Cosmetics & makeup", description: "Colour cosmetics and makeup." },
        { key: "body_bath", label: "Body & bath", description: "Body care, bath, hand and foot care." },
        { key: "fragrance", label: "Fragrance", description: "Perfume, fragrance, home scent." },
        { key: "supplements_wellness", label: "Supplements & wellness", description: "Supplements and wellness products and devices." },
        { key: "mens_grooming", label: "Men's grooming", description: "Men's grooming and shaving products." },
        { key: "other", label: "Other", description: "A real business whose main lane is none of the listed categories." },
      ],
      scope: {
        coreCategories: ["skincare", "body_bath", "mens_grooming"],
        adjacentCategories: ["haircare", "cosmetics_makeup", "fragrance", "supplements_wellness"],
        scopeKeywords: [
          "skin", "derma", "dermat", "collagen", "elastin", "retinol", "retinoid", "tretinoin",
          "hyaluron", "niacinamide", "peptid", "ceramid", "moisturiz", "moisturis", "serum",
          "acne", "eczema", "psoriasis", "rosacea", "sunscreen", "sun screen", "suncare",
          "sun care", "spf", "exfoliat", "cleanser", "facial", "face wash", "facewash",
          "toner", "lotion", "night cream", "day cream", "eye cream", "vitamin c", "glycolic",
          "salicylic", "azelaic", "kojic", "anti-ag", "antiag", "wrinkle", "dark spot",
          "hyperpigment", "melasma", "skin barrier",
        ],
        businessTypes: ["dtc_brand"],
        requireSellsOwnProducts: true,
        requireHasOnlineStore: true,
      },
      classifierHints: {
        serviceExamples: "spa, salon, barbershop, beauty services without own product line",
        retailerExamples: "beauty store, pharmacy chain, marketplace selling other brands",
        supplierExamples: "raw ingredients, packaging, or equipment supplier",
      },
      tiering: {
        apolloMinPerStaff: 75000,
        staffEstimatePerHead: 175000,
        publicCheckPerStaff: 1000000,
        pressSources: [
          "wwd", "women's wear daily", "beautymatter", "beauty independent", "happi",
          "premium beauty", "cosmeticsbusiness", "cosmetics business", "little pink book", "body+soul",
        ],
      },
      promptHints: {
        retailerExamples: "Sephora, Ulta, Target, Boots, Amazon, pharmacies",
        priceTiers: "masstige, prestige, luxury, budget",
        productClaims: "clean, vegan, dermatologist-tested, ingredient stories",
        positioningStory: "ingredient story",
      },
    });
    // And against the surviving pre-5.4 constants themselves, not just literals.
    expect(categoryKeys(SKINCARE_PROFILE)).toEqual([...PRIMARY_CATEGORIES]);
    expect(SKINCARE_PROFILE.scope.coreCategories).toEqual([...SCOPE_CORE_CATEGORIES]);
    expect(SKINCARE_PROFILE.scope.adjacentCategories).toEqual([...SCOPE_ADJACENT_CATEGORIES]);
    expect(SKINCARE_PROFILE.scope.scopeKeywords).toEqual([...SKIN_KEYWORDS]);
    expect(SKINCARE_PROFILE.scope.coreCategories).toEqual(DEFAULT_SKINCARE_RUBRIC.eligible.primaryCategories);
    expect(SKINCARE_PROFILE.scope.adjacentCategories).toEqual(DEFAULT_SKINCARE_RUBRIC.review.primaryCategories);
    expect(profileHash(SKINCARE_PROFILE)).toHaveLength(16);
  });
});
