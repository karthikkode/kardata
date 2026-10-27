import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  bulkJobItems,
  bulkJobs,
  companies,
  researchRuns,
  shortlists,
  type BulkJob,
  type BulkJobItem,
  type ResearchRun,
} from "../db/schema.js";
import { DomainError } from "../domain/errors.js";
import { screenJobCompanyIds, type ScreenCriterion, type ScreenSort } from "../domain/screening.js";
import { researchStart } from "./agent.js";
import { extractRun } from "./extract.js";
import { latestPromptVersion, resolvePromptVersion } from "./prompt.js";
import { cancelRun, startCollect } from "./queue.js";
import { effectiveMaxAgents } from "./settings.js";

export const JOB_DEFAULT_RESEARCH_SKIP_DAYS = 30;
export const JOB_DEFAULT_COLLECT_SKIP_DAYS = 14;
export const JOB_SAME_ERROR_PAUSE = 3;
export const JOB_STATUS_ITEM_CAP = 200;
export const JOB_LIST_DEFAULT_LIMIT = 20;
const JOB_POLL_MS = 15_000;
const TERMINAL_RUN = ["succeeded", "partial", "failed", "stalled", "cancelled"] as const;

export type JobKind = BulkJob["kind"];
export type JobScope = BulkJob["scope"];

export interface JobBudget {
  maxTokens?: number;
  maxHours?: number;
}

export interface ResearchSectorJobInput {
  sectorId: string;
  criteria?: ScreenCriterion[];
  sort?: ScreenSort;
  maxCompanies?: number;
  skipIfRecentDays?: number;
  promptVersion?: string;
  budget?: JobBudget;
}

export interface ResearchShortlistJobInput {
  shortlistId: string;
  maxCompanies?: number;
  skipIfRecentDays?: number;
  promptVersion?: string;
  budget?: JobBudget;
}

export interface CollectSectorJobInput {
  sectorId: string;
  onlyStale?: boolean;
  staleDays?: number;
  maxCompanies?: number;
  budget?: JobBudget;
}

export function checkBudget(budget: JobBudget | undefined): {
  maxTokens: number | null;
  maxHours: number | null;
} {
  const maxTokens = budget?.maxTokens ?? null;
  const maxHours = budget?.maxHours ?? null;
  if (maxTokens !== null && (!Number.isInteger(maxTokens) || maxTokens < 1)) {
    throw new DomainError("invalid_input", "budget.maxTokens must be a positive integer");
  }
  if (maxHours !== null && (!Number.isFinite(maxHours) || maxHours <= 0 || maxHours > 720)) {
    throw new DomainError("invalid_input", "budget.maxHours must be within (0, 720]");
  }
  return { maxTokens, maxHours };
}

function checkMaxCompanies(maxCompanies: number | undefined): number | null {
  if (maxCompanies === undefined) return null;
  if (!Number.isInteger(maxCompanies) || maxCompanies < 1) {
    throw new DomainError("invalid_input", "maxCompanies must be a positive integer");
  }
  return maxCompanies;
}

function checkSkipDays(days: number | undefined, fallback: number): number {
  const value = days ?? fallback;
  if (!Number.isInteger(value) || value < 0 || value > 365) {
    throw new DomainError("invalid_input", "skip window must be 0..365 days");
  }
  return value;
}

async function createJob(
  db: Db,
  args: {
    kind: JobKind;
    scope: JobScope;
    sectorId?: string;
    shortlistId?: string;
    companyIds: string[];
    maxCompanies: number | null;
    maxTokens: number | null;
    maxHours: number | null;
    skipIfRecentDays: number;
    promptVersion: string | null;
  },
): Promise<{ jobId: string; items: number; capped: boolean }> {
  const capped = args.maxCompanies !== null && args.companyIds.length > args.maxCompanies;
  const ids = capped ? args.companyIds.slice(0, args.maxCompanies as number) : args.companyIds;
  if (ids.length === 0) throw new DomainError("invalid_input", "job scope has no companies");
  const jobId = randomUUID();
  await db.insert(bulkJobs).values({
    id: jobId,
    kind: args.kind,
    scope: args.scope,
    status: "running",
    sectorId: args.sectorId ?? null,
    shortlistId: args.shortlistId ?? null,
    maxCompanies: args.maxCompanies,
    maxInputTokens: args.maxTokens,
    maxHours: args.maxHours,
    skipIfRecentDays: args.skipIfRecentDays,
    promptVersion: args.promptVersion,
  });
  await db.insert(bulkJobItems).values(
    ids.map((companyId, position) => ({ id: randomUUID(), jobId, companyId, position })),
  );
  return { jobId, items: ids.length, capped };
}

