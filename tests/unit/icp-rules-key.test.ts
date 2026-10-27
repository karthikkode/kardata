import { describe, expect, it } from "vitest";
import { EXCLUSION_RULES } from "../../src/domain/icp/rules.js";

describe("not_d2c fact key (Stage 5.6 B6)", () => {
  it("routes on the undated key with neutral examples", () => {
    const rule = EXCLUSION_RULES.find((r) => r.key === "not_d2c");
    expect(rule?.routes[0]?.factKeys).toEqual(["business_model.dtc_store", "decisions.online_store_active"]);
    expect(rule?.question).toContain("a service business, distributor, agency, or a dead or parked site");
    expect(JSON.stringify(EXCLUSION_RULES)).not.toContain("online_store_active_oct_2026");
  });
});
