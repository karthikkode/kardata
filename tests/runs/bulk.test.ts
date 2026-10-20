import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import {
  bulkJobItems,
  companies,
  researchRuns,
  sectorCompanies,
  sectors,
  shortlists,
} from "../../src/db/schema.js";
import {
  bulkCancel,
  bulkPause,
  bulkResume,
  bulkRetryFailed,
  bulkSetConcurrency,
  bulkStart,
  bulkStatus,
  createBulkRunner,
  type BulkRunnerDeps,
} from "../../src/runs/bulk.js";
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

interface FakeQueue {
  started: string[];
  extracted: string[];
  cancelled: string[];
  now: number;
  deps: BulkRunnerDeps;
  setNow: (now: number) => void;
  finishRun: (runId: string, status: "succeeded" | "failed" | "stalled", error?: string) => Promise<void>;
}

/** Fake queue: real research_runs rows, no docker. */
function fakeQueue(): FakeQueue {
  const started: string[] = [];
  const extracted: string[] = [];
  const cancelled: string[] = [];
  const state = { now: 1_000_000 };
  const start = async (companyId: string, kind: "agent" | "collect") => {
    const runId = randomUUID();
    await handle.db.insert(researchRuns).values({
      id: runId,
      companyId,
      kind,
      status: "running",
      startedAt: new Date(state.now),
    });
    started.push(companyId);
    return { runId };
  };
  return {
    started,
    extracted,
    cancelled,
    now: state.now,
    deps: {
      startResearch: async (companyId) => start(companyId, "agent"),
      startCollect: async (companyId) => start(companyId, "collect"),
      extract: async (runId) => {
        extracted.push(runId);
      },
      clock: () => state.now,
    },
    setNow: (now: number) => {
      state.now = now;
    },
    finishRun: async (runId, status, error) => {
      await handle.db
        .update(researchRuns)
        .set({
          status,
          error: error ?? null,
          finishedAt: new Date(state.now),
          agentUsage:
            status === "succeeded"
              ? {
                  model: "fake",
                  inputTokens: 1000,
                  outputTokens: 100,
                  cachedTokens: 500,
                  reasoningTokens: 0,
                  calls: 2,
                  childrenIncluded: false,
                }
              : null,
        })
        .where(eq(researchRuns.id, runId));
    },
  };
}

async function runIdsForJob(jobId: string): Promise<string[]> {
  const rows = await handle.db
    .select({ runId: bulkJobItems.runId })
    .from(bulkJobItems)
    .where(eq(bulkJobItems.jobId, jobId));
  return rows.map((r) => r.runId).filter((r): r is string => r !== null);
}

describe("bulk_start", () => {
  it("resolves sectors, shortlists and explicit lists", async () => {
    const a = await makeCompany("A");
    const b = await makeCompany("B");
    const [sector] = await handle.db
      .insert(sectors)
      .values({ id: randomUUID(), name: "Bulk Sector" })
      .returning({ id: sectors.id });
    await handle.db.insert(sectorCompanies).values([
      { sectorId: sector?.id ?? "", companyId: a, addedVia: "manual" },
      { sectorId: sector?.id ?? "", companyId: b, addedVia: "manual" },
    ]);
    const [list] = await handle.db
      .insert(shortlists)
      .values({ id: randomUUID(), sectorId: sector?.id ?? "", name: "Bulk List", companyIds: [b] })
      .returning({ id: shortlists.id });

    const bySector = await bulkStart(handle.db, { kind: "research_sector", sectorId: sector?.id ?? "" });
    expect(bySector.items).toBe(2);
    const byList = await bulkStart(handle.db, { kind: "research_shortlist", shortlistId: list?.id ?? "" });
    expect(byList.items).toBe(1);
    const byIds = await bulkStart(handle.db, { kind: "collect_sector", companyIds: [a, a] });
    expect(byIds.items).toBe(1);
  });

  it("validates scope sources, concurrency and research-only options", async () => {
    const a = await makeCompany("A");
    await expect(bulkStart(handle.db, { kind: "research_sector", companyIds: [a], sectorId: a })).rejects.toThrow(
      "exactly one",
    );
    await expect(bulkStart(handle.db, { kind: "research_sector", companyIds: [a], concurrency: 5 })).rejects.toThrow(
      "1..4",
    );
    await expect(
      bulkStart(handle.db, { kind: "collect_sector", companyIds: [a], promptVersion: "v1.2" }),
    ).rejects.toThrow("research-only");
    await expect(bulkStart(handle.db, { kind: "collect_sector", companyIds: [] })).rejects.toThrow("must not be empty");
    await expect(
      bulkStart(handle.db, { kind: "collect_sector", companyIds: [randomUUID()] }),
    ).rejects.toThrow("unknown company");
  });
});

