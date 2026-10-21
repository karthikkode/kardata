import { describe, expect, it } from "vitest";
import { evaluateSectorScope, type ScopeInput } from "../../src/domain/sector-preflight/eligibility.js";

function input(patch: Partial<ScopeInput> = {}): ScopeInput {
  return {
    businessType: "dtc_brand",
    primaryCategory: "skincare",
    sellsOwnProducts: true,
    hasOnlineStore: true,
    confidence: "high",
    reason: "Shopify storefront sells its own skincare line.",
    quote: null,
    companyName: "Skin Co",
    apolloKeywords: [],
    ...patch,
  };
}

describe("evaluateSectorScope", () => {
  it("admits D2C core-category sellers", () => {
    for (const primaryCategory of ["skincare", "body_bath", "mens_grooming"]) {
      const verdict = evaluateSectorScope(input({ primaryCategory }));
      expect(verdict).toEqual({ eligible: true, reason: `sector scope: D2C ${primaryCategory}` });
    }
  });

  it("rejects non-D2C, product-less and store-less sellers first", () => {
    expect(evaluateSectorScope(input({ businessType: "clinic_medical" })).eligible).toBe(false);
    expect(evaluateSectorScope(input({ businessType: "spa_salon" })).reason).toContain("not D2C");
    expect(evaluateSectorScope(input({ sellsOwnProducts: false })).reason).toContain("no own products");
    expect(evaluateSectorScope(input({ hasOnlineStore: false })).reason).toContain("no online store");
  });

  it("admits adjacent categories only with skin evidence", () => {
    const makeup = input({
      primaryCategory: "cosmetics_makeup",
      reason: "Sells its own makeup line direct.",
      quote: null,
      companyName: "Glam Co",
    });
    expect(evaluateSectorScope(makeup)).toEqual({
      eligible: false,
      reason: "sector scope: cosmetics_makeup out of scope, not skin-related",
    });
    const skinMakeup = input({
      primaryCategory: "cosmetics_makeup",
      reason: "Sells its own makeup line direct.",
      quote: "skincare-infused foundation with SPF",
      companyName: "Glam Co",
    });
    expect(evaluateSectorScope(skinMakeup).eligible).toBe(true);
    expect(evaluateSectorScope(skinMakeup).reason).toContain("skin-related");
  });

  it("finds skin evidence in the company name", () => {
    const byName = input({
      primaryCategory: "haircare",
      reason: "Sells its own hair products direct.",
      companyName: "SkinFix Hair",
      apolloKeywords: [],
    });
    expect(evaluateSectorScope(byName).eligible).toBe(true);
  });

  it("counts Apollo keywords only when the site was unreadable", () => {
    const base = {
      primaryCategory: "supplements_wellness",
      reason: "Sells its own vitamins direct.",
      companyName: "Vita Co",
      apolloKeywords: ["collagen peptides", "e-commerce"],
    };
    // Readable site without skin evidence: Apollo soup does not save it.
    expect(evaluateSectorScope(input({ ...base, confidence: "high" })).eligible).toBe(false);
    // Blocked site: Apollo is the only evidence and it counts.
    const low = evaluateSectorScope(input({ ...base, confidence: "low" }));
    expect(low.eligible).toBe(true);
    expect(low.reason).toContain("apollo-attested");
  });

  it("rejects off-sector categories even with skin words nearby", () => {
    const verdict = evaluateSectorScope(
      input({ primaryCategory: "other", reason: "Sells its own contact lenses with skin-tone packaging." }),
    );
    expect(verdict).toEqual({ eligible: false, reason: "sector scope: other out of scope" });
  });
});
