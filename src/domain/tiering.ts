import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  companies,
  companyVerdicts,
  factsCurrent,
  revenueConfirmations,
  sectorCompanies,
  sources,
} from "../db/schema.js";
import { DomainError } from "./errors.js";
import { addFacts } from "./research/facts.js";

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

export type RevenueSource = "public" | "vendor" | "apollo" | "staff_estimate" | null;

export type RevenueSourceKind =
  | "filing"
  | "press"
  | "interview"
  | "company_statement"
  | "vendor_estimate"
  | "award_entry";

const SOURCE_KINDS: RevenueSourceKind[] = [
  "filing",
  "press",
  "interview",
  "company_statement",
  "vendor_estimate",
  "award_entry",
];

/**
 * Backstop only. The extract prompt picks the kind with judgement; this seed
 * list catches stored figures and extractor slips. Vendor agreement does not
 * promote a guess: several vendors saying the same number is still a vendor
 * estimate.
 */
const VENDOR_BACKSTOP = [
  "zoominfo",
  "apollo",
  "prospeo",
  "rocketreach",
  "rocket reach",
  "owler",
  "kona equity",
  "manta",
  "growjo",
  "zippia",
  "dun & bradstreet",
  "d&b",
  "companycheck",
  "company check",
  "celebslifereel",
  "directory aggregator",
  "datanyze",
  "grips",
  "signalhire",
  "clearvalue",
  "endole",
  "globaldatabase",
  "buzzfile",
  "crowdlustro",
  "accio",
  "couponupto",
  "sharktankblog",
  "bold.pro",
];

/** Known editorial outlets. Anything else fails closed to vendor_estimate. */
const PRESS_BACKSTOP = [
  "wwd",
  "women's wear daily",
  "beautymatter",
  "beauty independent",
  "glossy",
  "forbes",
  "businesscloud",
  "happi",
  "fast company",
  "premium beauty",
  "cosmeticsbusiness",
  "cosmetics business",
  "fierce biotech",
  "stocktitan",
  "little pink book",
  "body+soul",
  "acuity",
];

export function classifyRevenueSourceKind(
  sourceName: string,
  storedKind?: string | null,
): RevenueSourceKind {
  if (storedKind && (SOURCE_KINDS as string[]).includes(storedKind)) {
    return storedKind as RevenueSourceKind;
  }
  const name = sourceName.toLowerCase();
  if (VENDOR_BACKSTOP.some((v) => name.includes(v))) return "vendor_estimate";
  if (name.includes("brand-submitted") || name.includes("award entry")) return "award_entry";
  if (
    name.includes("companies house") ||
    name.includes("filing") ||
    name.includes("accounts") ||
    name.includes("sec filing") ||
    name.includes("form d")
  ) {
    return "filing";
  }
  if (name.includes("podcast") || name.includes("interview")) return "interview";
  if (PRESS_BACKSTOP.some((v) => name.includes(v))) return "press";
  if (name.includes("investor page") || name.includes("investor relations")) {
    return "company_statement";
  }
  // Fail closed: a source is press only if a journalist or the company
  // itself states the figure. Unknown or unclassified means a vendor guess.
  return "vendor_estimate";
}

export function isPublicKind(kind: RevenueSourceKind): boolean {
  return kind !== "vendor_estimate";
}
export type Tier = "A" | "B" | "C" | null;
export type ContactStatus = "contactable" | "watchlist" | "excluded" | "research_incomplete";

export interface StaffCount {
  count: number;
  source: "companies_house" | "apollo" | "other";
  asOf?: string | null;
}

export interface RevenueTruthInput {
  publicRevenue: {
    amount: number;
    sourceName: string;
    kind?: RevenueSourceKind;
    confirmed?: boolean;
    confirmationReason?: string | null;
  } | null;
  vendorRevenue: { amount: number; sourceName: string } | null;
  staff: StaffCount | null;
  score: number | null;
  verdictStatus: ContactStatus | null;
  exclusionReason?: string | null;
  plausibility?: string | null;
}

