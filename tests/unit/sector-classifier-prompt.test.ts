import { describe, expect, it } from "vitest";
import {
  buildClassifierPrompt,
  classifierSchemaFor,
  parseClassification,
  type ClassifierInput,
} from "../../src/domain/sector-preflight/classify.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSectorProfile } from "../../src/domain/sector-preflight/profile.js";

const sample = parseSectorProfile(
  JSON.parse(readFileSync(resolve("tests/fixtures/sector-profile.json"), "utf8")),
);

const company = {
  id: "00000000-0000-0000-0000-000000000001",
  source: "manual",
  name: "Example Co",
  domain: "example.test",
  website: "https://example.test",
  industry: "Retail",
  keywords: [],
  employees: 5,
  country: "Australia",
  raw: {},
  overrides: null,
} as unknown as ClassifierInput["company"];

function input(): ClassifierInput {
  return { company, description: "Sells things.", pages: [], shopify: null, apolloOnly: true };
}

const garden = parseSectorProfile({
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

describe("classifier prompt and schema from a profile", () => {
  it("renders the garden categories and hints, nothing sector-foreign", () => {
    const prompt = buildClassifierPrompt(input(), garden);
    expect(prompt).toContain("`growing`");
    expect(prompt).toContain("landscaping, garden design");
    expect(prompt).not.toContain("skincare");
    expect(prompt).not.toContain("{{");
  });

  it("renders the sample-sector categories from the fixture profile", () => {
    const prompt = buildClassifierPrompt(input(), sample);
    for (const key of ["widgets", "gadgets", "other"]) {
      expect(prompt).toContain(`\`${key}\``);
    }
    expect(prompt).not.toContain("{{");
    const schema = JSON.parse(classifierSchemaFor(sample)) as {
      properties: { primary_category: { enum: string[] } };
    };
    expect(schema.properties.primary_category.enum).toContain("widgets");
    expect(schema.properties.primary_category.enum).toHaveLength(3);
  });

  it("generates a runtime enum and rejects undeclared categories", () => {
    const schema = JSON.parse(classifierSchemaFor(garden)) as {
      properties: { primary_category: { enum: string[] } };
    };
    expect(schema.properties.primary_category.enum).toEqual(
      expect.arrayContaining(["growing", "tools_watering", "outdoor_decor", "other"]),
    );
    expect(() =>
      parseClassification(
        {
          business_type: "dtc_brand",
          primary_category: "widgets",
          sells_own_products: true,
          has_online_store: true,
          ships_to: [],
          confidence: "low",
          reason: "Wrong sector lane.",
          quote: null,
          quote_source_id: null,
        },
        garden,
      ),
    ).toThrowError(/invalid classification/);
  });
});
