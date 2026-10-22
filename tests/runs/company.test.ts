import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import type { DbHandle } from "../../src/db/client.js";
import {
  areaStatuses,
  companies,
  companyJobs,
  jobEvents,
  providerCalls,
  researchRuns,
  type CompanyJob,
  type ResearchRun,
} from "../../src/db/schema.js";
import { recordEvent } from "../../src/collect/db.js";
import { companyJobLive } from "../../src/domain/company-jobs/live.js";
import { describeCompanyJob, type CompanyStage } from "../../src/domain/company-jobs/status.js";
import {
  parseQuotaExhaustion,
  quotaBreakerClear,
  quotaBreakerGet,
  quotaCalibrationSet,
  windowBurn,
} from "../../src/domain/quota/breaker.js";
import {
  beginStageReal,
  companyJobCancel,
  companyJobList,
  companyJobPause,
  companyJobResume,
  companyJobsPauseAll,
  companyJobRetry,
  companyJobStatus,
  createCompanyRunner,
  startCompanyJob,
  supersedePendingJobs,
  type BeginStageOutcome,
  type CompanyRunnerDeps,
} from "../../src/runs/company.js";
import {
  checkPreflightGate,
  getPreflightReport,
  savePreflightReport,
} from "../../src/domain/company-jobs/preflight.js";
import { companySettingsGet, companySettingsSet } from "../../src/runs/settings.js";
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

async function jobRow(jobId: string): Promise<CompanyJob> {
  const [job] = await handle.db.select().from(companyJobs).where(eq(companyJobs.id, jobId));
  if (!job) throw new Error("no job row");
  return job;
}

async function latestSubjob(jobId: string, stage: CompanyStage): Promise<ResearchRun | null> {
  const rows = await handle.db
    .select()
    .from(researchRuns)
    .where(and(eq(researchRuns.companyJobId, jobId), eq(researchRuns.stage, stage)))
    .orderBy(asc(researchRuns.createdAt));
  return rows[rows.length - 1] ?? null;
}

async function fileReport(jobId: string, companyId: string): Promise<void> {
  await savePreflightReport(handle.db, {
    jobId,
    companyId,
    report: {
      version: 1,
      reviewLocations: [],
      adaptersRequired: [{ adapterId: "site", reason: "homepage" }],
      adaptersMissing: [],
      collectDirectives: { areas: [], notes: "" },
      confidence: 0.9,
      notes: "",
    },
  });
}

async function flipRun(
  runId: string,
  status: ResearchRun["status"],
  error: string | null = null,
): Promise<void> {
  const now = new Date();
  await handle.db
    .update(researchRuns)
    .set({
      status,
      error,
      startedAt: new Date(now.getTime() - 1000),
      finishedAt: now,
      lastActivityAt: now,
    })
    .where(eq(researchRuns.id, runId));
}

interface FakeWorld {
  begins: { jobId: string; stage: CompanyStage; runId: string }[];
  extractions: { jobId: string; researchRunId: string }[];
  deps: (overrides?: Partial<CompanyRunnerDeps>) => CompanyRunnerDeps;
}

function fakeWorld(): FakeWorld {
  const begins: FakeWorld["begins"] = [];
  const extractions: FakeWorld["extractions"] = [];
  const beginStage = async (job: CompanyJob, stage: CompanyStage): Promise<BeginStageOutcome> => {
    const kind = stage === "collect" ? "collect" : "agent";
    const status = stage === "extraction" ? "running" : "queued";
    const [row] = await handle.db
      .insert(researchRuns)
      .values({
        id: randomUUID(),
        companyId: job.companyId,
        kind,
        status,
        startedAt: status === "running" ? new Date() : null,
        companyJobId: job.id,
        stage,
      })
      .returning({ id: researchRuns.id });
    if (!row) throw new Error("no subjob row");
    begins.push({ jobId: job.id, stage, runId: row.id });
    return { runId: row.id };
  };
  return {
    begins,
    extractions,
    deps: (overrides = {}) => ({
      companyMax: 10,
      beginStage,
      runExtraction: async (job, researchRunId) => {
        extractions.push({ jobId: job.id, researchRunId });
      },
      agentLoad: async () => ({ active: 0, max: 8 }),
      collectLoad: async () => ({ active: 0, max: 3 }),
      ...overrides,
    }),
  };
}

