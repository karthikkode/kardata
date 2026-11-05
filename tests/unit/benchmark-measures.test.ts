import { expect, it } from "vitest";
import { deriveMeasures, EMPTY_SNAPSHOT, primaryPeerFees, type Fees, type Snapshot } from "../../src/domain/benchmark/measures.js";
import { peerStatistics, type PeerConfig } from "../../src/domain/benchmark/peers.js";

const current: Snapshot = {
  filingDate: "2024-12-31", staff: 10, advisoryStaff: 4, clients: 60, accounts: 100,
  aum: 120_000_000, individualClients: 20, hnwClients: 25, individualAum: 20_000_000, hnwAum: 70_000_000,
};
const prior = { ...current, staff: 5, advisoryStaff: 2, clients: 30, accounts: 50, aum: 20_000_000 };
const fees: Fees = {
  tiers: [{ from: 0, to: null, rate_pct: 1 }], method: "cliff", minimumAnnualFee: null, minimumAccountSize: null,
  at1m: { dollars: 10_000, rate_pct: 1 }, at5m: { dollars: 50_000, rate_pct: 1 },
};
const config: PeerConfig = { aumBandStarts: [0, 100_000_000, 250_000_000], individualShareMin: 2 / 3,
  institutionalShareMax: 1 / 3, soloStaffMax: 1, minimumGroupSize: 3 };

it("derives operating ratios, historical growth, mix, and explicitly estimated fee revenue", () => {
  const result = deriveMeasures(current, prior, EMPTY_SNAPSHOT, fees, "2026-11", [EMPTY_SNAPSHOT, prior, current]);
  expect(result.values).toMatchObject({
    clients_per_staff: 6, clients_per_non_advisory_staff: 10, accounts_per_staff: 10,
    aum_per_staff: 12_000_000, aum_per_client: 2_000_000, individual_client_share_pct: 75,
    individual_aum_share_pct: 75, clients_growth_1y_pct: 100, advisory_staff_growth_1y_pct: 100,
    staff_growth_1y_pct: 100, accounts_growth_1y_pct: 100, aum_growth_1y_pct: 500,
    clients_growth_3y_pct: null, estimated_annual_fee_revenue: 1_200_000,
    estimated_fee_revenue_per_staff: 120_000, fee_1m_pct: 1, fee_5m_dollars: 50_000,
  });
  expect(result.flags).toEqual(["rising_aum_stale_filing", "snapshot_jump_over_300_pct"]);
  expect(result.jumps).toEqual(["aum"]);
  expect(result.gapReasons).toMatchObject({ clients_growth_3y_pct: "no verified prior filing" });
  const zero = { ...current, staff: 0, accounts: 0 };
  const gaps = deriveMeasures(zero, prior, prior, null, "2026-11", [prior, zero]);
  expect(gaps.values).toMatchObject({ clients_per_staff: null, clients_per_non_advisory_staff: null,
    estimated_annual_fee_revenue: null, clients_growth_3y_pct: 100 });
  expect(gaps.flags).toEqual(expect.arrayContaining(["zero_staff", "clients_without_accounts"]));
});

it("merges adjacent same-mix groups, separates solo firms, and assigns tied percentile ranks", () => {
  const make = (id: string, aum: number, clients: number, staff = 10, individualClients = clients) => {
    const snapshot = { ...current, aum, clients, staff, individualClients, hnwClients: 0 };
    return { id, aum, staff, values: deriveMeasures(snapshot, prior, prior, null, "2026-11", [prior, snapshot]).values };
  };
  const report = peerStatistics([
    make("a", 50_000_000, 20), make("b", 100_000_000, 20), make("c", 100_000_000, 60),
    make("solo", 100_000_000, 60, 1), make("mixed", 150_000_000, 60, 10, 30),
  ], config);
  expect(report.summaries.find(row => row.measure === "clients_per_staff" && row.mix === "mostly_individual"))
    .toMatchObject({ size: 3, n: 3, q1: 2, median: 2, q3: 4, bandIndices: [0, 1] });
  expect(report.memberGroups.get("a")?.percentiles.clients_per_staff)
    .toBeCloseTo(report.memberGroups.get("b")?.percentiles.clients_per_staff ?? 0);
  expect(report.memberGroups.get("c")?.percentiles.clients_per_staff).toBeCloseTo(100 * 2.5 / 3);
  expect(report.memberGroups.get("solo")).toMatchObject({ key: "solo", size: 1, percentiles: {} });
  expect(report.summaries.find(row => row.mix === "mixed")?.median).toBeNull();
});

it("compares a two-reading interval against single-reading primary peers without adding it to the sample", () => {
  const standard = { role: "primary", category: "standard", name: "Individual investment management",
    scope: { kind: "firm", quote: "Standard individual investment management." } };
  const value = { ...fees, primaryScheduleIndex: 0, schedules: [standard] };
  expect(primaryPeerFees(value)).toEqual(value);
  expect(primaryPeerFees(fees)).toBeNull();
  expect(primaryPeerFees({ ...value, schedules: [{ ...standard,
    scope: { ...standard.scope, quote: "Fees for accounts offered through Financial Advisors." } }] })).toBeNull();
  const both = { ...value, scenarios: {
    cliff: { at1m: fees.at1m, at5m: fees.at5m },
    marginal: { at1m: { dollars: 12_500, rate_pct: 1.25 }, at5m: { dollars: 62_500, rate_pct: 1.25 } },
  } };
  expect(primaryPeerFees({ ...value, at1m: { dollars: 1_000, rate_pct: 0.1 } })).toBeNull();
  expect(primaryPeerFees({ ...both, scenarios: { ...both.scenarios,
    marginal: { ...both.scenarios.marginal, at1m: { dollars: 31_000, rate_pct: 3.1 } } } })).toBeNull();
  const make = (id: string, schedule: Fees | null) => ({ id, staff: current.staff, aum: current.aum,
    ...deriveMeasures(current, prior, prior, schedule, "2026-11", [prior, current]) });
  const one = make("a", primaryPeerFees(value));
  const two = make("b", primaryPeerFees(both));
  const three = make("c", primaryPeerFees({ ...value, at1m: { dollars: 12_500, rate_pct: 1.25 } }));
  expect(two.values).toMatchObject({ fee_1m_dollars: null, fee_5m_dollars: null, estimated_annual_fee_revenue: null });
  expect(two.feeRanges.fee_1m_dollars).toEqual({ low: 10_000, high: 12_500 });
  const report = peerStatistics([one, two, three], config);
  expect(report.summaries.find(row => row.measure === "fee_1m_dollars")).toMatchObject({ n: 2, median: 11_250 });
  expect(report.memberGroups.get("b")?.percentiles.fee_1m_dollars).toBeUndefined();
  expect(report.memberGroups.get("b")?.feeRangePercentiles.fee_1m_dollars).toEqual({ low: 25, high: 75 });
});
