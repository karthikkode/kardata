import { expect, it } from "vitest";
import { comparableFixture } from "../fixtures/comparable-review.js";
import { assessComparable, COMPARABLE_REVIEW_VERSION } from "../../src/domain/benchmark/comparable-review.js";
import { comparableFeeGate } from "../../src/domain/benchmark/comparable-gate.js";
import { deriveMeasures, EMPTY_SNAPSHOT, type Fees } from "../../src/domain/benchmark/measures.js";
import { peerStatistics } from "../../src/domain/benchmark/peers.js";

const raw: Fees = { method: "cliff", tiers: [{ from: 0, to: null, rate_pct: 1 }], minimumAnnualFee: null, minimumAccountSize: null,
  at1m: { dollars: 10_000, rate_pct: 1 }, at5m: { dollars: 50_000, rate_pct: 1 } };
const current = { ...EMPTY_SNAPSHOT, staff: 10, advisoryStaff: 5, aum: 100_000_000, accounts: 100, individualAum: 100_000_000, hnwAum: 0, filingDate: "2026-01-01" };
const assess = (options: Parameters<typeof comparableFixture>[0] = {}) => {
  const f = comparableFixture(options); return assessComparable(f.answer, f.passages, f.context);
};

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
