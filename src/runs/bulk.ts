import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  bulkJobItems,
  bulkJobs,
  companies,
  researchRuns,
  sectorCompanies,
  shortlists,
  type BulkJob,
  type BulkJobItem,
  type ResearchRun,
} from "../db/schema.js";
import { DomainError } from "../domain/errors.js";
import { researchStart } from "./agent.js";
import { extractRun } from "./extract.js";
import { resolvePromptVersion } from "./prompt.js";
import { cancelRun, startCollect } from "./queue.js";

export const BULK_MAX_RESEARCH_CONCURRENCY = 4;
export const BULK_MAX_COLLECT_CONCURRENCY = 8;
export const BULK_DEFAULT_CONCURRENCY = 2;
export const BULK_DEFAULT_SKIP_DAYS = 14;
export const BULK_SAME_ERROR_PAUSE = 3;
export const BULK_STATUS_ITEM_CAP = 200;
const BULK_POLL_MS = 15_000;
const TERMINAL_RUN = ["succeeded", "partial", "failed", "stalled", "cancelled"] as const;

export type BulkKind = BulkJob["kind"];

export interface BulkStartInput {
  kind: BulkKind;
  sectorId?: string;
  shortlistId?: string;
  companyIds?: string[];
  concurrency?: number;
  maxRuns?: number;
  maxInputTokens?: number;
  skipIfRecentDays?: number;
  promptVersion?: string;
}

function maxConcurrency(kind: BulkKind): number {
  return kind === "collect_sector" ? BULK_MAX_COLLECT_CONCURRENCY : BULK_MAX_RESEARCH_CONCURRENCY;
}

function isResearchKind(kind: BulkKind): boolean {
  return kind !== "collect_sector";
}

async function resolveCompanies(db: Db, input: BulkStartInput): Promise<string[]> {
  const sources = [
    input.companyIds !== undefined ? "companyIds" : null,
    input.sectorId !== undefined ? "sectorId" : null,
    input.shortlistId !== undefined ? "shortlistId" : null,
  ].filter((s): s is string => s !== null);
  if (sources.length !== 1) {
    throw new DomainError("invalid_input", "pass exactly one of companyIds, sectorId, shortlistId");
  }
  if (input.companyIds !== undefined) {
    const unique = [...new Set(input.companyIds)];
    if (unique.length === 0) throw new DomainError("invalid_input", "companyIds must not be empty");
    const found = await db
      .select({ id: companies.id })
      .from(companies)
      .where(inArray(companies.id, unique));
    if (found.length !== unique.length) throw new DomainError("invalid_input", "unknown company id");
    return unique;
  }
  if (input.sectorId !== undefined) {
    if (!input.kind.endsWith("_sector")) {
      throw new DomainError("invalid_input", `sectorId needs a *_sector scope, not ${input.kind}`);
    }
    const members = await db
      .select({ companyId: sectorCompanies.companyId })
      .from(sectorCompanies)
      .where(and(eq(sectorCompanies.sectorId, input.sectorId), sql`${sectorCompanies.removedAt} IS NULL`))
      .orderBy(asc(sectorCompanies.createdAt));
    if (members.length === 0) throw new DomainError("invalid_input", "sector has no companies");
    return members.map((m) => m.companyId);
  }
  const [list] = await db.select().from(shortlists).where(eq(shortlists.id, input.shortlistId ?? ""));
  if (!list) throw new DomainError("not_found", `shortlist not found: ${input.shortlistId}`);
  if (input.kind !== "research_shortlist") {
    throw new DomainError("invalid_input", `shortlistId needs research_shortlist, not ${input.kind}`);
  }
  if (list.companyIds.length === 0) throw new DomainError("invalid_input", "shortlist has no companies");
  return [...list.companyIds];
}

