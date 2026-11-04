import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db, DbTx } from "../../db/client.js";
import { benchmarkFeeJobs, riaStepRuns } from "../../db/schema.js";
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
const byCompany = (job: Job) => job.results as Record<string, FeeMetrics>;

function elapsed(job: Job, now = new Date()) {
  if (!job.activeSince) return job.elapsedMs;
  const end = Math.min(now.getTime(), job.leaseUntil?.getTime() ?? now.getTime());
  return job.elapsedMs + Math.max(0, end - job.activeSince.getTime());
}

function jobView(job: Job) {
  const saved = byCompany(job);
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
    concurrency: job.concurrency, finished, pending: job.companyIds.length - finished, results,
    summary: { ...summary, totalInputTokens, totalOutputTokens,
      meanInputTokens: measured.length ? totalInputTokens / measured.length : null,
      projected: job.eligibleSelected === job.companyIds.length ? summary.projected : null },
  };
}

async function findJob(db: Db | DbTx, id: string) {
  const [job] = await db.select().from(benchmarkFeeJobs).where(eq(benchmarkFeeJobs.id, id));
  return job;
}

export async function benchmarkFeeJobStatus(db: Db, id: string) {
  const job = await findJob(db, id);
  if (!job) throw new DomainError("not_found", "benchmark fee job does not exist");
  return jobView(job);
}

export async function enqueueBenchmarkFeeJob(db: Db, input: {
  sectorId: string; companyIds: string[]; concurrency?: number; requestId?: string;
}) {
  const companyIds = [...new Set(input.companyIds)].sort();
  if (companyIds.length < 20 || companyIds.length > 30 || companyIds.length !== input.companyIds.length) {
    throw new DomainError("invalid_input", "select 20–30 distinct firms for a pilot");
  }
  const concurrency = input.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new DomainError("invalid_input", "concurrency must be between 1 and 16");
  }
  const [cohort, eligible] = await Promise.all([activeMembers(db, input.sectorId), eligibleCompanyIds(db, input.sectorId)]);
  const active = new Set(cohort.map(row => row.id));
  const eligibleSet = new Set(eligible.filter(id => active.has(id)));
  return db.transaction(async tx => {
    await lockEvidence(tx, DISPATCH_LOCK);
    const previous = input.requestId ? await findJob(tx, input.requestId) : undefined;
    if (previous) {
      if (previous.sectorId !== input.sectorId || previous.concurrency !== concurrency ||
        previous.companyIds.join(",") !== companyIds.join(",")) {
        throw new DomainError("conflict", "fee job requestId already belongs to a different pilot");
      }
      return jobView(previous);
    }
    if (companyIds.some(id => !active.has(id))) {
      throw new DomainError("invalid_input", "selected companies must be active sector members");
    }
    const [queued] = await tx.select().from(benchmarkFeeJobs).where(and(
      eq(benchmarkFeeJobs.sectorId, input.sectorId),
      eq(benchmarkFeeJobs.concurrency, concurrency),
      inArray(benchmarkFeeJobs.status, ["queued", "running", "paused"]),
      eq(benchmarkFeeJobs.companyIds, companyIds),
    )).orderBy(asc(benchmarkFeeJobs.createdAt)).limit(1);
    if (queued && !input.requestId) return jobView(queued);
    const [job] = await tx.insert(benchmarkFeeJobs).values({
      id: input.requestId ?? randomUUID(), sectorId: input.sectorId, companyIds, concurrency,
      eligibleSelected: companyIds.filter(id => eligibleSet.has(id)).length, cohortSize: eligibleSet.size,
    }).returning();
    return jobView(job!);
  });
}

export async function resumeBenchmarkFeeJob(db: Db, id: string) {
  const [job] = await db.update(benchmarkFeeJobs).set({ status: "queued", reason: null, finishedAt: null }).where(and(
    eq(benchmarkFeeJobs.id, id), inArray(benchmarkFeeJobs.status, ["paused", "failed"]),
    sql`${benchmarkFeeJobs.reason} IS DISTINCT FROM 'retry_threshold'`,
  )).returning();
  if (job) return jobView(job);
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
    models: [...new Set([...(previous.models ?? []), ...(result.models ?? [])])],
  };
}

async function persistResult(db: Db, job: Job, result: FeeMetrics) {
  const [updated] = await db.update(benchmarkFeeJobs).set({
    results: sql`${benchmarkFeeJobs.results} || ${JSON.stringify({ [result.companyId]: result })}::jsonb`,
  }).where(owned(job)).returning({ id: benchmarkFeeJobs.id });
  if (!updated) throw new Error("benchmark fee job lease expired");
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
    const results = byCompany(job);
    const onResult = async (row: FeeMetrics) => {
      const result = accumulate(results[row.companyId], row);
      await persistResult(db, job, result);
      results[row.companyId] = result;
    };
    try {
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
      for (let i = 0; i < job.companyIds.length && shouldContinue(); i += job.concurrency) {
        const ids = job.companyIds.slice(i, i + job.concurrency)
          .filter(id => !results[id] || results[id].outcome === "interrupted");
        if (!ids.length) continue;
        const activeMembersNow = new Set((await activeMembers(db, job.sectorId)).map(row => row.id));
        const stillActive = ids.filter(id => activeMembersNow.has(id));
        for (const id of ids.filter(id => !activeMembersNow.has(id))) {
          await onResult({ companyId: id, outcome: "gap", reason: "company no longer in the active sector",
            attempts: 0, retries: 0, unmeteredAttempts: 0, elapsedMs: 0, inputTokens: null, outputTokens: null });
        }
        const stopped = stillActive.length ? await runWave(db, { jobId: job.id, sectorId: job.sectorId, companyIds: stillActive, shouldContinue, onResult }) : null;
        if (closed) break;
        const summary = feePilotSummary(Object.values(results), job.cohortSize, elapsed(job));
        if (summary.meanRetries > 1) { await finish("paused", "retry_threshold"); return; }
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
