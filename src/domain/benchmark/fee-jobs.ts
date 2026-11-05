import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db, DbTx } from "../../db/client.js";
import { benchmarkFeeJobResults, benchmarkFeeJobs, riaStepRuns, sectorCompanies } from "../../db/schema.js";
import { DomainError } from "../errors.js";
import { eligibleCompanyIds } from "../ria-steps/status.js";
import { lockEvidence } from "../sec-adv/evidence.js";
import { activeMembers } from "../sec-adv/snapshot.js";
import { feePilotSummary, runBenchmarkFeeWave, type FeeMetrics } from "./fees.js";

type Job = typeof benchmarkFeeJobs.$inferSelect;
type Wave = typeof runBenchmarkFeeWave;

const DISPATCH_LOCK = "benchmark:fee-job-dispatch";
const LEASE_MS = 60_000;
const leaseUntil = () => new Date(Date.now() + LEASE_MS);
const owned = (job: Job) => and(eq(benchmarkFeeJobs.id, job.id), eq(benchmarkFeeJobs.leaseId, job.leaseId!),
  sql`${benchmarkFeeJobs.leaseUntil} > now()`);
async function byCompany(db: Db | DbTx, job: Job) {
  const rows = await db.select().from(benchmarkFeeJobResults).where(eq(benchmarkFeeJobResults.jobId, job.id));
  return Object.assign({}, job.results, Object.fromEntries(rows.map(row => [row.companyId, row.metrics]))) as Record<string, FeeMetrics>;
}

function elapsed(job: Job, now = new Date()) {
  if (!job.activeSince) return job.elapsedMs;
  const end = Math.min(now.getTime(), job.leaseUntil?.getTime() ?? now.getTime());
  return job.elapsedMs + Math.max(0, end - job.activeSince.getTime());
}

async function jobView(db: Db | DbTx, job: Job, offset = 0, limit = 100) {
  const saved = await byCompany(db, job);
  const results = job.companyIds.flatMap(id => saved[id] ? [saved[id]] : []);
  const elapsedMs = elapsed(job);
  const finished = results.filter(row => row.outcome !== "interrupted").length;
  const summary = feePilotSummary(results, job.cohortSize, elapsedMs);
  const measured = results.filter(row => row.outcome !== "interrupted" && row.outcome !== "cached");
  const totalInputTokens = measured.reduce((total, row) => total + (row.inputTokens ?? 0), 0);
  const totalOutputTokens = measured.reduce((total, row) => total + (row.outputTokens ?? 0), 0);
  return {
    jobId: job.id, sectorId: job.sectorId, status: job.status, reason: job.reason,
    createdAt: job.createdAt, finishedAt: job.finishedAt, elapsedMs,
    selected: job.companyIds.length, eligibleSelected: job.eligibleSelected, cohortSize: job.cohortSize,
    concurrency: job.concurrency, fullRun: job.fullRun, priorityCompanyIds: job.priorityCompanyIds, finished, pending: job.companyIds.length - finished,
    results: job.fullRun
      ? job.companyIds.slice(offset, offset + limit).flatMap(id => saved[id] ? [saved[id]] : [])
      : results.slice(offset, offset + limit),
    nextOffset: offset + limit < (job.fullRun ? job.companyIds.length : results.length) ? offset + limit : null,
    summary: { ...summary, totalInputTokens, totalOutputTokens,
      meanInputTokens: measured.length ? totalInputTokens / measured.length : null,
      projected: job.eligibleSelected === job.companyIds.length ? summary.projected : null },
  };
}

async function findJob(db: Db | DbTx, id: string) {
  const [job] = await db.select().from(benchmarkFeeJobs).where(eq(benchmarkFeeJobs.id, id));
  return job;
}

export async function benchmarkFeeJobStatus(db: Db, id: string, offset?: number, limit?: number) {
  const job = await findJob(db, id);
  if (!job) throw new DomainError("not_found", "benchmark fee job does not exist");
  return jobView(db, job, offset, limit);
}

