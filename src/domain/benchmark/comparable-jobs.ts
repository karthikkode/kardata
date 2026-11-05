import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db, DbTx } from "../../db/client.js";
import { benchmarkComparableJobs, facts } from "../../db/schema.js";
import { DomainError } from "../errors.js";
import { addFacts } from "../research/facts.js";
import { eligibleCompanyIds } from "../ria-steps/status.js";
import { riaExtractorCall, riaProviderGate, withRiaProvider } from "../ria-steps/provider.js";
import { lockEvidence } from "../sec-adv/evidence.js";
import { activeMembers } from "../sec-adv/snapshot.js";
import { parseQuotaExhaustion } from "../quota/breaker.js";
import { COMPARABLE_REVIEW_COLLECTOR, COMPARABLE_REVIEW_KEY, COMPARABLE_REVIEW_VERSION,
  currentComparableFees, reviewComparable } from "./comparable-review.js";

type Job = typeof benchmarkComparableJobs.$inferSelect;
type Result = Awaited<ReturnType<typeof reviewComparable>>;
const DISPATCH = "benchmark:comparable-review-dispatch", LEASE_MS = 60_000;
const owned = (job: Job) => and(eq(benchmarkComparableJobs.id, job.id), eq(benchmarkComparableJobs.leaseId, job.leaseId!),
  sql`${benchmarkComparableJobs.leaseUntil} > now()`);

export async function comparableJobStatus(db: Db | DbTx, jobId: string, offset = 0, limit = 100) {
  const [job] = await db.select().from(benchmarkComparableJobs).where(eq(benchmarkComparableJobs.id, jobId));
  if (!job) throw new DomainError("not_found", "comparable review job does not exist");
  const values = Object.values(job.results) as { outcome: string; inputTokens?: number | null; outputTokens?: number | null; elapsedMs?: number }[];
  const counts: Record<string, number> = {};
  for (const value of values) counts[value.outcome] = (counts[value.outcome] ?? 0) + 1;
  return { jobId, sectorId: job.sectorId, version: job.version, status: job.status, reason: job.reason,
    selected: job.companyIds.length, finished: values.length, pending: job.companyIds.length - values.length,
    createdAt: job.createdAt, finishedAt: job.finishedAt, counts,
    tokens: { input: values.reduce((n, row) => n + (row.inputTokens ?? 0), 0), output: values.reduce((n, row) => n + (row.outputTokens ?? 0), 0) },
    results: job.companyIds.slice(offset, offset + limit).flatMap(companyId => job.results[companyId] ? [{ companyId, ...job.results[companyId] as object }] : []),
    nextOffset: offset + limit < job.companyIds.length ? offset + limit : null };
}

export async function enqueueComparableJob(db: Db, input: {
  sectorId: string; companyIds?: string[]; concurrency?: number; requestId?: string;
}) {
  const concurrency = input.concurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new DomainError("invalid_input", "concurrency must be 1..4");
  const active = new Set((await activeMembers(db, input.sectorId)).map(row => row.id));
  const selected = input.companyIds ?? (await eligibleCompanyIds(db, input.sectorId)).filter(id => active.has(id));
  if (new Set(selected).size !== selected.length || selected.some(id => !active.has(id))) throw new DomainError("invalid_input", "select distinct active sector companies");
  const fees = await currentComparableFees(db, selected);
  if (input.companyIds && fees.length !== selected.length) throw new DomainError("invalid_input", "each selected firm must have an exact comparable");
  const companyIds = fees.map(row => row.companyId).sort();
  return db.transaction(async tx => {
    await lockEvidence(tx, DISPATCH);
    if (input.requestId) {
      const [prior] = await tx.select().from(benchmarkComparableJobs).where(eq(benchmarkComparableJobs.id, input.requestId));
      if (prior) {
        if (prior.sectorId !== input.sectorId || prior.version !== COMPARABLE_REVIEW_VERSION || prior.concurrency !== concurrency ||
          (input.companyIds && prior.companyIds.join(",") !== [...input.companyIds].sort().join(","))) throw new DomainError("conflict", "requestId belongs to a different comparable review");
        if (prior.status === "paused") await tx.update(benchmarkComparableJobs).set({ status: "queued", reason: null }).where(eq(benchmarkComparableJobs.id, prior.id));
        return comparableJobStatus(tx, prior.id);
      }
    }
    if (!companyIds.length) throw new DomainError("invalid_input", "no exact comparable firms were selected");
    const [pending] = await tx.select().from(benchmarkComparableJobs).where(and(eq(benchmarkComparableJobs.sectorId, input.sectorId),
      eq(benchmarkComparableJobs.version, COMPARABLE_REVIEW_VERSION), eq(benchmarkComparableJobs.companyIds, companyIds),
      inArray(benchmarkComparableJobs.status, ["queued", "running", "paused"])));
    if (pending) return comparableJobStatus(tx, pending.id);
    const id = input.requestId ?? randomUUID();
    await tx.insert(benchmarkComparableJobs).values({ id, sectorId: input.sectorId, companyIds, concurrency, version: COMPARABLE_REVIEW_VERSION });
    return comparableJobStatus(tx, id);
  });
}

