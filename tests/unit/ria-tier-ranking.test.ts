import { expect, it } from "vitest";
import { tierHeavyBooks } from "../../src/domain/sector-preflight/ria-ranking.js";

it("ranks heavy books independently within each accepted tier, with inclusive quartile boundaries", () => {
  const result = tierHeavyBooks([
    { companyId: "solo", tier: 0, accountsPer: 1000, clientsPer: null },
    { companyId: "small-low", tier: 1, accountsPer: 1, clientsPer: null },
    { companyId: "small-high", tier: 1, accountsPer: 2, clientsPer: null },
    { companyId: "large", tier: 2, accountsPer: null, clientsPer: 3 },
    { companyId: "unknown", tier: 2, accountsPer: null, clientsPer: null },
  ]);
  expect(result.get("solo")?.counted).toBe(true);
  expect(result.get("small-low")?.counted).toBe(false);
  expect(result.get("small-high")).toMatchObject({ counted: true, observation: "2 accounts per employee (top quartile of Tier 1)" });
  expect(result.get("large")).toMatchObject({ counted: true, observation: "3 clients per employee (top quartile of Tier 2)" });
  expect(result.get("unknown")?.counted).toBe(false);
});
