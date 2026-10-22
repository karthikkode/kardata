import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import {
  bulkJobItems,
  bulkJobs,
  companies,
  researchRuns,
  sectorCompanies,
  sectors,
  shortlists,
} from "../../src/db/schema.js";
import {
  createJobRunner,
  jobCancel,
  jobList,
  jobPause,
  jobResume,
  jobRetryFailed,
  jobStatus,
  startCollectSectorJob,
  startResearchSectorJob,
  startResearchShortlistJob,
  type JobRunnerDeps,
} from "../../src/runs/bulk.js";
import { effectiveMaxAgents, harnessSettingsGet, harnessSettingsSet } from "../../src/runs/settings.js";
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

async function makeCompany(name: string, opts: { employees?: number; country?: string } = {}): Promise<string> {
  const [row] = await handle.db
    .insert(companies)
    .values({ id: randomUUID(), source: "manual", name, employees: opts.employees ?? null, country: opts.country ?? null })
    .returning({ id: companies.id });
  if (!row) throw new Error("no company row");
  return row.id;
}

async function makeSector(name: string, companyIds: string[]): Promise<string> {
  const [sector] = await handle.db
    .insert(sectors)
    .values({ id: randomUUID(), name })
    .returning({ id: sectors.id });
  if (!sector) throw new Error("no sector row");
  if (companyIds.length > 0) {
    await handle.db.insert(sectorCompanies).values(
      companyIds.map((companyId) => ({ sectorId: sector.id, companyId, addedVia: "manual" as const })),
    );
  }
  return sector.id;
}

async function makeShortlist(sectorId: string, name: string, companyIds: string[]): Promise<string> {
  const [list] = await handle.db
    .insert(shortlists)
    .values({ id: randomUUID(), sectorId, name, companyIds })
    .returning({ id: shortlists.id });
  if (!list) throw new Error("no shortlist row");
  return list.id;
}

