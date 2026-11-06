import { expect, it } from "vitest";
import { comparableFixture } from "../fixtures/comparable-review.js";
import { assessComparable, COMPARABLE_REVIEW_VERSION, hasBenchmarkFeeOutput, comparablePriceReadings } from "../../src/domain/benchmark/comparable-review.js";
import { comparableFeeGate } from "../../src/domain/benchmark/comparable-gate.js";
import { deriveMeasures, EMPTY_SNAPSHOT, type Fees } from "../../src/domain/benchmark/measures.js";
import { peerStatistics } from "../../src/domain/benchmark/peers.js";

const raw: Fees = { method: "cliff", tiers: [{ from: 0, to: null, rate_pct: 1 }], minimumAnnualFee: null, minimumAccountSize: null,
  at1m: { dollars: 10_000, rate_pct: 1 }, at5m: { dollars: 50_000, rate_pct: 1 } };
const current = { ...EMPTY_SNAPSHOT, staff: 10, advisoryStaff: 5, aum: 100_000_000, accounts: 100, individualAum: 100_000_000, hnwAum: 0, filingDate: "2026-01-01" };
const two: Fees = { ...raw, method: null, at1m: null, at5m: null, flags: ["tier_method_unclear"],
  tiers: [{ from: 0, to: 500_000, rate_pct: 2 }, { from: 500_000, to: null, rate_pct: 1 }],
  scenarios: { cliff: { at1m: raw.at1m, at5m: raw.at5m }, marginal: {
    at1m: { dollars: 15_000, rate_pct: 1.5 }, at5m: { dollars: 55_000, rate_pct: 1.1 },
  } } };
const assess = (options: Parameters<typeof comparableFixture>[0] = {}) => {
  const f = comparableFixture(options); return assessComparable(f.answer, f.passages, f.context);
};
const assessTwo = (options: Parameters<typeof comparableFixture>[0] = {}) => assess({ ...options, twoReadings: true });

it("fails a strategy-only primary despite a generic Item 5 fee table", () => {
  const review = assess({ strategy: true });
  expect(review).toMatchObject({ outcome: "fail", scope: { category: "strategy", evidence: { page: 4 } }, balances: { at1m: "unavailable", at5m: "unavailable" } });
  expect(comparableFeeGate(raw, review, "synthetic-fee").fees).toBeNull();
});
it("retains a waived $10M account minimum from Item 7 and withholds both peer prices and revenue", () => {
  const before = structuredClone(raw), review = assess({ minimum: 10_000_000, waivable: true });
  expect(review).toMatchObject({ outcome: "conditional", minimum: { amount: 10_000_000, waivable: true, evidence: { page: 6 } },
    balances: { at1m: "waiver_required", at5m: "waiver_required" } });
  const gate = comparableFeeGate(raw, review, "synthetic-fee");
  expect(gate.fees).toMatchObject({ at1m: null, at5m: null, minimumAccountSize: 10_000_000 });
  expect(deriveMeasures(current, EMPTY_SNAPSHOT, EMPTY_SNAPSHOT, gate.fees, "2026-11", [current]).values).toMatchObject({
    fee_1m_dollars: null, fee_5m_dollars: null, estimated_annual_fee_revenue: null, estimated_fee_revenue_per_staff: null,
  });
  expect(raw).toEqual(before);
});
it("allows a normal general schedule and only conditions the balance below a waivable minimum", () => {
  expect(comparableFeeGate(raw, assess(), "synthetic-fee")).toMatchObject({ status: "pass", fees: { at1m: raw.at1m, at5m: raw.at5m } });
  expect(comparableFeeGate(raw, assess({ minimum: 2_000_000, waivable: true }), "synthetic-fee")).toMatchObject({
    status: "conditional", fees: { at1m: null, at5m: raw.at5m }, balances: { at1m: "waiver_required", at5m: "available" },
  });
  expect(assess({ minimum: 10_000_000 })).toMatchObject({ outcome: "fail", balances: { at1m: "unavailable", at5m: "unavailable" } });
});
it("names grounding, physical-page, coverage and malformed-minimum gaps instead of passing", () => {
  const f = comparableFixture();
  f.answer.scope.evidence.quote = "An invented statement absent from this brochure.";
  expect(assessComparable(f.answer, f.passages, f.context)).toMatchObject({ outcome: "unclear", reasons: expect.arrayContaining(["Scope answer failed quote/page grounding"]) });
  const g = comparableFixture(); g.answer.minimum.evidence.page = 70;
  expect(assessComparable(g.answer, g.passages, g.context).outcome).toBe("unclear");
  const h = comparableFixture();
  expect(assessComparable(h.answer, h.passages, { ...h.context, complete: false }).outcome).toBe("unclear");
  expect(assessComparable({ ...h.answer, minimum: { ...h.answer.minimum, kind: "account_minimum", amount: null } }, h.passages, h.context).outcome).toBe("unclear");
});
it("keeps missing, unclear, mismatched and old-version reviews outside peer inputs", () => {
  const review = assess();
  expect(comparableFeeGate(raw, null, "synthetic-fee").fees).toBeNull();
  expect(comparableFeeGate(raw, { ...review, outcome: "unclear" }, "synthetic-fee").fees).toBeNull();
  expect(comparableFeeGate(raw, review, "different-fee").fees).toBeNull();
  expect(comparableFeeGate(raw, { ...review, version: COMPARABLE_REVIEW_VERSION + "-old" }, "synthetic-fee").fees).toBeNull();
});
it("uses only passing prices in peer fee percentiles and revenue summaries", () => {
  const make = (id: string, review: ReturnType<typeof assess> | null) => ({ id, staff: 10, aum: current.aum,
    ...deriveMeasures(current, EMPTY_SNAPSHOT, EMPTY_SNAPSHOT, comparableFeeGate(raw, review, "synthetic-fee").fees, "2026-11", [current]) });
  const peers = peerStatistics([make("normal", assess()), make("normal-2", assess()), make("strategy", assess({ strategy: true })),
    make("waived", assess({ minimum: 10_000_000, waivable: true })), make("pending", null)], {
    aumBandStarts: [0], individualShareMin: 2 / 3, institutionalShareMax: 1 / 3, soloStaffMax: 1, minimumGroupSize: 2,
  });
  expect(peers.summaries.find(row => row.measure === "fee_1m_dollars")).toMatchObject({ n: 2, median: 10_000 });
  expect(peers.summaries.find(row => row.measure === "estimated_annual_fee_revenue")).toMatchObject({ n: 2, median: 1_000_000 });
  for (const id of ["strategy", "waived", "pending"]) expect(peers.memberGroups.get(id)?.percentiles.fee_1m_dollars).toBeUndefined();
});