/** Research every company in a sector (optionally screened), feeding the queue as slots free up. */
export async function startResearchSectorJob(
  db: Db,
  input: ResearchSectorJobInput,
): Promise<{ jobId: string; items: number; capped: boolean }> {
  const companyIds = await screenJobCompanyIds(db, input.sectorId, {
    criteria: input.criteria,
    sort: input.sort,
  });
  const { maxTokens, maxHours } = checkBudget(input.budget);
  return createJob(db, {
    kind: "research",
    scope: "sector",
    sectorId: input.sectorId,
    companyIds,
    maxCompanies: checkMaxCompanies(input.maxCompanies),
    maxTokens,
    maxHours,
    skipIfRecentDays: checkSkipDays(input.skipIfRecentDays, JOB_DEFAULT_RESEARCH_SKIP_DAYS),
    promptVersion: resolvePromptVersion(input.promptVersion),
  });
}

/** Research every company in a shortlist, in list order. */
export async function startResearchShortlistJob(
  db: Db,
  input: ResearchShortlistJobInput,
): Promise<{ jobId: string; items: number; capped: boolean }> {
  const [list] = await db.select().from(shortlists).where(eq(shortlists.id, input.shortlistId));
  if (!list) throw new DomainError("not_found", `shortlist not found: ${input.shortlistId}`);
  const { maxTokens, maxHours } = checkBudget(input.budget);
  return createJob(db, {
    kind: "research",
    scope: "shortlist",
    sectorId: list.sectorId,
    shortlistId: list.id,
    companyIds: [...list.companyIds],
    maxCompanies: checkMaxCompanies(input.maxCompanies),
    maxTokens,
    maxHours,
    skipIfRecentDays: checkSkipDays(input.skipIfRecentDays, JOB_DEFAULT_RESEARCH_SKIP_DAYS),
    promptVersion: resolvePromptVersion(input.promptVersion),
  });
}

/** Collect every live company in a sector as a job (employees desc). */
export async function startCollectSectorJob(
  db: Db,
  input: CollectSectorJobInput,
): Promise<{ jobId: string; items: number; capped: boolean }> {
  const companyIds = await screenJobCompanyIds(db, input.sectorId, {});
  const { maxTokens, maxHours } = checkBudget(input.budget);
  const onlyStale = input.onlyStale ?? true;
  const staleDays = input.staleDays ?? JOB_DEFAULT_COLLECT_SKIP_DAYS;
  if (!Number.isFinite(staleDays) || staleDays < 0 || staleDays > 365) {
    throw new DomainError("invalid_input", "staleDays must be within 0..365");
  }
  return createJob(db, {
    kind: "collect",
    scope: "sector",
    sectorId: input.sectorId,
    companyIds,
    maxCompanies: checkMaxCompanies(input.maxCompanies),
    maxTokens,
    maxHours,
    skipIfRecentDays: onlyStale ? Math.floor(staleDays) : 0,
    promptVersion: null,
  });
}

export interface JobItemView {
  companyId: string;
  companyName: string;
  status: BulkJobItem["status"];
  runId: string | null;
  attempts: number;
  error: string | null;
  durationMs: number | null;
}

export interface JobActiveRun {
  companyId: string;
  companyName: string;
  runId: string | null;
  status: BulkJobItem["status"];
  startedAt: Date | null;
}

export interface JobStatusView {
  job: BulkJob;
  counts: Record<BulkJobItem["status"], number>;
  activeRuns: JobActiveRun[];
  tokensSpent: number;
  avgMinPerCompany: number | null;
  etaSec: number | null;
  items: JobItemView[];
  itemsTruncated: boolean;
}

function finishedDurations(items: BulkJobItem[]): number[] {
  return items
    .map((i) => i.durationMs)
    .filter((d): d is number => typeof d === "number" && d > 0);
}

function etaSeconds(items: BulkJobItem[], concurrency: number): number | null {
  const durations = finishedDurations(items);
  if (durations.length === 0) return null;
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  const remaining = items.filter(
    (i) => i.status === "queued" || i.status === "running" || i.status === "extracting",
  ).length;
  if (remaining === 0) return 0;
  return Math.ceil((avg * remaining) / Math.max(1, concurrency) / 1000);
}

