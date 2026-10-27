import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateSectorScope, type ScopeInput } from "../../src/domain/sector-preflight/eligibility.js";
import { parseSectorProfile } from "../../src/domain/sector-preflight/profile.js";

const profile = parseSectorProfile(
  JSON.parse(readFileSync(resolve("tests/fixtures/sector-profile.json"), "utf8")),
);

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

describe("evaluateSectorScope (neutral fixture profile)", () => {
  it("admits in-scope business types in a core category", () => {
    expect(evaluateSectorScope(input(), profile)).toEqual({
      eligible: true,
      reason: "sector scope: widgets",
    });
  });

  it("rejects business types outside the profile list, then missing products/store per the require flags", () => {
    const out = evaluateSectorScope(input({ businessType: "clinic_medical" }), profile);
    expect(out.eligible).toBe(false);
    expect(out.reason).toContain("business type clinic_medical out of scope");
    expect(evaluateSectorScope(input({ sellsOwnProducts: false }), profile).reason).toContain("no own products");
    expect(evaluateSectorScope(input({ hasOnlineStore: false }), profile).reason).toContain("no online store");
  });

  it("honours require flags switched off in the profile", () => {
    const relaxed = parseSectorProfile({
      ...JSON.parse(readFileSync(resolve("tests/fixtures/sector-profile.json"), "utf8")),
      scope: {
        ...profile.scope,
        requireSellsOwnProducts: false,
        requireHasOnlineStore: false,
      },
    });
    expect(evaluateSectorScope(input({ sellsOwnProducts: false, hasOnlineStore: false }), relaxed).eligible).toBe(true);
    const open = parseSectorProfile({
      ...JSON.parse(readFileSync(resolve("tests/fixtures/sector-profile.json"), "utf8")),
      scope: { ...profile.scope, businessTypes: ["dtc_brand", "brand_retail_only"] },
    });
    expect(evaluateSectorScope(input({ businessType: "brand_retail_only" }), open).eligible).toBe(true);
  });

  it("admits adjacent categories only with a keyword hit, with neutral reason wording", () => {
    const plain = input({
      primaryCategory: "gadgets",
      reason: "Sells its own gadget line direct.",
      companyName: "Gadget Co",
    });
    expect(evaluateSectorScope(plain, profile)).toEqual({
      eligible: false,
      reason: "sector scope: gadgets out of scope, no keyword hit",
    });
    const hit = input({
      primaryCategory: "gadgets",
      reason: "Sells its own gadget line direct.",
      quote: "our widgetized gadget-grade kit",
      companyName: "Gadget Co",
    });
    expect(evaluateSectorScope(hit, profile)).toEqual({
      eligible: true,
      reason: "sector scope: gadgets, keyword hit (widgetized)",
    });
  });

  it("counts Apollo keywords only when the site was unreadable", () => {
    const base = {
      primaryCategory: "gadgets",
      reason: "Sells its own gadgets direct.",
      companyName: "Gadget Co",
      apolloKeywords: ["gadget-grade hardware", "e-commerce"],
    };
    expect(evaluateSectorScope(input({ ...base, confidence: "high" }), profile).eligible).toBe(false);
    const low = evaluateSectorScope(input({ ...base, confidence: "low" }), profile);
    expect(low.eligible).toBe(true);
    expect(low.reason).toContain("apollo-attested");
  });

  it("rejects off-sector categories even with keywords nearby", () => {
    expect(
      evaluateSectorScope(input({ primaryCategory: "other", reason: "Sells widgetized contact lenses." }), profile),
    ).toEqual({ eligible: false, reason: "sector scope: other out of scope" });
  });
});
