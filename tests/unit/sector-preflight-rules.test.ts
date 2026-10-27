import { describe, expect, it } from "vitest";
import {
  DEFAULT_SKINCARE_RUBRIC,
  deriveForCompany,
  eligibilityRubricSchema,
  evaluateClassification,
} from "../../src/domain/sector-preflight/eligibility.js";

const DTC = {
  businessType: "dtc_brand",
  primaryCategory: "skincare",
  sellsOwnProducts: true,
  hasOnlineStore: true,
  confidence: "high",
};

describe("evaluateClassification (default skincare rubric)", () => {
  it("accepts dtc skincare with its own store", () => {
    expect(evaluateClassification(DTC, DEFAULT_SKINCARE_RUBRIC).eligibility).toBe("eligible");
  });

  it("rejects clinics, spas, distributors outright", () => {
    for (const businessType of ["clinic_medical", "spa_salon", "distributor_wholesaler", "retailer_marketplace"]) {
      expect(evaluateClassification({ ...DTC, businessType }, DEFAULT_SKINCARE_RUBRIC).eligibility).toBe("ineligible");
    }
  });

  it("sends retail-only, unknown, low-confidence and off-category to review", () => {
    expect(evaluateClassification({ ...DTC, businessType: "brand_retail_only" }, DEFAULT_SKINCARE_RUBRIC).eligibility).toBe("review");
    expect(evaluateClassification({ ...DTC, businessType: "unknown" }, DEFAULT_SKINCARE_RUBRIC).eligibility).toBe("review");
    expect(evaluateClassification({ ...DTC, confidence: "low" }, DEFAULT_SKINCARE_RUBRIC).eligibility).toBe("review");
    expect(evaluateClassification({ ...DTC, primaryCategory: "haircare" }, DEFAULT_SKINCARE_RUBRIC).eligibility).toBe("review");
  });

  it("requires own products and own store for eligible", () => {
    expect(evaluateClassification({ ...DTC, sellsOwnProducts: false }, DEFAULT_SKINCARE_RUBRIC).eligibility).toBe("ineligible");
    expect(evaluateClassification({ ...DTC, hasOnlineStore: false }, DEFAULT_SKINCARE_RUBRIC).eligibility).toBe("ineligible");
  });
});

describe("evaluateClassification (low confidence, garden-style rubric)", () => {
  const GARDEN = {
    eligible: {
      businessTypes: ["dtc_brand"],
      primaryCategories: ["outdoor_furniture", "growing"],
      requireSellsOwnProducts: true,
      requireHasOnlineStore: true,
    },
    review: { businessTypes: ["brand_retail_only", "unknown"], primaryCategories: [], lowConfidence: true },
  };
  const low = (businessType: string, primaryCategory: string) => ({
    ...DTC,
    businessType,
    primaryCategory,
    confidence: "low",
  });

  it("reviews a possible qualifier", () => {
    expect(evaluateClassification(low("dtc_brand", "outdoor_furniture"), GARDEN)).toEqual({
      eligibility: "review",
      reason: "needs review: low confidence, possible dtc_brand/outdoor_furniture",
    });
    expect(evaluateClassification(low("brand_retail_only", "growing"), GARDEN).eligibility).toBe("review");
    expect(evaluateClassification(low("unknown", "other"), GARDEN).eligibility).toBe("review");
  });

  it("rejects a clear non-qualifier even when unsure", () => {
    expect(evaluateClassification(low("retailer_marketplace", "outdoor_furniture"), GARDEN).eligibility).toBe("ineligible");
    expect(evaluateClassification(low("distributor_wholesaler", "other"), GARDEN).eligibility).toBe("ineligible");
    expect(evaluateClassification(low("dtc_brand", "other"), GARDEN).eligibility).toBe("ineligible");
  });

  it("still reviews an unsure retail-only brand outside the categories via its type", () => {
    expect(evaluateClassification(low("brand_retail_only", "other"), GARDEN).reason).toBe(
      "needs review: business_type brand_retail_only",
    );
  });

  it("is off when the rubric disables it", () => {
    const off = { ...GARDEN, review: { ...GARDEN.review, lowConfidence: false } };
    expect(evaluateClassification(low("dtc_brand", "outdoor_furniture"), off).eligibility).toBe("eligible");
  });
});

describe("deriveForCompany", () => {
  it("is pending without a classification", () => {
    expect(deriveForCompany({ classification: null, override: null, rubric: DEFAULT_SKINCARE_RUBRIC })).toEqual({
      eligibility: "pending",
      source: null,
      reason: null,
    });
  });

  it("lets overrides win both ways, even unclassified", () => {
    expect(
      deriveForCompany({
        classification: null,
        override: { decision: "include", note: "owner knows best" },
        rubric: DEFAULT_SKINCARE_RUBRIC,
      }),
    ).toEqual({ eligibility: "eligible", source: "override", reason: "owner knows best" });
    expect(
      deriveForCompany({
        classification: DTC,
        override: { decision: "exclude", note: "" },
        rubric: DEFAULT_SKINCARE_RUBRIC,
      }).eligibility,
    ).toBe("ineligible");
  });
});

describe("eligibilityRubricSchema", () => {
  it("rejects unknown keys and bad shapes", () => {
    expect(eligibilityRubricSchema.safeParse(DEFAULT_SKINCARE_RUBRIC).success).toBe(true);
    expect(eligibilityRubricSchema.safeParse({ ...DEFAULT_SKINCARE_RUBRIC, bogus: 1 }).success).toBe(false);
    expect(eligibilityRubricSchema.safeParse({ eligible: DEFAULT_SKINCARE_RUBRIC.eligible }).success).toBe(false);
  });
});
