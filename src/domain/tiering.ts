import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies, companyVerdicts, factsCurrent, sectorCompanies } from "../db/schema.js";
import { DomainError } from "./errors.js";

/**
 * D-55 revenue truth and tier/layer (Stage 5.3 Step 4).
 *
 * Revenue for the tier, best first: (a) a figure with a named public source,
 * flagged "check" over $1M per staff; (b) Apollo's estimate only if it
 * implies at least $75k per staff; (c) staff x $175k, marked estimated.
 * A rejected Apollo figure stays visible with its reason. Thresholds flag
 * and route; they never delete data.
 */

export const APOLLO_MIN_PER_STAFF = 75_000;
export const STAFF_ESTIMATE_PER_HEAD = 175_000;
export const PUBLIC_CHECK_PER_STAFF = 1_000_000;

export type RevenueSource = "public" | "apollo" | "staff_estimate" | null;
export type Tier = "A" | "B" | "C" | null;
export type ContactStatus = "contactable" | "watchlist" | "excluded" | "research_incomplete";

export interface StaffCount {
  count: number;
  source: "companies_house" | "apollo" | "other";
  asOf?: string | null;
}

export interface RevenueTruthInput {
  publicRevenue: { amount: number; sourceName: string } | null;
  apolloRevenue: number | null;
  staff: StaffCount | null;
  score: number | null;
  verdictStatus: ContactStatus | null;
  exclusionReason?: string | null;
  plausibility?: string | null;
}

export interface RevenueTruth {
  revenueUsed: number | null;
  revenueSource: RevenueSource;
  publicSourceName: string | null;
  rejected: { amount: number; source: "apollo"; reason: string } | null;
  staff: StaffCount | null;
  tier: Tier;
  score: number | null;
  layer: number | null;
  status: ContactStatus;
  exclusionReason: string | null;
  flags: string[];
}

export function pickStaff(candidates: StaffCount[]): StaffCount | null {
  if (candidates.length === 0) return null;
  const dated = candidates
    .filter((c) => c.asOf)
    .sort((a, b) => String(b.asOf).localeCompare(String(a.asOf)));
  if (dated.length > 0) {
    // On equal dates the filed accounts beat the vendor snapshot.
    dated.sort((a, b) => {
      const byDate = String(b.asOf).localeCompare(String(a.asOf));
      if (byDate !== 0) return byDate;
      if (a.source === b.source) return 0;
      return a.source === "companies_house" ? -1 : 1;
    });
    return dated[0] ?? null;
  }
  return candidates[0] ?? null;
}

export function tierForRevenue(revenue: number | null): Tier {
  if (revenue === null) return null;
  if (revenue >= 10_000_000) return "A";
  if (revenue >= 2_000_000) return "B";
  if (revenue >= 500_000) return "C";
  return null;
}

export function computeRevenueTruth(input: RevenueTruthInput): RevenueTruth {
  const flags: string[] = [];
  const staff = input.staff;
  let revenueUsed: number | null = null;
  let revenueSource: RevenueSource = null;
  let publicSourceName: string | null = null;
  let rejected: RevenueTruth["rejected"] = null;

  if (input.publicRevenue && input.publicRevenue.amount > 0) {
    revenueUsed = input.publicRevenue.amount;
    revenueSource = "public";
    publicSourceName = input.publicRevenue.sourceName;
    if (staff && staff.count > 0 && revenueUsed / staff.count > PUBLIC_CHECK_PER_STAFF) {
      flags.push("check: public figure over $1M per staff");
    }
  } else if (input.apolloRevenue !== null && input.apolloRevenue > 0) {
    const perStaff =
      staff && staff.count > 0 ? input.apolloRevenue / staff.count : null;
    if (perStaff !== null && perStaff >= APOLLO_MIN_PER_STAFF) {
      revenueUsed = input.apolloRevenue;
      revenueSource = "apollo";
    } else {
      rejected = {
        amount: input.apolloRevenue,
        source: "apollo",
        reason: "rejected: below $75k per staff",
      };
      if (staff && staff.count > 0) {
        revenueUsed = staff.count * STAFF_ESTIMATE_PER_HEAD;
        revenueSource = "staff_estimate";
      }
    }
  } else if (staff && staff.count > 0) {
    revenueUsed = staff.count * STAFF_ESTIMATE_PER_HEAD;
    revenueSource = "staff_estimate";
  }

  if (revenueUsed === null) flags.push("no revenue basis: no usable figure and no staff count");
  if (input.plausibility && input.plausibility.trim().toLowerCase().startsWith("disputed")) {
    flags.push(input.plausibility.trim());
  }

  const score = input.score;
  const layer = score !== null && score >= 2 ? 7 - score : null;
  const tier = tierForRevenue(revenueUsed);

  let status: ContactStatus;
  let exclusionReason: string | null = null;
  if (input.verdictStatus === "excluded") {
    status = "excluded";
    exclusionReason = input.exclusionReason ?? "excluded";
  } else if (input.verdictStatus === "research_incomplete") {
    status = "research_incomplete";
  } else if (score === null || score <= 1) {
    status = "watchlist";
  } else if (revenueUsed !== null && tier === null) {
    status = "excluded";
    exclusionReason = "below $500k revenue: not contacted";
  } else {
    status = "contactable";
  }

  return {
    revenueUsed,
    revenueSource,
    publicSourceName,
    rejected,
    staff,
    tier,
    score,
    layer,
    status,
    exclusionReason,
    flags,
  };
}

