import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  companies,
  companyJobs,
  researchRuns,
  sectorCompanies,
  sectorPreflight,
  sectorPreflightItems,
  sectorPreflightJobs,
  sectors,
  type ResearchRun,
  type SectorPreflightJob,
} from "../db/schema.js";
import { DomainError } from "../domain/errors.js";
import { deriveCompany, getRubric } from "../domain/sector-preflight/eligibility.js";
import { categoryKeys, resolveProfileForSector } from "../domain/sector-preflight/profile.js";
import {
  JOB_SAME_ERROR_PAUSE,
  checkBudget,
  classifyRunError,
  usageInputTokens,
  type JobBudget,
} from "./bulk.js";
import { startCompanyJob } from "./company.js";
import { cancelRun } from "./queue.js";
import { classifyCompany, createSectorRun } from "./sector-classify.js";
import { effectiveSectorPreflight, systemMemAvailableMB } from "./settings.js";

/**
 * Sector-preflight jobs (Stage 5.1 Step 3): one classification per company,
 * driven inline by this worker at the sector_preflight pool size. Mirrors
 * the bulk job controls: status/ETA, pause/resume/cancel, retry_failed,
 * budgets, and auto-pause on 3 same-class errors.
 */

const TERMINAL_ITEM = ["succeeded", "failed", "skipped", "cancelled"] as const;

/** Classifier launches hold below this much available RAM (MB). */
export const SECTOR_MEM_MIN_AVAILABLE_MB = 12 * 1024;

function checkMaxCompanies(maxCompanies: number | undefined): number | null {
  if (maxCompanies === undefined) return null;
  if (!Number.isInteger(maxCompanies) || maxCompanies < 1) {
    throw new DomainError("invalid_input", "maxCompanies must be a positive integer");
  }
  return maxCompanies;
}

export interface SectorPreflightStartInput {
  sectorId: string;
  /** Skip companies already classified for this sector (default true). */
  onlyPending?: boolean;
  maxCompanies?: number;
  /** Classify exactly these companies (must be sector members; default: all members). */
  companyIds?: string[];
  /**
   * Re-classify only companies whose stored classification is low
   * confidence (their site was unreadable or thin). Implies onlyPending false.
   */
  onlyLowConfidence?: boolean;
  budget?: JobBudget;
}

export async function startSectorPreflight(
  db: Db,
  input: SectorPreflightStartInput,
): Promise<{ jobId: string; companies: number }> {
  // No profile, no preflight (plain refusal, no fallback prompt).
  await resolveProfileForSector(db, input.sectorId);
  // No rubric, no preflight either (only legacy skincare may use defaults).
  await getRubric(db, input.sectorId);
  if (input.onlyLowConfidence && input.onlyPending === true) {
    throw new DomainError("invalid_input", "onlyLowConfidence re-classifies done companies; drop onlyPending");
  }
  const onlyPending = input.onlyLowConfidence ? false : (input.onlyPending ?? true);
  const members = await db
    .select({ companyId: sectorCompanies.companyId })
    .from(sectorCompanies)
    .innerJoin(companies, eq(companies.id, sectorCompanies.companyId))
    .where(eq(sectorCompanies.sectorId, input.sectorId))
    .orderBy(asc(companies.name));
  if (members.length === 0) {
    const [sector] = await db.select({ id: sectors.id }).from(sectors).where(eq(sectors.id, input.sectorId));
    if (!sector) throw new DomainError("not_found", `sector not found: ${input.sectorId}`);
  }
  const memberSet = new Set(members.map((m) => m.companyId));
  let companyIds = members.map((m) => m.companyId);
  if (input.companyIds !== undefined) {
    const outside = input.companyIds.filter((id) => !memberSet.has(id));
    if (outside.length > 0) throw new DomainError("invalid_input", `${outside.length} companies are not in this sector`);
    const wanted = new Set(input.companyIds);
    companyIds = companyIds.filter((id) => wanted.has(id));
  }
  if (input.onlyLowConfidence) {
    const low = await db
      .select({ companyId: sectorPreflight.companyId })
      .from(sectorPreflight)
      .where(and(eq(sectorPreflight.sectorId, input.sectorId), eq(sectorPreflight.confidence, "low")));
    const lowSet = new Set(low.map((r) => r.companyId));
    companyIds = companyIds.filter((id) => lowSet.has(id));
  }
  if (onlyPending) {
    const done = await db
      .select({ companyId: sectorPreflight.companyId })
      .from(sectorPreflight)
      .where(eq(sectorPreflight.sectorId, input.sectorId));
    const doneSet = new Set(done.map((r) => r.companyId));
    companyIds = companyIds.filter((id) => !doneSet.has(id));
  }
  const cap = checkMaxCompanies(input.maxCompanies);
  if (cap !== null) companyIds = companyIds.slice(0, cap);
  const { maxTokens, maxHours } = checkBudget(input.budget);
  const jobId = randomUUID();
  await db.insert(sectorPreflightJobs).values({
    id: jobId,
    sectorId: input.sectorId,
    onlyPending,
    maxCompanies: cap,
    maxInputTokens: maxTokens,
    maxHours,
  });
  for (let i = 0; i < companyIds.length; i += 500) {
    const chunk = companyIds.slice(i, i + 500);
    await db.insert(sectorPreflightItems).values(
      chunk.map((companyId, index) => ({ id: randomUUID(), jobId, companyId, position: i + index })),
    );
  }
  return { jobId, companies: companyIds.length };
}

