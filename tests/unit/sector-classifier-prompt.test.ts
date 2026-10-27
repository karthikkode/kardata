import { describe, expect, it } from "vitest";
import {
  buildClassifierPrompt,
  classifierSchemaFor,
  parseClassification,
  type ClassifierInput,
} from "../../src/domain/sector-preflight/classify.js";
import {
  SKINCARE_PROFILE,
  parseSectorProfile,
} from "../../src/domain/sector-preflight/profile.js";

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
  scope: { coreCategories: ["growing"], adjacentCategories: [], scopeKeywords: [] },
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

  it("renders skincare exactly as before (v1 categories present)", () => {
    const prompt = buildClassifierPrompt(input(), SKINCARE_PROFILE);
    for (const key of ["skincare", "haircare", "cosmetics_makeup", "body_bath"]) {
      expect(prompt).toContain(`\`${key}\``);
    }
    expect(prompt).not.toContain("{{");
    const schema = JSON.parse(classifierSchemaFor(SKINCARE_PROFILE)) as {
      properties: { primary_category: { enum: string[] } };
    };
    expect(schema.properties.primary_category.enum).toContain("skincare");
    expect(schema.properties.primary_category.enum).toHaveLength(8);
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
          primary_category: "skincare",
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