describe("startCompanyJob", () => {
  it("starts a scheduled job and rejects dupes and ghosts", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    expect((await jobRow(jobId)).status).toBe("scheduled");
    await expect(startCompanyJob(handle.db, { companyId })).rejects.toMatchObject({ code: "conflict" });
    await expect(startCompanyJob(handle.db, { companyId: randomUUID() })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("stays created when no slot is free", async () => {
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    await startCompanyJob(handle.db, { companyId: a });
    await companySettingsSet(handle.db, 1);
    const { jobId } = await startCompanyJob(handle.db, { companyId: b });
    expect((await jobRow(jobId)).status).toBe("created");
  });
});

describe("describeCompanyJob (AC-2)", () => {
  it("derives incomplete until all four stages complete, and failed on any failure", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const world = fakeWorld();
    const runner = createCompanyRunner(handle.db, world.deps());
    await fileReport(jobId, companyId);
    await runner.tick();
    let desc = await describeCompanyJob(handle.db, jobId);
    expect(desc.derived).toBe("incomplete");
    expect(desc.nextStage).toBe("preflight");
    // Three stages done is still incomplete, never complete.
    for (const stage of ["preflight", "collect", "research"] as const) {
      const sub = await latestSubjob(jobId, stage);
      if (!sub) throw new Error(`no ${stage} subjob`);
      await flipRun(sub.id, "succeeded");
      await runner.tick();
    }
    desc = await describeCompanyJob(handle.db, jobId);
    expect(desc.derived).toBe("incomplete");
    expect((await jobRow(jobId)).status).not.toBe("completed");
    // A failed extraction fails the whole company...
    const extraction = await latestSubjob(jobId, "extraction");
    if (!extraction) throw new Error("no extraction subjob");
    await flipRun(extraction.id, "failed", "boom");
    await runner.tick();
    desc = await describeCompanyJob(handle.db, jobId);
    expect(desc.derived).toBe("failed");
    // ...and a retry supersedes the failure back to incomplete.
    await companyJobRetry(handle.db, jobId);
    desc = await describeCompanyJob(handle.db, jobId);
    expect(desc.derived).toBe("incomplete");
    expect(desc.nextStage).toBe("extraction");
  });
});

describe("company feeder (AC-3)", () => {
  it("never holds more company slots than the cap", async () => {
    for (const name of ["A", "B", "C"]) {
      const companyId = await makeCompany(name);
      await handle.db.insert(companyJobs).values({ id: randomUUID(), companyId, status: "created" });
    }
    const world = fakeWorld();
    const runner = createCompanyRunner(handle.db, world.deps({ companyMax: 2 }));
    await runner.tick();
    const scheduled = await handle.db.select().from(companyJobs).where(eq(companyJobs.status, "scheduled"));
    const created = await handle.db.select().from(companyJobs).where(eq(companyJobs.status, "created"));
    expect(scheduled).toHaveLength(2);
    expect(created).toHaveLength(1);
    expect(world.begins.filter((b) => b.stage === "preflight")).toHaveLength(2);
    // Freeing a slot claims the next created job.
    await companyJobCancel(handle.db, scheduled[0]?.id ?? "");
    await runner.tick();
    expect(await handle.db.select().from(companyJobs).where(eq(companyJobs.status, "created"))).toHaveLength(0);
  });
});

describe("stage machine", () => {
  it("advances through all four stages and completes", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const world = fakeWorld();
    const runner = createCompanyRunner(handle.db, world.deps());
    await fileReport(jobId, companyId);
    await runner.tick();
    for (const stage of ["preflight", "collect", "research"] as const) {
      const sub = await latestSubjob(jobId, stage);
      if (!sub) throw new Error(`no ${stage} subjob`);
      await flipRun(sub.id, "succeeded");
      await runner.tick();
    }
    // Extraction was begun as a running row; the next tick drives it.
    const extraction = await latestSubjob(jobId, "extraction");
    if (!extraction) throw new Error("no extraction subjob");
    expect(extraction.status).toBe("running");
    await runner.tick();
    expect(world.extractions).toHaveLength(1);
    const research = await latestSubjob(jobId, "research");
    expect(world.extractions[0]?.researchRunId).toBe(research?.id);
    const job = await jobRow(jobId);
    expect(job.status).toBe("completed");
    expect(job.finishedAt).not.toBeNull();
    const events = await handle.db.select().from(jobEvents).where(eq(jobEvents.jobId, jobId));
    expect(events.map((e) => e.type)).toContain("job_completed");
    expect((await describeCompanyJob(handle.db, jobId)).derived).toBe("complete");
  });

  it("pauses after 3 consecutive same-class failures, then resumes with a retry", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const world = fakeWorld();
    const runner = createCompanyRunner(handle.db, world.deps());
    await runner.tick();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const sub = await latestSubjob(jobId, "preflight");
      if (!sub) throw new Error("no preflight subjob");
      await flipRun(sub.id, "failed", "boom");
      await runner.tick();
      if (attempt < 3) {
        expect((await jobRow(jobId)).status).toBe("failed");
        await companyJobRetry(handle.db, jobId);
      }
    }
    const paused = await jobRow(jobId);
    expect(paused.status).toBe("paused");
    expect(paused.pauseReason).toContain("3 consecutive");
    const resumed = await companyJobResume(handle.db, jobId);
    expect(resumed.status).toBe("scheduled");
    expect(resumed.errorStreak).toBe(0);
    // Resume retried the stage: a fresh live subjob exists.
    const fresh = await latestSubjob(jobId, "preflight");
    expect(fresh?.status).toBe("queued");
  });

  it("auto-retries the first stall, then parks on the second", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const world = fakeWorld();
    const runner = createCompanyRunner(handle.db, world.deps());
    await runner.tick();
    const first = await latestSubjob(jobId, "preflight");
    if (!first) throw new Error("no preflight subjob");
    await flipRun(first.id, "stalled");
    await runner.tick();
    const retried = await jobRow(jobId);
    expect(retried.status).toBe("scheduled");
    expect(retried.errorStreak).toBe(1);
    expect(retried.errorClass).toBe("stall");
    const second = await latestSubjob(jobId, "preflight");
    expect(second?.id).not.toBe(first.id);
    expect(second?.status).toBe("queued");
    if (!second) throw new Error("no retried subjob");
    await flipRun(second.id, "stalled");
    await runner.tick();
    const parked = await jobRow(jobId);
    expect(parked.status).toBe("failed");
    expect(parked.errorStreak).toBe(2);
  });

  it("auto-retries usage_limit once but never server_stopped", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const world = fakeWorld();
    const runner = createCompanyRunner(handle.db, world.deps());
    await runner.tick();
    const first = await latestSubjob(jobId, "preflight");
    if (!first) throw new Error("no preflight subjob");
    await flipRun(first.id, "failed", "429 rate limit exceeded, retry later");
    await runner.tick();
    expect((await jobRow(jobId)).status).toBe("scheduled");
    expect((await jobRow(jobId)).errorClass).toBe("usage_limit");
    const second = await latestSubjob(jobId, "preflight");
    if (!second) throw new Error("no retried subjob");
    await flipRun(second.id, "failed", "server stopped mid-run");
    await runner.tick();
    const parked = await jobRow(jobId);
    expect(parked.status).toBe("failed");
    expect(parked.errorClass).toBe("server_stopped");
    // No third subjob: the crash loop must not respawn work.
    expect((await latestSubjob(jobId, "preflight"))?.id).toBe(second.id);
  });

  it("pause stops the live run; resume restarts the stage with saved work", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const world = fakeWorld();
    const runner = createCompanyRunner(handle.db, world.deps());
    await fileReport(jobId, companyId);
    await runner.tick();
    const live = await latestSubjob(jobId, "preflight");
    if (!live) throw new Error("no subjob");
    await companyJobPause(handle.db, jobId, "operator check");
    const stopped = await latestSubjob(jobId, "preflight");
    expect(stopped?.id).toBe(live.id);
    expect(stopped?.status).toBe("cancelled");
    expect(stopped?.error).toContain("operator check");
    expect((await jobRow(jobId)).pauseReason).toBe("operator check");
    // Nothing new starts while paused.
    await runner.tick();
    expect(await latestSubjob(jobId, "collect")).toBeNull();
    await companyJobResume(handle.db, jobId);
    const retry = await latestSubjob(jobId, "preflight");
    expect(retry?.id).not.toBe(live.id);
    expect(retry?.status).toBe("queued");
    if (!retry) throw new Error("no retried subjob");
    await flipRun(retry.id, "succeeded");
    await runner.tick();
    expect((await jobRow(jobId)).currentStage).toBe("collect");
  });

  it("reports the live run: areas, recent calls, tokens, stall countdown", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const runner = createCompanyRunner(handle.db, fakeWorld().deps());
    await runner.tick();
    const sub = await latestSubjob(jobId, "preflight");
    if (!sub) throw new Error("no subjob");
    await handle.db
      .update(researchRuns)
      .set({
        status: "running",
        agentPhase: "researching",
        startedAt: new Date(Date.now() - 60_000),
        lastActivityAt: new Date(),
        agentUsage: {
          inputTokens: 1000,
          outputTokens: 0,
          cachedTokens: 200,
          reasoningTokens: 0,
          calls: 3,
          childrenIncluded: true,
          children: [
            { sessionId: "c1", inputTokens: 1, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, calls: 1 },
            { sessionId: "c2", inputTokens: 1, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, calls: 1 },
          ],
        },
      })
      .where(eq(researchRuns.id, sub.id));
    await handle.db.insert(areaStatuses).values({ runId: sub.id, area: "reviews", companyId, status: "done" });
    await recordEvent(handle.db, sub.id, "mcp_call", { tool: "company_context", status: "ok" });
    await recordEvent(handle.db, sub.id, "mcp_call", { tool: "source_fetch", status: "ok" });
    const live = await companyJobLive(handle.db, jobId);
    expect(live.job.status).toBe("scheduled");
    expect(live.active?.stage).toBe("preflight");
    expect(live.active?.phase).toBe("researching");
    expect(live.active?.areas).toEqual([{ area: "reviews", status: "done", updatedAt: expect.any(Date) }]);
    expect(live.active?.recentCalls.map((c) => c.tool)).toEqual(["source_fetch", "company_context"]);
    expect(live.active?.runInputTokens).toBe(1200);
    expect(live.active?.childAgents).toBe(2);
    expect(live.active?.stallInSeconds).toBeGreaterThan(200);
    await flipRun(sub.id, "succeeded");
    const idle = await companyJobLive(handle.db, jobId);
    expect(idle.active).toBeNull();
  });

  it("pauses all running jobs with one reason", async () => {
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    const first = await startCompanyJob(handle.db, { companyId: a });
    const second = await startCompanyJob(handle.db, { companyId: b });
    const runner = createCompanyRunner(handle.db, fakeWorld().deps());
    await runner.tick();
    const result = await companyJobsPauseAll(handle.db, "quota check");
    expect(new Set(result.paused)).toEqual(new Set([first.jobId, second.jobId]));
    expect((await jobRow(first.jobId)).status).toBe("paused");
    expect((await jobRow(second.jobId)).pauseReason).toBe("quota check");
    expect(await companyJobsPauseAll(handle.db, "again")).toEqual({ paused: [] });
  });

  it("respects engine capacity gates", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const world = fakeWorld();
    const full = createCompanyRunner(handle.db, world.deps({ agentLoad: async () => ({ active: 8, max: 8 }) }));
    await full.tick();
    expect(await latestSubjob(jobId, "preflight")).toBeNull();
    const free = createCompanyRunner(handle.db, world.deps({ agentLoad: async () => ({ active: 0, max: 8 }) }));
    await free.tick();
    expect(await latestSubjob(jobId, "preflight")).not.toBeNull();
  });

  it("pauses on budget", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId, budget: { maxHours: 0.000001 } });
    const world = fakeWorld();
    const runner = createCompanyRunner(handle.db, world.deps());
    await new Promise((r) => setTimeout(r, 10));
    await runner.tick();
    const job = await jobRow(jobId);
    expect(job.status).toBe("paused");
    expect(job.pauseReason).toContain("budget");
  });

  it("reconciles spent tokens from subjob usage", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const world = fakeWorld();
    const runner = createCompanyRunner(handle.db, world.deps());
    await runner.tick();
    await fileReport(jobId, companyId);
    const sub = await latestSubjob(jobId, "preflight");
    if (!sub) throw new Error("no subjob");
    await handle.db
      .update(researchRuns)
      .set({
        agentUsage: {
          inputTokens: 100,
          outputTokens: 10,
          cachedTokens: 50,
          reasoningTokens: 0,
          calls: 2,
          childrenIncluded: false,
        },
      })
      .where(eq(researchRuns.id, sub.id));
    await flipRun(sub.id, "succeeded");
    await runner.tick();
    expect((await jobRow(jobId)).inputTokensSpent).toBe(150);
  });
});