export interface RevenueTruth {
  revenueUsed: number | null;
  revenueSource: RevenueSource;
  revenueKind: RevenueSourceKind | null;
  publicSourceName: string | null;
  flaggedFigure: { amount: number; sourceName: string; reason: string } | null;
  rejected: { amount: number; source: string; reason: string } | null;
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
  let revenueKind: RevenueSourceKind | null = null;
  let publicSourceName: string | null = null;
  let rejected: RevenueTruth["rejected"] = null;
  let flaggedFigure: RevenueTruth["flaggedFigure"] = null;
  let used = false;

  if (input.publicRevenue && input.publicRevenue.amount > 0) {
    const pub = input.publicRevenue;
    const perStaff = staff && staff.count > 0 ? pub.amount / staff.count : null;
    const flagged = perStaff !== null && perStaff > PUBLIC_CHECK_PER_STAFF;
    if (!flagged) {
      revenueUsed = pub.amount;
      revenueSource = "public";
      revenueKind = pub.kind ?? classifyRevenueSourceKind(pub.sourceName);
      publicSourceName = pub.sourceName;
      used = true;
    } else {
      // A flagged figure is usually a parent or group number. It stays
      // visible, but it does not set the tier until a human confirms it is
      // the brand's own figure (company_revenue_confirm).
      flaggedFigure = {
        amount: pub.amount,
        sourceName: pub.sourceName,
        reason:
          pub.confirmed === false && pub.confirmationReason
            ? pub.confirmationReason
            : "over $1M per staff: not confirmed as the brand's own figure",
      };
      flags.push(
        `check: public figure over $1M per staff (${pub.sourceName})` +
          (pub.confirmed
            ? ": confirmed as the brand's own figure"
            : `: not used for tier (${flaggedFigure.reason})`),
      );
      if (pub.confirmed) {
        revenueUsed = pub.amount;
        revenueSource = "public";
        revenueKind = pub.kind ?? classifyRevenueSourceKind(pub.sourceName);
        publicSourceName = pub.sourceName;
        used = true;
      }
    }
  }
  if (!used && input.vendorRevenue !== null && input.vendorRevenue.amount > 0) {
    const perStaff =
      staff && staff.count > 0 ? input.vendorRevenue.amount / staff.count : null;
    if (perStaff !== null && perStaff >= APOLLO_MIN_PER_STAFF) {
      revenueUsed = input.vendorRevenue.amount;
      revenueSource = input.vendorRevenue.sourceName.toLowerCase().startsWith("apollo")
        ? "apollo"
        : "vendor";
      revenueKind = "vendor_estimate";
      publicSourceName = input.vendorRevenue.sourceName;
    } else {
      rejected = {
        amount: input.vendorRevenue.amount,
        source: input.vendorRevenue.sourceName,
        reason: "rejected: below $75k per staff",
      };
      if (staff && staff.count > 0) {
        revenueUsed = staff.count * STAFF_ESTIMATE_PER_HEAD;
        revenueSource = "staff_estimate";
      }
    }
  }
  if (!used && revenueUsed === null && staff && staff.count > 0) {
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
    revenueKind,
    publicSourceName,
    flaggedFigure,
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

/**
 * Stamp the source kind onto stored revenue figures that lack one, writing a
 * superseding fact through the standard fact path. The kind comes from the
 * backstop classifier; the extractor's judgement (source_kind) always wins
 * where it is already stored.
 */
export async function sectorRevenueReclassify(
  db: Db,
  sectorId: string,
): Promise<{ stamped: number; alreadyStamped: number; noRevenueFact: number; byKind: Record<string, number> }> {
  const members = await db
    .select({ companyId: sectorCompanies.companyId })
    .from(sectorCompanies)
    .where(eq(sectorCompanies.sectorId, sectorId));
  let stamped = 0;
  let alreadyStamped = 0;
  let noRevenueFact = 0;
  const byKind: Record<string, number> = {};
  for (const m of members) {
    const [row] = await db
      .select()
      .from(factsCurrent)
      .where(
        and(
          eq(factsCurrent.companyId, m.companyId),
          eq(factsCurrent.key, "financials.revenue_estimate"),
        ),
      );
    if (!row) {
      noRevenueFact += 1;
      continue;
    }
    const qualifiers = (row.qualifiers ?? {}) as Record<string, unknown>;
    const source = typeof qualifiers["source"] === "string" ? (qualifiers["source"] as string) : "";
    if (source === "") {
      noRevenueFact += 1;
      continue;
    }
    const kind = classifyRevenueSourceKind(source);
    if (typeof qualifiers["source_kind"] === "string") {
      // Extractor-stamped kinds are judgement and stay. Kinds we stamped
      // ourselves are recomputed, so a stricter classifier re-stamps them.
      const ours = row.createdBy === "reclassify:stage-5.3";
      if (!ours || qualifiers["source_kind"] === kind) {
        alreadyStamped += 1;
        continue;
      }
    }
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    const amount = factAmount(row);
    const citedIds = row.sourceIds ?? [];
    const existingSources =
      citedIds.length > 0
        ? await db
            .select({ id: sources.id })
            .from(sources)
            .where(inArray(sources.id, citedIds))
        : [];
    const validSourceIds = existingSources.map((s) => s.id);
    const results = await addFacts(db, {
      companyId: m.companyId,
      createdBy: "reclassify:stage-5.3",
      facts: [
        {
          key: "financials.revenue_estimate",
          value:
            amount !== null
              ? { amount, currency: row.currency ?? "USD" }
              : (row.valueJson ?? row.valueText ?? row.valueNum),
          qualifiers: {
            ...qualifiers,
            source_kind: kind,
            ...(kind === "vendor_estimate" ? { estimate_kind: "vendor" } : {}),
          },
          sourceIds: validSourceIds,
          confidence: row.confidence ?? "medium",
        },
      ],
    });
    if (results[0]?.ok) stamped += 1;
  }
  return { stamped, alreadyStamped, noRevenueFact, byKind };
}

/** Record the human verdict on a flagged public figure for one company. */
export async function recordRevenueConfirmation(
  db: Db,
  input: { companyId: string; decision: "confirm" | "reject"; reason: string },
): Promise<{ companyId: string; decision: string; reason: string }> {
  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.id, input.companyId));
  if (!company) throw new DomainError("not_found", `company not found: ${input.companyId}`);
  await db
    .insert(revenueConfirmations)
    .values({ companyId: input.companyId, decision: input.decision, reason: input.reason })
    .onConflictDoUpdate({
      target: revenueConfirmations.companyId,
      set: { decision: input.decision, reason: input.reason, updatedAt: new Date() },
    });
  return { companyId: input.companyId, decision: input.decision, reason: input.reason };
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
  let vendorRevenue: RevenueTruthInput["vendorRevenue"] = null;
  const staffCandidates: StaffCount[] = [];
  let plausibility: string | null = null;

