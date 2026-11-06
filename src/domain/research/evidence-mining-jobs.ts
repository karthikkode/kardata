import { createHash, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db, DbTx } from "../../db/client.js";
import { blobs, companies, documents, evidenceMiningJobs, harnessSettings, records, sources } from "../../db/schema.js";
import { codexHasCapacity } from "../../harness/codex-status.js";
import { dockerCodexExtractorCall, CodexCallError } from "../../harness/codex-extract.js";
import { withCodexReasoning } from "../../harness/codex-config.js";
import { pdfPageText } from "../../lib/sec/pdf-text.js";
import type { ExtractorCall } from "../../runs/extract.js";
import { DomainError } from "../errors.js";
import { codexSnapshot } from "../ria-steps/provider.js";
import { lockEvidence } from "../sec-adv/evidence.js";
import { blobText } from "./reads.js";
import { upsertRecords } from "./records.js";
import { EVIDENCE_MINING_TYPE, EVIDENCE_MINING_VERSION, mineSource, type MiningSource, type MiningTheme } from "./evidence-mining.js";

type Job = typeof evidenceMiningJobs.$inferSelect;
const DISPATCH = "source-mining:dispatch", LEASE_MS = 90_000;
const owned = (j: Job) => and(eq(evidenceMiningJobs.id, j.id), eq(evidenceMiningJobs.leaseId, j.leaseId!), sql`${evidenceMiningJobs.leaseUntil} > now()`);
export class MiningPause extends Error {}

/** Codex only, fail closed, and never write provider mode/hold or either breaker. */
export async function miningCapacity(db: Db) {
  const [hold] = await db.select().from(harnessSettings).where(eq(harnessSettings.key, "ria_codex_hold"));
  if ((hold?.value as { kind?: unknown } | undefined)?.kind) throw new MiningPause("codex provider hold; no hold was cleared");
  const snapshot = await codexSnapshot(db, true);
  if (!snapshot || !codexHasCapacity(snapshot)) throw new MiningPause(`codex unavailable: ${snapshot?.error ?? "usage unavailable"}`);
  const weekly = [snapshot.primary, snapshot.secondary].find(w => w && w.windowMinutes >= 10080);
  if (!weekly) throw new MiningPause("codex weekly usage unavailable");
  if (weekly.usedPercent >= 85) throw new MiningPause(`codex weekly use ${weekly.usedPercent}% reached 85%; reset ${weekly.resetsAt}`);
  return { weeklyUsedPercent: weekly.usedPercent, resetsAt: weekly.resetsAt };
}

export async function evidenceMiningStatus(db: Db | DbTx, jobId: string, offset = 0, limit = 50, includeEvidence = false) {
  const [job] = await db.select().from(evidenceMiningJobs).where(eq(evidenceMiningJobs.id, jobId));
  if (!job) throw new DomainError("not_found", "source mining job does not exist");
  const counts: Record<string, number> = {}, rows = Object.values(job.results);
  for (const row of rows) counts[String(row.outcome)] = (counts[String(row.outcome)] ?? 0) + 1;
  const ids = job.documentIds.slice(offset, offset + limit);
  const recordIds = ids.flatMap(id => typeof job.results[id]?.recordId === "string" ? [job.results[id]!.recordId as string] : []);
  const items = includeEvidence && recordIds.length ? await db.select().from(records).where(and(eq(records.companyId, job.companyId), inArray(records.id, recordIds))) : [];
  return { jobId, companyId: job.companyId, version: job.version, provider: "codex", reasoning: "high", status: job.status, reason: job.reason,
    selected: job.documentIds.length, finished: rows.length, pending: job.documentIds.length - rows.length, counts,
    createdAt: job.createdAt, finishedAt: job.finishedAt,
    tokens: { input: rows.reduce((n, r) => n + Number(r.inputTokens ?? 0), 0), output: rows.reduce((n, r) => n + Number(r.outputTokens ?? 0), 0) },
    results: ids.map(documentId => { const r = job.results[documentId]; return { documentId, ...(r ?? { outcome: "pending", reason: job.reason }),
      ...(includeEvidence && r?.recordId ? { item: items.find(item => item.id === r.recordId)?.data ?? null } : {}) }; }),
    nextOffset: offset + limit < job.documentIds.length ? offset + limit : null };
}