// ---- Stored verdicts (signal scores and exclusions from the ICP check) ----

export interface VerdictInput {
  companyId: string;
  sectorId: string;
  score: number;
  signals: Record<string, boolean>;
  status: ContactStatus;
  exclusionReason?: string | null;
  source: string;
}

export async function recordVerdicts(db: Db, verdicts: VerdictInput[]): Promise<{ recorded: number }> {
  let recorded = 0;
  for (const v of verdicts) {
    const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, v.companyId));
    if (!company) throw new DomainError("not_found", `company not found: ${v.companyId}`);
    await db
      .insert(companyVerdicts)
      .values({
        companyId: v.companyId,
        sectorId: v.sectorId,
        score: v.score,
        signals: v.signals,
        status: v.status,
        exclusionReason: v.exclusionReason ?? null,
        source: v.source,
      })
      .onConflictDoUpdate({
        target: companyVerdicts.companyId,
        set: {
          sectorId: v.sectorId,
          score: v.score,
          signals: v.signals,
          status: v.status,
          exclusionReason: v.exclusionReason ?? null,
          source: v.source,
          updatedAt: new Date(),
        },
      });
    recorded += 1;
  }
  return { recorded };
}

// ---- Reading the stored facts for one company ----

function factAmount(row: { valueNum: unknown; valueJson: unknown }): number | null {
  if (row.valueJson && typeof row.valueJson === "object") {
    const amount = (row.valueJson as { amount?: unknown }).amount;
    if (typeof amount === "number" && Number.isFinite(amount)) return amount;
  }
  if (row.valueNum !== null && row.valueNum !== undefined) {
    const n = Number(row.valueNum);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export async function companyRevenueTruth(db: Db, companyId: string): Promise<RevenueTruth & { companyId: string }> {
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
  if (!company) throw new DomainError("not_found", `company not found: ${companyId}`);
  const rows = await db
    .select()
    .from(factsCurrent)
    .where(
      and(
        eq(factsCurrent.companyId, companyId),
        inArray(factsCurrent.key, [
          "financials.revenue_estimate",
          "financials.employees",
          "financials.revenue_plausibility",
        ]),
      ),
    );

  let publicRevenue: RevenueTruthInput["publicRevenue"] = null;
  let apolloRevenue: number | null = null;
  const staffCandidates: StaffCount[] = [];
  let plausibility: string | null = null;

  for (const row of rows) {
    const qualifiers = (row.qualifiers ?? {}) as Record<string, unknown>;
    if (row.key === "financials.revenue_estimate") {
      const amount = factAmount(row);
      if (amount === null) continue;
      const source = typeof qualifiers["source"] === "string" ? (qualifiers["source"] as string) : "";
      if (source === "apollo") {
        apolloRevenue = amount;
      } else if (source !== "") {
        publicRevenue = { amount, sourceName: source };
      } else if (row.createdBy.startsWith("collector:apollo")) {
        apolloRevenue = amount;
      }
    } else if (row.key === "financials.employees") {
      const n = factAmount(row);
      if (n === null) continue;
      const sourceRaw = typeof qualifiers["source"] === "string" ? (qualifiers["source"] as string) : "";
      const source: StaffCount["source"] =
        sourceRaw === "companies_house" ? "companies_house" : sourceRaw === "apollo" ? "apollo" : "other";
      staffCandidates.push({
        count: Math.round(n),
        source,
        asOf: row.asOf ? String(row.asOf).slice(0, 10) : null,
      });
    } else if (row.key === "financials.revenue_plausibility") {
      plausibility = typeof row.valueText === "string" ? row.valueText : null;
    }
  }

  const [verdict] = await db
    .select()
    .from(companyVerdicts)
    .where(eq(companyVerdicts.companyId, companyId));

  const truth = computeRevenueTruth({
    publicRevenue,
    apolloRevenue,
    staff: pickStaff(staffCandidates),
    score: verdict ? verdict.score : null,
    verdictStatus: verdict ? (verdict.status as ContactStatus) : null,
    exclusionReason: verdict?.exclusionReason ?? null,
    plausibility,
  });
  return { companyId, ...truth };
}

export interface SheetRow {
  tier: string;
  layer: number;
  score: number;
  company: string;
  domain: string;
  country: string;
  revenueUsed: number;
  revenueSource: string;
  flags: string;
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Contactable rows for the outreach sheet: one block per tier, layer then score. */
export async function sectorSheetRows(db: Db, sectorId: string): Promise<SheetRow[]> {
  const members = await db
    .select({
      companyId: sectorCompanies.companyId,
      name: companies.name,
      domain: companies.domain,
      country: companies.country,
    })
    .from(sectorCompanies)
    .innerJoin(companies, eq(sectorCompanies.companyId, companies.id))
    .where(eq(sectorCompanies.sectorId, sectorId));
  const rows: SheetRow[] = [];
  for (const m of members) {
    const truth = await companyRevenueTruth(db, m.companyId);
    if (truth.status !== "contactable" || !truth.tier || truth.layer === null) continue;
    rows.push({
      tier: truth.tier,
      layer: truth.layer,
      score: truth.score ?? 0,
      company: m.name,
      domain: m.domain ?? "",
      country: m.country ?? "",
      revenueUsed: truth.revenueUsed ?? 0,
      revenueSource:
        truth.revenueSource === "public"
          ? `public (${truth.publicSourceName ?? "named source"})`
          : truth.revenueSource === "staff_estimate"
            ? "estimated from staff"
            : (truth.revenueSource ?? ""),
      flags: truth.flags.join("; "),
    });
  }
  const tierOrder: Record<string, number> = { A: 0, B: 1, C: 2 };
  rows.sort(
    (a, b) =>
      (tierOrder[a.tier] ?? 9) - (tierOrder[b.tier] ?? 9) ||
      a.layer - b.layer ||
      b.score - a.score ||
      a.company.localeCompare(b.company),
  );
  return rows;
}

export function sheetCsv(rows: SheetRow[]): string {
  const header = "Tier,Layer,Score,Company,Domain,Country,Revenue used,Revenue source,Flags";
  const lines: string[] = [];
  let currentTier = "";
  for (const r of rows) {
    if (r.tier !== currentTier) {
      currentTier = r.tier;
      lines.push(`Tier ${r.tier}`, header);
    }
    lines.push(
      [
        r.tier,
        r.layer,
        r.score,
        csvCell(r.company),
        csvCell(r.domain),
        csvCell(r.country),
        r.revenueUsed,
        csvCell(r.revenueSource),
        csvCell(r.flags),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export interface SectorTierSummary {
  sectorId: string;
  companiesWithVerdicts: number;
  byTierLayer: Record<string, number>;
  byRevenueSource: Record<string, number>;
  byStatus: Record<string, number>;
}

export async function sectorTierSummary(db: Db, sectorId: string): Promise<SectorTierSummary> {
  const members = await db
    .select({ companyId: sectorCompanies.companyId })
    .from(sectorCompanies)
    .where(eq(sectorCompanies.sectorId, sectorId));
  const ids = members.map((m) => m.companyId);
  const byTierLayer: Record<string, number> = {};
  const byRevenueSource: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let withVerdicts = 0;
  // Bounded batches keep the summary to a handful of queries per 200 ids.
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const verdicts = await db
      .select({ companyId: companyVerdicts.companyId })
      .from(companyVerdicts)
      .where(inArray(companyVerdicts.companyId, batch));
    withVerdicts += verdicts.length;
    for (const v of verdicts) {
      const truth = await companyRevenueTruth(db, v.companyId);
      byStatus[truth.status] = (byStatus[truth.status] ?? 0) + 1;
      if (truth.revenueSource) {
        byRevenueSource[truth.revenueSource] = (byRevenueSource[truth.revenueSource] ?? 0) + 1;
      }
      if (truth.status === "contactable" && truth.tier && truth.layer !== null) {
        const key = `${truth.tier}/L${truth.layer}`;
        byTierLayer[key] = (byTierLayer[key] ?? 0) + 1;
      }
    }
  }
  return { sectorId, companiesWithVerdicts: withVerdicts, byTierLayer, byRevenueSource, byStatus };
}