it("selects exact prices and numeric two-reading outputs, excluding incomplete or non-primary prices", () => {
  const primary = { role: "primary", category: "standard", name: "Investment management", scope: { kind: "firm", quote: "General investment management services." } };
  const stored = (fees: Fees) => ({ ...fees, primaryScheduleIndex: 0, schedules: [primary] });
  expect(hasBenchmarkFeeOutput(stored(raw))).toBe(true);
  expect(hasBenchmarkFeeOutput(stored(two))).toBe(true);
  expect(hasBenchmarkFeeOutput(stored({ ...two, scenarios: { marginal: two.scenarios!.marginal, cliff: null } }))).toBe(false);
  expect(hasBenchmarkFeeOutput({ ...stored(two), schedules: [{ ...primary, role: "scoped" }] })).toBe(false);
  expect(hasBenchmarkFeeOutput(stored({ ...raw, at1m: null, at5m: null }))).toBe(false);
});

it("keeps passing two-reading intervals, withholds failed/unclear ones, and conditions both endpoints below a minimum", () => {
  const before = structuredClone(two);
  const result = (review: ReturnType<typeof assess>) => deriveMeasures(current, EMPTY_SNAPSHOT, EMPTY_SNAPSHOT,
    comparableFeeGate(two, review, "synthetic-fee").fees, "2026-11", [current]);
  expect(result(assessTwo()).feeRanges).toMatchObject({ fee_1m_dollars: { low: 10_000, high: 15_000 }, fee_5m_dollars: { low: 50_000, high: 55_000 } });
  expect(result(assessTwo({ strategy: true })).feeRanges).toEqual({});
  expect(result({ ...assessTwo(), outcome: "unclear" }).feeRanges).toEqual({});
  const waived = comparableFeeGate(two, assessTwo({ minimum: 10_000_000, waivable: true }), "synthetic-fee");
  expect(waived.balances).toEqual({ at1m: "waiver_required", at5m: "waiver_required" });
  expect(waived.fees?.scenarios).toEqual({ marginal: { at1m: null, at5m: null }, cliff: { at1m: null, at5m: null } });
  expect(result(assessTwo({ minimum: 10_000_000, waivable: true })).feeRanges).toEqual({});
  expect(result(assessTwo({ minimum: 2_000_000, waivable: true })).feeRanges).toEqual({
    fee_5m_dollars: { low: 50_000, high: 55_000 }, fee_5m_pct: { low: 1, high: 1.1 },
  });
  expect(two).toEqual(before);
});