export async function enqueueEvidenceMining(db: Db, input: { companyId: string; documentIds: string[]; themes: MiningTheme[];
  concurrency?: number; metadataType?: string; researchContext?: string; requestId?: string; resume?: boolean }) {
  const concurrency = input.concurrency ?? 2, ids = [...input.documentIds].sort();
  if (!ids.length || ids.length > 2000 || new Set(ids).size !== ids.length) throw new DomainError("invalid_input", "select 1..2000 distinct stored documents");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new DomainError("invalid_input", "concurrency must be 1..4");
  if (!input.themes.length || new Set(input.themes.map(t => t.key)).size !== input.themes.length) throw new DomainError("invalid_input", "select distinct theme keys");
  if (input.resume) {
    if (!input.requestId) throw new DomainError("invalid_input", "resume requires the original requestId");
    await miningCapacity(db);
  }
  const [company] = await db.select().from(companies).where(eq(companies.id, input.companyId));
  if (!company?.evidenceLibrary) throw new DomainError("invalid_input", "select the internal evidence library");
  const docs = await db.select().from(documents).where(and(eq(documents.companyId, input.companyId), inArray(documents.id, ids), eq(documents.isCurrent, true)));
  if (docs.length !== ids.length) throw new DomainError("invalid_input", "every document must be current and belong to this library");
  const settings = { themes: input.themes, ...(input.metadataType ? { metadataType: input.metadataType } : {}),
    ...(input.researchContext ? { researchContext: input.researchContext } : {}) };
  return db.transaction(async tx => {
    await lockEvidence(tx, DISPATCH);
    if (input.requestId) {
      const [prior] = await tx.select().from(evidenceMiningJobs).where(eq(evidenceMiningJobs.id, input.requestId));
      if (prior) {
        if (prior.companyId !== input.companyId || prior.version !== EVIDENCE_MINING_VERSION || prior.concurrency !== concurrency ||
          prior.documentIds.join() !== ids.join() || !isDeepStrictEqual(prior.settings, settings)) throw new DomainError("conflict", "requestId belongs to a different source mining job");
        // A repeat never resumes implicitly. Explicit resume still checks the
        // real85% guard and cannot clear any provider/auth/quota hold.
        if (input.resume && prior.status === "paused") await tx.update(evidenceMiningJobs).set({ status: "queued", reason: null }).where(eq(evidenceMiningJobs.id, prior.id));
        return evidenceMiningStatus(tx, prior.id);
      }
    }
    const id = input.requestId ?? randomUUID();
    await tx.insert(evidenceMiningJobs).values({ id, companyId: input.companyId, documentIds: ids, settings, concurrency, version: EVIDENCE_MINING_VERSION });
    return evidenceMiningStatus(tx, id);
  });
}

