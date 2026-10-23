import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  companies,
  companyJobs,
  jobEvents,
  researchRuns,
  type CompanyJob,
  type ResearchRun,
} from "../db/schema.js";
import {
  describeCompanyJob,
  isStageComplete,
  isTerminalSubjob,
  type CompanyDerived,
  type CompanyJobDescription,
  type CompanyStage,
} from "../domain/company-jobs/status.js";
import { checkPreflightGate, getPreflightSummary } from "../domain/company-jobs/preflight.js";
import { logJobEvent } from "../domain/company-jobs/events.js";
import {
  QUOTA_EARLY_TRIP_RATIO,
  parseQuotaExhaustion,
  estimateInflightBurn,
  quotaBreakerClear,
  quotaBreakerGet,
  quotaBreakerSet,
  quotaCalibrationGet,
  quotaCalibrationSet,
  windowBurn,
} from "../domain/quota/breaker.js";
import { DomainError, isUniqueViolation } from "../domain/errors.js";
import { resolvePlanAdapters } from "../collect/adapters.js";
import { researchStart } from "./agent.js";
import {
  JOB_SAME_ERROR_PAUSE,
  checkBudget,
  classifyRunError,
  usageInputTokens,
  type JobBudget,
} from "./bulk.js";
import { extractRun } from "./extract.js";
import { latestPromptVersion } from "./prompt.js";
import { cancelRun, startCollect } from "./queue.js";
import {
  checkpointGet,
  effectiveCollectLimit,
  effectiveCompanyConcurrency,
  effectiveExtractionLimit,
  effectiveMaxAgents,
  pipelinePausedGet,
  tripPipelinePause,
  type PipelinePausedView,
} from "./settings.js";

/**
 * Company jobs (Stage 5): one job per company runs the whole pipeline
 * (preflight → collect → research → extraction) as subjobs. The worker below
 * is the stage machine plus the company-slot feeder; the existing engines
 * (collect runner, agent runner) execute collect/research subjobs, and the
 * worker drives extraction inline. Mirrors bulk.ts patterns.
 */

const COMPANY_POLL_MS = 15_000;
const COMPANY_LIST_DEFAULT_LIMIT = 20;
const AGENT_STAGES: readonly CompanyStage[] = ["preflight", "research"];
/**
 * Feed lane by next needed stage (ordering only). Credits are perishable,
 * so credit-burning stages feed first; collect fills leftover capacity.
 * Complete-ready jobs go first of all (completing frees company slots
 * for this tick's claims). FIFO within a lane doubles as the starvation
 * guard: the longest-waiting collect always advances in turn. The row's
 * currentStage lags by one stage, so lanes key on the describe — which
 * the tick reuses to avoid a second describe per job. Claim order stays
 * FIFO: every claim enters at preflight (lane 0).
 */
function feedLane(desc: CompanyJobDescription): number {
  if (desc.derived === "complete") return -1;
  return desc.nextStage === "collect" ? 1 : 0;
}
/** First consecutive failure in these classes requeues the stage instead of parking the job. */
const TRANSIENT_AUTO_RETRY = new Set(["stall", "usage_limit"]);

export interface StartCompanyJobInput {
  companyId: string;
  budget?: JobBudget;
  /** Stay created (the feeder promotes it at company concurrency) instead of scheduling now. */
  defer?: boolean;
}

export async function startCompanyJob(db: Db, input: StartCompanyJobInput): Promise<{ jobId: string }> {
  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.id, input.companyId));
  if (!company) throw new DomainError("not_found", `company not found: ${input.companyId}`);
  const { maxTokens, maxHours } = checkBudget(input.budget);
  const jobId = randomUUID();
  try {
    await db.insert(companyJobs).values({
      id: jobId,
      companyId: input.companyId,
      status: "created",
      maxInputTokens: maxTokens,
      maxHours,
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    throw new DomainError("conflict", "company already has an active job");
  }
  await logJobEvent(db, jobId, "job_started");
  if (input.defer) return { jobId };
  // Operator start: schedule immediately when a slot is free, else wait as
  // created for the feeder. Never jumps the concurrency cap.
  const max = await effectiveCompanyConcurrency(db);
  const feeding = await countJobsIn(db, ["scheduled", "running"]);
  if (feeding < max) {
    const [claimed] = await db
      .update(companyJobs)
      .set({ status: "scheduled" })
      .where(and(eq(companyJobs.id, jobId), eq(companyJobs.status, "created")))
      .returning();
    if (claimed) await logJobEvent(db, jobId, "job_claimed");
  }
  return { jobId };
}

export interface CompanyStageView {
  stage: CompanyStage;
  status: ResearchRun["status"] | null;
  runId: string | null;
  attempts: number;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
}

export interface CompanyStatusView {
  job: CompanyJob;
  companyName: string;
  derived: CompanyDerived;
  nextStage: CompanyStage | null;
  stages: CompanyStageView[];
  active: { stage: CompanyStage; runId: string; status: ResearchRun["status"]; startedAt: Date | null } | null;
  tokensSpent: number;
  etaSec: number | null;
  preflightReport: { version: number; confidence: number } | null;
}

function stageDurationMs(run: ResearchRun): number | null {
  if (!run.startedAt || !run.finishedAt) return null;
  return Math.max(0, run.finishedAt.getTime() - run.startedAt.getTime());
}

export async function companyJobStatus(db: Db, jobId: string): Promise<CompanyStatusView> {
  const desc = await describeCompanyJob(db, jobId);
  const [company] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, desc.job.companyId));
  const rows = await db.select().from(researchRuns).where(eq(researchRuns.companyJobId, jobId));
  const attempts = new Map<CompanyStage, number>();
  for (const row of rows) {
    if (row.stage === null) continue;
    attempts.set(row.stage as CompanyStage, (attempts.get(row.stage as CompanyStage) ?? 0) + 1);
  }
  const stages: CompanyStageView[] = desc.stages.map((s) => ({
    stage: s.stage,
    status: s.run?.status ?? null,
    runId: s.run?.id ?? null,
    attempts: attempts.get(s.stage) ?? 0,
    error: s.run?.error ?? null,
    startedAt: s.run?.startedAt ?? null,
    finishedAt: s.run?.finishedAt ?? null,
    durationMs: s.run ? stageDurationMs(s.run) : null,
  }));
  const activeState = desc.stages.find((s) => s.run && !isTerminalSubjob(s.run.status));
  const preflightReport = await getPreflightSummary(db, jobId);
  const durations = stages.map((s) => s.durationMs).filter((d): d is number => d !== null && d > 0);
  const remaining = stages.filter((s) => s.status === null || !isTerminalSubjob(s.status)).length;
  const etaSec =
    desc.derived !== "incomplete" || durations.length === 0 || remaining === 0
      ? 0
      : Math.ceil(((durations.reduce((a, b) => a + b, 0) / durations.length) * remaining) / 1000);
  return {
    job: desc.job,
    companyName: company?.name ?? desc.job.companyId,
    derived: desc.derived,
    nextStage: desc.nextStage,
    stages,
    active:
      activeState?.run === undefined || activeState.run === null
        ? null
        : {
            stage: activeState.stage,
            runId: activeState.run.id,
            status: activeState.run.status,
            startedAt: activeState.run.startedAt,
          },
    tokensSpent: desc.job.inputTokensSpent,
    etaSec,
    preflightReport,
  };
}

