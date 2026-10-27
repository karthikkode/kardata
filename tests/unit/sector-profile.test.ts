import { describe, expect, it } from "vitest";
import { PRIMARY_CATEGORIES } from "../../src/domain/sector-preflight/classify.js";
import { DEFAULT_SKINCARE_RUBRIC } from "../../src/domain/sector-preflight/eligibility.js";
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
  scope: { coreCategories: ["growing"], adjacentCategories: [], scopeKeywords: [] },
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
        scope: { coreCategories: ["nope"], adjacentCategories: [], scopeKeywords: [] },
      }),
    ).toThrowError(/unknown category "nope"/);
  });

  it("rejects core/adjacent overlap and duplicate keys", () => {
    expect(() =>
      parseSectorProfile({
        ...gardenInput,
        scope: { coreCategories: ["growing"], adjacentCategories: ["growing"], scopeKeywords: [] },
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
  it("carries the same categories, scope lists and keywords", () => {
    expect(categoryKeys(SKINCARE_PROFILE)).toEqual([...PRIMARY_CATEGORIES]);
    expect(SKINCARE_PROFILE.scope.coreCategories).toEqual(["skincare", "body_bath", "mens_grooming"]);
    expect(SKINCARE_PROFILE.scope.adjacentCategories).toEqual([
      "haircare",
      "cosmetics_makeup",
      "fragrance",
      "supplements_wellness",
    ]);
    expect(SKINCARE_PROFILE.scope.scopeKeywords).toContain("skin");
    expect(SKINCARE_PROFILE.scope.scopeKeywords).toContain("hyaluron");
    expect(SKINCARE_PROFILE.scope.scopeKeywords.length).toBeGreaterThanOrEqual(40);
    expect(profileHash(SKINCARE_PROFILE)).toHaveLength(16);
  });
});