export interface SectorStatusItemView {
  itemId: string;
  companyId: string;
  status: string;
  attempts: number;
  error: string | null;
}

export interface SectorStatusView {
  job: SectorPreflightJob;
  counts: Record<string, number>;
  activeRuns: { itemId: string; runId: string | null; companyId: string; startedAt: Date | null }[];
  tokens: { spent: number; max: number | null };
  avgMinutes: number | null;
  etaSeconds: number | null;
  quota: null;
  items: SectorStatusItemView[];
}

function etaSeconds(avgMs: number | null, remaining: number): number | null {
  if (avgMs === null || remaining === 0) return null;
  return Math.round((avgMs * remaining) / 1000);
}

export async function sectorPreflightStatus(db: Db, jobId: string): Promise<SectorStatusView> {
  const [job] = await db.select().from(sectorPreflightJobs).where(eq(sectorPreflightJobs.id, jobId));
  if (!job) throw new DomainError("not_found", `sector job not found: ${jobId}`);
  const items = await db
    .select()
    .from(sectorPreflightItems)
    .where(eq(sectorPreflightItems.jobId, jobId))
    .orderBy(asc(sectorPreflightItems.position), asc(sectorPreflightItems.id));
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
  const durations = items.map((i) => i.durationMs).filter((d): d is number => d !== null);
  const avgMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const remaining = items.filter((i) => !TERMINAL_ITEM.includes(i.status as (typeof TERMINAL_ITEM)[number])).length;
  return {
    job,
    counts,
    activeRuns: items
      .filter((i) => i.status === "running")
      .map((i) => ({ itemId: i.id, runId: i.runId, companyId: i.companyId, startedAt: i.startedAt })),
    tokens: { spent: job.inputTokensSpent, max: job.maxInputTokens },
    avgMinutes: avgMs === null ? null : Math.round((avgMs / 60000) * 10) / 10,
    etaSeconds: etaSeconds(avgMs, remaining),
    // Same as pipeline_status: app Muse exposes no subscription surface.
    quota: null,
    items: items.slice(0, 200).map((i) => ({
      itemId: i.id,
      companyId: i.companyId,
      status: i.status,
      attempts: i.attempts,
      error: i.error,
    })),
  };
}

export async function sectorPreflightList(db: Db, limit = 20): Promise<SectorPreflightJob[]> {
  return db
    .select()
    .from(sectorPreflightJobs)
    .orderBy(sql`${sectorPreflightJobs.createdAt} desc`)
    .limit(limit);
}

export async function sectorPreflightPause(db: Db, jobId: string, reason = "paused by operator"): Promise<SectorPreflightJob> {
  const [job] = await db
    .update(sectorPreflightJobs)
    .set({ status: "paused", pauseReason: reason.slice(0, 500) })
    .where(eq(sectorPreflightJobs.id, jobId))
    .returning();
  if (!job) throw new DomainError("not_found", `sector job not found: ${jobId}`);
  return job;
}