/** Create a job with one queued item per company. The worker picks it up. */
export async function bulkStart(db: Db, input: BulkStartInput): Promise<{ jobId: string; items: number }> {
  if (input.kind !== "research_sector" && input.kind !== "research_shortlist" && input.kind !== "collect_sector") {
    throw new DomainError("invalid_input", `bad bulk kind "${input.kind as string}"`);
  }
  const companyIds = await resolveCompanies(db, input);
  const concurrency = input.concurrency ?? BULK_DEFAULT_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > maxConcurrency(input.kind)) {
    throw new DomainError("invalid_input", `concurrency must be 1..${maxConcurrency(input.kind)} for ${input.kind}`);
  }
  if (input.maxRuns !== undefined && (!Number.isInteger(input.maxRuns) || input.maxRuns < 1)) {
    throw new DomainError("invalid_input", "maxRuns must be a positive integer");
  }
  if (input.maxInputTokens !== undefined && (!Number.isInteger(input.maxInputTokens) || input.maxInputTokens < 1)) {
    throw new DomainError("invalid_input", "maxInputTokens must be a positive integer");
  }
  const skipDays = input.skipIfRecentDays ?? BULK_DEFAULT_SKIP_DAYS;
  if (!Number.isInteger(skipDays) || skipDays < 0 || skipDays > 365) {
    throw new DomainError("invalid_input", "skipIfRecentDays must be 0..365");
  }
  let promptVersion: string | null = null;
  if (isResearchKind(input.kind)) {
    promptVersion = resolvePromptVersion(input.promptVersion);
  } else if (input.promptVersion !== undefined) {
    throw new DomainError("invalid_input", "promptVersion is research-only");
  }
  const jobId = randomUUID();
  await db.insert(bulkJobs).values({
    id: jobId,
    kind: input.kind,
    status: "running",
    sectorId: input.sectorId ?? null,
    shortlistId: input.shortlistId ?? null,
    concurrency,
    maxRuns: input.maxRuns ?? null,
    maxInputTokens: input.maxInputTokens ?? null,
    skipIfRecentDays: skipDays,
    promptVersion,
  });
  await db.insert(bulkJobItems).values(
    companyIds.map((companyId) => ({ id: randomUUID(), jobId, companyId })),
  );
  return { jobId, items: companyIds.length };
}

export interface BulkItemView {
  companyId: string;
  companyName: string;
  status: BulkJobItem["status"];
  runId: string | null;
  attempts: number;
  error: string | null;
  durationMs: number | null;
}

export interface BulkStatusView {
  job: BulkJob;
  counts: Record<BulkJobItem["status"], number>;
  items: BulkItemView[];
  itemsTruncated: boolean;
  etaSec: number | null;
}

function etaSeconds(items: BulkJobItem[], concurrency: number): number | null {
  const durations = items
    .map((i) => i.durationMs)
    .filter((d): d is number => typeof d === "number" && d > 0);
  if (durations.length === 0) return null;
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  const remaining = items.filter(
    (i) => i.status === "queued" || i.status === "running" || i.status === "extracting",
  ).length;
  if (remaining === 0) return 0;
  return Math.ceil((avg * remaining) / Math.max(1, concurrency) / 1000);
}

export async function bulkStatus(db: Db, jobId: string): Promise<BulkStatusView> {
  const [job] = await db.select().from(bulkJobs).where(eq(bulkJobs.id, jobId));
  if (!job) throw new DomainError("not_found", `bulk job not found: ${jobId}`);
  const rows = await db
    .select({ item: bulkJobItems, name: companies.name })
    .from(bulkJobItems)
    .innerJoin(companies, eq(companies.id, bulkJobItems.companyId))
    .where(eq(bulkJobItems.jobId, jobId))
    .orderBy(asc(bulkJobItems.createdAt));
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
  const items: BulkItemView[] = rows.slice(0, BULK_STATUS_ITEM_CAP).map((r) => ({
    companyId: r.item.companyId,
    companyName: r.name ?? r.item.companyId,
    status: r.item.status,
    runId: r.item.runId,
    attempts: r.item.attempts,
    error: r.item.error,
    durationMs: r.item.durationMs,
  }));
  return {
    job,
    counts,
    items,
    itemsTruncated: rows.length > BULK_STATUS_ITEM_CAP,
    etaSec: etaSeconds(
      rows.map((r) => r.item),
      job.concurrency,
    ),
  };
}

async function loadJob(db: Db, jobId: string): Promise<BulkJob> {
  const [job] = await db.select().from(bulkJobs).where(eq(bulkJobs.id, jobId));
  if (!job) throw new DomainError("not_found", `bulk job not found: ${jobId}`);
  return job;
}

export async function bulkSetConcurrency(db: Db, jobId: string, concurrency: number): Promise<BulkJob> {
  const job = await loadJob(db, jobId);
  if (job.status === "completed" || job.status === "cancelled") {
    throw new DomainError("invalid_input", `job is ${job.status}`);
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > maxConcurrency(job.kind)) {
    throw new DomainError("invalid_input", `concurrency must be 1..${maxConcurrency(job.kind)} for ${job.kind}`);
  }
  const [updated] = await db
    .update(bulkJobs)
    .set({ concurrency })
    .where(eq(bulkJobs.id, jobId))
    .returning();
  if (!updated) throw new DomainError("not_found", `bulk job not found: ${jobId}`);
  return updated;
}

export async function bulkPause(db: Db, jobId: string, reason = "paused by operator"): Promise<BulkJob> {
  const job = await loadJob(db, jobId);
  if (job.status !== "running") throw new DomainError("invalid_input", `job is ${job.status}, not running`);
  const [updated] = await db
    .update(bulkJobs)
    .set({ status: "paused", pauseReason: reason })
    .where(eq(bulkJobs.id, jobId))
    .returning();
  if (!updated) throw new DomainError("not_found", `bulk job not found: ${jobId}`);
  return updated;
}