async function claim(db: Db) {
  return db.transaction(async tx => {
    await lockEvidence(tx, DISPATCH);
    const [running] = await tx.select().from(benchmarkComparableJobs).where(eq(benchmarkComparableJobs.status, "running")).orderBy(asc(benchmarkComparableJobs.createdAt)).limit(1).for("update");
    if (running?.leaseUntil && running.leaseUntil > new Date()) return null;
    const [queued] = running ? [] : await tx.select().from(benchmarkComparableJobs).where(eq(benchmarkComparableJobs.status, "queued")).orderBy(asc(benchmarkComparableJobs.createdAt)).limit(1).for("update");
    const next = running ?? queued;
    if (!next) return null;
    if (next.version !== COMPARABLE_REVIEW_VERSION) {
      await tx.update(benchmarkComparableJobs).set({ status: "failed", reason: "Comparable review version changed; enqueue a new review", leaseId: null,
        leaseUntil: null, finishedAt: new Date() }).where(eq(benchmarkComparableJobs.id, next.id));
      return null;
    }
    const [job] = await tx.update(benchmarkComparableJobs).set({ status: "running", reason: null,
      leaseId: randomUUID(), leaseUntil: new Date(Date.now() + LEASE_MS) }).where(eq(benchmarkComparableJobs.id, next.id)).returning();
    return job!;
  });
}

async function persist(db: Db, job: Job, companyId: string, result: Result | { error: string }) {
  await db.transaction(async tx => {
    const [lease] = await tx.select().from(benchmarkComparableJobs).where(owned(job)).for("update");
    if (!lease) throw new Error("comparable review lease expired");
    if (lease.results[companyId]) return;
    let metrics: Record<string, unknown>;
    if ("error" in result) metrics = { outcome: "error", reason: result.error };
    else {
      const review = result.review;
      const qualifiers = { review: COMPARABLE_REVIEW_VERSION, input: review.inputHash, fee_fact_id: review.feeFactId };
      const [existing] = await tx.select({ id: facts.id }).from(facts).where(and(eq(facts.companyId, companyId), eq(facts.key, COMPARABLE_REVIEW_KEY),
        eq(facts.createdBy, COMPARABLE_REVIEW_COLLECTOR), eq(facts.qualifiers, qualifiers)));
      let factId = existing?.id;
      if (!factId) {
        const [fee] = await tx.select({ runId: facts.runId }).from(facts).where(eq(facts.id, review.feeFactId));
        const [saved] = await addFacts(tx, { companyId, runId: result.runId ?? fee?.runId, createdBy: COMPARABLE_REVIEW_COLLECTOR,
          facts: [{ key: COMPARABLE_REVIEW_KEY, value: review, qualifiers, sourceIds: result.sourceIds, asOf: review.brochureDate ?? review.reviewedAt.slice(0, 10),
            confidence: review.outcome === "unclear" ? "low" : "high", note: review.reasons.join("; "),
            quote: review.scope.evidence?.quote, quoteSourceId: review.scope.evidence?.sourceId }] });
        if (!saved?.ok) throw Error(saved?.error ?? "comparable review fact not saved");
        factId = saved.id;
      }
      metrics = { outcome: review.outcome, factId, ...result };
    }
    await tx.update(benchmarkComparableJobs).set({ results: { ...lease.results, [companyId]: metrics } }).where(owned(job));
  });
}

export function createComparableReviewWorker(db: Db, dependencies: {
  review?: typeof reviewComparable; gate?: typeof riaProviderGate;
} = {}) {
  const review = dependencies.review ?? reviewComparable, gate = dependencies.gate ?? riaProviderGate;
  let timer: ReturnType<typeof setInterval> | undefined, active: Promise<void> | undefined, closed = false;
  async function run() {
    const job = await claim(db);
    if (!job) return;
    let alive = true;
    const heartbeat = setInterval(() => {
      const until = new Date(Date.now() + LEASE_MS);
      void db.update(benchmarkComparableJobs).set({ leaseUntil: until }).where(owned(job)).returning({ id: benchmarkComparableJobs.id })
        .then(rows => { alive = rows.length === 1; if (alive) job.leaseUntil = until; }).catch(() => { alive = false; });
    }, LEASE_MS / 4);
    heartbeat.unref();
    const finish = async (status: Job["status"], reason: string | null = null) => {
      await db.update(benchmarkComparableJobs).set({ status, reason, leaseId: null, leaseUntil: null,
        finishedAt: status === "completed" || status === "failed" ? new Date() : null }).where(owned(job));
    };
    try {
      const pending = job.companyIds.filter(id => !job.results[id]);
      for (let i = 0; i < pending.length && alive && !closed; i += job.concurrency) {
        const ids = pending.slice(i, i + job.concurrency);
        const fees = await currentComparableFees(db, ids);
        const pauses = await Promise.all(ids.map(async companyId => {
          const fee = fees.find(row => row.companyId === companyId);
          if (!fee) { await persist(db, job, companyId, { error: "Firm no longer has an exact comparable" }); return null; }
          const provider = await gate(db);
          if (!provider.available) return provider.reason ?? "provider unavailable";
          try {
            const result = await withRiaProvider(provider.provider, () => review(db, fee, riaExtractorCall(db)));
            if (alive && !closed) await persist(db, job, companyId, result);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // A quota/auth hold leaves this firm pending, without manufacturing a review.
            if (parseQuotaExhaustion(message).exhausted) return "provider_quota";
            const state = await gate(db);
            if (!state.available) return state.reason ?? message;
            if (alive && !closed) await persist(db, job, companyId, { error: message.slice(0, 500) });
          }
          return null;
        }));
        const pause = pauses.find(Boolean);
        if (pause) { await finish("paused", pause); return; }
      }
      if (alive) await finish(closed ? "queued" : "completed");
    } catch (error) {
      if (alive) await finish(closed ? "queued" : "failed", error instanceof Error ? error.message.slice(0, 500) : String(error));
    } finally { clearInterval(heartbeat); }
  }
  const tick = () => { if (closed) return Promise.resolve(); if (!active) active = run().finally(() => { active = undefined; }); return active; };
  return { tick, start() { if (timer) return; closed = false; const background = () => { void tick().catch(() => {}); };
    timer = setInterval(background, 2000); timer.unref(); background(); }, stop() { closed = true; clearInterval(timer); timer = undefined; } };
}