async function loadInput(db: Db, job: Job, documentId: string) {
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.companyId, job.companyId), eq(documents.isCurrent, true)));
  if (!doc) throw Error("stored document changed or is no longer current");
  if (!doc.sourceIds.length) throw Error("document has no stored source");
  const sourceRows = await db.select().from(sources).where(inArray(sources.id, doc.sourceIds));
  const material: MiningSource[] = [], gaps: string[] = [];
  for (const id of doc.sourceIds) {
    const source = sourceRows.find(s => s.id === id);
    if (!source || source.companyId !== job.companyId) throw Error("source belongs to another company or is missing");
    if (!source.blobSha256) { gaps.push(`source ${id} has no stored text`); continue; }
    const [blob] = await db.select().from(blobs).where(eq(blobs.sha256, source.blobSha256));
    if (!blob) { gaps.push(`source ${id} blob missing`); continue; }
    const body = gunzipSync(blob.gzip), url = source.finalUrl ?? source.url;
    if (body.subarray(0, 5).toString() === "%PDF-") {
      const first = await pdfPageText(body, 1);
      if (first.totalPages > 120) throw Error("PDF exceeds 120 physical pages; no default excerpt was silently substituted");
      for (let page = 1; page <= first.totalPages; page++) {
        const text = page === 1 ? first.text : (await pdfPageText(body, page)).text;
        if (!text.trim()) { gaps.push(`source ${id} physical page ${page} has no text`); continue; }
        material.push({ id: `${id}:p${page}`, sourceId: id, page, url, text });
      }
    } else {
      const text = await blobText(db, source.blobSha256);
      if (!text?.text.trim()) { gaps.push(`source ${id} has no readable text`); continue; }
      material.push({ id, url, text: text.text });
    }
  }
  let metadata: Record<string, unknown> = {};
  if (job.settings.metadataType) {
    const [row] = await db.select().from(records).where(and(eq(records.companyId, job.companyId), eq(records.type, job.settings.metadataType),
      sql`${records.data}->>'document_id' = ${documentId}`)).limit(1);
    metadata = row?.data ?? {};
  }
  const published = typeof metadata.published === "string" && Number.isFinite(Date.parse(metadata.published)) ? metadata.published : null;
  return { doc, sourceIds: doc.sourceIds, metadata, gaps, input: { title: doc.title, published, sources: material, themes: job.settings.themes,
    sourceGaps: gaps, sourceIds: doc.sourceIds, documentVersion: doc.version,
    ...(job.settings.researchContext ? { researchContext: job.settings.researchContext } : {}) } };
}

async function claim(db: Db) {
  return db.transaction(async tx => {
    await lockEvidence(tx, DISPATCH);
    const [running] = await tx.select().from(evidenceMiningJobs).where(eq(evidenceMiningJobs.status, "running")).orderBy(asc(evidenceMiningJobs.createdAt)).limit(1).for("update");
    if (running?.leaseUntil && running.leaseUntil > new Date()) return null;
    const [queued] = running ? [] : await tx.select().from(evidenceMiningJobs).where(eq(evidenceMiningJobs.status, "queued")).orderBy(asc(evidenceMiningJobs.createdAt)).limit(1).for("update");
    const next = running ?? queued;
    if (!next) return null;
    if (next.version !== EVIDENCE_MINING_VERSION) {
      await tx.update(evidenceMiningJobs).set({ status: "failed", reason: "mining version changed; enqueue a new job", finishedAt: new Date(), leaseId: null, leaseUntil: null }).where(eq(evidenceMiningJobs.id, next.id)); return null;
    }
    const [job] = await tx.update(evidenceMiningJobs).set({ status: "running", reason: null, leaseId: randomUUID(), leaseUntil: new Date(Date.now() + LEASE_MS) })
      .where(eq(evidenceMiningJobs.id, next.id)).returning(); return job!;
  });
}