export async function jobStatus(db: Db, jobId: string): Promise<JobStatusView> {
  const [job] = await db.select().from(bulkJobs).where(eq(bulkJobs.id, jobId));
  if (!job) throw new DomainError("not_found", `job not found: ${jobId}`);
  const rows = await db
    .select({ item: bulkJobItems, name: companies.name })
    .from(bulkJobItems)
    .innerJoin(companies, eq(companies.id, bulkJobItems.companyId))
    .where(eq(bulkJobItems.jobId, jobId))
    .orderBy(asc(bulkJobItems.position));
  const counts: Record<BulkJobItem["status"], number> = {
    queued: 0,
    running: 0,
    extracting: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
  };
  for (const r of rows) counts[r.item.status] += 1;
  const durations = finishedDurations(rows.map((r) => r.item));
  const avgMin =
    durations.length === 0 ? null : durations.reduce((a, b) => a + b, 0) / durations.length / 60000;
  const concurrency = await effectiveMaxAgents(db);
  return {
    job,
    counts,
    activeRuns: rows
      .filter((r) => r.item.status === "running" || r.item.status === "extracting")
      .map((r) => ({
        companyId: r.item.companyId,
        companyName: r.name ?? r.item.companyId,
        runId: r.item.runId,
        status: r.item.status,
        startedAt: r.item.startedAt,
      })),
    tokensSpent: job.inputTokensSpent,
    avgMinPerCompany: avgMin === null ? null : Math.round(avgMin * 10) / 10,
    etaSec: etaSeconds(
      rows.map((r) => r.item),
      concurrency,
    ),
    items: rows.slice(0, JOB_STATUS_ITEM_CAP).map((r) => ({
      companyId: r.item.companyId,
      companyName: r.name ?? r.item.companyId,
      status: r.item.status,
      runId: r.item.runId,
      attempts: r.item.attempts,
      error: r.item.error,
      durationMs: r.item.durationMs,
    })),
    itemsTruncated: rows.length > JOB_STATUS_ITEM_CAP,
  };
}

export interface JobListEntry {
  job: BulkJob;
  counts: Record<BulkJobItem["status"], number>;
}

export async function jobList(db: Db, limit = JOB_LIST_DEFAULT_LIMIT): Promise<JobListEntry[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new DomainError("invalid_input", "limit must be 1..100");
  }
  const jobs = await db.select().from(bulkJobs).orderBy(desc(bulkJobs.createdAt)).limit(limit);
  const entries: JobListEntry[] = [];
  for (const job of jobs) {
    const rows = await db
      .select({ status: bulkJobItems.status })
      .from(bulkJobItems)
      .where(eq(bulkJobItems.jobId, job.id));
    const counts: Record<BulkJobItem["status"], number> = {
      queued: 0,
      running: 0,
      extracting: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0,
    };
    for (const r of rows) counts[r.status] += 1;
    entries.push({ job, counts });
  }
  return entries;
}

async function loadJob(db: Db, jobId: string): Promise<BulkJob> {
  const [job] = await db.select().from(bulkJobs).where(eq(bulkJobs.id, jobId));
  if (!job) throw new DomainError("not_found", `job not found: ${jobId}`);
  return job;
}

export async function jobPause(db: Db, jobId: string, reason = "paused by operator"): Promise<BulkJob> {
  const job = await loadJob(db, jobId);
  if (job.status !== "running") throw new DomainError("invalid_input", `job is ${job.status}, not running`);
  const [updated] = await db
    .update(bulkJobs)
    .set({ status: "paused", pauseReason: reason })
    .where(eq(bulkJobs.id, jobId))
    .returning();
  if (!updated) throw new DomainError("not_found", `job not found: ${jobId}`);
  return updated;
}

export async function jobResume(db: Db, jobId: string): Promise<BulkJob> {
  const job = await loadJob(db, jobId);
  if (job.status !== "paused") throw new DomainError("invalid_input", `job is ${job.status}, not paused`);
  // An operator resume means "looked, carry on": reset the error tripwire so
  // the next same-class failure does not re-pause immediately.
  const [updated] = await db
    .update(bulkJobs)
    .set({ status: "running", pauseReason: null, errorStreak: 0, errorClass: null })
    .where(eq(bulkJobs.id, jobId))
    .returning();
  if (!updated) throw new DomainError("not_found", `job not found: ${jobId}`);
  return updated;
}