export interface PipelineStatusView {
  counts: Record<string, number>;
  completed: number;
  checkpointTarget: number | null;
  paused: PipelinePausedView;
  /**
   * Subscription quota snapshot. Always null: app Muse 1.4.11 exposes no
   * subscription surface (no CLI command, session record, local state, or
   * binary strings for it) — see the checkpoint report.
   */
  quota: null;
}

export async function pipelineStatus(db: Db): Promise<PipelineStatusView> {
  const rows = await db
    .select({ status: companyJobs.status, n: sql<number>`count(*)` })
    .from(companyJobs)
    .groupBy(companyJobs.status);
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = Number(row.n);
  const [checkpoint, paused] = await Promise.all([checkpointGet(db), pipelinePausedGet(db)]);
  return {
    counts,
    completed: counts.completed ?? 0,
    checkpointTarget: checkpoint.target,
    paused,
    quota: null,
  };
}

export interface CompanyListEntry {
  job: CompanyJob;
  derived: CompanyDerived;
}

export async function companyJobList(
  db: Db,
  limit = COMPANY_LIST_DEFAULT_LIMIT,
  status?: CompanyJob["status"],
): Promise<CompanyListEntry[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new DomainError("invalid_input", "limit must be 1..100");
  }
  const jobs = await db
    .select()
    .from(companyJobs)
    .where(status === undefined ? undefined : eq(companyJobs.status, status))
    .orderBy(desc(companyJobs.createdAt))
    .limit(limit);
  const entries: CompanyListEntry[] = [];
  for (const job of jobs) {
    const desc = await describeCompanyJob(db, job.id);
    entries.push({ job, derived: desc.derived });
  }
  return entries;
}

async function countJobsIn(db: Db, statuses: CompanyJob["status"][]): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(companyJobs)
    .where(inArray(companyJobs.status, statuses));
  return Number(row?.n ?? 0);
}

async function loadCompanyJob(db: Db, jobId: string): Promise<CompanyJob> {
  const [job] = await db.select().from(companyJobs).where(eq(companyJobs.id, jobId));
  if (!job) throw new DomainError("not_found", `company job not found: ${jobId}`);
  return job;
}

export async function companyJobPause(
  db: Db,
  jobId: string,
  reason = "paused by operator",
): Promise<CompanyJob> {
  const job = await loadCompanyJob(db, jobId);
  if (job.status !== "running" && job.status !== "scheduled") {
    throw new DomainError("invalid_input", `job is ${job.status}, not running or scheduled`);
  }
  const [updated] = await db
    .update(companyJobs)
    .set({ status: "paused", pauseReason: reason })
    .where(eq(companyJobs.id, jobId))
    .returning();
  if (!updated) throw new DomainError("not_found", `company job not found: ${jobId}`);
  // Stop the burn: cancel the live subjob run (the engines stop it on
  // their next tick). Saved work stays in the DB; resume restarts the
  // stage with that work visible to the agent.
  const desc = await describeCompanyJob(db, jobId);
  const active = desc.stages.find((s) => s.run && !isTerminalSubjob(s.run.status));
  if (active?.run) {
    await cancelRun(db, active.run.id).catch(() => undefined);
    await db
      .update(researchRuns)
      .set({ error: `paused by operator: ${reason}`.slice(0, 500) })
      .where(eq(researchRuns.id, active.run.id));
  }
  await logJobEvent(db, jobId, "job_paused", null, { reason });
  return updated;
}

/** Pause every feeding company job (quota trips, operator pause-all). Skips jobs that raced to terminal. */
export async function companyJobsPauseAll(db: Db, reason: string): Promise<{ paused: string[] }> {
  const running = await db
    .select({ id: companyJobs.id })
    .from(companyJobs)
    .where(inArray(companyJobs.status, ["scheduled", "running"]));
  const paused: string[] = [];
  for (const job of running) {
    try {
      await companyJobPause(db, job.id, reason);
      paused.push(job.id);
    } catch {
      // Raced to terminal between list and pause; leave it alone.
    }
  }
  return { paused };
}

