import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { bulkJobItems, bulkJobs, companyJobs } from "../db/schema.js";
import { DomainError } from "../domain/errors.js";
import { jobCancel } from "./bulk.js";
import { startCompanyJob } from "./company.js";

/**
 * Bulk → company migration (Stage 5 Phase 7): move every company of a bulk
 * job into the company pipeline. Each migrated company gets a created company
 * job and runs the full pipeline honestly (preflight → collect → research →
 * extraction); the bulk-collected data stays as company-scoped history
 * (dossier, facts, fresh-collect checks all see it). No stage is ever
 * pre-marked complete. The bulk job is retired (cancelled) so the two
 * feeders can never double-feed a company.
 */

export interface BulkMigrationPlan {
  bulkJobId: string;
  bulkStatus: string;
  itemCounts: Record<string, number>;
  distinctCompanies: number;
  alreadyHaveJob: number;
  toCreate: string[];
}

const PLAN_SAMPLE_MAX = 10;

async function loadBulkJob(db: Db, bulkJobId: string) {
  const [job] = await db.select().from(bulkJobs).where(eq(bulkJobs.id, bulkJobId));
  if (!job) throw new DomainError("not_found", `bulk job not found: ${bulkJobId}`);
  return job;
}

/** Dry-run: compute the migration without writing anything. */
export async function planBulkMigration(db: Db, bulkJobId: string): Promise<BulkMigrationPlan> {
  const job = await loadBulkJob(db, bulkJobId);
  const counts = await db
    .select({ status: bulkJobItems.status, n: sql<number>`count(*)` })
    .from(bulkJobItems)
    .where(eq(bulkJobItems.jobId, bulkJobId))
    .groupBy(bulkJobItems.status);
  const itemCounts: Record<string, number> = {};
  for (const row of counts) itemCounts[row.status] = Number(row.n);
  const items = await db
    .selectDistinct({ companyId: bulkJobItems.companyId })
    .from(bulkJobItems)
    .where(eq(bulkJobItems.jobId, bulkJobId));
  const existing = await db
    .selectDistinct({ companyId: companyJobs.companyId })
    .from(companyJobs);
  const haveJob = new Set(existing.map((r) => r.companyId));
  const toCreate = items.map((r) => r.companyId).filter((id) => !haveJob.has(id));
  return {
    bulkJobId,
    bulkStatus: job.status,
    itemCounts,
    distinctCompanies: items.length,
    alreadyHaveJob: items.length - toCreate.length,
    toCreate: toCreate.slice(0, PLAN_SAMPLE_MAX),
  };
}

export interface BulkMigrationResult {
  plan: BulkMigrationPlan;
  created: number;
  skippedRace: number;
  /** Full create list (the plan view only samples). */
  createdCompanyIds: string[];
  bulkCancelled: boolean;
}

/**
 * Execute the migration. Refuses a running bulk job (pause it first) so the
 * feeder cannot race the migration; anything else is retired afterwards.
 */
export async function migrateBulkJob(db: Db, bulkJobId: string): Promise<BulkMigrationResult> {
  const job = await loadBulkJob(db, bulkJobId);
  if (job.status === "running") {
    throw new DomainError("invalid_input", "pause the bulk job before migrating it");
  }
  const items = await db
    .selectDistinct({ companyId: bulkJobItems.companyId })
    .from(bulkJobItems)
    .where(eq(bulkJobItems.jobId, bulkJobId));
  const existing = await db
    .selectDistinct({ companyId: companyJobs.companyId })
    .from(companyJobs);
  const haveJob = new Set(existing.map((r) => r.companyId));
  const createdCompanyIds: string[] = [];
  let skippedRace = 0;
  for (const { companyId } of items) {
    if (haveJob.has(companyId)) continue;
    try {
      await startCompanyJob(db, { companyId, defer: true });
      createdCompanyIds.push(companyId);
      haveJob.add(companyId);
    } catch (err) {
      if (err instanceof DomainError && err.code === "conflict") {
        skippedRace += 1;
        continue;
      }
      throw err;
    }
  }
  let bulkCancelled = false;
  if (job.status !== "cancelled" && job.status !== "completed") {
    await jobCancel(db, bulkJobId);
    bulkCancelled = true;
  }
  const plan = await planBulkMigration(db, bulkJobId);
  return { plan, created: createdCompanyIds.length, skippedRace, createdCompanyIds, bulkCancelled };
}
