import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { categoryKeys, parseSectorProfile } from "../../src/domain/sector-preflight/profile.js";

const GARDEN_KEYS = [
  "growing",
  "tools_watering",
  "planters_structures",
  "outdoor_furniture",
  "outdoor_cooking_heating",
  "lighting_decor",
  "wildlife",
  "lawn_care",
];

describe("docs/plans/stage-5.4-garden-profile.json (first non-skincare profile)", () => {
  const raw = JSON.parse(
    readFileSync(resolve("docs/plans/stage-5.4-garden-profile.json"), "utf8"),
  ) as Record<string, unknown>;

  it("parses and validates against the profile schema", () => {
    const profile = parseSectorProfile(raw);
    expect(raw.name).toBe("garden-outdoor");
    expect(String(raw.description)).not.toMatch(/synthetic/i);
    expect(categoryKeys(profile)).toEqual([...GARDEN_KEYS, "other"]);
    expect(profile.scope.coreCategories).toEqual(GARDEN_KEYS);
    expect(profile.scope.adjacentCategories).toEqual([]);
    expect(profile.classifierHints).toEqual({
      serviceExamples: "landscaping, lawn and garden maintenance, garden design, tree surgery, florists and flower delivery",
      retailerExamples:
        "garden centres, DIY and hardware chains, national store chains that sell mainly through their own stores even with own-label ranges, department stores, multi-brand online outdoor retailers",
      supplierExamples: "growers selling only to trade, horticultural wholesalers",
    });
  });

  it("carries v2 scope fields matching its old rubric", () => {
    const profile = parseSectorProfile(raw);
    expect(profile.scope.businessTypes).toEqual(["dtc_brand"]);
    expect(profile.scope.requireSellsOwnProducts).toBe(true);
    expect(profile.scope.requireHasOnlineStore).toBe(true);
    expect(raw.rubric).toBeUndefined();
  });
});