/**
 * Pause only credit-burning jobs (deterministic mode): jobs with a live
 * collect run, jobs whose next stage is collect, and complete-ready jobs
 * keep flowing — pausing them would trash free deterministic progress.
 * Everything else (live or upcoming agent/extraction work) pauses.
 */
export async function pauseCreditJobs(db: Db, reason: string): Promise<{ paused: string[]; flowing: string[] }> {
  const running = await db
    .select({ id: companyJobs.id })
    .from(companyJobs)
    .where(inArray(companyJobs.status, ["scheduled", "running"]));
  const paused: string[] = [];
  const flowing: string[] = [];
  for (const job of running) {
    try {
      const desc = await describeCompanyJob(db, job.id);
      const live = desc.stages.find((s) => s.run && !isTerminalSubjob(s.run.status));
      const free = desc.derived === "complete" || (live?.run ? live.run.kind === "collect" : desc.nextStage === "collect");
      if (free) {
        flowing.push(job.id);
        continue;
      }
      await companyJobPause(db, job.id, reason);
      paused.push(job.id);
    } catch {
      // Raced to terminal between list and pause; leave it alone.
    }
  }
  return { paused, flowing };
}

export interface QuotaTripInput {
  /** Already-parked job to record (the quotaPark path records itself). */
  jobId?: string;
  resumeAt: Date | null;
  estimated: boolean;
  error: string;
}

/**
 * Trip the quota breaker: pause credit-burning jobs (stops their burn),
 * leave deterministic (collect) jobs flowing, and record the paused ones
 * for auto-resume. Idempotent: re-trips union ids into the open trip,
 * and an exact reset time always wins over an estimated one.
 */
export async function tripQuotaBreaker(
  db: Db,
  input: QuotaTripInput,
): Promise<{ paused: string[]; resumeAt: string | null }> {
  const resumeIso = input.resumeAt ? input.resumeAt.toISOString() : null;
  const reason = resumeIso
    ? `quota exhausted, resumes ${resumeIso}`
    : "quota exhausted, resume on owner go (no reset time in error)";
  const { paused } = await pauseCreditJobs(db, reason);
  const ids = [...new Set([...paused, ...(input.jobId ? [input.jobId] : [])])];
  const existing = await quotaBreakerGet(db);
  const allIds = [...new Set([...(existing.tripped ? existing.jobIds : []), ...ids])];
  const now = new Date();
  let resumeAt = existing.tripped ? existing.resumeAt : null;
  let estimated = existing.tripped ? existing.estimated : true;
  if (resumeIso && !input.estimated) {
    resumeAt = resumeIso;
    estimated = false;
  } else if (!resumeAt && resumeIso) {
    resumeAt = resumeIso;
    estimated = true;
  }
  await quotaBreakerSet(db, {
    trippedAt: existing.tripped ? existing.trippedAt : now.toISOString(),
    resumeAt,
    estimated,
    jobIds: allIds,
    error: input.error.slice(0, 500),
  });
  const cal = await quotaCalibrationGet(db);
  if (input.estimated) {
    // Estimated trip: don't touch the allowance sample, just mark this
    // window early-tripped so it happens at most once per window.
    if (cal && !cal.earlyTrips.includes(cal.windowStart)) {
      await quotaCalibrationSet(db, { ...cal, earlyTrips: [...cal.earlyTrips, cal.windowStart] });
    }
  } else {
    // Exact trip: this window's burn-since-start is the allowance sample.
    // The first trip has no start yet, so it meters all-time burn (rough).
    // Metering must never break the trip: on failure keep the old sample.
    const start = cal ? new Date(cal.windowStart) : null;
    const validStart = start && !Number.isNaN(start.getTime()) ? start : null;
    let burn: number | null = null;
    try {
      burn = await windowBurn(db, validStart);
    } catch (err) {
      console.error(`quota calibration meter failed: ${err instanceof Error ? err.message : err}`);
    }
    const resumeDate = resumeAt ? new Date(resumeAt) : null;
    await quotaCalibrationSet(db, {
      windowStart:
        resumeDate && !Number.isNaN(resumeDate.getTime())
          ? resumeDate.toISOString()
          : (cal?.windowStart ?? now.toISOString()),
      allowanceEstimate: burn ?? cal?.allowanceEstimate ?? 0,
      windowMs:
        resumeDate && validStart && !Number.isNaN(resumeDate.getTime())
          ? Math.max(0, resumeDate.getTime() - validStart.getTime())
          : (cal?.windowMs ?? null),
      earlyTrips: cal?.earlyTrips ?? [],
    });
  }
  return { paused: allIds, resumeAt };
}

/** Auto-resume breaker-paused jobs once the reset time passes. */
export async function maybeQuotaResume(db: Db, now: Date = new Date()): Promise<{ resumed: string[] }> {
  const trip = await quotaBreakerGet(db);
  if (!trip.tripped || !trip.resumeAt) return { resumed: [] };
  if (new Date(trip.resumeAt).getTime() > now.getTime()) return { resumed: [] };
  const resumed: string[] = [];
  for (const id of trip.jobIds) {
    try {
      await companyJobResume(db, id);
      resumed.push(id);
    } catch {
      // Already resumed by the owner, or otherwise unresumable; skip.
    }
  }
  await quotaBreakerClear(db);
  return { resumed };
}