export async function enqueueBenchmarkFeeJob(db: Db, input: {
  sectorId: string; companyIds?: string[]; fullRun?: true; priorityCompanyIds?: string[];
  pilot?: true; concurrency?: number; requestId?: string;
}) {
  const fullRun = input.fullRun === true;
  const priorityCompanyIds = input.priorityCompanyIds?.map(id => id.toLowerCase()) ?? [];
  const prioritySet = new Set(priorityCompanyIds);
  if (!fullRun && input.priorityCompanyIds) throw new DomainError("invalid_input", "priorityCompanyIds requires fullRun");
  if (prioritySet.size !== priorityCompanyIds.length) throw new DomainError("invalid_input", "priorityCompanyIds must be distinct");
  const pilotIds = [...new Set(input.companyIds ?? [])].sort();
  if (fullRun && (input.companyIds || input.pilot)) {
    throw new DomainError("invalid_input", "fullRun cannot be combined with companyIds or pilot");
  }
  if (!fullRun && (pilotIds.length < 20 || pilotIds.length > 30 || pilotIds.length !== input.companyIds?.length)) {
    throw new DomainError("invalid_input", "select 20–30 distinct firms for a pilot, or explicitly set fullRun: true");
  }
  const concurrency = input.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new DomainError("invalid_input", "concurrency must be between 1 and 16");
  }
  const [cohort, eligible] = await Promise.all([activeMembers(db, input.sectorId), eligibleCompanyIds(db, input.sectorId)]);
  const active = new Set(cohort.map(row => row.id));
  const eligibleSet = new Set(eligible.filter(id => active.has(id)));
  const companyIds = fullRun ? [...priorityCompanyIds, ...[...eligibleSet].filter(id => !prioritySet.has(id)).sort()] : pilotIds;
  return db.transaction(async tx => {
    await lockEvidence(tx, DISPATCH_LOCK);
    const previous = input.requestId ? await findJob(tx, input.requestId) : undefined;
    if (previous) {
      if (previous.sectorId !== input.sectorId || previous.concurrency !== concurrency || previous.fullRun !== fullRun ||
        (fullRun ? previous.priorityCompanyIds.join(",") !== priorityCompanyIds.join(",") : previous.companyIds.join(",") !== companyIds.join(","))) {
        throw new DomainError("conflict", "fee job requestId already belongs to a different fee job");
      }
      return jobView(tx, previous);
    }
    if (priorityCompanyIds.some(id => !eligibleSet.has(id))) {
      throw new DomainError("invalid_input", "priority companies must be active eligible sector members");
    }
    if (!companyIds.length) throw new DomainError("invalid_input", "the sector has no active eligible firms");
    if (companyIds.some(id => !active.has(id))) {
      throw new DomainError("invalid_input", "selected companies must be active sector members");
    }
    const [queued] = await tx.select().from(benchmarkFeeJobs).where(and(
      eq(benchmarkFeeJobs.sectorId, input.sectorId),
      fullRun ? eq(benchmarkFeeJobs.fullRun, true) : and(eq(benchmarkFeeJobs.fullRun, false), eq(benchmarkFeeJobs.concurrency, concurrency)),
      inArray(benchmarkFeeJobs.status, ["queued", "running", "paused"]),
      fullRun ? undefined : eq(benchmarkFeeJobs.companyIds, companyIds),
    )).orderBy(asc(benchmarkFeeJobs.createdAt)).limit(1);
    if (queued && (fullRun || !input.requestId)) {
      if (fullRun && input.priorityCompanyIds && queued.priorityCompanyIds.join(",") !== priorityCompanyIds.join(",")) {
        throw new DomainError("conflict", "an unfinished full fee job has a different priority list");
      }
      return jobView(tx, queued);
    }
    const [job] = await tx.insert(benchmarkFeeJobs).values({
      id: input.requestId ?? randomUUID(), sectorId: input.sectorId, companyIds, concurrency, fullRun, priorityCompanyIds,
      eligibleSelected: companyIds.filter(id => eligibleSet.has(id)).length, cohortSize: eligibleSet.size,
    }).returning();
    return jobView(tx, job!);
  });
}