export function createEvidenceMiningWorker(db: Db, dependencies: { call?: ExtractorCall; capacity?: typeof miningCapacity } = {}) {
  const call = dependencies.call ?? dockerCodexExtractorCall, capacity = dependencies.capacity ?? miningCapacity;
  let timer: ReturnType<typeof setInterval> | undefined, active: Promise<void> | undefined, closed = false;
  async function run() {
    const job = await claim(db); if (!job) return;
    let alive = true;
    const heartbeat = setInterval(() => {
      const until = new Date(Date.now() + LEASE_MS);
      void db.update(evidenceMiningJobs).set({ leaseUntil: until }).where(owned(job)).returning({ id: evidenceMiningJobs.id })
        .then(rows => { alive = rows.length === 1; if (alive) job.leaseUntil = until; }).catch(() => { alive = false; });
    }, LEASE_MS / 4); heartbeat.unref();
    const persist = (documentId: string, metrics: Record<string, unknown>, item?: Record<string, unknown>, sourceIds: string[] = []) => db.transaction(async tx => {
      const [lease] = await tx.select().from(evidenceMiningJobs).where(owned(job)).for("update");
      if (!lease) throw Error("source mining lease expired");
      if (lease.results[documentId]) return;
      let recordId = metrics.recordId;
      if (item) {
        const [saved] = await upsertRecords(tx, { companyId: job.companyId, createdBy: "source_mining", records: [{ type: EVIDENCE_MINING_TYPE,
          data: item, sourceIds, naturalKey: ["document_id", "version", "input_hash"] }] });
        if (!saved?.ok) throw Error(saved?.error ?? "mining record was not saved"); recordId = saved.id;
      }
      await tx.update(evidenceMiningJobs).set({ results: { ...lease.results, [documentId]: { ...metrics, ...(recordId ? { recordId } : {}) } } }).where(owned(job));
    });
    const finish = async (status: Job["status"], reason: string | null = null) => {
      await db.update(evidenceMiningJobs).set({ status, reason, leaseId: null, leaseUntil: null, finishedAt: ["completed", "failed"].includes(status) ? new Date() : null }).where(owned(job));
    };
    try {
      const pending = job.documentIds.filter(id => !job.results[id]);
      for (let i = 0; i < pending.length && alive && !closed; i += job.concurrency) {
        const pauses = await Promise.all(pending.slice(i, i + job.concurrency).map(async documentId => {
          const started = performance.now();
          try {
            await capacity(db);
            const context = await loadInput(db, job, documentId), hash = createHash("sha256").update(JSON.stringify(context.input)).digest("hex");
            const [cached] = await db.select().from(records).where(and(eq(records.companyId, job.companyId), eq(records.type, EVIDENCE_MINING_TYPE),
              sql`${records.data}->>'document_id' = ${documentId}`, sql`${records.data}->>'version' = ${job.version}`, sql`${records.data}->>'input_hash' = ${hash}`)).limit(1);
            if (cached) { await persist(documentId, { outcome: cached.data.outcome, cached: true, recordId: cached.id, provider: "codex", inputTokens: 0, outputTokens: 0 }); return null; }
            const beforeCall = async () => { if (!alive || closed) throw new MiningPause("worker stopping"); await capacity(db); };
            const result = await withCodexReasoning("high", () => mineSource(context.input, call, randomUUID(), beforeCall));
            const outcome = context.gaps.length ? "partial" : result.item.outcome;
            const item = { document_id: documentId, version: job.version, input_hash: result.inputHash, published: context.input.published ?? "not stated",
              source_group: context.metadata.source_group ?? "not stated", document_title: context.doc.title,
              ...result.item, outcome, source_gaps: context.gaps, processed_at: new Date().toISOString(), provider: "codex", reasoning: "high", repair_log: result.repairLog };
            if (alive) await persist(documentId, { outcome, provider: "codex", inputTokens: result.inputTokens, outputTokens: result.outputTokens,
              cachedTokens: result.cachedTokens, calls: result.calls, elapsedMs: Math.round(performance.now() - started),
              quoteCount: result.item.citations.length, quoteRejections: result.repairLog, gaps: [...context.gaps, ...result.item.gaps] }, item, context.sourceIds);
            return null;
          } catch (error) {
            if (error instanceof MiningPause) return error.message;
            if (error instanceof CodexCallError && ["quota", "auth"].includes(error.kind)) return `codex ${error.kind}; no provider or breaker was changed`;
            if (alive) await persist(documentId, { outcome: "exception", reason: error instanceof Error ? error.message.slice(0, 1000) : String(error), provider: "codex", elapsedMs: Math.round(performance.now() - started) });
            return null;
          }
        }));
        const pause = pauses.find(Boolean); if (pause) { await finish(closed ? "queued" : "paused", pause); return; }
      }
      if (alive) await finish(closed ? "queued" : "completed");
    } catch (error) {
      if (alive) await finish("failed", error instanceof Error ? error.message.slice(0, 1000) : String(error));
    } finally { clearInterval(heartbeat); }
  }
  const tick = () => { if (closed) return Promise.resolve(); if (!active) active = run().finally(() => { active = undefined; }); return active; };
  return { tick, start() { if (timer) return; closed = false; const background = () => { void tick().catch(() => {}); };
    timer = setInterval(background, 2000); timer.unref(); background(); }, stop() { closed = true; clearInterval(timer); timer = undefined; } };
}