describe("preflight reports", () => {
  const valid = {
    version: 1,
    reviewLocations: [{ platform: "trustpilot", url: "https://example.com/t", evidence: "seen" }],
    adaptersRequired: [{ adapterId: "site", reason: "homepage" }],
    adaptersMissing: [],
    collectDirectives: { areas: ["reviews"], notes: "" },
    confidence: 0.7,
    notes: "",
  };

  it("versions reports and gates on the latest valid one", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    expect(await checkPreflightGate(handle.db, jobId)).toEqual({ ok: false, reason: "no preflight report saved" });
    const v1 = await savePreflightReport(handle.db, { jobId, companyId, report: valid });
    expect(v1.reportVersion).toBe(1);
    const v2 = await savePreflightReport(handle.db, { jobId, companyId, report: { ...valid, confidence: 0.8 } });
    expect(v2.reportVersion).toBe(2);
    expect((await getPreflightReport(handle.db, jobId))?.reportVersion).toBe(2);
    const gate = await checkPreflightGate(handle.db, jobId);
    expect(gate.ok).toBe(true);
  });

  it("accepts a stringified report", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const saved = await savePreflightReport(handle.db, { jobId, companyId, report: JSON.stringify(valid) });
    expect(saved.reportVersion).toBe(1);
    expect((await checkPreflightGate(handle.db, jobId)).ok).toBe(true);
    await expect(
      savePreflightReport(handle.db, { jobId, companyId, report: "not json" }),
    ).rejects.toThrow("not an object or JSON string");
  });

  it("rejects malformed reports", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    await expect(savePreflightReport(handle.db, { jobId, companyId, report: { version: 1 } })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(
      savePreflightReport(handle.db, {
        jobId,
        companyId,
        report: { ...valid, collectDirectives: { areas: ["nope"], notes: "" } },
      }),
    ).rejects.toThrow("unknown area");
    await expect(
      savePreflightReport(handle.db, { jobId, companyId, report: { ...valid, confidence: 2 } }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("preflight gate", () => {
  it("fails a reportless preflight and advances once the report is filed", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const world = fakeWorld();
    const runner = createCompanyRunner(handle.db, world.deps());
    await runner.tick();
    const first = await latestSubjob(jobId, "preflight");
    if (!first) throw new Error("no subjob");
    await flipRun(first.id, "succeeded");
    await runner.tick();
    const failed = await latestSubjob(jobId, "preflight");
    expect(failed?.status).toBe("failed");
    expect(failed?.error ?? "").toContain("preflight gate");
    expect((await jobRow(jobId)).status).toBe("failed");

    await fileReport(jobId, companyId);
    await companyJobRetry(handle.db, jobId);
    const second = await latestSubjob(jobId, "preflight");
    if (!second) throw new Error("no retry subjob");
    await flipRun(second.id, "succeeded");
    await runner.tick();
    expect((await jobRow(jobId)).currentStage).toBe("collect");
    expect(await latestSubjob(jobId, "collect")).not.toBeNull();
  });

  it("reports the filed version and confidence in status", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    expect((await companyJobStatus(handle.db, jobId)).preflightReport).toBeNull();
    await fileReport(jobId, companyId);
    expect((await companyJobStatus(handle.db, jobId)).preflightReport).toEqual({ version: 1, confidence: 0.9 });
  });
});

describe("adapter gating", () => {
  it("pauses on unknown adapters and proceeds once the plan is fixed", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    await savePreflightReport(handle.db, {
      jobId,
      companyId,
      report: {
        version: 1,
        reviewLocations: [],
        adaptersRequired: [{ adapterId: "nope", reason: "test" }],
        adaptersMissing: [],
        collectDirectives: { areas: [], notes: "" },
        confidence: 0.9,
        notes: "",
      },
    });
    const world = fakeWorld();
    const runner = createCompanyRunner(handle.db, world.deps());
    await runner.tick();
    const preflight = await latestSubjob(jobId, "preflight");
    if (!preflight) throw new Error("no subjob");
    await flipRun(preflight.id, "succeeded");
    await runner.tick();
    const paused = await jobRow(jobId);
    expect(paused.status).toBe("paused");
    expect(paused.pauseReason ?? "").toContain("adapter_missing");
    expect(await latestSubjob(jobId, "collect")).toBeNull();

    await fileReport(jobId, companyId);
    await companyJobResume(handle.db, jobId);
    await runner.tick();
    expect(await latestSubjob(jobId, "collect")).not.toBeNull();
  });
});

describe("cancel and retry", () => {
  it("cancels the active subjob by default, and never resurrects", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const world = fakeWorld();
    const runner = createCompanyRunner(handle.db, world.deps());
    await runner.tick();
    const sub = await latestSubjob(jobId, "preflight");
    if (!sub) throw new Error("no subjob");
    await companyJobCancel(handle.db, jobId);
    const [cancelled] = await handle.db.select().from(researchRuns).where(eq(researchRuns.id, sub.id));
    expect(cancelled?.status).toBe("cancelled");
    await runner.tick();
    expect((await jobRow(jobId)).status).toBe("terminated");
    expect(world.begins).toHaveLength(1);
  });

  it("leaves the subjob alone with stopRunning=false", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const world = fakeWorld();
    const runner = createCompanyRunner(handle.db, world.deps());
    await runner.tick();
    const sub = await latestSubjob(jobId, "preflight");
    if (!sub) throw new Error("no subjob");
    await companyJobCancel(handle.db, jobId, { stopRunning: false });
    const [row] = await handle.db.select().from(researchRuns).where(eq(researchRuns.id, sub.id));
    expect(row?.status).toBe("queued");
  });

  it("does not drive a cancelled extraction", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const world = fakeWorld();
    const runner = createCompanyRunner(handle.db, world.deps());
    await fileReport(jobId, companyId);
    await runner.tick();
    for (const stage of ["preflight", "collect", "research"] as const) {
      const sub = await latestSubjob(jobId, stage);
      if (!sub) throw new Error(`no ${stage} subjob`);
      await flipRun(sub.id, "succeeded");
      await runner.tick();
    }
    const extraction = await latestSubjob(jobId, "extraction");
    if (!extraction) throw new Error("no extraction subjob");
    await companyJobCancel(handle.db, jobId);
    await runner.tick();
    expect(world.extractions).toHaveLength(0);
    const [row] = await handle.db.select().from(researchRuns).where(eq(researchRuns.id, extraction.id));
    expect(row?.status).toBe("cancelled");
    expect((await jobRow(jobId)).status).toBe("terminated");
  });

  it("rejects nonsense retries", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    await expect(companyJobRetry(handle.db, jobId)).rejects.toMatchObject({ code: "invalid_input" });
    await companyJobPause(handle.db, jobId);
    await expect(companyJobRetry(handle.db, jobId)).rejects.toThrow("resume the job instead");
  });
});

