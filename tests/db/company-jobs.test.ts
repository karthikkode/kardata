import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import {
  companies,
  companyJobs,
  httpFetches,
  jobEvents,
  preflightReports,
  providerCalls,
  researchRuns,
} from "../../src/db/schema.js";
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

describe("company_jobs one-active rule (AC-1)", () => {
  it("rejects a second active job for the same company", async () => {
    const companyId = await makeCompany("Acme");
    await handle.db.insert(companyJobs).values({ id: randomUUID(), companyId, status: "running" });
    await expect(
      handle.db.insert(companyJobs).values({ id: randomUUID(), companyId, status: "scheduled" }),
    ).rejects.toThrow();
  });

  it("allows a new job once the previous one is terminal", async () => {
    const companyId = await makeCompany("Acme");
    const [first] = await handle.db
      .insert(companyJobs)
      .values({ id: randomUUID(), companyId, status: "running" })
      .returning({ id: companyJobs.id });
    if (!first) throw new Error("no job row");
    await handle.db.update(companyJobs).set({ status: "completed" }).where(eq(companyJobs.id, first.id));
    await handle.db.insert(companyJobs).values({ id: randomUUID(), companyId, status: "scheduled" });
    const rows = await handle.db.select().from(companyJobs).where(eq(companyJobs.companyId, companyId));
    expect(rows).toHaveLength(2);
  });
});

describe("subjobs", () => {
  it("links research_runs rows to a job with a stage", async () => {
    const companyId = await makeCompany("Acme");
    const [job] = await handle.db
      .insert(companyJobs)
      .values({ id: randomUUID(), companyId })
      .returning({ id: companyJobs.id });
    if (!job) throw new Error("no job row");
    await handle.db.insert(researchRuns).values({
      id: randomUUID(),
      companyId,
      kind: "agent",
      status: "succeeded",
      companyJobId: job.id,
      stage: "preflight",
    });
    const rows = await handle.db
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.companyJobId, job.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.stage).toBe("preflight");
  });
});

describe("preflight_reports", () => {
  it("enforces one report per job+version", async () => {
    const companyId = await makeCompany("Acme");
    const [job] = await handle.db
      .insert(companyJobs)
      .values({ id: randomUUID(), companyId })
      .returning({ id: companyJobs.id });
    if (!job) throw new Error("no job row");
    await handle.db
      .insert(preflightReports)
      .values({ id: randomUUID(), jobId: job.id, companyId, report: { adapters: [] } });
    await expect(
      handle.db
        .insert(preflightReports)
        .values({ id: randomUUID(), jobId: job.id, companyId, report: {} }),
    ).rejects.toThrow();
  });
});

describe("provider_calls", () => {
  it("dedupes on usage_id but allows multiple dispatch rows", async () => {
    const companyId = await makeCompany("Acme");
    const [job] = await handle.db
      .insert(companyJobs)
      .values({ id: randomUUID(), companyId })
      .returning({ id: companyJobs.id });
    if (!job) throw new Error("no job row");
    await handle.db.insert(providerCalls).values({ companyJobId: job.id, stage: "research" });
    await handle.db.insert(providerCalls).values({ companyJobId: job.id, stage: "research" });
    await handle.db
      .insert(providerCalls)
      .values({ companyJobId: job.id, stage: "research", usageId: "usage-1", inputTokens: 10 });
    await expect(
      handle.db
        .insert(providerCalls)
        .values({ companyJobId: job.id, stage: "research", usageId: "usage-1" }),
    ).rejects.toThrow();
  });
});

describe("job_events and http_fetches", () => {
  it("stores stage transitions and fetch logs in id order", async () => {
    const companyId = await makeCompany("Acme");
    const [job] = await handle.db
      .insert(companyJobs)
      .values({ id: randomUUID(), companyId })
      .returning({ id: companyJobs.id });
    if (!job) throw new Error("no job row");
    await handle.db.insert(jobEvents).values({ jobId: job.id, stage: "collect", type: "stage_started" });
    await handle.db.insert(jobEvents).values({ jobId: job.id, stage: "collect", type: "stage_done" });
    await handle.db.insert(httpFetches).values({
      companyJobId: job.id,
      companyId,
      collector: "shopify",
      url: "https://example.com/products.json",
      host: "example.com",
      statusCode: 200,
      bytes: 12,
    });
    const events = await handle.db
      .select()
      .from(jobEvents)
      .where(eq(jobEvents.jobId, job.id))
      .orderBy(asc(jobEvents.id));
    expect(events.map((e) => e.type)).toEqual(["stage_started", "stage_done"]);
    const fetches = await handle.db
      .select()
      .from(httpFetches)
      .where(eq(httpFetches.companyJobId, job.id));
    expect(fetches).toHaveLength(1);
  });
});