it("ranks only passing reviewed intervals against exact peers without adding endpoints to the reference sample", () => {
  const make = (id: string, fees: Fees, review: ReturnType<typeof assess>) => ({ id, staff: 10, aum: current.aum,
    ...deriveMeasures(current, EMPTY_SNAPSHOT, EMPTY_SNAPSHOT, comparableFeeGate(fees, review, "synthetic-fee").fees, "2026-11", [current]) });
  const peers = peerStatistics([make("exact-a", raw, assess()), make("exact-b", raw, assess()), make("range-pass", two, assessTwo()),
    make("range-fail", two, assessTwo({ strategy: true })), make("range-waived", two, assessTwo({ minimum: 10_000_000, waivable: true }))], {
    aumBandStarts: [0], individualShareMin: 2 / 3, institutionalShareMax: 1 / 3, soloStaffMax: 1, minimumGroupSize: 2,
  });
  expect(peers.summaries.find(row => row.measure === "fee_1m_dollars")).toMatchObject({ n: 2 });
  expect(peers.memberGroups.get("range-pass")?.feeRangePercentiles.fee_1m_dollars).toEqual({ low: 50, high: 100 });
  expect(peers.memberGroups.get("range-fail")?.feeRangePercentiles).toEqual({});
  expect(peers.memberGroups.get("range-waived")?.feeRangePercentiles).toEqual({});
});


it("keeps diversified multi-asset schedules and a firm-wide investing style general", () => {
  for (const scope of ["diversified", "style", "balanced_row", "current_schedule", "optional_services"] as const) {
    expect(assess({ scope })).toMatchObject({ outcome: "pass", scope: { category: "general", evidence: { page: 4 } } });
  }
  for (const scope of ["product", "institutional", "adviser_channel", "legacy"] as const) {
    expect(assess({ scope }).outcome).toBe("fail");
  }
});
it("does not translate net-worth targets or relationship preferences into account minimums", () => {
  for (const minimumKind of ["net_worth_target", "relationship_preference"] as const) {
    const review = assess({ minimumKind });
    expect(review).toMatchObject({ outcome: "pass", minimum: { kind: minimumKind, amount: 5_000_000 },
      balances: { at1m: "available", at5m: "available" } });
    const extracted = { ...raw, minimumAccountSize: 5_000_000 };
    expect(comparableFeeGate(extracted, review, "synthetic-fee")).toMatchObject({ status: "pass", minimum: 0,
      fees: { at1m: raw.at1m, at5m: raw.at5m, minimumAccountSize: null } });
    expect(extracted.minimumAccountSize).toBe(5_000_000);
  }
});
it("keeps the assets limb of an assets-or-net-worth requirement conditional below that limb", () => {
  expect(assess({ minimumKind: "assets_or_net_worth" })).toMatchObject({ outcome: "conditional", minimum: { kind: "account_minimum", amount: 2_000_000 },
    balances: { at1m: "waiver_required", at5m: "available" } });
});
it("accepts only a grounded restriction as fail when physical pages are unread", () => {
  const f = comparableFixture({ strategy: true });
  const context = { ...f.context, complete: false, gaps: ["No text layer on page 9 of b-synthetic; original PDF requires visual review"] };
  const answer = { ...f.answer, minimum: { ...f.answer.minimum, kind: "unclear", evidence: null },
    sections: { ...f.answer.sections, item7: null } };
  const failed = assessComparable(answer, f.passages, context);
  expect(failed).toMatchObject({ outcome: "fail", scope: { category: "strategy" }, balances: { at1m: "unavailable", at5m: "unavailable" } });
  expect(failed.reasons).toContain(context.gaps[0]);
  expect(comparableFeeGate(raw, failed, "synthetic-fee").status).toBe("fail");
  for (const options of [{}, { minimum: 10_000_000, waivable: true }]) {
    const normal = comparableFixture(options);
    const review = assessComparable(normal.answer, normal.passages, context);
    expect(review.outcome).toBe("unclear"); expect(review.reasons).toContain(context.gaps[0]);
    expect(comparableFeeGate(two, review, "synthetic-fee").fees).toBeNull();
  }
  const invented = structuredClone(f.answer); invented.scope.evidence.quote = "Unsupported restriction quotation.";
  expect(assessComparable(invented, f.passages, context).outcome).toBe("unclear");
});
it("requires v5 evidence and never accepts v1–v4 reviews", () => {
  expect(COMPARABLE_REVIEW_VERSION).toBe("adv-comparable-v5");
  for (const version of ["adv-comparable-v1", "adv-comparable-v2", "adv-comparable-v3", "adv-comparable-v4"]) {
    expect(comparableFeeGate(raw, { ...assess(), version }, "synthetic-fee")).toMatchObject({ status: "unreviewed", fees: null });
  }
});