export async function sectorPreflightResume(db: Db, jobId: string): Promise<SectorPreflightJob> {
  const [job] = await db
    .update(sectorPreflightJobs)
    .set({ status: "running", pauseReason: null, errorStreak: 0, errorClass: null })
    .where(eq(sectorPreflightJobs.id, jobId))
    .returning();
  if (!job) throw new DomainError("not_found", `sector job not found: ${jobId}`);
  return job;
}

export async function sectorPreflightCancel(db: Db, jobId: string): Promise<SectorPreflightJob> {
  const [job] = await db.select().from(sectorPreflightJobs).where(eq(sectorPreflightJobs.id, jobId));
  if (!job) throw new DomainError("not_found", `sector job not found: ${jobId}`);
  if (job.status === "completed" || job.status === "cancelled") {
    throw new DomainError("invalid_input", `sector job is already ${job.status}`);
  }
  await db
    .update(sectorPreflightItems)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(and(eq(sectorPreflightItems.jobId, jobId), eq(sectorPreflightItems.status, "queued")));
  const running = await db
    .select()
    .from(sectorPreflightItems)
    .where(and(eq(sectorPreflightItems.jobId, jobId), eq(sectorPreflightItems.status, "running")));
  for (const item of running) {
    if (item.runId) await cancelRun(db, item.runId).catch(() => undefined);
    await db
      .update(sectorPreflightItems)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(eq(sectorPreflightItems.id, item.id));
  }
  const [cancelled] = await db
    .update(sectorPreflightJobs)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(eq(sectorPreflightJobs.id, jobId))
    .returning();
  if (!cancelled) throw new DomainError("not_found", `sector job not found: ${jobId}`);
  return cancelled;
}

export async function sectorPreflightRetryFailed(db: Db, jobId: string): Promise<{ job: SectorPreflightJob; retried: number }> {
  const [job] = await db.select().from(sectorPreflightJobs).where(eq(sectorPreflightJobs.id, jobId));
  if (!job) throw new DomainError("not_found", `sector job not found: ${jobId}`);
  const failed = await db
    .select()
    .from(sectorPreflightItems)
    .where(and(eq(sectorPreflightItems.jobId, jobId), eq(sectorPreflightItems.status, "failed")));
  for (const item of failed) {
    await db
      .update(sectorPreflightItems)
      .set({ status: "queued", error: null, errorClass: null, runId: null, startedAt: null, finishedAt: null, durationMs: null })
      .where(eq(sectorPreflightItems.id, item.id));
  }
  const [resumed] = await db
    .update(sectorPreflightJobs)
    .set({ status: "running", pauseReason: null, errorStreak: 0, errorClass: null, finishedAt: null })
    .where(eq(sectorPreflightJobs.id, jobId))
    .returning();
  if (!resumed) throw new DomainError("not_found", `sector job not found: ${jobId}`);
  return { job: resumed, retried: failed.length };
}

export interface SectorSummaryBucket {
  businessType: string;
  primaryCategory: string;
  eligibility: string;
  count: number;
  examples: { companyId: string; name: string | null; reason: string; quote: string | null }[];
}

