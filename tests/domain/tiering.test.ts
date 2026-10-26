import { describe, expect, it } from "vitest";
import { computeRevenueTruth, pickStaff } from "../../src/domain/tiering.js";

describe("D-55 revenue truth (pure)", () => {
  it("rejects Apollo below $75k per staff and falls back to staff x $175k", () => {
    const r = computeRevenueTruth({
      publicRevenue: null,
      apolloRevenue: 607000,
      staff: { count: 20, source: "apollo" },
      score: 2,
      verdictStatus: "contactable",
    });
    expect(r.revenueUsed).toBe(3500000);
    expect(r.revenueSource).toBe("staff_estimate");
    expect(r.rejected).toEqual({
      amount: 607000,
      source: "apollo",
      reason: "rejected: below $75k per staff",
    });
    expect(r.tier).toBe("B");
    expect(r.layer).toBe(5);
    expect(r.status).toBe("contactable");
  });

  it("accepts Apollo at or above $75k per staff", () => {
    const r = computeRevenueTruth({
      publicRevenue: null,
      apolloRevenue: 4000000,
      staff: { count: 20, source: "apollo" },
      score: 3,
      verdictStatus: "contactable",
    });
    expect(r.revenueUsed).toBe(4000000);
    expect(r.revenueSource).toBe("apollo");
    expect(r.rejected).toBeNull();
    expect(r.tier).toBe("B");
    expect(r.layer).toBe(4);
  });

  it("public figure wins, flagged check over $1M per staff", () => {
    const r = computeRevenueTruth({
      publicRevenue: { amount: 30000000, sourceName: "trade press interview" },
      apolloRevenue: 607000,
      staff: { count: 20, source: "companies_house" },
      score: 6,
      verdictStatus: "contactable",
    });
    expect(r.revenueUsed).toBe(30000000);
    expect(r.revenueSource).toBe("public");
    expect(r.tier).toBe("A");
    expect(r.layer).toBe(1);
    expect(r.flags).toContain("check: public figure over $1M per staff");
  });

  it("score 0-1 is watchlist and below $500k is not contacted", () => {
    const w = computeRevenueTruth({
      publicRevenue: null,
      apolloRevenue: null,
      staff: { count: 10, source: "apollo" },
      score: 1,
      verdictStatus: "contactable",
    });
    expect(w.status).toBe("watchlist");
    expect(w.layer).toBeNull();
    const small = computeRevenueTruth({
      publicRevenue: null,
      apolloRevenue: 400000,
      staff: { count: 4, source: "apollo" },
      score: 4,
      verdictStatus: "contactable",
    });
    // Apollo implies $100k/staff, so it is accepted and lands below the floor.
    expect(small.revenueUsed).toBe(400000);
    expect(small.tier).toBeNull();
    expect(small.status).toBe("excluded");
    expect(small.exclusionReason).toContain("below $500k");
  });

  it("exclusions stay exclusions and disputed figures are flagged", () => {
    const r = computeRevenueTruth({
      publicRevenue: null,
      apolloRevenue: 5000000,
      staff: { count: 20, source: "apollo" },
      score: 5,
      verdictStatus: "excluded",
      exclusionReason: "has data team",
      plausibility: "disputed: revenue sits oddly against the accounts",
    });
    expect(r.status).toBe("excluded");
    expect(r.exclusionReason).toBe("has data team");
    expect(r.flags.some((f) => f.startsWith("disputed"))).toBe(true);
  });

  it("pickStaff prefers the most recent dated count, Companies House first", () => {
    const picked = pickStaff([
      { count: 20, source: "apollo", asOf: null },
      { count: 13, source: "companies_house", asOf: "2024-09-30" },
      { count: 17, source: "companies_house", asOf: "2025-09-30" },
    ]);
    expect(picked).toEqual({ count: 17, source: "companies_house", asOf: "2025-09-30" });
    const apolloOnly = pickStaff([{ count: 20, source: "apollo", asOf: null }]);
    expect(apolloOnly?.count).toBe(20);
    expect(pickStaff([])).toBeNull();
  });
});
