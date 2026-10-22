import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import { companies, companyJobs } from "../../src/db/schema.js";
import {
  createCompanyRunner,
  pipelineStatus,
  startCompanyJob,
} from "../../src/runs/company.js";
import {
  checkpointGet,
  checkpointSet,
  pipelinePausedGet,
  tripPipelinePause,
} from "../../src/runs/settings.js";
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

async function completeJob(companyId: string): Promise<void> {
  await handle.db.insert(companyJobs).values({ id: randomUUID(), companyId, status: "completed" });
}

describe("checkpoint settings", () => {
  it("defaults to off and validates the target", async () => {
    await expect(checkpointGet(handle.db)).resolves.toEqual({ target: null });
    await expect(checkpointSet(handle.db, 0)).rejects.toThrow(/afterCompleted/);
    await expect(checkpointSet(handle.db, 25)).resolves.toEqual({ target: 25 });
    await expect(checkpointGet(handle.db)).resolves.toEqual({ target: 25 });
    await expect(checkpointSet(handle.db, null)).resolves.toEqual({ target: null });
  });

  it("setting a target resumes a paused pipeline", async () => {
    await tripPipelinePause(handle.db, 25, 25);
    await expect(pipelinePausedGet(handle.db)).resolves.toMatchObject({ paused: true, target: 25, completed: 25 });
    await checkpointSet(handle.db, 50);
    await expect(pipelinePausedGet(handle.db)).resolves.toMatchObject({ paused: false });
  });

  it("trips are idempotent (first trip wins)", async () => {
    await tripPipelinePause(handle.db, 25, 25);
    await tripPipelinePause(handle.db, 25, 27);
    await expect(pipelinePausedGet(handle.db)).resolves.toMatchObject({ paused: true, completed: 25 });
  });
});

describe("checkpoint trigger", () => {
  it("pauses promotion at N completions while in-flight jobs keep feeding", async () => {
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    const c = await makeCompany("C Co");
    await completeJob(a);
    const { jobId: queuedId } = await startCompanyJob(handle.db, { companyId: b, queued: true });
    const { jobId: runningId } = await startCompanyJob(handle.db, { companyId: c });
    await checkpointSet(handle.db, 1);

    const fed: string[] = [];
    const runner = createCompanyRunner(handle.db, {
      companyMax: 10,
      beginStage: async (job) => {
        fed.push(job.id);
        return { runId: randomUUID() };
      },
    });
    await runner.tick();

    // Tripped: the queued job stays queued.
    await expect(pipelinePausedGet(handle.db)).resolves.toMatchObject({ paused: true, completed: 1 });
    const [queued] = await handle.db.select().from(companyJobs).where(eq(companyJobs.id, queuedId));
    expect(queued?.status).toBe("queued");
    // But the running job was still fed its next stage.
    expect(fed).toContain(runningId);
  });

  it("does not trip below the target", async () => {
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    await completeJob(a);
    const { jobId: queuedId } = await startCompanyJob(handle.db, { companyId: b, queued: true });
    await checkpointSet(handle.db, 2);

    const runner = createCompanyRunner(handle.db, {
      companyMax: 10,
      beginStage: async () => ({ runId: randomUUID() }),
    });
    await runner.tick();

    await expect(pipelinePausedGet(handle.db)).resolves.toMatchObject({ paused: false });
    const [queued] = await handle.db.select().from(companyJobs).where(eq(companyJobs.id, queuedId));
    expect(queued?.status).toBe("running");
  });
});

describe("pipelineStatus", () => {
  it("reports counts, checkpoint, pause state and null quota", async () => {
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    await completeJob(a);
    await startCompanyJob(handle.db, { companyId: b, queued: true });
    await checkpointSet(handle.db, 25);

    const status = await pipelineStatus(handle.db);
    expect(status.counts).toEqual({ completed: 1, queued: 1 });
    expect(status.completed).toBe(1);
    expect(status.checkpointTarget).toBe(25);
    expect(status.paused.paused).toBe(false);
    expect(status.quota).toBeNull();
  });
});
