import { describe, expect, it } from "vitest";
import {
  classifyRevenueSourceKind,
  computeRevenueTruth,
  pickStaff,
} from "../../src/domain/tiering.js";

describe("D-55 revenue truth (pure)", () => {
  it("rejects Apollo below $75k per staff and falls back to staff x $175k", () => {
    const r = computeRevenueTruth({
      publicRevenue: null,
      vendorRevenue: { amount: 607000, sourceName: "Apollo" },
      staff: { count: 20, source: "apollo" },
      score: 2,
      verdictStatus: "contactable",
    });
    expect(r.revenueUsed).toBe(3500000);
    expect(r.revenueSource).toBe("staff_estimate");
    expect(r.rejected).toEqual({
      amount: 607000,
      source: "Apollo",
      reason: "rejected: below $75k per staff",
    });
    expect(r.tier).toBe("B");
    expect(r.layer).toBe(5);
    expect(r.status).toBe("contactable");
  });

  it("accepts Apollo at or above $75k per staff", () => {
    const r = computeRevenueTruth({
      publicRevenue: null,
      vendorRevenue: { amount: 4000000, sourceName: "Apollo" },
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
      publicRevenue: { amount: 30000000, sourceName: "trade press interview", confirmed: true },
      vendorRevenue: { amount: 607000, sourceName: "Apollo" },
      staff: { count: 20, source: "companies_house" },
      score: 6,
      verdictStatus: "contactable",
    });
    expect(r.revenueUsed).toBe(30000000);
    expect(r.revenueSource).toBe("public");
    expect(r.tier).toBe("A");
    expect(r.layer).toBe(1);
    expect(r.flags.some((f) => f.includes("over $1M per staff"))).toBe(true);
  });

  it("score 1 is Layer 6 (D-64), score 0 is watchlist, and below $500k is not contacted", () => {
    const one = computeRevenueTruth({
      publicRevenue: null,
      vendorRevenue: null,
      staff: { count: 10, source: "apollo" },
      score: 1,
      verdictStatus: "contactable",
    });
    expect(one.status).toBe("contactable");
    expect(one.layer).toBe(6);
    const w = computeRevenueTruth({
      publicRevenue: null,
      vendorRevenue: null,
      staff: { count: 10, source: "apollo" },
      score: 0,
      verdictStatus: "watchlist",
    });
    expect(w.status).toBe("watchlist");
    expect(w.layer).toBeNull();
    const small = computeRevenueTruth({
      publicRevenue: null,
      vendorRevenue: { amount: 400000, sourceName: "Apollo" },
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
      vendorRevenue: { amount: 5000000, sourceName: "Apollo" },
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

  it("vendor estimates from any vendor go through the $75k check, not just Apollo", () => {
    const low = computeRevenueTruth({
      publicRevenue: null,
      vendorRevenue: { amount: 900000, sourceName: "ZoomInfo" },
      staff: { count: 20, source: "apollo" },
      score: 2,
      verdictStatus: "contactable",
    });
    expect(low.revenueSource).toBe("staff_estimate");
    expect(low.rejected).toEqual({
      amount: 900000,
      source: "ZoomInfo",
      reason: "rejected: below $75k per staff",
    });
    const high = computeRevenueTruth({
      publicRevenue: null,
      vendorRevenue: { amount: 3000000, sourceName: "RocketReach" },
      staff: { count: 20, source: "apollo" },
      score: 2,
      verdictStatus: "contactable",
    });
    expect(high.revenueUsed).toBe(3000000);
    expect(high.revenueSource).toBe("vendor");
    expect(high.tier).toBe("B");
  });

  it("an award entry counts as a company statement and keeps the check flag", () => {
    const r = computeRevenueTruth({
      publicRevenue: {
        amount: 33000000,
        sourceName: "Gold award entry (brand-submitted)",
        kind: "award_entry",
        confirmed: true,
      },
      vendorRevenue: null,
      staff: { count: 10, source: "apollo" },
      score: 5,
      verdictStatus: "contactable",
    });
    expect(r.revenueSource).toBe("public");
    expect(r.tier).toBe("A");
    expect(r.flags.some((f) => f.includes("over $1M per staff"))).toBe(true);
  });

  it("classifies source kinds with the vendor backstop", () => {
    expect(classifyRevenueSourceKind("ZoomInfo")).toBe("vendor_estimate");
    expect(classifyRevenueSourceKind("RocketReach")).toBe("vendor_estimate");
    expect(classifyRevenueSourceKind("The Company Check")).toBe("vendor_estimate");
    expect(classifyRevenueSourceKind("directory aggregator (example)")).toBe("vendor_estimate");
    expect(classifyRevenueSourceKind("Apollo.io")).toBe("vendor_estimate");
    expect(classifyRevenueSourceKind("Gold award entry (brand-submitted)")).toBe("award_entry");
    expect(classifyRevenueSourceKind("Companies House accounts 2025")).toBe("filing");
    expect(classifyRevenueSourceKind("WWD")).toBe("press");
    expect(classifyRevenueSourceKind("Anything", "vendor_estimate")).toBe("vendor_estimate");
    expect(classifyRevenueSourceKind("ZoomInfo", "press")).toBe("press");
  });

  it("fails closed: unknown sources are vendor estimates, not press", () => {
    expect(classifyRevenueSourceKind("Some Obscure Site")).toBe("vendor_estimate");
    expect(classifyRevenueSourceKind("Datanyze")).toBe("vendor_estimate");
    expect(classifyRevenueSourceKind("Grips Intelligence")).toBe("vendor_estimate");
    expect(classifyRevenueSourceKind("SignalHire")).toBe("vendor_estimate");
    expect(classifyRevenueSourceKind("Endole")).toBe("vendor_estimate");
    expect(classifyRevenueSourceKind("GlobalDatabase")).toBe("vendor_estimate");
    expect(classifyRevenueSourceKind("Buzzfile")).toBe("vendor_estimate");
    expect(classifyRevenueSourceKind("Bold.pro CV")).toBe("vendor_estimate");
    // Known editorial names still read as press.
    expect(classifyRevenueSourceKind("BeautyMatter")).toBe("press");
    expect(classifyRevenueSourceKind("Glossy (founder statement)")).toBe("press");
    expect(classifyRevenueSourceKind("Forbes Asia")).toBe("press");
  });

  it("a flagged public figure does not set the tier until confirmed", () => {
    const unconfirmed = computeRevenueTruth({
      publicRevenue: { amount: 364000000, sourceName: "Wikipedia", kind: "press" },
      vendorRevenue: null,
      staff: { count: 24, source: "apollo" },
      score: 4,
      verdictStatus: "contactable",
    });
    // Falls to the staff estimate; the figure and flag stay visible.
    expect(unconfirmed.revenueSource).toBe("staff_estimate");
    expect(unconfirmed.tier).toBe("B");
    expect(unconfirmed.flaggedFigure).toEqual({
      amount: 364000000,
      sourceName: "Wikipedia",
      reason: "over $1M per staff: not confirmed as the brand's own figure",
    });
    expect(unconfirmed.flags.some((f) => f.includes("over $1M per staff"))).toBe(true);

    const confirmed = computeRevenueTruth({
      publicRevenue: { amount: 364000000, sourceName: "Wikipedia", kind: "press", confirmed: true },
      vendorRevenue: null,
      staff: { count: 24, source: "apollo" },
      score: 4,
      verdictStatus: "contactable",
    });
    expect(confirmed.revenueSource).toBe("public");
    expect(confirmed.tier).toBe("A");
    expect(confirmed.flaggedFigure).not.toBeNull();

    const rejected = computeRevenueTruth({
      publicRevenue: {
        amount: 364000000,
        sourceName: "Wikipedia",
        kind: "press",
        confirmed: false,
        confirmationReason: "parent-company figure",
      },
      vendorRevenue: { amount: 3000000, sourceName: "ZoomInfo" },
      staff: { count: 24, source: "apollo" },
      score: 4,
      verdictStatus: "contactable",
    });
    expect(rejected.revenueSource).toBe("vendor");
    expect(rejected.flags.some((f) => f.includes("parent-company figure"))).toBe(true);
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