describe("status, list and settings", () => {
  it("reports stages, attempts and eta", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const world = fakeWorld();
    const runner = createCompanyRunner(handle.db, world.deps());
    await runner.tick();
    const first = await latestSubjob(jobId, "preflight");
    if (!first) throw new Error("no subjob");
    await flipRun(first.id, "failed", "boom");
    await runner.tick();
    await companyJobRetry(handle.db, jobId);
    const view = await companyJobStatus(handle.db, jobId);
    expect(view.companyName).toBe("Acme");
    expect(view.derived).toBe("incomplete");
    expect(view.nextStage).toBe("preflight");
    expect(view.stages.find((s) => s.stage === "preflight")?.attempts).toBe(2);
    expect(view.active?.stage).toBe("preflight");
    const listed = await companyJobList(handle.db);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.derived).toBe("incomplete");
    expect(await companyJobList(handle.db, 20, "scheduled")).toHaveLength(1);
    expect(await companyJobList(handle.db, 20, "failed")).toHaveLength(0);
    await expect(companyJobList(handle.db, 0)).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("stores company concurrency in the DB", async () => {
    expect((await companySettingsGet(handle.db)).companyConcurrency).toBe(4);
    await companySettingsSet(handle.db, 25);
    const view = await companySettingsGet(handle.db);
    expect(view.companyConcurrency).toBe(25);
    expect(view.source).toBe("db");
    await expect(companySettingsSet(handle.db, 0)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(companySettingsSet(handle.db, 101)).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("beginStageReal", () => {
  it("tags engine rows with the job link", async () => {
    const companyId = await makeCompany("Acme");
    const { jobId } = await startCompanyJob(handle.db, { companyId });
    const job = await jobRow(jobId);
    const preflight = await beginStageReal(handle.db, job, "preflight");
    if (!("runId" in preflight)) throw new Error("preflight busy");
    const [preRow] = await handle.db.select().from(researchRuns).where(eq(researchRuns.id, preflight.runId));
    expect(preRow?.companyJobId).toBe(jobId);
    expect(preRow?.stage).toBe("preflight");
    expect(preRow?.kind).toBe("agent");
    expect(preRow?.agentOptions).toMatchObject({ maxMinutes: 15, maxModelSteps: 30 });
    await flipRun(preflight.runId, "succeeded");
    const collect = await beginStageReal(handle.db, job, "collect");
    if (!("runId" in collect)) throw new Error("collect busy");
    const [colRow] = await handle.db.select().from(researchRuns).where(eq(researchRuns.id, collect.runId));
    expect(colRow?.companyJobId).toBe(jobId);
    expect(colRow?.stage).toBe("collect");
    expect(colRow?.kind).toBe("collect");
    await flipRun(collect.runId, "succeeded");
    const extraction = await beginStageReal(handle.db, job, "extraction");
    if (!("runId" in extraction)) throw new Error("extraction busy");
    const [extRow] = await handle.db.select().from(researchRuns).where(eq(researchRuns.id, extraction.runId));
    expect(extRow?.status).toBe("running");
    expect(extRow?.stage).toBe("extraction");
  });
});

describe("supersedePendingJobs", () => {
  it("terminates created jobs with a reason and leaves scheduled ones alone", async () => {
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    const c = await makeCompany("C Co");
    const qa = await startCompanyJob(handle.db, { companyId: a, defer: true });
    const qb = await startCompanyJob(handle.db, { companyId: b, defer: true });
    const { jobId: scheduledId } = await startCompanyJob(handle.db, { companyId: c });
    const result = await supersedePendingJobs(handle.db, "superseded by sector preflight");
    expect(result).toEqual({ terminated: 2 });
    for (const { jobId } of [qa, qb]) {
      const job = await jobRow(jobId);
      expect(job.status).toBe("terminated");
      const events = await handle.db.select().from(jobEvents).where(eq(jobEvents.jobId, jobId));
      const cancelled = events.find((e) => e.type === "job_cancelled");
      expect((cancelled?.payload as { reason?: string } | null)?.reason).toBe("superseded by sector preflight");
    }
    expect((await jobRow(scheduledId)).status).toBe("scheduled");
  });
});

describe("quota breaker", () => {
  const quotaErr = (reset: string) =>
    `API error 429: Subscription quota exhausted. Your usage window resets at ${reset}. (rate_limit_error)`;

  it("parses exhaustion and reset time, and ignores plain rate limits", () => {
    const reset = "2026-10-21T18:27:17Z";
    expect(parseQuotaExhaustion(quotaErr(reset))).toEqual({ exhausted: true, resumeAt: new Date(reset) });
    expect(parseQuotaExhaustion("Subscription quota exhausted.")).toEqual({ exhausted: true, resumeAt: null });
    expect(parseQuotaExhaustion("429 rate limit exceeded").exhausted).toBe(false);
    expect(parseQuotaExhaustion("boom").exhausted).toBe(false);
  });

  it("parks quota-hit jobs paused and trips the breaker with the reset time", async () => {
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    const first = await startCompanyJob(handle.db, { companyId: a });
    const second = await startCompanyJob(handle.db, { companyId: b });
    const runner = createCompanyRunner(handle.db, fakeWorld().deps());
    await runner.tick();
    const reset = new Date(Date.now() + 3600_000).toISOString();
    const sub = await latestSubjob(first.jobId, "preflight");
    if (!sub) throw new Error("no subjob");
    await flipRun(sub.id, "failed", quotaErr(reset));
    await runner.tick();
    expect((await jobRow(first.jobId)).status).toBe("paused");
    expect((await jobRow(first.jobId)).pauseReason).toContain("quota exhausted");
    expect((await jobRow(second.jobId)).status).toBe("paused");
    expect((await jobRow(second.jobId)).pauseReason).toContain(reset);
    const trip = await quotaBreakerGet(handle.db);
    expect(trip.tripped).toBe(true);
    if (!trip.tripped) throw new Error("no trip");
    expect(trip.resumeAt).toBe(reset);
    expect(trip.estimated).toBe(false);
    expect(new Set(trip.jobIds)).toEqual(new Set([first.jobId, second.jobId]));
  });

  it("blocks new claims while tripped and auto-resumes after reset", async () => {
    const a = await makeCompany("A Co");
    const b = await makeCompany("B Co");
    const first = await startCompanyJob(handle.db, { companyId: a });
    const runner = createCompanyRunner(handle.db, fakeWorld().deps());
    await runner.tick();
    const waiting = await startCompanyJob(handle.db, { companyId: b, defer: true });
    const sub = await latestSubjob(first.jobId, "preflight");
    if (!sub) throw new Error("no subjob");
    // Trip with a future reset: the created job must not be claimed.
    await flipRun(sub.id, "failed", quotaErr(new Date(Date.now() + 3600_000).toISOString()));
    await runner.tick();
    expect((await jobRow(first.jobId)).status).toBe("paused");
    expect((await jobRow(waiting.jobId)).status).toBe("created");
    // Emulate time passing: clear and re-trip with a past reset.
    await quotaBreakerClear(handle.db);
    await companyJobResume(handle.db, first.jobId);
    const retry = await latestSubjob(first.jobId, "preflight");
    if (!retry) throw new Error("no retried subjob");
    await flipRun(retry.id, "failed", quotaErr(new Date(Date.now() - 1000).toISOString()));
    await runner.tick();
    expect((await jobRow(first.jobId)).status).toBe("paused");
    await runner.tick();
    expect((await jobRow(first.jobId)).status).toBe("scheduled");
    expect((await quotaBreakerGet(handle.db)).tripped).toBe(false);
    const resumed = await latestSubjob(first.jobId, "preflight");
    expect(resumed?.id).not.toBe(retry.id);
  });

  it("holds for the owner when the reset time is missing", async () => {
    const a = await makeCompany("A Co");
    const { jobId } = await startCompanyJob(handle.db, { companyId: a });
    const runner = createCompanyRunner(handle.db, fakeWorld().deps());
    await runner.tick();
    const sub = await latestSubjob(jobId, "preflight");
    if (!sub) throw new Error("no subjob");
    await flipRun(sub.id, "failed", "Subscription quota exhausted.");
    await runner.tick();
    expect((await jobRow(jobId)).status).toBe("paused");
    expect((await jobRow(jobId)).pauseReason).toContain("owner go");
    const trip = await quotaBreakerGet(handle.db);
    expect(trip.tripped).toBe(true);
    if (!trip.tripped) throw new Error("no trip");
    expect(trip.resumeAt).toBeNull();
    await runner.tick();
    expect((await jobRow(jobId)).status).toBe("paused");
    await quotaBreakerClear(handle.db);
    expect((await quotaBreakerGet(handle.db)).tripped).toBe(false);
  });

  it("trips early at 95% of the learned allowance, once per window", async () => {
    const a = await makeCompany("A Co");
    const { jobId } = await startCompanyJob(handle.db, { companyId: a });
    const runner = createCompanyRunner(handle.db, fakeWorld().deps());
    await runner.tick();
    const windowStart = new Date(Date.now() - 3600_000).toISOString();
    await quotaCalibrationSet(handle.db, {
      windowStart,
      allowanceEstimate: 1000,
      windowMs: 3600_000,
      earlyTrips: [],
    });
    await handle.db.insert(providerCalls).values([
      { stage: "research", inputTokens: 900, cachedTokens: 0, at: new Date() },
      { stage: "research", inputTokens: 60, cachedTokens: 0, at: new Date() },
    ]);
    await runner.tick();
    expect((await jobRow(jobId)).status).toBe("paused");
    const trip = await quotaBreakerGet(handle.db);
    expect(trip.tripped).toBe(true);
    if (!trip.tripped) throw new Error("no trip");
    expect(trip.estimated).toBe(true);
    // Estimated resume lands ~now: next tick auto-resumes, and must not
    // immediately re-trip (one early trip per window).
    await runner.tick();
    expect((await jobRow(jobId)).status).toBe("scheduled");
    expect((await quotaBreakerGet(handle.db)).tripped).toBe(false);
    await runner.tick();
    expect((await jobRow(jobId)).status).toBe("scheduled");
    expect((await quotaBreakerGet(handle.db)).tripped).toBe(false);
  });

  it("meters burn past int4 max (live burn passed 2.1B)", async () => {
    await handle.db.insert(providerCalls).values([
      { stage: "research", inputTokens: 1500000000, cachedTokens: 0, at: new Date() },
      { stage: "research", inputTokens: 1500000000, cachedTokens: 100, at: new Date() },
    ]);
    expect(await windowBurn(handle.db, null)).toBe(3000000100);
    expect(await windowBurn(handle.db, new Date(Date.now() + 3600_000))).toBe(0);
  });

  it("plain rate-limit 429s auto-retry without tripping", async () => {
    const a = await makeCompany("A Co");
    const { jobId } = await startCompanyJob(handle.db, { companyId: a });
    const runner = createCompanyRunner(handle.db, fakeWorld().deps());
    await runner.tick();
    const sub = await latestSubjob(jobId, "preflight");
    if (!sub) throw new Error("no subjob");
    await flipRun(sub.id, "failed", "429 rate limit exceeded, retry later");
    await runner.tick();
    expect((await jobRow(jobId)).status).toBe("scheduled");
    expect((await quotaBreakerGet(handle.db)).tripped).toBe(false);
  });
});