/** Early trip at 95% of the learned allowance, at most once per window. */
export async function maybeQuotaEarlyTrip(db: Db): Promise<{ tripped: boolean }> {
  const trip = await quotaBreakerGet(db);
  if (trip.tripped) return { tripped: false };
  const cal = await quotaCalibrationGet(db);
  if (!cal || cal.allowanceEstimate <= 0 || !cal.windowMs) return { tripped: false };
  if (cal.earlyTrips.includes(cal.windowStart)) return { tripped: false };
  const start = new Date(cal.windowStart);
  if (Number.isNaN(start.getTime())) return { tripped: false };
  const burn = await windowBurn(db, start);
  const total = burn + (await estimateInflightBurn(db));
  if (total < QUOTA_EARLY_TRIP_RATIO * cal.allowanceEstimate) return { tripped: false };
  const resumeAt = new Date(start.getTime() + cal.windowMs);
  await tripQuotaBreaker(db, {
    resumeAt,
    estimated: true,
    error: `95% of learned window burn (${total} >= ${Math.round(QUOTA_EARLY_TRIP_RATIO * cal.allowanceEstimate)})`,
  });
  return { tripped: true };
}

export type BeginStageOutcome = { runId: string } | { busy: true };

/**
 * Create the subjob row for a stage. preflight/collect/research rows are
 * executed by the existing engines; extraction rows are worker-driven.
 */
export async function beginStageReal(db: Db, job: CompanyJob, stage: CompanyStage): Promise<BeginStageOutcome> {
  if (stage === "extraction") {
    try {
      const [row] = await db
        .insert(researchRuns)
        .values({
          id: randomUUID(),
          companyId: job.companyId,
          kind: "agent",
          status: "running",
          startedAt: new Date(),
          companyJobId: job.id,
          stage,
        })
        .returning({ id: researchRuns.id });
      if (!row) throw new Error("extraction subjob insert returned no row");
      return { runId: row.id };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return { busy: true };
    }
  }
  if (stage === "collect") {
    const result = await startCollect(db, [job.companyId], undefined, { companyJobId: job.id, stage });
    const entry = result.runs[0];
    if (!entry || entry.status === "already_running") return { busy: true };
    return { runId: entry.runId };
  }
  // Preflight is recon, not research: a short leash.
  const agentOpts =
    stage === "preflight" ? { maxMinutes: 15, maxModelSteps: 30 } : { maxMinutes: 40, maxModelSteps: 100 };
  const result = await researchStart(db, {
    companyIds: [job.companyId],
    promptVersion: latestPromptVersion(),
    companyJobId: job.id,
    stage,
    ...agentOpts,
  });
  const entry = result.runs[0];
  if (!entry || entry.status === "already_running") return { busy: true };
  return { runId: entry.runId };
}

/** Fresh subjob for the earliest incomplete stage (retry semantics). */
async function retryStage(db: Db, job: CompanyJob): Promise<CompanyStage> {
  const desc = await describeCompanyJob(db, job.id);
  const target = desc.nextStage;
  if (!target) throw new DomainError("invalid_input", "job is complete, nothing to retry");
  const latest = desc.stages.find((s) => s.stage === target)?.run ?? null;
  if (latest && !isTerminalSubjob(latest.status)) {
    throw new DomainError("invalid_input", `stage ${target} is still ${latest.status}`);
  }
  const outcome = await beginStageReal(db, job, target);
  if ("busy" in outcome) throw new DomainError("conflict", "company slot is busy, retry later");
  await db.update(companyJobs).set({ currentStage: target }).where(eq(companyJobs.id, job.id));
  await logJobEvent(db, job.id, "stage_started", target, { runId: outcome.runId, retry: true });
  return target;
}

export async function companyJobResume(db: Db, jobId: string): Promise<CompanyJob> {
  const job = await loadCompanyJob(db, jobId);
  if (job.status !== "paused") throw new DomainError("invalid_input", `job is ${job.status}, not paused`);
  // Resume means "looked, carry on": a failed stage is retried as part of it.
  // Lands on scheduled (waits for a slot) — never jumps the cap.
  const desc = await describeCompanyJob(db, jobId);
  if (desc.derived === "failed") await retryStage(db, job);
  const [updated] = await db
    .update(companyJobs)
    .set({ status: "scheduled", pauseReason: null, errorStreak: 0, errorClass: null })
    .where(eq(companyJobs.id, jobId))
    .returning();
  if (!updated) throw new DomainError("not_found", `company job not found: ${jobId}`);
  await logJobEvent(db, jobId, "job_resumed");
  return updated;
}

/**
 * Terminate every created (never admitted) company job with a reason. Created
 * jobs never hold active subjobs, so no runs need stopping.
 */
export async function supersedePendingJobs(db: Db, reason: string): Promise<{ terminated: number }> {
  const pending = await db.select({ id: companyJobs.id }).from(companyJobs).where(eq(companyJobs.status, "created"));
  const finishedAt = new Date();
  for (const job of pending) {
    await db
      .update(companyJobs)
      .set({ status: "terminated", finishedAt })
      .where(and(eq(companyJobs.id, job.id), eq(companyJobs.status, "created")));
    await logJobEvent(db, job.id, "job_cancelled", null, { reason: reason.slice(0, 500) });
  }
  return { terminated: pending.length };
}