export interface JobCancelInput {
  /** Stop running agents too (default true); false lets them finish. */
  stopRunning?: boolean;
}

export async function jobCancel(
  db: Db,
  jobId: string,
  input: JobCancelInput = {},
  cancelRunFn: (runId: string) => Promise<unknown> = (runId) => cancelRun(db, runId),
): Promise<BulkJob> {
  const job = await loadJob(db, jobId);
  if (job.status === "completed" || job.status === "cancelled") {
    throw new DomainError("invalid_input", `job is ${job.status}`);
  }
  const stopRunning = input.stopRunning ?? true;
  const queued = await db
    .select()
    .from(bulkJobItems)
    .where(and(eq(bulkJobItems.jobId, jobId), eq(bulkJobItems.status, "queued")));
  for (const item of queued) {
    await db.update(bulkJobItems).set({ status: "cancelled" }).where(eq(bulkJobItems.id, item.id));
  }
  if (stopRunning) {
    const running = await db
      .select()
      .from(bulkJobItems)
      .where(and(eq(bulkJobItems.jobId, jobId), eq(bulkJobItems.status, "running")));
    for (const item of running) {
      if (item.runId) await cancelRunFn(item.runId).catch(() => undefined);
      await db.update(bulkJobItems).set({ status: "cancelled" }).where(eq(bulkJobItems.id, item.id));
    }
  }
  // Running (stopRunning=false) and extracting items finalize on later ticks.
  const [updated] = await db
    .update(bulkJobs)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(eq(bulkJobs.id, jobId))
    .returning();
  if (!updated) throw new DomainError("not_found", `job not found: ${jobId}`);
  return updated;
}

export async function jobRetryFailed(db: Db, jobId: string): Promise<{ job: BulkJob; retried: number }> {
  await loadJob(db, jobId);
  const failed = await db
    .select({ id: bulkJobItems.id })
    .from(bulkJobItems)
    .where(and(eq(bulkJobItems.jobId, jobId), eq(bulkJobItems.status, "failed")));
  for (const item of failed) {
    await db
      .update(bulkJobItems)
      .set({ status: "queued", runId: null, error: null, errorClass: null })
      .where(eq(bulkJobItems.id, item.id));
  }
  const [updated] = await db
    .update(bulkJobs)
    .set({ status: "running", finishedAt: null, pauseReason: null, errorStreak: 0, errorClass: null })
    .where(eq(bulkJobs.id, jobId))
    .returning();
  if (!updated) throw new DomainError("not_found", `job not found: ${jobId}`);
  return { job: updated, retried: failed.length };
}

// ---- Worker ----

export type StartOutcome = { runId: string } | { busy: true };

export interface JobRunnerDeps {
  pollMs?: number;
  startResearch: (companyId: string, promptVersion: string) => Promise<StartOutcome>;
  startCollect: (companyId: string) => Promise<StartOutcome>;
  extract: (runId: string) => Promise<void>;
  clock?: () => number;
}

/** A succeeded agent run within the window. */
export async function hasFreshResearch(db: Db, companyId: string, days: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ id: researchRuns.id })
    .from(researchRuns)
    .where(
      and(
        eq(researchRuns.companyId, companyId),
        eq(researchRuns.kind, "agent"),
        eq(researchRuns.status, "succeeded"),
        gt(researchRuns.finishedAt, cutoff),
      ),
    )
    .limit(1);
  return row !== undefined;
}