  for (const row of rows) {
    const qualifiers = (row.qualifiers ?? {}) as Record<string, unknown>;
    if (row.key === "financials.revenue_estimate") {
      const amount = factAmount(row);
      if (amount === null) continue;
      const source = typeof qualifiers["source"] === "string" ? (qualifiers["source"] as string) : "";
      const storedKind =
        typeof qualifiers["source_kind"] === "string" ? (qualifiers["source_kind"] as string) : null;
      if (source !== "") {
        const kind = classifyRevenueSourceKind(source, storedKind);
        if (isPublicKind(kind)) {
          publicRevenue = { amount, sourceName: source, kind };
        } else {
          vendorRevenue = { amount, sourceName: source };
        }
      } else if (row.createdBy.startsWith("collector:apollo")) {
        vendorRevenue = { amount, sourceName: "Apollo" };
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

  const [confirmation] = await db
    .select()
    .from(revenueConfirmations)
    .where(eq(revenueConfirmations.companyId, companyId));
  if (publicRevenue && confirmation) {
    publicRevenue = {
      ...publicRevenue,
      confirmed: confirmation.decision === "confirm",
      confirmationReason: confirmation.reason || null,
    };
  }

  const truth = computeRevenueTruth({
    publicRevenue,
    vendorRevenue,
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
      company: m.name ?? "",
      domain: m.domain ?? "",
      country: m.country ?? "",
      revenueUsed: truth.revenueUsed ?? 0,
      revenueSource:
        truth.revenueSource === "public"
          ? `public (${truth.publicSourceName ?? "named source"})`
          : truth.revenueSource === "vendor"
            ? `vendor (${truth.publicSourceName ?? "vendor"})`
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