it("fails grounded annual-floor contradictions without correcting exact fees or two-reading endpoints", () => {
  const f = comparableFixture({ annualFloorConflict: true });
  const review = assessComparable(f.answer, f.passages, f.context);
  expect(review).toMatchObject({ outcome: "fail", scope: { category: "general" }, minimum: { kind: "none_stated" },
    pricing: { status: "contradicted", evidence: { page: 6 } }, balances: { at1m: "unavailable", at5m: "unavailable" } });
  for (const fees of [raw, two]) {
    const before = structuredClone(fees), gate = comparableFeeGate(fees, review, "synthetic-fee");
    expect(gate).toMatchObject({ status: "fail", fees: null });
    const derived = deriveMeasures(current, EMPTY_SNAPSHOT, EMPTY_SNAPSHOT, gate.fees, "2026-11", [current]);
    expect(derived.values).toMatchObject({ fee_1m_dollars: null, fee_5m_dollars: null, estimated_annual_fee_revenue: null });
    expect(derived.feeRanges).toEqual({}); expect(fees).toEqual(before);
  }
  const partial = assessComparable({ ...f.answer, minimum: { ...f.answer.minimum, kind: "unclear", evidence: null } },
    f.passages, { ...f.context, complete: false, gaps: ["Unrelated unread page"] });
  expect(comparableFeeGate(raw, partial, "synthetic-fee").status).toBe("fail");
});

it("keeps unsupported and unclear price checks out of peer output", () => {
  const f = comparableFixture();
  f.answer.pricing.evidence.quote = "An unsupported price quotation.";
  const ungrounded = assessComparable(f.answer, f.passages, f.context);
  expect(ungrounded).toMatchObject({ outcome: "unclear", reasons: expect.arrayContaining(["Price consistency answer failed quote/page grounding"]) });
  const g = comparableFixture();
  const unclear = assessComparable({ ...g.answer, pricing: { ...g.answer.pricing, status: "unclear" } }, g.passages, g.context);
  expect(unclear.outcome).toBe("unclear");
  expect(comparableFeeGate(raw, unclear, "synthetic-fee").fees).toBeNull();
});

it("withholds an asset-class table despite diversified firm services, preserving raw fees", () => {
  const f = comparableFixture({ scope: "asset_class" });
  const review = assessComparable(f.answer, f.passages, f.context);
  expect(review).toMatchObject({ outcome: "fail", scope: { category: "asset_class", evidence: { page: 5 } },
    balances: { at1m: "unavailable", at5m: "unavailable" } });
  for (const fees of [raw, two]) {
    const before = structuredClone(fees);
    const gate = comparableFeeGate(fees, review, "synthetic-fee");
    expect(gate).toMatchObject({ status: "fail", fees: null });
    const derived = deriveMeasures(current, EMPTY_SNAPSHOT, EMPTY_SNAPSHOT, gate.fees, "2026-11", [current]);
    expect(derived.values).toMatchObject({ fee_1m_dollars: null, fee_5m_dollars: null, estimated_annual_fee_revenue: null });
    expect(derived.feeRanges).toEqual({});
    expect(fees).toEqual(before);
  }
  const unread = assessComparable({ ...f.answer, minimum: { ...f.answer.minimum, kind: "unclear", evidence: null } }, f.passages,
    { ...f.context, complete: false, gaps: ["Unrelated physical page unavailable"] });
  expect(comparableFeeGate(raw, unread, "synthetic-fee").status).toBe("fail");
  f.answer.scope.evidence.quote = "Invented restriction not in the table.";
  expect(assessComparable(f.answer, f.passages, f.context).outcome).toBe("unclear");
});