export async function sectorPreflightSummary(db: Db, sectorId: string): Promise<{ sectorId: string; buckets: SectorSummaryBucket[] }> {
  const rows = await db
    .select({
      companyId: sectorPreflight.companyId,
      name: companies.name,
      businessType: sectorPreflight.businessType,
      primaryCategory: sectorPreflight.primaryCategory,
      reason: sectorPreflight.reason,
      quote: sectorPreflight.quote,
      eligibility: sectorCompanies.eligibility,
    })
    .from(sectorPreflight)
    .innerJoin(
      sectorCompanies,
      and(
        eq(sectorCompanies.sectorId, sectorPreflight.sectorId),
        eq(sectorCompanies.companyId, sectorPreflight.companyId),
      ),
    )
    .innerJoin(companies, eq(companies.id, sectorPreflight.companyId))
    .where(eq(sectorPreflight.sectorId, sectorId));
  const buckets = new Map<string, SectorSummaryBucket>();
  const ordered = [...rows].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  for (const row of ordered) {
    const key = `${row.businessType}|${row.primaryCategory}|${row.eligibility}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        businessType: row.businessType,
        primaryCategory: row.primaryCategory,
        eligibility: row.eligibility,
        count: 0,
        examples: [],
      };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.examples.length < 5) {
      bucket.examples.push({
        companyId: row.companyId,
        name: row.name,
        reason: row.reason,
        quote: row.quote ? row.quote.slice(0, 200) : null,
      });
    }
  }
  return { sectorId, buckets: [...buckets.values()].sort((a, b) => b.count - a.count) };
}

export interface SectorPreflightCompaniesInput {
  sectorId: string;
  eligibility?: ("eligible" | "review" | "ineligible")[];
  confidence?: ("high" | "medium" | "low")[];
  promptVersion?: string;
  companyIds?: string[];
  limit?: number;
  offset?: number;
}

export interface SectorPreflightCompanyRow {
  companyId: string;
  name: string | null;
  website: string | null;
  country: string | null;
  employees: number | null;
  eligibility: string;
  eligibilityReason: string | null;
  businessType: string;
  primaryCategory: string;
  sellsOwnProducts: boolean;
  hasOnlineStore: boolean;
  confidence: string;
  reason: string;
  quote: string | null;
  verification: string | null;
  promptVersion: string | null;
}

/** Per-company classifications for one sector, filtered, ordered by name. */
export async function sectorPreflightCompanies(
  db: Db,
  input: SectorPreflightCompaniesInput,
): Promise<{ total: number; rows: SectorPreflightCompanyRow[] }> {
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new DomainError("invalid_input", "limit must be 1..500");
  const offset = input.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) throw new DomainError("invalid_input", "offset must be >= 0");
  const filters = [eq(sectorPreflight.sectorId, input.sectorId)];
  if (input.eligibility?.length) filters.push(inArray(sectorCompanies.eligibility, input.eligibility));
  if (input.confidence?.length) filters.push(inArray(sectorPreflight.confidence, input.confidence));
  if (input.promptVersion) filters.push(eq(sectorPreflight.promptVersion, input.promptVersion));
  if (input.companyIds?.length) filters.push(inArray(sectorPreflight.companyId, input.companyIds));
  const where = and(...filters);
  const from = db
    .select({
      companyId: sectorPreflight.companyId,
      name: companies.name,
      website: companies.website,
      country: companies.country,
      employees: companies.employees,
      eligibility: sectorCompanies.eligibility,
      eligibilityReason: sectorCompanies.eligibilityReason,
      businessType: sectorPreflight.businessType,
      primaryCategory: sectorPreflight.primaryCategory,
      sellsOwnProducts: sectorPreflight.sellsOwnProducts,
      hasOnlineStore: sectorPreflight.hasOnlineStore,
      confidence: sectorPreflight.confidence,
      reason: sectorPreflight.reason,
      quote: sectorPreflight.quote,
      verification: sectorPreflight.verification,
      promptVersion: sectorPreflight.promptVersion,
    })
    .from(sectorPreflight)
    .innerJoin(
      sectorCompanies,
      and(
        eq(sectorCompanies.sectorId, sectorPreflight.sectorId),
        eq(sectorCompanies.companyId, sectorPreflight.companyId),
      ),
    )
    .innerJoin(companies, eq(companies.id, sectorPreflight.companyId));
  const [count] = await db
    .select({ n: sql<number>`count(*)` })
    .from(sectorPreflight)
    .innerJoin(
      sectorCompanies,
      and(
        eq(sectorCompanies.sectorId, sectorPreflight.sectorId),
        eq(sectorCompanies.companyId, sectorPreflight.companyId),
      ),
    )
    .where(where);
  const rows = await from.where(where).orderBy(asc(companies.name), asc(sectorPreflight.companyId)).limit(limit).offset(offset);
  return { total: Number(count?.n ?? 0), rows };
}

export interface SectorRunnerDeps {
  pollMs?: number;
  pool?: number;
  classify?: (input: { sectorId: string; companyId: string; runId: string }) => Promise<unknown>;
  /** Available RAM in MB (default: reads /proc/meminfo; null = unknown, proceed). */
  memAvailableMB?: () => number | null;
  /** Create the classify run row (default: createSectorRun). */
  createRun?: (db: Db, companyId: string) => Promise<string>;
}

export interface SectorRunner {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  tick: () => Promise<void>;
}

/** Launch the company pipeline, but only for eligible companies of the sector. */
export async function startPipeline(
  db: Db,
  sectorId: string,
  options: { categories?: string[] } = {},
): Promise<{ created: number; skipped: number; eligible: number }> {
  if (options.categories && options.categories.length > 0) {
    const profile = await resolveProfileForSector(db, sectorId);
    const valid = categoryKeys(profile);
    const unknown = options.categories.filter((c) => !valid.includes(c));
    if (unknown.length > 0) {
      throw new DomainError(
        "invalid_input",
        `unknown categories for this sector: ${unknown.join(", ")}; valid categories: ${valid.join(", ")}`,
      );
    }
  }
  const eligibleScope = and(eq(sectorCompanies.sectorId, sectorId), eq(sectorCompanies.eligibility, "eligible"));
  const members =
    options.categories && options.categories.length > 0
      ? await db
          .select({ companyId: sectorCompanies.companyId })
          .from(sectorCompanies)
          .innerJoin(
            sectorPreflight,
            and(
              eq(sectorPreflight.sectorId, sectorCompanies.sectorId),
              eq(sectorPreflight.companyId, sectorCompanies.companyId),
            ),
          )
          .where(and(eligibleScope, inArray(sectorPreflight.primaryCategory, options.categories)))
      : await db
          .select({ companyId: sectorCompanies.companyId })
          .from(sectorCompanies)
          .where(eligibleScope);
  // Terminal history (failed/terminated) gets a fresh job; anything
  // else (created, scheduled, running, paused, completed) is skipped.
  const existing = await db.select({ companyId: companyJobs.companyId, status: companyJobs.status }).from(companyJobs);
  const haveJob = new Set(
    existing.filter((r) => r.status !== "failed" && r.status !== "terminated").map((r) => r.companyId),
  );
  let created = 0;
  let skipped = 0;
  for (const member of members) {
    if (haveJob.has(member.companyId)) {
      skipped += 1;
      continue;
    }
    try {
      await startCompanyJob(db, { companyId: member.companyId, defer: true });
      created += 1;
      haveJob.add(member.companyId);
    } catch (err) {
      if (err instanceof DomainError && err.code === "conflict") {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }
  return { created, skipped, eligible: members.length };
}

export function createSectorRunner(db: Db, deps: SectorRunnerDeps): SectorRunner {
  const pollMs = deps.pollMs ?? 15_000;
  const drive = deps.classify ?? ((input) => classifyCompany(db, { sectorId: input.sectorId, companyId: input.companyId, runId: input.runId }));
  const actives = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  async function loadRun(runId: string): Promise<ResearchRun | null> {
    const [run] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId));
    return run ?? null;
  }

  async function spendTokens(jobId: string, spend: number): Promise<void> {
    if (spend <= 0) return;
    await db
      .update(sectorPreflightJobs)
      .set({ inputTokensSpent: sql`${sectorPreflightJobs.inputTokensSpent} + ${spend}` })
      .where(eq(sectorPreflightJobs.id, jobId));
  }

  async function loadJob(jobId: string): Promise<SectorPreflightJob> {
    const [job] = await db.select().from(sectorPreflightJobs).where(eq(sectorPreflightJobs.id, jobId));
    if (!job) throw new DomainError("not_found", `sector job not found: ${jobId}`);
    return job;
  }

  async function failItem(
    job: SectorPreflightJob,
    itemId: string,
    errorClass: string,
    error: string,
  ): Promise<SectorPreflightJob> {
    const finishedAt = new Date();
    const [item] = await db.select().from(sectorPreflightItems).where(eq(sectorPreflightItems.id, itemId));
    const durationMs = item?.startedAt ? Math.max(0, finishedAt.getTime() - item.startedAt.getTime()) : null;
    await db
      .update(sectorPreflightItems)
      .set({ status: "failed", error: error.slice(0, 500), errorClass, finishedAt, durationMs })
      .where(eq(sectorPreflightItems.id, itemId));
    const streak = job.errorClass === errorClass ? job.errorStreak + 1 : 1;
    const patch: Partial<SectorPreflightJob> = { errorStreak: streak, errorClass };
    if (streak >= JOB_SAME_ERROR_PAUSE && job.status === "running") {
      patch.status = "paused";
      patch.pauseReason = `${streak} consecutive ${errorClass} failures: ${error.slice(0, 300)}`;
    }
    return loadJobAfterPatch(job.id, patch);
  }

  async function loadJobAfterPatch(jobId: string, patch: Partial<SectorPreflightJob>): Promise<SectorPreflightJob> {
    await db.update(sectorPreflightJobs).set(patch).where(eq(sectorPreflightJobs.id, jobId));
    return loadJob(jobId);
  }

  async function finalizeItem(job: SectorPreflightJob, itemId: string, runId: string): Promise<SectorPreflightJob> {
    const run = await loadRun(runId);
    const [item] = await db.select().from(sectorPreflightItems).where(eq(sectorPreflightItems.id, itemId));
    if (!item || !run) return job;
    const finishedAt = new Date();
    const durationMs = item.startedAt ? Math.max(0, finishedAt.getTime() - item.startedAt.getTime()) : null;
    const spend = usageInputTokens(run);
    if (run.status !== "succeeded") {
      const { errorClass, error } = classifyRunError(run);
      await spendTokens(job.id, spend);
      return failItem(await loadJob(job.id), itemId, errorClass, error);
    }
    await db
      .update(sectorPreflightItems)
      .set({ status: "succeeded", finishedAt, durationMs })
      .where(eq(sectorPreflightItems.id, itemId));
    if (job.sectorId) await deriveCompany(db, job.sectorId, item.companyId);
    await spendTokens(job.id, spend);
    return loadJob(job.id);
  }

  async function launch(job: SectorPreflightJob, itemId: string, companyId: string): Promise<void> {
    if (!job.sectorId) return;
    const sectorId = job.sectorId;
    const runId = await (deps.createRun ?? createSectorRun)(db, companyId);
    await db
      .update(sectorPreflightItems)
      .set({ status: "running", runId, startedAt: new Date(), attempts: sql`${sectorPreflightItems.attempts} + 1` })
      .where(eq(sectorPreflightItems.id, itemId));
    await db
      .update(sectorPreflightJobs)
      .set({ startedRuns: sql`${sectorPreflightJobs.startedRuns} + 1` })
      .where(eq(sectorPreflightJobs.id, job.id));
    actives.add(itemId);
    void Promise.resolve()
      .then(() => drive({ sectorId, companyId, runId }))
      .catch(() => undefined)
      .finally(() => {
        actives.delete(itemId);
      });
  }

  async function budgetPause(job: SectorPreflightJob): Promise<SectorPreflightJob | null> {
    const [fresh] = await db
      .select({ inputTokensSpent: sectorPreflightJobs.inputTokensSpent })
      .from(sectorPreflightJobs)
      .where(eq(sectorPreflightJobs.id, job.id));
    if (job.maxInputTokens !== null && (fresh?.inputTokensSpent ?? 0) >= job.maxInputTokens) {
      return sectorPreflightPause(db, job.id, `budget: maxTokens ${job.maxInputTokens} reached`);
    }
    if (job.maxHours !== null && Date.now() - job.createdAt.getTime() >= job.maxHours * 3600_000) {
      return sectorPreflightPause(db, job.id, `budget: maxHours ${job.maxHours} reached`);
    }
    return null;
  }

  async function tickJob(job: SectorPreflightJob, feed: boolean): Promise<void> {
    const items = await db
      .select()
      .from(sectorPreflightItems)
      .where(eq(sectorPreflightItems.jobId, job.id))
      .orderBy(asc(sectorPreflightItems.position), asc(sectorPreflightItems.id));
    // Finalize landed runs (also under pause) and relaunch restart orphans.
    for (const item of items) {
      if (item.status !== "running" || actives.has(item.id)) continue;
      const [fresh] = await db.select().from(sectorPreflightItems).where(eq(sectorPreflightItems.id, item.id));
      if (!fresh || fresh.status !== "running") continue;
      if (!fresh.runId) {
        // A launch failure marks the item failed instead of stalling the tick:
        // one poison item must never starve the rest of the job.
        if (feed && job.sectorId) {
          try {
            await launch(job, fresh.id, fresh.companyId);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`sector job ${job.id} launch failed for item ${fresh.id}: ${message}`);
            job = await failItem(job, fresh.id, "failed", `launch: ${message}`);
          }
        }
        continue;
      }
      const run = await loadRun(fresh.runId);
      if (!run) {
        job = await failItem(job, fresh.id, "failed", "sector run is gone");
      } else if (run.status === "cancelled") {
        job = await failItem(job, fresh.id, "failed", "sector run was cancelled");
      } else if (run.status !== "running" && run.status !== "queued") {
        job = await finalizeItem(job, fresh.id, fresh.runId);
      } else if (feed) {
        // Running run with no in-flight drive: orphaned by a restart; relaunch.
        await db
          .update(researchRuns)
          .set({ status: "failed", error: "worker restarted", finishedAt: new Date() })
          .where(eq(researchRuns.id, fresh.runId));
        await db
          .update(sectorPreflightItems)
          .set({ status: "queued", runId: null, startedAt: null })
          .where(eq(sectorPreflightItems.id, fresh.id));
      }
      if (job.status !== "running") return;
    }
    const budgeted = await budgetPause(job);
    if (budgeted) job = budgeted;
    const open = await db
      .select({ n: sql<number>`count(*)` })
      .from(sectorPreflightItems)
      .where(
        and(
          eq(sectorPreflightItems.jobId, job.id),
          inArray(sectorPreflightItems.status, ["queued", "running"]),
        ),
      );
    if (Number(open[0]?.n ?? 0) === 0 && job.status === "running") {
      await db
        .update(sectorPreflightJobs)
        .set({ status: "completed", finishedAt: new Date() })
        .where(eq(sectorPreflightJobs.id, job.id));
      return;
    }
    if (!feed) return;
    const pool = await effectiveSectorPreflight(db, deps.pool);
    const queued = await db
      .select()
      .from(sectorPreflightItems)
      .where(and(eq(sectorPreflightItems.jobId, job.id), eq(sectorPreflightItems.status, "queued")))
      .orderBy(asc(sectorPreflightItems.position), asc(sectorPreflightItems.id));
    for (const item of queued) {
      if (actives.size >= pool) break;
      const [fresh] = await db.select().from(sectorPreflightJobs).where(eq(sectorPreflightJobs.id, job.id));
      if (!fresh || fresh.status !== "running" || !fresh.sectorId) break;
      const availableMB = (deps.memAvailableMB ?? systemMemAvailableMB)();
      if (availableMB !== null && availableMB < SECTOR_MEM_MIN_AVAILABLE_MB) {
        console.error(
          `sector job ${job.id} mem hold: ${availableMB} MB available (< ${SECTOR_MEM_MIN_AVAILABLE_MB}); waiting`,
        );
        await db
          .update(sectorPreflightJobs)
          .set({ memHolds: sql`${sectorPreflightJobs.memHolds} + 1` })
          .where(eq(sectorPreflightJobs.id, job.id));
        break;
      }
      try {
        await launch(fresh, item.id, item.companyId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`sector job ${job.id} launch failed for item ${item.id}: ${message}`);
        job = await failItem(fresh, item.id, "failed", `launch: ${message}`);
        if (job.status !== "running") break;
      }
    }
  }

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      const jobs = await db
        .select()
        .from(sectorPreflightJobs)
        .where(inArray(sectorPreflightJobs.status, ["running", "paused"]))
        .orderBy(asc(sectorPreflightJobs.createdAt));
      for (const job of jobs) {
        try {
          await tickJob(job, job.status === "running");
        } catch (err) {
          console.error(`sector job ${job.id} tick failed: ${err instanceof Error ? err.message : err}`);
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
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick,
  };
}