export async function resumeBenchmarkFeeJob(db: Db, id: string) {
  const [job] = await db.update(benchmarkFeeJobs).set({ status: "queued", reason: null, finishedAt: null }).where(and(
    eq(benchmarkFeeJobs.id, id), inArray(benchmarkFeeJobs.status, ["paused", "failed"]),
    sql`${benchmarkFeeJobs.reason} IS DISTINCT FROM 'retry_threshold'`,
  )).returning();
  if (job) return jobView(db, job);
  const current = await benchmarkFeeJobStatus(db, id);
  if (current.status === "queued" || current.status === "running") return current;
  throw new DomainError("conflict", "fee job cannot be resumed from its current state");
}

async function claim(db: Db) {
  return db.transaction(async tx => {
    await lockEvidence(tx, DISPATCH_LOCK);
    const [running] = await tx.select().from(benchmarkFeeJobs).where(eq(benchmarkFeeJobs.status, "running"))
      .orderBy(asc(benchmarkFeeJobs.createdAt)).limit(1).for("update");
    const now = new Date();
    if (running?.leaseUntil && running.leaseUntil > now) return null;
    const [queued] = running ? [] : await tx.select().from(benchmarkFeeJobs)
      .where(eq(benchmarkFeeJobs.status, "queued")).orderBy(asc(benchmarkFeeJobs.createdAt)).limit(1).for("update");
    const next = running ?? queued;
    if (!next) return null;
    const [job] = await tx.update(benchmarkFeeJobs).set({
      status: "running", reason: null, leaseId: randomUUID(), leaseUntil: leaseUntil(),
      activeSince: now, elapsedMs: elapsed(next, now),
    }).where(eq(benchmarkFeeJobs.id, next.id)).returning();
    return job ?? null;
  });
}

function accumulate(previous: FeeMetrics | undefined, result: FeeMetrics): FeeMetrics {
  if (previous?.outcome !== "interrupted") return result;
  const sum = (a: number | null, b: number | null) => a === null && b === null ? null : (a ?? 0) + (b ?? 0);
  return {
    ...result, attempts: previous.attempts + result.attempts, retries: previous.retries + result.retries,
    unmeteredAttempts: previous.unmeteredAttempts + result.unmeteredAttempts, elapsedMs: previous.elapsedMs + result.elapsedMs,
    inputTokens: sum(previous.inputTokens, result.inputTokens), outputTokens: sum(previous.outputTokens, result.outputTokens),
    groundingRejections: previous.groundingRejections || result.groundingRejections
      ? [...previous.groundingRejections ?? [], ...result.groundingRejections ?? []] : undefined,
    models: [...new Set([...(previous.models ?? []), ...(result.models ?? [])])],
  };
}

async function persistResult(db: Db, job: Job, result: FeeMetrics) {
  await db.transaction(async tx => {
    const [lease] = await tx.select({ id: benchmarkFeeJobs.id }).from(benchmarkFeeJobs).where(owned(job)).for("update");
    if (!lease) throw new Error("benchmark fee job lease expired");
    const metrics = { ...result };
    await tx.insert(benchmarkFeeJobResults).values({ jobId: job.id, companyId: result.companyId, metrics })
      .onConflictDoUpdate({ target: [benchmarkFeeJobResults.jobId, benchmarkFeeJobResults.companyId], set: { metrics } });
  });
}

