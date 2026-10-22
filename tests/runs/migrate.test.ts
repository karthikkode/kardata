import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import {
  bulkJobItems,
  bulkJobs,
  companies,
  companyJobs,
  researchRuns,
} from "../../src/db/schema.js";
import { startCompanyJob } from "../../src/runs/company.js";
import { migrateBulkJob, planBulkMigration } from "../../src/runs/migrate.js";
import { ensureMigrated, getTestDb, resetTestDb } from "../db.js";

let handle: DbHandle;

beforeAll(async () => {
  handle = getTestDb();
  await ensureMigrated(handle);
});

beforeEach(async () => {
  await resetTestDb(handle);
});

afterAll(async () => {
  await handle.close();
});

async function makeCompany(name: string): Promise<string> {
  const [row] = await handle.db
    .insert(companies)
    .values({ id: randomUUID(), source: "manual", name })
    .returning({ id: companies.id });
  if (!row) throw new Error("no company row");
  return row.id;
}

async function makeBulkJob(status: "running" | "paused"): Promise<string> {
  const [row] = await handle.db
    .insert(bulkJobs)
    .values({ id: randomUUID(), kind: "collect", scope: "sector", status })
    .returning({ id: bulkJobs.id });
  if (!row) throw new Error("no bulk job row");
  return row.id;
}

async function addItem(jobId: string, companyId: string, status: "queued" | "succeeded" | "failed" | "skipped", runId: string | null = null): Promise<void> {
  await handle.db.insert(bulkJobItems).values({ id: randomUUID(), jobId, companyId, status, runId });
}

async function companyJobCount(): Promise<number> {
  const [row] = await handle.db.select({ n: sql<number>`count(*)` }).from(companyJobs);
  return Number(row?.n ?? 0);
}

describe("planBulkMigration", () => {
  it("plans without writing anything", async () => {
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    const jobId = await makeBulkJob("paused");
    await addItem(jobId, a, "succeeded");
    await addItem(jobId, b, "queued");
    await startCompanyJob(handle.db, { companyId: a });

    const plan = await planBulkMigration(handle.db, jobId);
    expect(plan.bulkStatus).toBe("paused");
    expect(plan.itemCounts).toEqual({ succeeded: 1, queued: 1 });
    expect(plan.distinctCompanies).toBe(2);
    expect(plan.alreadyHaveJob).toBe(1);
    expect(plan.toCreate).toEqual([b]);
    // Dry-run: nothing created, bulk untouched.
    expect(await companyJobCount()).toBe(1);
    const [job] = await handle.db.select().from(bulkJobs).where(eq(bulkJobs.id, jobId));
    expect(job?.status).toBe("paused");
  });
});

describe("migrateBulkJob", () => {
  it("refuses a running bulk job with no writes", async () => {
    const a = await makeCompany("A Co");
    const jobId = await makeBulkJob("running");
    await addItem(jobId, a, "queued");
    await expect(migrateBulkJob(handle.db, jobId)).rejects.toThrow(/pause the bulk job/);
    expect(await companyJobCount()).toBe(0);
  });

  it("creates queued jobs, skips jobbed companies, retires the bulk job", async () => {
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    const c = await makeCompany("C Co");
    const jobId = await makeBulkJob("paused");
    const runId = randomUUID();
    await handle.db.insert(researchRuns).values({ id: runId, companyId: a, kind: "collect", status: "succeeded" });
    await addItem(jobId, a, "succeeded", runId);
    await addItem(jobId, b, "failed");
    await addItem(jobId, c, "queued");
    await startCompanyJob(handle.db, { companyId: c });

    const result = await migrateBulkJob(handle.db, jobId);
    expect(result.created).toBe(2);
    expect(result.createdCompanyIds.sort()).toEqual([a, b].sort());
    expect(result.skippedRace).toBe(0);
    expect(result.bulkCancelled).toBe(true);
    const jobs = await handle.db.select().from(companyJobs);
    expect(jobs).toHaveLength(3);
    expect(jobs.filter((j) => j.status === "queued")).toHaveLength(2);
    // The bulk job is retired, but its progress rows keep their run links.
    const [job] = await handle.db.select().from(bulkJobs).where(eq(bulkJobs.id, jobId));
    expect(job?.status).toBe("cancelled");
    const [item] = await handle.db
      .select()
      .from(bulkJobItems)
      .where(eq(bulkJobItems.companyId, a));
    expect(item?.runId).toBe(runId);
  });
});