async function hasFreshCollect(db: Db, companyId: string, days: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ id: researchRuns.id })
    .from(researchRuns)
    .where(
      and(
        eq(researchRuns.companyId, companyId),
        eq(researchRuns.kind, "collect"),
        gt(researchRuns.finishedAt, cutoff),
        sql`${researchRuns.status} IN ('succeeded', 'partial')`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

const USAGE_LIMIT = /usage|quota|subscription|rate.?limit|429|overloaded|capacity|billing/i;

/** Coarse failure class for the 3-same-errors auto-pause. */
export function classifyRunError(run: ResearchRun): { errorClass: string; error: string } {
  if (run.status === "stalled") return { errorClass: "stall", error: "run stalled" };
  const text = run.error ?? run.status;
  if (USAGE_LIMIT.test(text)) return { errorClass: "usage_limit", error: text };
  if (/time limit/i.test(text)) return { errorClass: "time_limit", error: text };
  if (/server stopped/i.test(text)) return { errorClass: "server_stopped", error: text };
  if (/^all areas blocked/i.test(text)) return { errorClass: "all_blocked", error: text };
  return { errorClass: "failed", error: text };
}

export function usageInputTokens(run: ResearchRun): number {
  const usage = run.agentUsage;
  if (!usage) return 0;
  return (usage.inputTokens ?? 0) + (usage.cachedTokens ?? 0);
}

export function realJobDeps(db: Db): Omit<JobRunnerDeps, "pollMs" | "clock"> {
  return {
    startResearch: async (companyId, promptVersion) => {
      const result = await researchStart(db, { companyIds: [companyId], promptVersion });
      const entry = result.runs[0];
      if (!entry || entry.status === "already_running") return { busy: true };
      return { runId: entry.runId };
    },
    startCollect: async (companyId) => {
      const result = await startCollect(db, [companyId]);
      const entry = result.runs[0];
      if (!entry || entry.status === "already_running") return { busy: true };
      return { runId: entry.runId };
    },
    extract: async (runId) => {
      await extractRun(db, runId);
    },
  };
}

export interface JobRunner {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  tick: () => Promise<void>;
}

export function createJobRunner(db: Db, deps: JobRunnerDeps): JobRunner {
  const pollMs = deps.pollMs ?? JOB_POLL_MS;
  const clock = deps.clock ?? Date.now;
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  async function spendTokens(jobId: string, spend: number): Promise<void> {
    if (spend <= 0) return;
    await db
      .update(bulkJobs)
      .set({ inputTokensSpent: sql`${bulkJobs.inputTokensSpent} + ${spend}` })
      .where(eq(bulkJobs.id, jobId));
  }

  async function failItem(job: BulkJob, item: BulkJobItem, errorClass: string, error: string): Promise<BulkJob> {
    const finishedAt = new Date(clock());
    const durationMs = item.startedAt ? Math.max(0, finishedAt.getTime() - item.startedAt.getTime()) : null;
    await db
      .update(bulkJobItems)
      .set({ status: "failed", error: error.slice(0, 500), errorClass, finishedAt, durationMs })
      .where(eq(bulkJobItems.id, item.id));
    const streak = job.errorClass === errorClass ? job.errorStreak + 1 : 1;
    const patch: Partial<BulkJob> = { errorStreak: streak, errorClass };
    if (streak >= JOB_SAME_ERROR_PAUSE && job.status === "running") {
      patch.status = "paused";
      patch.pauseReason = `${streak} consecutive ${errorClass} failures: ${error.slice(0, 300)}`;
    }
    const [updated] = await db.update(bulkJobs).set(patch).where(eq(bulkJobs.id, job.id)).returning();
    if (!updated) throw new DomainError("not_found", `job not found: ${job.id}`);
    return updated;
  }

  async function succeedItem(item: BulkJobItem, spend: number): Promise<void> {
    const finishedAt = new Date(clock());
    const durationMs = item.startedAt ? Math.max(0, finishedAt.getTime() - item.startedAt.getTime()) : null;
    await db
      .update(bulkJobItems)
      .set({ status: "succeeded", finishedAt, durationMs })
      .where(eq(bulkJobItems.id, item.id));
    await spendTokens(item.jobId, spend);
  }

  /** Finalize one active item whose run may have reached a terminal state. */
  async function finalizeItem(job: BulkJob, item: BulkJobItem): Promise<BulkJob> {
    // Recovery: an extraction interrupted by a restart runs again.
    if (item.status === "extracting" && item.runId) {
      try {
        await deps.extract(item.runId);
        await succeedItem(item, 0);
      } catch (err) {
        return failItem(job, item, "extraction", err instanceof Error ? err.message : String(err));
      }
      return loadJob(db, job.id);
    }
    if (!item.runId) {
      return failItem(job, item, "failed", "run row is gone");
    }
    const [run] = await db.select().from(researchRuns).where(eq(researchRuns.id, item.runId));
    if (!run || !(TERMINAL_RUN as readonly string[]).includes(run.status)) return job;
    const spend = usageInputTokens(run);
    if (run.status !== "succeeded" && run.status !== "partial") {
      const { errorClass, error } = classifyRunError(run);
      await spendTokens(job.id, spend);
      return failItem(await loadJob(db, job.id), item, errorClass, error);
    }
    if (job.kind === "collect") {
      await succeedItem(item, spend);
      return loadJob(db, job.id);
    }
    await db.update(bulkJobItems).set({ status: "extracting" }).where(eq(bulkJobItems.id, item.id));
    try {
      await deps.extract(item.runId);
      await succeedItem({ ...item, status: "extracting" }, spend);
    } catch (err) {
      await spendTokens(job.id, spend);
      return failItem(
        await loadJob(db, job.id),
        { ...item, status: "extracting" },
        "extraction",
        err instanceof Error ? err.message : String(err),
      );
    }
    return loadJob(db, job.id);
  }

  async function budgetPause(job: BulkJob): Promise<BulkJob | null> {
    const [fresh] = await db
      .select({ inputTokensSpent: bulkJobs.inputTokensSpent })
      .from(bulkJobs)
      .where(eq(bulkJobs.id, job.id));
    if (job.maxInputTokens !== null && (fresh?.inputTokensSpent ?? 0) >= job.maxInputTokens) {
      return jobPause(db, job.id, `budget: maxTokens ${job.maxInputTokens} reached`);
    }
    if (job.maxHours !== null && clock() - job.createdAt.getTime() >= job.maxHours * 3600_000) {
      return jobPause(db, job.id, `budget: maxHours ${job.maxHours} reached`);
    }
    return null;
  }

  async function tickJob(job: BulkJob, feed: boolean): Promise<void> {
    let current = job;
    const actives = await db
      .select()
      .from(bulkJobItems)
      .where(and(eq(bulkJobItems.jobId, job.id), inArray(bulkJobItems.status, ["running", "extracting"])))
      .orderBy(asc(bulkJobItems.position));
    for (const item of actives) {
      const [fresh] = await db.select().from(bulkJobItems).where(eq(bulkJobItems.id, item.id));
      if (!fresh || (fresh.status !== "running" && fresh.status !== "extracting")) continue;
      current = await finalizeItem(current, fresh);
      if (current.status !== "running") return;
    }
    const [open] = await db
      .select({ n: sql<number>`count(*)` })
      .from(bulkJobItems)
      .where(
        and(eq(bulkJobItems.jobId, job.id), inArray(bulkJobItems.status, ["queued", "running", "extracting"])),
      );
    if (Number(open?.n ?? 0) === 0 && current.status === "running") {
      await db
        .update(bulkJobs)
        .set({ status: "completed", finishedAt: new Date(clock()) })
        .where(eq(bulkJobs.id, job.id));
      return;
    }
    if (!feed) return;
    const concurrency = await effectiveMaxAgents(db);
    const items = await db
      .select()
      .from(bulkJobItems)
      .where(eq(bulkJobItems.jobId, job.id))
      .orderBy(asc(bulkJobItems.position));
    let active = items.filter((i) => i.status === "running" || i.status === "extracting").length;
    for (const item of items.filter((i) => i.status === "queued")) {
      if (active >= concurrency) break;
      const paused = await budgetPause(current);
      if (paused) return;
      if (current.skipIfRecentDays > 0) {
        const fresh =
          current.kind === "research"
            ? await hasFreshResearch(db, item.companyId, current.skipIfRecentDays)
            : await hasFreshCollect(db, item.companyId, current.skipIfRecentDays);
        if (fresh) {
          await db.update(bulkJobItems).set({ status: "skipped" }).where(eq(bulkJobItems.id, item.id));
          continue;
        }
      }
      const outcome =
        current.kind === "research"
          ? await deps.startResearch(item.companyId, current.promptVersion ?? latestPromptVersion())
          : await deps.startCollect(item.companyId);
      if ("busy" in outcome) continue;
      await db.update(researchRuns).set({ jobId: job.id }).where(eq(researchRuns.id, outcome.runId));
      await db
        .update(bulkJobItems)
        .set({ status: "running", runId: outcome.runId, attempts: item.attempts + 1, startedAt: new Date(clock()) })
        .where(eq(bulkJobItems.id, item.id));
      await db
        .update(bulkJobs)
        .set({ startedRuns: sql`${bulkJobs.startedRuns} + 1` })
        .where(eq(bulkJobs.id, job.id));
      active += 1;
    }
  }

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      const jobs = await db
        .select()
        .from(bulkJobs)
        .where(inArray(bulkJobs.status, ["running", "paused", "cancelled"]));
      for (const job of jobs) {
        try {
          await tickJob(job, job.status === "running");
        } catch (err) {
          console.error(`job ${job.id} tick failed: ${err instanceof Error ? err.message : err}`);
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