export async function companyJobRetry(db: Db, jobId: string): Promise<{ job: CompanyJob; stage: CompanyStage }> {
  const job = await loadCompanyJob(db, jobId);
  if (job.status !== "failed" && job.status !== "paused") {
    throw new DomainError("invalid_input", `job is ${job.status}, nothing to retry`);
  }
  const desc = await describeCompanyJob(db, jobId);
  if (desc.derived !== "failed") {
    throw new DomainError("invalid_input", "no failed stage; resume the job instead");
  }
  const stage = await retryStage(db, job);
  // The streak survives a retry: three strikes on one company trip the pause.
  // Only a resume ("looked, carry on") resets the tripwire.
  const [updated] = await db
    .update(companyJobs)
    .set({ status: "scheduled", pauseReason: null, finishedAt: null })
    .where(eq(companyJobs.id, jobId))
    .returning();
  if (!updated) throw new DomainError("not_found", `company job not found: ${jobId}`);
  await logJobEvent(db, jobId, "job_retried", stage);
  return { job: updated, stage };
}

export interface CompanyCancelInput {
  /** Cancel the active subjob too (default true); false lets it finish. */
  stopRunning?: boolean;
}

export async function companyJobCancel(
  db: Db,
  jobId: string,
  input: CompanyCancelInput = {},
  cancelRunFn: (runId: string) => Promise<unknown> = (runId) => cancelRun(db, runId),
): Promise<CompanyJob> {
  const job = await loadCompanyJob(db, jobId);
  if (job.status === "completed" || job.status === "terminated") {
    throw new DomainError("invalid_input", `job is ${job.status}`);
  }
  if (input.stopRunning ?? true) {
    const desc = await describeCompanyJob(db, jobId);
    const active = desc.stages.find((s) => s.run && !isTerminalSubjob(s.run.status));
    if (active?.run) await cancelRunFn(active.run.id).catch(() => undefined);
  }
  const [updated] = await db
    .update(companyJobs)
    .set({ status: "terminated", finishedAt: new Date() })
    .where(eq(companyJobs.id, jobId))
    .returning();
  if (!updated) throw new DomainError("not_found", `company job not found: ${jobId}`);
  await logJobEvent(db, jobId, "job_cancelled");
  return updated;
}

// ---- Worker ----

export interface EngineLoad {
  active: number;
  max: number;
}

export interface CompanyRunnerDeps {
  pollMs?: number;
  clock?: () => number;
  /** Test override for company slots (else the live setting). */
  companyMax?: number;
  /** Test override for extraction pool width (else the live setting). */
  extractionMax?: number;
  beginStage?: (job: CompanyJob, stage: CompanyStage) => Promise<BeginStageOutcome>;
  runExtraction?: (job: CompanyJob, researchRunId: string) => Promise<void>;
  agentLoad?: () => Promise<EngineLoad>;
  collectLoad?: () => Promise<EngineLoad>;
}

export interface CompanyRunner {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  tick: () => Promise<void>;
}

export function realCompanyDeps(db: Db): Pick<CompanyRunnerDeps, "beginStage" | "runExtraction"> {
  return {
    beginStage: (job, stage) => beginStageReal(db, job, stage),
    runExtraction: (_job, researchRunId) => extractRun(db, researchRunId).then(() => undefined),
  };
}

async function countActiveRuns(db: Db, kind: "agent" | "collect"): Promise<number> {
  // Worker-driven extraction rows hold no container, so they never consume
  // agent slots (engine parity: the agent runner excludes them too). Without
  // this, extractions squat slots and real agents starve below the cap.
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(researchRuns)
    .where(
      and(
        eq(researchRuns.kind, kind),
        sql`${researchRuns.status} IN ('queued', 'running') AND ${researchRuns.stage} IS DISTINCT FROM 'extraction'`,
      ),
    );
  return Number(row?.n ?? 0);
}

