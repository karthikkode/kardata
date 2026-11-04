import { effectiveFee, type FeeTier, type TierMethod } from "./fee-math.js";

export type Snapshot = {
  filingDate: string | null;
  clients: number | null; accounts: number | null; staff: number | null; advisoryStaff: number | null;
  aum: number | null; individualClients: number | null; hnwClients: number | null;
  individualAum: number | null; hnwAum: number | null;
};

export type Fees = {
  tiers: FeeTier[]; method: TierMethod | null; minimumAnnualFee: number | null; minimumAccountSize: number | null;
  at1m: { dollars: number; rate_pct: number } | null; at5m: { dollars: number; rate_pct: number } | null;
};

export const EMPTY_SNAPSHOT: Snapshot = {
  filingDate: null, clients: null, accounts: null, staff: null, advisoryStaff: null, aum: null,
  individualClients: null, hnwClients: null, individualAum: null, hnwAum: null,
};

const growthInputs = ["clients", "accounts", "staff", "advisoryStaff", "aum"] as const;
const growthNames = ["clients", "accounts", "staff", "advisory_staff", "aum"] as const;
export const MEASURES = [
  "clients_per_staff", "clients_per_non_advisory_staff", "accounts_per_staff", "aum_per_staff", "aum_per_client",
  "individual_client_share_pct", "individual_aum_share_pct", "estimated_annual_fee_revenue", "estimated_fee_revenue_per_staff",
  "fee_1m_dollars", "fee_1m_pct", "fee_5m_dollars", "fee_5m_pct",
  ...growthNames.flatMap(name => [`${name}_growth_1y_pct` as const, `${name}_growth_3y_pct` as const]),
] as const;
export type Measure = (typeof MEASURES)[number];
export type MeasureValues = Record<Measure, number | null>;

function ratio(n: number | null, d: number | null) {
  return n !== null && d !== null && d > 0 ? n / d : null;
}

function share(a: number | null, b: number | null, total: number | null) {
  const value = a === null || b === null ? null : ratio(a + b, total);
  return value !== null && value <= 1 ? value * 100 : null;
}

function growth(current: number | null, previous: number | null) {
  const change = ratio(current, previous);
  return change === null ? null : (change - 1) * 100;
}

function monthsBefore(month: string, count: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - count, 0)).toISOString().slice(0, 10);
}

export function deriveMeasures(current: Snapshot, prior1: Snapshot, prior3: Snapshot, fees: Fees | null, month: string,
  chronological: Snapshot[]) {
  const staffOutsideAdvisory = current.staff === null || current.advisoryStaff === null ? null : current.staff - current.advisoryStaff;
  const averageAccount = ratio(current.aum, current.accounts);
  const rate = fees?.method && averageAccount !== null
    ? effectiveFee({ ...fees, method: fees.method, balance: averageAccount })?.rate_pct ?? null : null;
  const estimated = current.aum !== null && rate !== null ? current.aum * rate / 100 : null;
  const values: Partial<MeasureValues> = {
    clients_per_staff: ratio(current.clients, current.staff),
    clients_per_non_advisory_staff: ratio(current.clients, staffOutsideAdvisory),
    accounts_per_staff: ratio(current.accounts, current.staff),
    aum_per_staff: ratio(current.aum, current.staff),
    aum_per_client: ratio(current.aum, current.clients),
    individual_client_share_pct: share(current.individualClients, current.hnwClients, current.clients),
    individual_aum_share_pct: share(current.individualAum, current.hnwAum, current.aum),
    estimated_annual_fee_revenue: estimated,
    estimated_fee_revenue_per_staff: ratio(estimated, current.staff),
    fee_1m_dollars: fees?.at1m?.dollars ?? null,
    fee_1m_pct: fees?.at1m?.rate_pct ?? null,
    fee_5m_dollars: fees?.at5m?.dollars ?? null,
    fee_5m_pct: fees?.at5m?.rate_pct ?? null,
  };
  for (const [i, input] of growthInputs.entries()) {
    const name = growthNames[i]!;
    values[`${name}_growth_1y_pct`] = growth(current[input], prior1[input]);
    values[`${name}_growth_3y_pct`] = growth(current[input], prior3[input]);
  }
  const flags: string[] = [];
  if (current.staff === 0) flags.push("zero_staff");
  if (current.clients !== null && current.clients > 0 && current.accounts === 0) flags.push("clients_without_accounts");
  const previousAum = chronological.slice(0, -1).findLast(snapshot => snapshot.aum !== null)?.aum ?? null;
  if (current.filingDate && current.filingDate < monthsBefore(month, 15) &&
    current.aum !== null && previousAum !== null && current.aum > previousAum) flags.push("rising_aum_stale_filing");
  const jumps = growthInputs.flatMap((input, i) => {
    const snapshots = chronological.filter(snapshot => snapshot[input] !== null);
    return snapshots.some((snapshot, j) => j > 0 && (growth(snapshot[input], snapshots[j - 1]![input]) ?? 0) > 300) ? [growthNames[i]!] : [];
  });
  if (jumps.length) flags.push("snapshot_jump_over_300_pct");
  const gapReasons = Object.fromEntries(MEASURES.flatMap(measure => {
    if (values[measure] !== null) return [];
    const feeMeasure = /^(?:fee_|estimated_)/.test(measure);
    const period = measure.endsWith("_growth_1y_pct") ? prior1 : measure.endsWith("_growth_3y_pct") ? prior3 : null;
    const reason = feeMeasure && !fees ? "no usable fee extraction" :
      !feeMeasure && !current.filingDate ? "no verified current filing" :
      period && !period.filingDate ? "no verified prior filing" :
      feeMeasure ? "fee schedule or account basis unavailable" : "input missing or denominator not positive";
    return [[measure, reason]];
  }));
  return { values: values as MeasureValues, flags, jumps, gapReasons };
}