export async function bulkResume(db: Db, jobId: string): Promise<BulkJob> {
  const job = await loadJob(db, jobId);
  if (job.status !== "paused") throw new DomainError("invalid_input", `job is ${job.status}, not paused`);
  const [updated] = await db
    .update(bulkJobs)
    .set({ status: "running", pauseReason: null })
    .where(eq(bulkJobs.id, jobId))
    .returning();
  if (!updated) throw new DomainError("not_found", `bulk job not found: ${jobId}`);
  return updated;
}

export async function bulkCancel(
  db: Db,
  jobId: string,
  cancelRunFn: (runId: string) => Promise<unknown> = (runId) => cancelRun(db, runId),
): Promise<BulkJob> {
  const job = await loadJob(db, jobId);
  if (job.status === "completed" || job.status === "cancelled") {
    throw new DomainError("invalid_input", `job is ${job.status}`);
  }
  const actives = await db
    .select()
    .from(bulkJobItems)
    .where(
      and(
        eq(bulkJobItems.jobId, jobId),
        inArray(bulkJobItems.status, ["queued", "running", "extracting"]),
      ),
    );
  for (const item of actives) {
    if (item.runId && (item.status === "running" || item.status === "extracting")) {
      await cancelRunFn(item.runId).catch(() => undefined);
    }
    await db.update(bulkJobItems).set({ status: "cancelled" }).where(eq(bulkJobItems.id, item.id));
  }
  const [updated] = await db
    .update(bulkJobs)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(eq(bulkJobs.id, jobId))
    .returning();
  if (!updated) throw new DomainError("not_found", `bulk job not found: ${jobId}`);
  return updated;
}

export async function bulkRetryFailed(db: Db, jobId: string): Promise<{ job: BulkJob; retried: number }> {
  const job = await loadJob(db, jobId);
  if (job.status === "cancelled") throw new DomainError("invalid_input", "job is cancelled");
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
  if (!updated) throw new DomainError("not_found", `bulk job not found: ${jobId}`);
  return { job: updated, retried: failed.length };
}

// ---- Worker ----

export type StartOutcome = { runId: string } | { busy: true };

export interface BulkRunnerDeps {
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
  return { errorClass: "failed", error: text };
}

function usageInputTokens(run: ResearchRun): number {
  const usage = run.agentUsage;
  if (!usage) return 0;
  return (usage.inputTokens ?? 0) + (usage.cachedTokens ?? 0);
}

