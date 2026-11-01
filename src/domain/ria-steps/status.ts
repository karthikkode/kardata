import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { imports, riaStepRuns, sectorCompanies, type RiaStep } from "../../db/schema.js";
import { RIA_STEPS } from "../../db/schema.js";

export type StepOutcome = "done" | "gap" | "failed";

export async function recordStep(
  db: Db,
  input: { sectorId: string; companyId: string; step: RiaStep; status: StepOutcome; reason?: string | null; inputHash?: string | null; tokensUsed?: number | null },
): Promise<void> {
  await db
    .insert(riaStepRuns)
    .values({
      id: randomUUID(),
      sectorId: input.sectorId,
      companyId: input.companyId,
      step: input.step,
      status: input.status,
      reason: input.reason ?? null,
      inputHash: input.inputHash ?? null,
      tokensUsed: input.tokensUsed ?? null,
    })
    .onConflictDoUpdate({
      target: [riaStepRuns.sectorId, riaStepRuns.companyId, riaStepRuns.step],
      set: {
        status: input.status,
        reason: input.reason ?? null,
        inputHash: input.inputHash ?? null,
        tokensUsed: input.tokensUsed ?? null,
        updatedAt: new Date(),
      },
    });
}

export async function stepState(
  db: Db,
  sectorId: string,
  companyId: string,
  step: RiaStep,
): Promise<{ status: StepOutcome; inputHash: string | null } | null> {
  const [row] = await db
    .select({ status: riaStepRuns.status, inputHash: riaStepRuns.inputHash })
    .from(riaStepRuns)
    .where(and(eq(riaStepRuns.sectorId, sectorId), eq(riaStepRuns.companyId, companyId), eq(riaStepRuns.step, step)));
  return row ? { status: row.status as StepOutcome, inputHash: row.inputHash } : null;
}

/** Eligible ria members (removed excluded), id-ordered. */
export async function eligibleCompanyIds(db: Db, sectorId: string): Promise<string[]> {
  const rows = await db
    .select({ companyId: sectorCompanies.companyId })
    .from(sectorCompanies)
    .where(and(eq(sectorCompanies.sectorId, sectorId), eq(sectorCompanies.eligibility, "eligible"), sql`${sectorCompanies.removedAt} is null`))
    .orderBy(sectorCompanies.companyId);
  return rows.map((r) => r.companyId);
}

export interface RiaStatusView {
  sectorId: string;
  eligible: number;
  steps: Record<RiaStep, { done: number; gap: number; failed: number; pending: number; gapReasons: Record<string, number>; failedReasons: Record<string, number> }>;
  latestImport: { filename: string; createdAt: string; rowsRead: number } | null;
  preflight: { eligible: number; ineligible: number; pending: number };
  details?: { companyId: string; step: RiaStep; status: string; reason: string | null; inputHash: string | null; tokensUsed: number | null; updatedAt: Date }[];
}

export async function riaStatus(db: Db, sectorId: string, companyIds?: string[]): Promise<RiaStatusView> {
  const allEligibleIds = await eligibleCompanyIds(db, sectorId);
  const requested = companyIds === undefined ? null : new Set(companyIds);
  const eligibleIds = requested ? allEligibleIds.filter((id) => requested.has(id)) : allEligibleIds;
  const eligibleSet = new Set(eligibleIds);
  const rows = await db.select().from(riaStepRuns).where(eq(riaStepRuns.sectorId, sectorId));
  const steps = {} as RiaStatusView["steps"];
  for (const step of RIA_STEPS) {
    const mine = rows.filter((r) => r.step === step && eligibleSet.has(r.companyId));
    const gapReasons: Record<string, number> = {};
    const failedReasons: Record<string, number> = {};
    for (const r of mine) {
      if (r.status === "gap") {
        const key = (r.reason ?? "gap").slice(0, 80);
        gapReasons[key] = (gapReasons[key] ?? 0) + 1;
      }
      if (r.status === "failed") {
        const key = (r.reason ?? "failed").slice(0, 160);
        failedReasons[key] = (failedReasons[key] ?? 0) + 1;
      }
    }
    steps[step] = {
      done: mine.filter((r) => r.status === "done").length,
      gap: mine.filter((r) => r.status === "gap").length,
      failed: mine.filter((r) => r.status === "failed").length,
      pending: eligibleIds.length - mine.length,
      gapReasons,
      failedReasons,
    };
  }
  const [latestImport] = await db
    .select()
    .from(imports)
    .where(eq(imports.sectorId, sectorId))
    .orderBy(desc(imports.createdAt))
    .limit(1);
  const counts = await db
    .select({ eligibility: sectorCompanies.eligibility, n: sql<number>`count(*)::int` })
    .from(sectorCompanies)
    .where(and(eq(sectorCompanies.sectorId, sectorId), sql`${sectorCompanies.removedAt} is null`))
    .groupBy(sectorCompanies.eligibility);
  const byElig = new Map(counts.map((c) => [c.eligibility, Number(c.n)]));
  const totalMembers = [...byElig.values()].reduce((a, b) => a + b, 0);
  return {
    sectorId,
    eligible: eligibleIds.length,
    steps,
    ...(requested ? { details: rows.filter((r) => eligibleSet.has(r.companyId)).map((r) => ({
      companyId: r.companyId, step: r.step, status: r.status, reason: r.reason, inputHash: r.inputHash,
      tokensUsed: r.tokensUsed, updatedAt: r.updatedAt,
    })) } : {}),
    latestImport: latestImport
      ? { filename: latestImport.filename, createdAt: latestImport.createdAt.toISOString(), rowsRead: latestImport.rowsRead }
      : null,
    preflight: {
      eligible: byElig.get("eligible") ?? 0,
      ineligible: byElig.get("ineligible") ?? 0,
      pending: totalMembers - (byElig.get("eligible") ?? 0) - (byElig.get("ineligible") ?? 0),
    },
  };
}

export async function latestImportId(db: Db, sectorId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: imports.id })
    .from(imports)
    .where(eq(imports.sectorId, sectorId))
    .orderBy(desc(imports.createdAt))
    .limit(1);
  return row?.id ?? null;
}

export { inArray };