export function createBenchmarkFeeWorker(db: Db, runWave: Wave = runBenchmarkFeeWave) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let active: Promise<void> | undefined;
  let closed = false;
  async function run() {
    const job = await claim(db);
    if (!job) return;
    let leaseAlive = true;
    let renewing = false;
    const heartbeat = setInterval(() => {
      if (renewing || !leaseAlive) return;
      renewing = true;
      const next = leaseUntil();
      void db.update(benchmarkFeeJobs).set({ leaseUntil: next }).where(owned(job)).returning({ id: benchmarkFeeJobs.id })
        .then(rows => {
          leaseAlive = rows.length === 1;
          if (leaseAlive) job.leaseUntil = next;
        }).catch(() => { leaseAlive = false; }).finally(() => { renewing = false; });
    }, LEASE_MS / 4);
    heartbeat.unref();
    const shouldContinue = () => !closed && leaseAlive && job.leaseUntil! > new Date();
    const finish = async (status: Job["status"], reason?: string) => {
      await db.update(benchmarkFeeJobs).set({
        status, reason: reason ?? null, elapsedMs: elapsed(job), activeSince: null,
        leaseId: null, leaseUntil: null, finishedAt: status === "completed" || status === "failed" ? new Date() : null,
      }).where(owned(job));
    };
    try {
      const results = await byCompany(db, job);
      const onResult = async (row: FeeMetrics) => {
        const result = accumulate(results[row.companyId], row);
        await persistResult(db, job, result);
        results[row.companyId] = result;
      };
      // The step status and its attempt telemetry commit together before the
      // job result. Recover this narrow crash window without a model reread.
      const savedSteps = await db.select({ companyId: riaStepRuns.companyId, telemetry: riaStepRuns.telemetry })
        .from(riaStepRuns).where(and(eq(riaStepRuns.sectorId, job.sectorId), eq(riaStepRuns.step, "fee_schedule"),
          inArray(riaStepRuns.companyId, job.companyIds), sql`${riaStepRuns.telemetry}->>'feeJobId' = ${job.id}`));
      for (const row of savedSteps) {
        const checkpoint = row.telemetry as (FeeMetrics & { feeJobId: string }) | null;
        if (!checkpoint || checkpoint.outcome === "interrupted" || (results[row.companyId] && results[row.companyId].outcome !== "interrupted")) continue;
        const { feeJobId: _feeJobId, ...result } = checkpoint;
        void _feeJobId;
        await onResult(result);
      }
      for (let i = 0; i < job.companyIds.length && shouldContinue();) {
        const end = i < job.priorityCompanyIds.length
          ? Math.min(i + job.concurrency, job.priorityCompanyIds.length) : i + job.concurrency;
        const ids = job.companyIds.slice(i, end)
          .filter(id => !results[id] || results[id].outcome === "interrupted");
        i = end;
        if (!ids.length) continue;
        const members = await db.select({ id: sectorCompanies.companyId }).from(sectorCompanies).where(and(
          eq(sectorCompanies.sectorId, job.sectorId), inArray(sectorCompanies.companyId, ids), isNull(sectorCompanies.removedAt),
          job.fullRun ? eq(sectorCompanies.eligibility, "eligible") : undefined));
        const activeMembersNow = new Set(members.map(row => row.id));
        const stillActive = ids.filter(id => activeMembersNow.has(id));
        for (const id of ids.filter(id => !activeMembersNow.has(id))) {
          await onResult({ companyId: id, outcome: "gap", reason: job.fullRun ? "company no longer active and eligible" : "company no longer in the active sector",
            attempts: 0, retries: 0, unmeteredAttempts: 0, elapsedMs: 0, inputTokens: null, outputTokens: null });
        }
        const stopped = stillActive.length ? await runWave(db, { jobId: job.id, sectorId: job.sectorId, companyIds: stillActive, shouldContinue, onResult }) : null;
        if (closed) break;
        if (!job.fullRun && feePilotSummary(Object.values(results), job.cohortSize, elapsed(job)).meanRetries > 1) {
          await finish("paused", "retry_threshold"); return;
        }
        if (stopped) { await finish("paused", stopped); return; }
      }
      if (closed) await finish("queued");
      else if (shouldContinue()) await finish("completed");
    } catch (error) {
      if (!closed && leaseAlive) {
        const message = error instanceof Error ? error.message : String(error);
        await finish("failed", message.slice(0, 300));
      }
    } finally {
      clearInterval(heartbeat);
    }
  }
  const tick = () => {
    if (closed) return Promise.resolve();
    if (!active) active = run().finally(() => { active = undefined; });
    return active;
  };
  const backgroundTick = () => {
    void tick().catch(error => console.error("benchmark fee worker:", error instanceof Error ? error.message : String(error)));
  };
  return {
    tick,
    start() {
      if (timer) return;
      closed = false;
      timer = setInterval(backgroundTick, 2_000);
      timer.unref();
      backgroundTick();
    },
    stop() {
      closed = true;
      clearInterval(timer);
      timer = undefined;
    },
  };
}