interface FakeQueue {
  started: string[];
  extracted: string[];
  cancelled: string[];
  deps: JobRunnerDeps;
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

async function finishRunning(q: FakeQueue, jobId: string, status: "succeeded" | "failed" | "stalled", error?: string): Promise<void> {
  for (const runId of await runIdsForJob(jobId)) {
    const [run] = await handle.db.select().from(researchRuns).where(eq(researchRuns.id, runId));
    if (run?.status === "running") await q.finishRun(runId, status, error);
  }
}

describe("job creation", () => {
  it("research_sector defaults to employees desc with criteria and cap", async () => {
    const big = await makeCompany("Big", { employees: 500, country: "Canada" });
    const mid = await makeCompany("Mid", { employees: 100, country: "Canada" });
    const small = await makeCompany("Small", { employees: 10, country: "Japan" });
    const sectorId = await makeSector("Jobs", [big, mid, small]);

    const all = await startResearchSectorJob(handle.db, { sectorId, skipIfRecentDays: 0 });
    expect(all.items).toBe(3);
    expect(all.capped).toBe(false);
    let view = await jobStatus(handle.db, all.jobId);
    expect(view.items.map((i) => i.companyName)).toEqual(["Big", "Mid", "Small"]);

    const canada = await startResearchSectorJob(handle.db, {
      sectorId,
      criteria: [{ field: "country", op: "eq", value: "Canada" }],
      skipIfRecentDays: 0,
    });
    expect(canada.items).toBe(2);

    const capped = await startResearchSectorJob(handle.db, {
      sectorId,
      maxCompanies: 1,
      skipIfRecentDays: 0,
    });
    expect(capped).toMatchObject({ items: 1, capped: true });
    view = await jobStatus(handle.db, capped.jobId);
    expect(view.items[0]?.companyName).toBe("Big");
  });

  it("research_shortlist keeps list order", async () => {
    const a = await makeCompany("A");
    const b = await makeCompany("B");
    const sectorId = await makeSector("Jobs", [a, b]);
    const shortlistId = await makeShortlist(sectorId, "List", [b, a]);
    const { jobId } = await startResearchShortlistJob(handle.db, { shortlistId, skipIfRecentDays: 0 });
    const view = await jobStatus(handle.db, jobId);
    expect(view.items.map((i) => i.companyName)).toEqual(["B", "A"]);
    expect(view.job.scope).toBe("shortlist");
  });

  it("rejects empty scopes and bad budgets", async () => {
    const a = await makeCompany("A");
    const sectorId = await makeSector("Jobs", [a]);
    await expect(startResearchSectorJob(handle.db, { sectorId: randomUUID() })).rejects.toThrow("not found");
    await expect(startResearchShortlistJob(handle.db, { shortlistId: randomUUID() })).rejects.toThrow("not found");
    await expect(startResearchSectorJob(handle.db, { sectorId, budget: { maxTokens: 0 } })).rejects.toThrow("maxTokens");
    await expect(startResearchSectorJob(handle.db, { sectorId, budget: { maxHours: -1 } })).rejects.toThrow("maxHours");
    await expect(startResearchSectorJob(handle.db, { sectorId, maxCompanies: 0 })).rejects.toThrow("maxCompanies");
    const emptySector = await makeSector("Empty", []);
    await expect(startResearchSectorJob(handle.db, { sectorId: emptySector })).rejects.toThrow("no companies");
    const emptyList = await makeShortlist(sectorId, "Empty", []);
    await expect(startResearchShortlistJob(handle.db, { shortlistId: emptyList })).rejects.toThrow("no companies");
  });

  it("collect_sector creates a collect job", async () => {
    const a = await makeCompany("A");
    const sectorId = await makeSector("Jobs", [a]);
    const { jobId } = await startCollectSectorJob(handle.db, { sectorId });
    const view = await jobStatus(handle.db, jobId);
    expect(view.job.kind).toBe("collect");
    expect(view.job.skipIfRecentDays).toBe(14);
  });

  it("job_list returns recent jobs with counts", async () => {
    const a = await makeCompany("A");
    const sectorId = await makeSector("Jobs", [a]);
    const first = await startCollectSectorJob(handle.db, { sectorId });
    const second = await startCollectSectorJob(handle.db, { sectorId });
    const jobs = await jobList(handle.db);
    expect(jobs.map((j) => j.job.id)).toEqual([second.jobId, first.jobId]);
    expect(jobs[0]?.counts.queued).toBe(1);
  });
});

describe("job worker", () => {
  async function shortlistJob(names: string[]) {
    const ids: string[] = [];
    for (const name of names) ids.push(await makeCompany(name));
    const sectorId = await makeSector("Jobs", ids);
    const shortlistId = await makeShortlist(sectorId, "List", ids);
    await harnessSettingsSet(handle.db, 2);
    return { ids, sectorId, shortlistId };
  }

  it("feeds at concurrency through research plus extraction", async () => {
    const { shortlistId } = await shortlistJob(["A", "B", "C"]);
    const q = fakeQueue();
    const runner = createJobRunner(handle.db, q.deps);
    const { jobId } = await startResearchShortlistJob(handle.db, { shortlistId, skipIfRecentDays: 0 });

    await runner.tick();
    expect(q.started).toHaveLength(2);
    let view = await jobStatus(handle.db, jobId);
    expect(view.counts).toMatchObject({ running: 2, queued: 1 });
    expect(view.activeRuns).toHaveLength(2);

    await finishRunning(q, jobId, "succeeded");
    await runner.tick();
    expect(q.extracted).toHaveLength(2);
    expect(q.started).toHaveLength(3);
    view = await jobStatus(handle.db, jobId);
    expect(view.counts).toMatchObject({ succeeded: 2, running: 1 });

    await finishRunning(q, jobId, "succeeded");
    await runner.tick();
    view = await jobStatus(handle.db, jobId);
    expect(view.counts).toMatchObject({ succeeded: 3 });
    expect(view.job.status).toBe("completed");
    expect(view.tokensSpent).toBe(3 * 1500);
    // Runs carry the job id.
    const runs = await handle.db.select({ jobId: researchRuns.jobId }).from(researchRuns);
    expect(runs).toHaveLength(3);
    for (const run of runs) expect(run.jobId).toBe(jobId);
  });

  it("applies a runtime concurrency change", async () => {
    const { sectorId } = await shortlistJob(["A", "B", "C"]);
    await harnessSettingsSet(handle.db, 1);
    const q = fakeQueue();
    const runner = createJobRunner(handle.db, q.deps);
    await startCollectSectorJob(handle.db, { sectorId, onlyStale: false });
    await runner.tick();
    expect(q.started).toHaveLength(1);
    await harnessSettingsSet(handle.db, 3);
    await runner.tick();
    expect(q.started).toHaveLength(3);
  });

  it("pauses, resumes and cancels", async () => {
    const { shortlistId } = await shortlistJob(["A", "B"]);
    await harnessSettingsSet(handle.db, 1);
    const q = fakeQueue();
    const runner = createJobRunner(handle.db, q.deps);
    const { jobId } = await startResearchShortlistJob(handle.db, { shortlistId, skipIfRecentDays: 0 });
    await runner.tick();
    await jobPause(handle.db, jobId);
    await finishRunning(q, jobId, "succeeded");
    await runner.tick();
    // The running item finalizes but nothing new starts while paused.
    expect(q.started).toHaveLength(1);
    let view = await jobStatus(handle.db, jobId);
    expect(view.job.status).toBe("paused");
    expect(view.counts).toMatchObject({ succeeded: 1, queued: 1 });

    await jobResume(handle.db, jobId);
    await runner.tick();
    expect(q.started).toHaveLength(2);

    await jobCancel(handle.db, jobId, {}, async (runId) => {
      q.cancelled.push(runId);
    });
    view = await jobStatus(handle.db, jobId);
    expect(view.job.status).toBe("cancelled");
    expect(view.counts).toMatchObject({ succeeded: 1, cancelled: 1 });
    expect(q.cancelled).toHaveLength(1);
  });

  it("cancel with stopRunning=false lets agents finish", async () => {
    const { shortlistId } = await shortlistJob(["A", "B"]);
    await harnessSettingsSet(handle.db, 1);
    const q = fakeQueue();
    const runner = createJobRunner(handle.db, q.deps);
    const { jobId } = await startResearchShortlistJob(handle.db, { shortlistId, skipIfRecentDays: 0 });
    await runner.tick();
    await jobCancel(handle.db, jobId, { stopRunning: false });
    let view = await jobStatus(handle.db, jobId);
    expect(view.job.status).toBe("cancelled");
    expect(view.counts).toMatchObject({ running: 1, queued: 0, cancelled: 1 });
    await finishRunning(q, jobId, "succeeded");
    await runner.tick();
    view = await jobStatus(handle.db, jobId);
    expect(view.counts).toMatchObject({ succeeded: 1, cancelled: 1 });
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
    const sectorId = await makeSector("Jobs", [fresh, stale]);
    const shortlistId = await makeShortlist(sectorId, "List", [fresh, stale]);
    await harnessSettingsSet(handle.db, 2);
    const q = fakeQueue();
    const runner = createJobRunner(handle.db, q.deps);
    const { jobId } = await startResearchShortlistJob(handle.db, { shortlistId, skipIfRecentDays: 14 });
    await runner.tick();
    expect(q.started).toEqual([stale]);
    const view = await jobStatus(handle.db, jobId);
    expect(view.counts).toMatchObject({ skipped: 1, running: 1 });
  });

  it("pauses on token and hour budgets", async () => {
    const { shortlistId } = await shortlistJob(["A", "B", "C"]);
    await harnessSettingsSet(handle.db, 1);
    const q = fakeQueue();
    const runner = createJobRunner(handle.db, q.deps);
    const { jobId } = await startResearchShortlistJob(handle.db, {
      shortlistId,
      skipIfRecentDays: 0,
      budget: { maxTokens: 1500 },
    });
    await runner.tick();
    await finishRunning(q, jobId, "succeeded");
    await runner.tick();
    let view = await jobStatus(handle.db, jobId);
    expect(view.job.status).toBe("paused");
    expect(view.job.pauseReason).toContain("maxTokens");
    expect(view.counts).toMatchObject({ succeeded: 1, queued: 2 });

    const { jobId: hoursId } = await startResearchShortlistJob(handle.db, {
      shortlistId,
      skipIfRecentDays: 0,
      budget: { maxHours: 1 },
    });
    await handle.db.update(bulkJobs).set({ createdAt: new Date(1_000_000) }).where(eq(bulkJobs.id, hoursId));
    q.setNow(1_000_000 + 2 * 3600_000);
    await runner.tick();
    view = await jobStatus(handle.db, hoursId);
    expect(view.job.status).toBe("paused");
    expect(view.job.pauseReason).toContain("maxHours");
  });

  it("auto-pauses after 3 consecutive same-class errors", async () => {
    const { shortlistId } = await shortlistJob(["A", "B", "C", "D"]);
    await harnessSettingsSet(handle.db, 1);
    const q = fakeQueue();
    const runner = createJobRunner(handle.db, q.deps);
    const { jobId } = await startResearchShortlistJob(handle.db, { shortlistId, skipIfRecentDays: 0 });
    for (let round = 0; round < 3; round++) {
      await runner.tick();
      await finishRunning(q, jobId, "failed", "API rate limited, quota exhausted");
      q.setNow(1_000_000 + (round + 1) * 60_000);
      await runner.tick();
    }
    const view = await jobStatus(handle.db, jobId);
    expect(view.job.status).toBe("paused");
    expect(view.job.pauseReason).toContain("usage_limit");
    expect(view.job.pauseReason).toContain("rate limited");
    expect(view.counts).toMatchObject({ failed: 3, queued: 1 });
    // A resume clears the tripwire: the next failure starts a fresh streak.
    await jobResume(handle.db, jobId);
    const cleared = await jobStatus(handle.db, jobId);
    expect(cleared.job.errorStreak).toBe(0);
    expect(cleared.job.errorClass).toBeNull();
    await runner.tick();
    await finishRunning(q, jobId, "stalled");
    await runner.tick();
    const resumed = await jobStatus(handle.db, jobId);
    expect(resumed.job.status).toBe("completed");
    expect(resumed.counts).toMatchObject({ failed: 4 });
  });

  it("recovers mid-job across a restart, including interrupted extraction", async () => {
    const { shortlistId } = await shortlistJob(["A", "B"]);
    const q = fakeQueue();
    const first = createJobRunner(handle.db, q.deps);
    const { jobId } = await startResearchShortlistJob(handle.db, { shortlistId, skipIfRecentDays: 0 });
    await first.tick();
    const runIds = await runIdsForJob(jobId);
    await q.finishRun(runIds[0] ?? "", "succeeded");
    // The second item was mid-extraction when the process died.
    await handle.db
      .update(bulkJobItems)
      .set({ status: "extracting" })
      .where(eq(bulkJobItems.runId, runIds[1] ?? ""));
    await q.finishRun(runIds[1] ?? "", "succeeded");

    const second = createJobRunner(handle.db, q.deps);
    await second.tick();
    expect(q.extracted).toHaveLength(2);
    const view = await jobStatus(handle.db, jobId);
    expect(view.counts).toMatchObject({ succeeded: 2 });
    expect(view.job.status).toBe("completed");
  });

  it("estimates ETA from finished timings", async () => {
    const { shortlistId } = await shortlistJob(["A", "B", "C"]);
    await harnessSettingsSet(handle.db, 1);
    const q = fakeQueue();
    const runner = createJobRunner(handle.db, q.deps);
    const { jobId } = await startResearchShortlistJob(handle.db, { shortlistId, skipIfRecentDays: 0 });
    await runner.tick();
    let view = await jobStatus(handle.db, jobId);
    expect(view.etaSec).toBeNull();
    q.setNow(1_000_000 + 120_000);
    await finishRunning(q, jobId, "succeeded");
    await runner.tick();
    view = await jobStatus(handle.db, jobId);
    // One 120s run finished, two remain at concurrency 1: ~240s.
    expect(view.etaSec).toBe(240);
    expect(view.avgMinPerCompany).toBe(2);
  });

  it("retries failed companies", async () => {
    const { shortlistId } = await shortlistJob(["A"]);
    await harnessSettingsSet(handle.db, 1);
    const q = fakeQueue();
    const runner = createJobRunner(handle.db, q.deps);
    const { jobId } = await startResearchShortlistJob(handle.db, { shortlistId, skipIfRecentDays: 0 });
    await runner.tick();
    await finishRunning(q, jobId, "failed", "boom");
    await runner.tick();
    let view = await jobStatus(handle.db, jobId);
    expect(view.job.status).toBe("completed");
    expect(view.counts.failed).toBe(1);
    const { retried } = await jobRetryFailed(handle.db, jobId);
    expect(retried).toBe(1);
    view = await jobStatus(handle.db, jobId);
    expect(view.job.status).toBe("running");
    await runner.tick();
    expect(q.started).toHaveLength(2);
  });
});

describe("harness settings", () => {
  it("reads env/default, sets and validates", async () => {
    const initial = await harnessSettingsGet(handle.db);
    expect([1, 2, 3, 4, 5, 6, 7, 8]).toContain(initial.maxConcurrentAgents);
    expect(["env", "default"]).toContain(initial.source);
    await harnessSettingsSet(handle.db, 6);
    const stored = await harnessSettingsGet(handle.db);
    expect(stored).toMatchObject({ maxConcurrentAgents: 6, source: "db", dbValue: 6 });
    await expect(harnessSettingsSet(handle.db, 0)).rejects.toThrow("1..16");
    await expect(harnessSettingsSet(handle.db, 17)).rejects.toThrow("1..16");
  });

  it("effectiveMaxAgents prefers an explicit override", async () => {
    await harnessSettingsSet(handle.db, 6);
    expect(await effectiveMaxAgents(handle.db, 2)).toBe(2);
    expect(await effectiveMaxAgents(handle.db)).toBe(6);
  });
});