it("reviews every publishable numeric reading and omits an unresolved one-sided balance", () => {
  expect(comparablePriceReadings(raw)).toEqual([
    { balance: "at1m", reading: "single", dollars: 10_000, rate_pct: 1 },
    { balance: "at5m", reading: "single", dollars: 50_000, rate_pct: 1 },
  ]);
  expect(comparablePriceReadings(two)).toHaveLength(4);
  const partial = { ...two, scenarios: { ...two.scenarios!, cliff: { ...two.scenarios!.cliff!, at5m: null } } };
  expect(comparablePriceReadings(partial)).toEqual([
    { balance: "at1m", reading: "cliff", dollars: 10_000, rate_pct: 1 },
    { balance: "at1m", reading: "marginal", dollars: 15_000, rate_pct: 1.5 },
  ]);
  expect(comparablePriceReadings({ ...raw, at1m: { dollars: NaN, rate_pct: 1 }, at5m: null })).toEqual([]);
});

it("cannot hide a grounded wrong lower-band endpoint behind a supported hybrid-schedule summary", () => {
  const f = comparableFixture({ hybrid: true });
  expect(f.answer.pricing.status).toBe("supported");
  const review = assessComparable(f.answer, f.passages, f.context);
  expect(review).toMatchObject({ outcome: "fail", pricing: { status: "contradicted", evidence: { page: 5 },
    explanation: expect.stringContaining("at5m/cliff") } });
  expect(review.pricing.readings.find(r => r.balance === "at5m" && r.reading === "cliff")).toMatchObject({
    status: "contradicted", explanation: expect.stringContaining("later flat band does not apply"), evidence: { page: 5 },
  });
  const fees: Fees = { ...two, scenarios: {
    cliff: { at1m: { dollars: 11_000, rate_pct: 1.1 }, at5m: { dollars: 35_000, rate_pct: .7 } },
    marginal: { at1m: { dollars: 11_000, rate_pct: 1.1 }, at5m: { dollars: 43_000, rate_pct: .86 } },
  } };
  const before = structuredClone(fees);
  for (const checked of [review, { ...review, outcome: "pass" as const,
    pricing: { ...review.pricing, status: "supported" as const } }]) {
    const gate = comparableFeeGate(fees, checked, "synthetic-fee");
    expect(gate).toMatchObject({ status: "fail", fees: null });
    const result = deriveMeasures(current, EMPTY_SNAPSHOT, EMPTY_SNAPSHOT, gate.fees, "2026-11", [current]);
    expect(result.feeRanges).toEqual({}); expect(result.values.estimated_annual_fee_revenue).toBeNull();
  }
  expect(fees).toEqual(before);
  const unread = assessComparable(f.answer, f.passages, { ...f.context, complete: false, gaps: ["Unrelated unread page"] });
  expect(unread.outcome).toBe("fail");
});

it.each(["missing", "duplicate", "unavailable_quote", "wrong_page", "unclear"])("withholds incomplete per-reading checks: %s", kind => {
  const f = comparableFixture();
  const answer = structuredClone(f.answer);
  if (kind === "missing") answer.pricing.readings.pop();
  if (kind === "duplicate") answer.pricing.readings[1] = structuredClone(answer.pricing.readings[0]!);
  if (kind === "unavailable_quote") answer.pricing.readings[0]!.evidence.quote = "Invented support absent from every page.";
  if (kind === "wrong_page") answer.pricing.readings[0]!.evidence.page = 99;
  const payload = kind === "unclear" ? { ...answer, pricing: { ...answer.pricing, readings: answer.pricing.readings.map((r, i) =>
    i === 0 ? { ...r, status: "unclear" } : r) } } : answer;
  const review = assessComparable(payload, f.passages, f.context);
  expect(review.outcome).toBe("unclear"); expect(review.reasons.length).toBeGreaterThan(0);
  expect(comparableFeeGate(raw, { ...review, outcome: "pass" }, "synthetic-fee").fees).toBeNull();
});

it("retains supported coincident readings and preserves balance-specific waiver handling", () => {
  const f = comparableFixture({ twoReadings: true, minimum: 2_000_000, waivable: true });
  const review = assessComparable(f.answer, f.passages, f.context);
  const gate = comparableFeeGate(two, review, "synthetic-fee");
  expect(gate).toMatchObject({ status: "conditional", balances: { at1m: "waiver_required", at5m: "available" } });
  expect(gate.fees?.scenarios?.marginal).toMatchObject({ at1m: null, at5m: { dollars: 55_000 } });
  const coincident: Fees = { ...two, scenarios: { cliff: two.scenarios!.cliff,
    marginal: { ...two.scenarios!.marginal!, at1m: two.scenarios!.cliff!.at1m } } };
  const normal = assessTwo();
  expect(comparableFeeGate(coincident, normal, "synthetic-fee").status).toBe("pass");
});