export function realBulkDeps(db: Db): Omit<BulkRunnerDeps, "pollMs" | "clock"> {
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

export interface BulkRunner {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  tick: () => Promise<void>;
}

export function createBulkRunner(db: Db, deps: BulkRunnerDeps): BulkRunner {
  const pollMs = deps.pollMs ?? BULK_POLL_MS;
  const clock = deps.clock ?? Date.now;
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  async function failItem(job: BulkJob, item: BulkJobItem, errorClass: string, error: string): Promise<BulkJob> {
    const finishedAt = new Date(clock());
    const durationMs = item.startedAt ? Math.max(0, finishedAt.getTime() - item.startedAt.getTime()) : null;
    await db
      .update(bulkJobItems)
      .set({ status: "failed", error: error.slice(0, 500), errorClass, finishedAt, durationMs })
      .where(eq(bulkJobItems.id, item.id));
    const streak = job.errorClass === errorClass ? job.errorStreak + 1 : 1;
    const patch: Partial<BulkJob> = { errorStreak: streak, errorClass };
    if (streak >= BULK_SAME_ERROR_PAUSE) {
      patch.status = "paused";
      patch.pauseReason = `${streak} consecutive ${errorClass} failures: ${error.slice(0, 300)}`;
    }
    const [updated] = await db.update(bulkJobs).set(patch).where(eq(bulkJobs.id, job.id)).returning();
    if (!updated) throw new DomainError("not_found", `bulk job not found: ${job.id}`);
    return updated;
  }

  async function succeedItem(item: BulkJobItem, spend: number): Promise<void> {
    const finishedAt = new Date(clock());
    const durationMs = item.startedAt ? Math.max(0, finishedAt.getTime() - item.startedAt.getTime()) : null;
    await db
      .update(bulkJobItems)
      .set({ status: "succeeded", finishedAt, durationMs })
      .where(eq(bulkJobItems.id, item.id));
    if (spend > 0) {
      await db
        .update(bulkJobs)
        .set({ inputTokensSpent: sql`${bulkJobs.inputTokensSpent} + ${spend}` })
        .where(eq(bulkJobs.id, item.jobId));
    }
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
    if (!isResearchKind(job.kind)) {
      if (run.status === "succeeded" || run.status === "partial") {
        await succeedItem(item, spend);
        return loadJob(db, job.id);
      }
      const { errorClass, error } = classifyRunError(run);
      await db
        .update(bulkJobs)
        .set({ inputTokensSpent: sql`${bulkJobs.inputTokensSpent} + ${spend}` })
        .where(eq(bulkJobs.id, job.id));
      return failItem(await loadJob(db, job.id), item, errorClass, error);
    }
    if (run.status !== "succeeded" && run.status !== "partial") {
      const { errorClass, error } = classifyRunError(run);
      await db
        .update(bulkJobs)
        .set({ inputTokensSpent: sql`${bulkJobs.inputTokensSpent} + ${spend}` })
        .where(eq(bulkJobs.id, job.id));
      return failItem(await loadJob(db, job.id), item, errorClass, error);
    }
    await db.update(bulkJobItems).set({ status: "extracting" }).where(eq(bulkJobItems.id, item.id));
    try {
      await deps.extract(item.runId);
      await succeedItem({ ...item, status: "extracting" }, spend);
    } catch (err) {
      await db
        .update(bulkJobs)
        .set({ inputTokensSpent: sql`${bulkJobs.inputTokensSpent} + ${spend}` })
        .where(eq(bulkJobs.id, job.id));
      return failItem(
        await loadJob(db, job.id),
        { ...item, status: "extracting" },
        "extraction",
        err instanceof Error ? err.message : String(err),
      );
    }
    return loadJob(db, job.id);
  }

  async function tickJob(job: BulkJob, feed: boolean): Promise<void> {
    let current = job;
    const actives = await db
      .select()
      .from(bulkJobItems)
      .where(and(eq(bulkJobItems.jobId, job.id), inArray(bulkJobItems.status, ["running", "extracting"])))
      .orderBy(asc(bulkJobItems.createdAt));
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
    if (Number(open?.n ?? 0) === 0) {
      await db
        .update(bulkJobs)
        .set({ status: "completed", finishedAt: new Date(clock()) })
        .where(eq(bulkJobs.id, job.id));
      return;
    }
    if (!feed) return;
    // Budgets pause before new starts, re-checked as each run starts.
    let started = current.startedRuns;
    const items = await db
      .select()
      .from(bulkJobItems)
      .where(eq(bulkJobItems.jobId, job.id))
      .orderBy(asc(bulkJobItems.createdAt));
    let active = items.filter((i) => i.status === "running" || i.status === "extracting").length;
    for (const item of items.filter((i) => i.status === "queued")) {
      if (active >= current.concurrency) break;
      const [budget] = await db
        .select({ startedRuns: bulkJobs.startedRuns, inputTokensSpent: bulkJobs.inputTokensSpent })
        .from(bulkJobs)
        .where(eq(bulkJobs.id, job.id));
      started = budget?.startedRuns ?? started;
      if (current.maxRuns !== null && started >= current.maxRuns) {
        await bulkPause(db, job.id, `budget: maxRuns ${current.maxRuns} reached`);
        return;
      }
      if (current.maxInputTokens !== null && (budget?.inputTokensSpent ?? 0) >= current.maxInputTokens) {
        await bulkPause(db, job.id, `budget: maxInputTokens ${current.maxInputTokens} reached`);
        return;
      }
      if (current.skipIfRecentDays > 0) {
        const fresh = isResearchKind(current.kind)
          ? await hasFreshResearch(db, item.companyId, current.skipIfRecentDays)
          : await hasFreshCollect(db, item.companyId, current.skipIfRecentDays);
        if (fresh) {
          await db.update(bulkJobItems).set({ status: "skipped" }).where(eq(bulkJobItems.id, item.id));
          continue;
        }
      }
      const outcome = isResearchKind(current.kind)
        ? await deps.startResearch(item.companyId, resolvePromptVersion(current.promptVersion ?? undefined))
        : await deps.startCollect(item.companyId);
      if ("busy" in outcome) continue;
      await db
        .update(bulkJobItems)
        .set({ status: "running", runId: outcome.runId, attempts: item.attempts + 1, startedAt: new Date(clock()) })
        .where(eq(bulkJobItems.id, item.id));
      await db
        .update(bulkJobs)
        .set({ startedRuns: sql`${bulkJobs.startedRuns} + 1` })
        .where(eq(bulkJobs.id, job.id));
      started += 1;
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
        .where(inArray(bulkJobs.status, ["running", "paused"]));
      for (const job of jobs) {
        try {
          await tickJob(job, job.status === "running");
        } catch (err) {
          console.error(`bulk job ${job.id} tick failed: ${err instanceof Error ? err.message : err}`);
        }
      }
    } finally {
      ticking = false;
    }
  }

  return {
    start: async () => {
      if (timer) return;
      timer = setInterval(() => {
        void tick();
      }, pollMs);
      timer.unref();
      await tick();
    },
    stop: async () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    tick,
  };
}