describe("bulk worker", () => {
  it("feeds at concurrency through research plus extraction", async () => {
    const ids = [await makeCompany("A"), await makeCompany("B"), await makeCompany("C")];
    const q = fakeQueue();
    const runner = createBulkRunner(handle.db, q.deps);
    const { jobId } = await bulkStart(handle.db, {
      kind: "research_shortlist",
      companyIds: ids,
      concurrency: 2,
      skipIfRecentDays: 0,
    });

    await runner.tick();
    expect(q.started).toHaveLength(2);
    let view = await bulkStatus(handle.db, jobId);
    expect(view.counts).toMatchObject({ running: 2, queued: 1 });

    for (const runId of await runIdsForJob(jobId)) await q.finishRun(runId, "succeeded");
    await runner.tick();
    expect(q.extracted).toHaveLength(2);
    expect(q.started).toHaveLength(3);
    view = await bulkStatus(handle.db, jobId);
    expect(view.counts).toMatchObject({ succeeded: 2, running: 1 });

    for (const runId of await runIdsForJob(jobId)) {
      const [run] = await handle.db.select().from(researchRuns).where(eq(researchRuns.id, runId));
      if (run?.status === "running") await q.finishRun(runId, "succeeded");
    }
    await runner.tick();
    view = await bulkStatus(handle.db, jobId);
    expect(view.counts).toMatchObject({ succeeded: 3 });
    expect(view.job.status).toBe("completed");
  });

  it("applies a runtime concurrency change", async () => {
    const ids = [await makeCompany("A"), await makeCompany("B"), await makeCompany("C")];
    const q = fakeQueue();
    const runner = createBulkRunner(handle.db, q.deps);
    const { jobId } = await bulkStart(handle.db, {
      kind: "collect_sector",
      companyIds: ids,
      concurrency: 1,
      skipIfRecentDays: 0,
    });
    await runner.tick();
    expect(q.started).toHaveLength(1);
    await bulkSetConcurrency(handle.db, jobId, 3);
    await runner.tick();
    expect(q.started).toHaveLength(3);
  });

  it("pauses, resumes and cancels", async () => {
    const ids = [await makeCompany("A"), await makeCompany("B")];
    const q = fakeQueue();
    const runner = createBulkRunner(handle.db, q.deps);
    const { jobId } = await bulkStart(handle.db, {
      kind: "collect_sector",
      companyIds: ids,
      concurrency: 1,
      skipIfRecentDays: 0,
    });
    await runner.tick();
    await bulkPause(handle.db, jobId);
    for (const runId of await runIdsForJob(jobId)) await q.finishRun(runId, "succeeded");
    await runner.tick();
    // The running item finalizes but nothing new starts while paused.
    expect(q.started).toHaveLength(1);
    let view = await bulkStatus(handle.db, jobId);
    expect(view.job.status).toBe("paused");
    expect(view.counts).toMatchObject({ succeeded: 1, queued: 1 });

    await bulkResume(handle.db, jobId);
    await runner.tick();
    expect(q.started).toHaveLength(2);

    await bulkCancel(handle.db, jobId, async (runId) => {
      q.cancelled.push(runId);
    });
    view = await bulkStatus(handle.db, jobId);
    expect(view.job.status).toBe("cancelled");
    expect(view.counts).toMatchObject({ succeeded: 1, cancelled: 1 });
    expect(q.cancelled).toHaveLength(1);
  });

  it("skips recently-done companies", async () => {
    const fresh = await makeCompany("Fresh");
    const stale = await makeCompany("Stale");
    await handle.db.insert(researchRuns).values({
      id: randomUUID(),
      companyId: fresh,
      kind: "agent",
      status: "succeeded",
      startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      finishedAt: new Date(Date.now() - 23 * 60 * 60 * 1000),
    });
    const q = fakeQueue();
    const runner = createBulkRunner(handle.db, q.deps);
    const { jobId } = await bulkStart(handle.db, {
      kind: "research_shortlist",
      companyIds: [fresh, stale],
      concurrency: 2,
      skipIfRecentDays: 14,
    });
    await runner.tick();
    expect(q.started).toEqual([stale]);
    const view = await bulkStatus(handle.db, jobId);
    expect(view.counts).toMatchObject({ skipped: 1, running: 1 });
  });

  it("pauses on budgets", async () => {
    const ids = [await makeCompany("A"), await makeCompany("B")];
    const q = fakeQueue();
    const runner = createBulkRunner(handle.db, q.deps);
    const { jobId } = await bulkStart(handle.db, {
      kind: "collect_sector",
      companyIds: ids,
      concurrency: 2,
      maxRuns: 1,
      skipIfRecentDays: 0,
    });
    await runner.tick();
    for (const runId of await runIdsForJob(jobId)) await q.finishRun(runId, "succeeded");
    await runner.tick();
    const view = await bulkStatus(handle.db, jobId);
    expect(view.job.status).toBe("paused");
    expect(view.job.pauseReason).toContain("maxRuns");
    expect(view.counts).toMatchObject({ succeeded: 1, queued: 1 });
  });

  it("auto-pauses after 3 consecutive same-class errors", async () => {
    const ids = [await makeCompany("A"), await makeCompany("B"), await makeCompany("C"), await makeCompany("D")];
    const q = fakeQueue();
    const runner = createBulkRunner(handle.db, q.deps);
    const { jobId } = await bulkStart(handle.db, {
      kind: "research_shortlist",
      companyIds: ids,
      concurrency: 1,
      skipIfRecentDays: 0,
    });
    for (let round = 0; round < 3; round++) {
      await runner.tick();
      const runIds = await runIdsForJob(jobId);
      const [run] = await handle.db.select().from(researchRuns).where(eq(researchRuns.id, runIds[runIds.length - 1] ?? ""));
      if (run?.status === "running") await q.finishRun(run.id, "failed", "API rate limited, quota exhausted");
      q.setNow(1_000_000 + (round + 1) * 60_000);
      await runner.tick();
    }
    const view = await bulkStatus(handle.db, jobId);
    expect(view.job.status).toBe("paused");
    expect(view.job.pauseReason).toContain("usage_limit");
    expect(view.job.pauseReason).toContain("rate limited");
    expect(view.counts).toMatchObject({ failed: 3, queued: 1 });
    // A different error class resets the streak instead.
    await bulkResume(handle.db, jobId);
    await runner.tick();
    const runIds = await runIdsForJob(jobId);
    const [run] = await handle.db.select().from(researchRuns).where(eq(researchRuns.id, runIds[runIds.length - 1] ?? ""));
    if (run?.status === "running") await q.finishRun(run.id, "stalled");
    await runner.tick();
    const resumed = await bulkStatus(handle.db, jobId);
    expect(resumed.job.status).toBe("completed");
    expect(resumed.counts).toMatchObject({ failed: 4 });
  });

  it("recovers mid-job across a restart, including interrupted extraction", async () => {
    const ids = [await makeCompany("A"), await makeCompany("B")];
    const q = fakeQueue();
    const first = createBulkRunner(handle.db, q.deps);
    const { jobId } = await bulkStart(handle.db, {
      kind: "research_shortlist",
      companyIds: ids,
      concurrency: 2,
      skipIfRecentDays: 0,
    });
    await first.tick();
    const runIds = await runIdsForJob(jobId);
    await q.finishRun(runIds[0] ?? "", "succeeded");
    // The second item was mid-extraction when the process died.
    await handle.db
      .update(bulkJobItems)
      .set({ status: "extracting" })
      .where(eq(bulkJobItems.runId, runIds[1] ?? ""));
    await q.finishRun(runIds[1] ?? "", "succeeded");

    const second = createBulkRunner(handle.db, q.deps);
    await second.tick();
    expect(q.extracted).toHaveLength(2);
    const view = await bulkStatus(handle.db, jobId);
    expect(view.counts).toMatchObject({ succeeded: 2 });
    expect(view.job.status).toBe("completed");
  });

  it("estimates ETA from finished timings", async () => {
    const ids = [await makeCompany("A"), await makeCompany("B"), await makeCompany("C")];
    const q = fakeQueue();
    const runner = createBulkRunner(handle.db, q.deps);
    const { jobId } = await bulkStart(handle.db, {
      kind: "collect_sector",
      companyIds: ids,
      concurrency: 1,
      skipIfRecentDays: 0,
    });
    await runner.tick();
    let view = await bulkStatus(handle.db, jobId);
    expect(view.etaSec).toBeNull();
    q.setNow(1_000_000 + 120_000);
    for (const runId of await runIdsForJob(jobId)) await q.finishRun(runId, "succeeded");
    await runner.tick();
    view = await bulkStatus(handle.db, jobId);
    // One 120s run finished, two remain at concurrency 1: ~240s.
    expect(view.etaSec).toBe(240);
  });

  it("retries failed companies", async () => {
    const a = await makeCompany("A");
    const q = fakeQueue();
    const runner = createBulkRunner(handle.db, q.deps);
    const { jobId } = await bulkStart(handle.db, {
      kind: "collect_sector",
      companyIds: [a],
      concurrency: 1,
      skipIfRecentDays: 0,
    });
    await runner.tick();
    for (const runId of await runIdsForJob(jobId)) await q.finishRun(runId, "failed", "boom");
    await runner.tick();
    let view = await bulkStatus(handle.db, jobId);
    expect(view.job.status).toBe("completed");
    expect(view.counts.failed).toBe(1);
    const { retried } = await bulkRetryFailed(handle.db, jobId);
    expect(retried).toBe(1);
    view = await bulkStatus(handle.db, jobId);
    expect(view.job.status).toBe("running");
    await runner.tick();
    expect(q.started).toHaveLength(2);
  });
});
