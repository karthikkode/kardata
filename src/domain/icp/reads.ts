import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { companies, companyIcpChecks, sectorCompanies, type CompanyIcpCheck } from "../../db/schema.js";
import { DomainError } from "../errors.js";
import { companyRevenueTruth, type ContactStatus } from "../tiering.js";
import type { BucketResult } from "./judge.js";
import { SIGNAL_RULES } from "./rules.js";

/** Read views over stored ICP checks (Stage 5.5 Step 4). */

export async function latestIcpCheck(db: Db, companyId: string, sectorId?: string): Promise<CompanyIcpCheck | null> {
  const [row] = await db
    .select()
    .from(companyIcpChecks)
    .where(
      sectorId
        ? and(eq(companyIcpChecks.companyId, companyId), eq(companyIcpChecks.sectorId, sectorId))
        : eq(companyIcpChecks.companyId, companyId),
    )
    .orderBy(desc(companyIcpChecks.createdAt))
    .limit(1);
  return row ?? null;
}

interface StoredResults {
  signals?: BucketResult[];
  exclusions?: BucketResult[];
  flags?: BucketResult[];
}

export function signalsMet(check: CompanyIcpCheck): string[] {
  const results = check.results as StoredResults;
  return (results.signals ?? [])
    .filter((s) => s.counted)
    .map((s) => SIGNAL_RULES.find((r) => r.key === s.key)?.label ?? s.key);
}

export function hasTechTeam(check: CompanyIcpCheck): boolean {
  const results = check.results as StoredResults;
  return (results.flags ?? []).some((f) => f.key === "tech_team" && f.counted);
}

export interface CompanyIcpView {
  companyId: string;
  check: CompanyIcpCheck | null;
  checks: number;
  tier: string | null;
  layer: number | null;
  status: ContactStatus;
  revenueUsed: number | null;
  revenueSource: string | null;
}

export async function companyIcpView(db: Db, companyId: string, sectorId: string): Promise<CompanyIcpView> {
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
  if (!company) throw new DomainError("not_found", `company not found: ${companyId}`);
  const [check, [count], truth] = await Promise.all([
    latestIcpCheck(db, companyId, sectorId),
    db
      .select({ n: sql<number>`count(*)` })
      .from(companyIcpChecks)
      .where(eq(companyIcpChecks.companyId, companyId)),
    companyRevenueTruth(db, companyId, sectorId),
  ]);
  return {
    companyId,
    check,
    checks: Number(count?.n ?? 0),
    tier: truth.tier,
    layer: truth.layer,
    status: truth.status,
    revenueUsed: truth.revenueUsed,
    revenueSource: truth.revenueSource,
  };
}

export interface SectorIcpCompaniesInput {
  sectorId: string;
  status?: ContactStatus[];
  tier?: ("A" | "B" | "C")[];
  minScore?: number;
  limit?: number;
  offset?: number;
}

export interface SectorIcpCompanyRow {
  companyId: string;
  name: string | null;
  domain: string | null;
  country: string | null;
  checkedAt: string;
  score: number;
  status: ContactStatus;
  tier: string | null;
  layer: number | null;
  exclusionReason: string | null;
  signalsMet: string[];
  techTeam: boolean;
  revenueUsed: number | null;
  revenueSource: string | null;
}

/** Latest check per sector member, with the tier and status the verdict gives today. */
export async function sectorIcpCompanies(
  db: Db,
  input: SectorIcpCompaniesInput,
): Promise<{ total: number; rows: SectorIcpCompanyRow[] }> {
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new DomainError("invalid_input", "limit must be 1..500");
  const offset = input.offset ?? 0;
  const checks = await db
    .selectDistinctOn([companyIcpChecks.companyId], {
      check: companyIcpChecks,
      name: companies.name,
      domain: companies.domain,
      country: companies.country,
    })
    .from(companyIcpChecks)
    .innerJoin(companies, eq(companies.id, companyIcpChecks.companyId))
    .innerJoin(
      sectorCompanies,
      and(eq(sectorCompanies.companyId, companyIcpChecks.companyId), eq(sectorCompanies.sectorId, input.sectorId)),
    )
    .where(eq(companyIcpChecks.sectorId, input.sectorId))
    .orderBy(companyIcpChecks.companyId, desc(companyIcpChecks.createdAt));
  const rows: SectorIcpCompanyRow[] = [];
  for (const c of checks) {
    const truth = await companyRevenueTruth(db, c.check.companyId, input.sectorId);
    rows.push({
      companyId: c.check.companyId,
      name: c.name,
      domain: c.domain,
      country: c.country,
      checkedAt: c.check.createdAt.toISOString(),
      score: c.check.score,
      status: truth.status,
      tier: truth.tier,
      layer: truth.layer,
      exclusionReason: truth.exclusionReason,
      signalsMet: signalsMet(c.check),
      techTeam: hasTechTeam(c.check),
      revenueUsed: truth.revenueUsed,
      revenueSource: truth.revenueSource,
    });
  }
  const filtered = rows
    .filter((r) => !input.status?.length || input.status.includes(r.status))
    .filter((r) => !input.tier?.length || (r.tier !== null && (input.tier as string[]).includes(r.tier)))
    .filter((r) => input.minScore === undefined || r.score >= input.minScore)
    .sort((a, b) => b.score - a.score || (a.name ?? "").localeCompare(b.name ?? ""));
  return { total: filtered.length, rows: filtered.slice(offset, offset + limit) };
}