export function createCompanyRunner(db: Db, deps: CompanyRunnerDeps): CompanyRunner {
  const pollMs = deps.pollMs ?? COMPANY_POLL_MS;
  const clock = deps.clock ?? Date.now;
  const beginStage = deps.beginStage ?? ((job, stage) => beginStageReal(db, job, stage));
  const runExtraction = deps.runExtraction ?? ((_job, researchRunId) => extractRun(db, researchRunId).then(() => undefined));
  const agentLoad =
    deps.agentLoad ??
    (async () => ({ active: await countActiveRuns(db, "agent"), max: await effectiveMaxAgents(db) }));
  const collectLoad =
    deps.collectLoad ?? (async () => ({ active: await countActiveRuns(db, "collect"), max: await effectiveCollectLimit(db) }));
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;
  /** Extraction run ids with a drive in flight (pool lives outside the tick). */
  const extracting = new Set<string>();

  /** Reconcile spent tokens to the sum of latest-subjob usage (extraction merges into the research row). */
  async function spendReconcile(job: CompanyJob): Promise<void> {
    const desc = await describeCompanyJob(db, job.id);
    const total = desc.stages.reduce((sum, s) => sum + (s.run ? usageInputTokens(s.run) : 0), 0);
    const spend = Math.max(0, total - job.inputTokensSpent);
    if (spend <= 0) return;
    await db
      .update(companyJobs)
      .set({ inputTokensSpent: sql`${companyJobs.inputTokensSpent} + ${spend}` })
      .where(eq(companyJobs.id, job.id));
  }

  async function failStage(
    job: CompanyJob,
    stage: CompanyStage,
    errorClass: string,
    error: string,
  ): Promise<CompanyJob> {
    await spendReconcile(job);
    // Quota exhaustion is not a job failure: park the job paused and trip
    // the breaker (never auto-retry — a requeue would instantly die again).
    const quota = parseQuotaExhaustion(error);
    if (
      (job.status === "running" || job.status === "scheduled") &&
      errorClass === "usage_limit" &&
      quota.exhausted
    ) {
      return quotaPark(job, error, quota.resumeAt);
    }
    const streak = job.errorClass === errorClass ? job.errorStreak + 1 : 1;
    const patch: Partial<CompanyJob> = { errorStreak: streak, errorClass };
    // First consecutive transient failure requeues instead of parking:
    // API-side flakiness (stalls, 429s) succeeds on retry. Anything else,
    // or a second consecutive transient, parks for a human. server_stopped
    // deliberately never auto-retries (a crash loop must not respawn work).
    const feeding = job.status === "running" || job.status === "scheduled";
    const autoRetry = feeding && TRANSIENT_AUTO_RETRY.has(errorClass) && streak < 2;
    if (feeding) {
      if (streak >= JOB_SAME_ERROR_PAUSE) {
        patch.status = "paused";
        patch.pauseReason = `${streak} consecutive ${errorClass} failures: ${error.slice(0, 300)}`;
      } else if (!autoRetry) {
        patch.status = "failed";
      }
    }
    const [updated] = await db.update(companyJobs).set(patch).where(eq(companyJobs.id, job.id)).returning();
    if (!updated) throw new DomainError("not_found", `company job not found: ${job.id}`);
    await logJobEvent(db, job.id, "stage_failed", stage, { errorClass, error: error.slice(0, 300) });
    if (autoRetry && (updated.status === "running" || updated.status === "scheduled")) {
      try {
        await retryStage(db, updated);
        await db.update(companyJobs).set({ status: "scheduled" }).where(eq(companyJobs.id, job.id));
      } catch {
        const [parked] = await db
          .update(companyJobs)
          .set({ status: "failed" })
          .where(eq(companyJobs.id, job.id))
          .returning();
        if (!parked) throw new DomainError("not_found", `company job not found: ${job.id}`);
        return parked;
      }
    }
    return updated;
  }

  /** Park a quota-hit job paused (not failed) and trip the breaker for the rest. */
  async function quotaPark(job: CompanyJob, error: string, resumeAt: Date | null): Promise<CompanyJob> {
    const reason = resumeAt
      ? `quota exhausted, resumes ${resumeAt.toISOString()}`
      : "quota exhausted, resume on owner go (no reset time in error)";
    const [updated] = await db
      .update(companyJobs)
      .set({ status: "paused", pauseReason: reason })
      .where(eq(companyJobs.id, job.id))
      .returning();
    if (!updated) throw new DomainError("not_found", `company job not found: ${job.id}`);
    await logJobEvent(db, job.id, "job_paused", null, { reason });
    await tripQuotaBreaker(db, { jobId: job.id, resumeAt, estimated: false, error });
    return updated;
  }

  async function completeJob(job: CompanyJob): Promise<void> {
    await spendReconcile(job);
    await db
      .update(companyJobs)
      .set({ status: "completed", finishedAt: new Date(clock()) })
      .where(eq(companyJobs.id, job.id));
    await logJobEvent(db, job.id, "job_completed");
  }

  async function budgetPause(job: CompanyJob): Promise<CompanyJob | null> {
    const [fresh] = await db
      .select({ inputTokensSpent: companyJobs.inputTokensSpent })
      .from(companyJobs)
      .where(eq(companyJobs.id, job.id));
    if (job.maxInputTokens !== null && (fresh?.inputTokensSpent ?? 0) >= job.maxInputTokens) {
      return companyJobPause(db, job.id, `budget: maxTokens ${job.maxInputTokens} reached`);
    }
    if (job.maxHours !== null && clock() - job.createdAt.getTime() >= job.maxHours * 3600_000) {
      return companyJobPause(db, job.id, `budget: maxHours ${job.maxHours} reached`);
    }
    return null;
  }

  /** Drive one running extraction subjob (fresh or restart-recovered). Returns the reloaded job. */
  async function driveExtraction(job: CompanyJob, subjob: ResearchRun): Promise<CompanyJob> {
    const desc = await describeCompanyJob(db, job.id);
    const research = desc.stages.find((s) => s.stage === "research")?.run ?? null;
    // The pool offers ahead of the drive: re-check the row is still live —
    // a cancel or pause may have landed after the offer.
    const [live] = await db.select().from(researchRuns).where(eq(researchRuns.id, subjob.id));
    if (!live || live.status !== "running") return loadCompanyJob(db, job.id);
    if (!research || !isStageComplete(research)) {
      const [marked] = await db
        .update(researchRuns)
        .set({ status: "failed", error: "no completed research run", finishedAt: new Date(clock()) })
        .where(and(eq(researchRuns.id, subjob.id), eq(researchRuns.status, "running")))
        .returning({ id: researchRuns.id });
      if (!marked) return loadCompanyJob(db, job.id);
      return failStage(await loadCompanyJob(db, job.id), "extraction", "failed", "no completed research run");
    }
    try {
      await runExtraction(job, research.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const [marked] = await db
        .update(researchRuns)
        .set({ status: "failed", error: message.slice(0, 500), finishedAt: new Date(clock()) })
        .where(and(eq(researchRuns.id, subjob.id), eq(researchRuns.status, "running")))
        .returning({ id: researchRuns.id });
      if (!marked) return loadCompanyJob(db, job.id);
      return failStage(await loadCompanyJob(db, job.id), "extraction", "extraction", message);
    }
    const [marked] = await db
      .update(researchRuns)
      .set({ status: "succeeded", finishedAt: new Date(clock()) })
      .where(and(eq(researchRuns.id, subjob.id), eq(researchRuns.status, "running")))
      .returning({ id: researchRuns.id });
    if (!marked) return loadCompanyJob(db, job.id);
    await spendReconcile(await loadCompanyJob(db, job.id));
    await logJobEvent(db, job.id, "stage_done", "extraction", { runId: subjob.id });
    const after = await describeCompanyJob(db, job.id);
    // Fresh status: the pool drives minutes after the offer, and the job
    // may have been paused or terminated meanwhile — never complete those.
    if (
      after.derived === "complete" &&
      (after.job.status === "running" || after.job.status === "scheduled" || after.job.status === "paused")
    ) {
      await completeJob(await loadCompanyJob(db, job.id));
    }
    return loadCompanyJob(db, job.id);
  }

  /**
   * Offer a running extraction row to the pool. Returns once the offer is
   * accepted or declined — the drive itself never blocks the tick.
   */
  async function offerExtraction(job: CompanyJob, run: ResearchRun): Promise<void> {
    if (extracting.has(run.id)) return;
    if (run.status !== "running") return;
    const limit = await effectiveExtractionLimit(db, deps.extractionMax);
    if (extracting.size >= limit) return;
    extracting.add(run.id);
    void driveExtraction(job, run)
      .catch((err: unknown) => {
        console.error(`company job ${job.id} extraction drive failed: ${err instanceof Error ? err.message : err}`);
      })
      .finally(() => {
        extracting.delete(run.id);
      });
  }

  async function tickJob(
    job: CompanyJob,
    feed: boolean,
    descArg?: CompanyJobDescription,
    holdAgents?: boolean,
  ): Promise<void> {
    const current = job;
    let desc = descArg ?? (await describeCompanyJob(db, job.id));
    if (
      desc.derived === "complete" &&
      (current.status === "running" || current.status === "scheduled" || current.status === "paused")
    ) {
      await completeJob(current);
      return;
    }
    // Running means an engine claimed it: sync the label both ways. A
    // scheduled job whose row turned running flips to running; a running
    // job with no live row at all drops back to scheduled (waiting again).
    const claimedRow = desc.stages.some(
      (s) => s.run && !isTerminalSubjob(s.run.status) && s.run.status === "running",
    );
    const liveRow = desc.stages.some((s) => s.run && !isTerminalSubjob(s.run.status));
    if (current.status === "scheduled" && claimedRow) {
      await db.update(companyJobs).set({ status: "running" }).where(eq(companyJobs.id, job.id));
      current.status = "running";
    } else if (current.status === "running" && !liveRow) {
      await db.update(companyJobs).set({ status: "scheduled" }).where(eq(companyJobs.id, job.id));
      current.status = "scheduled";
    }
    const active = desc.stages.find((s) => s.run && !isTerminalSubjob(s.run.status));
    if (active?.run) {
      const [fresh] = await db.select().from(researchRuns).where(eq(researchRuns.id, active.run.id));
      if (fresh && !isTerminalSubjob(fresh.status)) {
        // Engines own it — except running extraction, which the pool drives.
        if (active.stage === "extraction" && fresh.status === "running") {
          await offerExtraction(current, fresh);
        }
        return;
      }
      // Turned terminal since the describe; fall through with fresh state.
      desc = await describeCompanyJob(db, job.id);
      if (
        desc.derived === "complete" &&
        (current.status === "running" || current.status === "scheduled" || current.status === "paused")
      ) {
        await completeJob(await loadCompanyJob(db, job.id));
        return;
      }
    }
    // No active subjob. Gate first: a completed preflight without a valid
    // filed report failed (the retry path, never a skip).
    const preflight = desc.stages.find((s) => s.stage === "preflight");
    if (preflight?.run && isStageComplete(preflight.run)) {
      const gate = await checkPreflightGate(db, job.id);
      if (!gate.ok) {
        await db
          .update(researchRuns)
          .set({ status: "failed", error: `preflight gate: ${gate.reason}`, finishedAt: new Date(clock()) })
          .where(eq(researchRuns.id, preflight.run.id));
        desc = await describeCompanyJob(db, job.id);
      }
    }
    // A failed stage on a feeding job is always unaccounted (accounting
    // leaves failed/paused, and leaving those states always creates a live
    // subjob first) — account it now.
    const failed = desc.stages.find((s) => s.run && isTerminalSubjob(s.run.status) && !isStageComplete(s.run));
    if (failed?.run) {
      if (current.status === "running" || current.status === "scheduled") {
        const { errorClass, error } = classifyRunError(failed.run);
        await failStage(await loadCompanyJob(db, job.id), failed.stage, errorClass, error);
      }
      return;
    }
    // Advance the pointer past newly completed stages.
    const target = desc.nextStage;
    if (!target) return;
    if (current.currentStage !== target) {
      await db.update(companyJobs).set({ currentStage: target }).where(eq(companyJobs.id, job.id));
      const logged = await db
        .select({ stage: jobEvents.stage })
        .from(jobEvents)
        .where(and(eq(jobEvents.jobId, job.id), eq(jobEvents.type, "stage_done")));
      const loggedStages = new Set(logged.map((r) => r.stage));
      const doneIndex = desc.stages.findIndex((s) => s.stage === target);
      for (const done of desc.stages.slice(0, doneIndex)) {
        if (done.run && isStageComplete(done.run) && !loggedStages.has(done.stage)) {
          await logJobEvent(db, job.id, "stage_done", done.stage, { runId: done.run.id });
        }
      }
    }
    await spendReconcile(await loadCompanyJob(db, job.id));
    if (!feed) return;
    // Deterministic mode: while the quota breaker is tripped, fed jobs may
    // only begin collect (free); agent and extraction begins wait for reset.
    if (holdAgents && target !== "collect") return;
    if (AGENT_STAGES.includes(target)) {
      const load = await agentLoad();
      if (load.active >= load.max) return;
    } else if (target === "collect") {
      const load = await collectLoad();
      if (load.active >= load.max) return;
    }
    const paused = await budgetPause(current);
    if (paused) return;
    if (target === "collect") {
      // The plan gates collect: unknown adapters pause immediately for
      // onboarding (never improvised), and the plan is logged for replay.
      const gate = await checkPreflightGate(db, job.id);
      if (!gate.ok) {
        await companyJobPause(db, job.id, `collect blocked: ${gate.reason}`);
        return;
      }
      const wanted = gate.report.adaptersRequired.map((a) => a.adapterId);
      const { unknown } = resolvePlanAdapters(wanted);
      if (unknown.length > 0) {
        await companyJobPause(
          db,
          job.id,
          `adapter_missing: no adapter for ${unknown.join(", ")} (onboard it, then resume)`,
        );
        await logJobEvent(db, job.id, "collect_blocked", "collect", { unknown });
        return;
      }
      await logJobEvent(db, job.id, "collect_plan", "collect", {
        adapters: wanted,
        missing: gate.report.adaptersMissing.map((m) => m.suggestedId),
        directives: gate.report.collectDirectives,
      });
    }
    const outcome = await beginStage(current, target);
    if ("busy" in outcome) return;
    await db.update(companyJobs).set({ currentStage: target }).where(eq(companyJobs.id, job.id));
    await logJobEvent(db, job.id, "stage_started", target, { runId: outcome.runId });
    // A fresh extraction starts driving now instead of waiting a full tick.
    if (target === "extraction") {
      const [row] = await db.select().from(researchRuns).where(eq(researchRuns.id, outcome.runId));
      if (row) await offerExtraction(current, row);
    }
  }

  async function countByStatus(status: CompanyJob["status"]): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(companyJobs)
      .where(eq(companyJobs.status, status));
    return Number(row?.n ?? 0);
  }

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      // The quota monitor must never break the feeder: on failure log and
      // carry on untripped for this tick (the hard 429 path still parks).
      let quota: { tripped: boolean };
      try {
        await maybeQuotaResume(db);
        quota = await quotaBreakerGet(db);
        if (!quota.tripped) {
          await maybeQuotaEarlyTrip(db);
          quota = await quotaBreakerGet(db);
        }
      } catch (err) {
        console.error(`quota monitor failed: ${err instanceof Error ? err.message : err}`);
        quota = { tripped: false };
      }
      const jobs = await db
        .select()
        .from(companyJobs)
        .where(inArray(companyJobs.status, ["scheduled", "running", "paused", "terminated"]))
        .orderBy(asc(companyJobs.createdAt));
      // Agent lane first (stable sort keeps FIFO within a lane). One
      // describe per job, reused by tickJob — no added query cost.
      const lanes: { job: CompanyJob; desc: CompanyJobDescription }[] = [];
      for (const job of jobs) {
        try {
          lanes.push({ job, desc: await describeCompanyJob(db, job.id) });
        } catch (err) {
          console.error(`company job ${job.id} describe failed: ${err instanceof Error ? err.message : err}`);
        }
      }
      lanes.sort((a, b) => feedLane(a.desc) - feedLane(b.desc));
      for (const { job, desc } of lanes) {
        try {
          await tickJob(job, job.status === "scheduled" || job.status === "running", desc, quota.tripped);
        } catch (err) {
          console.error(`company job ${job.id} tick failed: ${err instanceof Error ? err.message : err}`);
        }
      }
      // Quality checkpoint: at N completions the batch pauses — promotion
      // stops, but running jobs keep their feed and finish normally.
      let paused = (await pipelinePausedGet(db)).paused;
      if (!paused) {
        const target = (await checkpointGet(db)).target;
        const completed = target === null ? 0 : await countByStatus("completed");
        if (target !== null && completed >= target) {
          await tripPipelinePause(db, target, completed);
          paused = true;
        }
      }
      if (paused) return;
      // Re-read: a trip mid-tick (quota 429 while accounting) must block
      // claims in the same tick, or jobs launch into a dry window. On a
      // read failure skip claiming this tick (fail closed, 15s cost).
      try {
        quota = await quotaBreakerGet(db);
      } catch (err) {
        console.error(`quota re-read failed: ${err instanceof Error ? err.message : err}`);
        return;
      }
      if (quota.tripped) return;
      const max = await effectiveCompanyConcurrency(db, deps.companyMax);
      while ((await countJobsIn(db, ["scheduled", "running"])) < max) {
        const [next] = await db
          .select()
          .from(companyJobs)
          .where(eq(companyJobs.status, "created"))
          .orderBy(asc(companyJobs.createdAt))
          .limit(1);
        if (!next) break;
        const [claimed] = await db
          .update(companyJobs)
          .set({ status: "scheduled" })
          .where(and(eq(companyJobs.id, next.id), eq(companyJobs.status, "created")))
          .returning();
        if (!claimed) break;
        await logJobEvent(db, claimed.id, "job_claimed");
        try {
          await tickJob(claimed, true, undefined, quota.tripped);
        } catch (err) {
          console.error(`company job ${claimed.id} tick failed: ${err instanceof Error ? err.message : err}`);
        }
      }
    } finally {
      ticking = false;
    }
  }

  return {
    tick,
    start: async () => {
      if (timer) return;
      timer = setInterval(() => {
        void tick();
      }, pollMs);
      await tick();
    },
    stop: async () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
