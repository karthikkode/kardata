import { mkdir, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join, resolve } from "node:path";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { blobs, providerCalls, records, researchRuns, sectorCompanies, sectors, sources } from "../../db/schema.js";
import { CODEX_MODEL } from "../../harness/codex-config.js";
import { CodexCallError, dockerCodexExtractorCall } from "../../harness/codex-extract.js";
import { codexHasCapacity, readCodexSnapshot } from "../../harness/codex-status.js";
import { getOrCreateManualRun } from "../../runs/queue.js";
import type { ExtractorCall } from "../../runs/extract.js";
import { DomainError } from "../errors.js";
import { logExtractorCall } from "../logging/provider-calls.js";
import { upsertRecords } from "../research/records.js";
import { saveDocument } from "../research/documents.js";
import { isValidDateString } from "../research/validate.js";
import { sectorSlug } from "../sectors.js";
import { lockEvidence } from "../sec-adv/evidence.js";
import { BRIEF_TYPE, BRIEF_VERSION, basicBrief, briefPrompt, csvCell, groundBrief, renderBrief, responseSchema, type BriefResponse, type CitedFact, type Evidence } from "./brief.js";
import { confirmedBrochureEvidence, publicBriefEvidence, storedBriefEvidence, type DeniedHosts, type FetchNote } from "./evidence.js";

export interface BriefBatch { sectorId: string; companyIds: string[]; callDate: string }
interface SavedBrief {
  version: string; call_date: string; company_id: string; company_name: string; owner: string | null; status: string; reason: string | null;
  response: BriefResponse; baseFacts: CitedFact[]; facts: CitedFact[]; evidence: Evidence[];
  fetches: FetchNote[]; gaps: string[]; brochureFound: boolean; websiteRead: boolean;
  sourceCount: number; documentId: string; markdown: string; opener: string; words: number;
  detailLevel: "detailed" | "basic"; validationPassed: boolean; generationError: string | null; generationAttempts: number;
}
async function persistBrief(db: Db, input: { companyId: string; runId: string; name: string; order: number; callDate: string; owner: string | null;
  baseFacts: CitedFact[]; evidence: Evidence[]; response: BriefResponse; gaps: string[]; fetches: FetchNote[]; brochureFound: boolean; websiteRead: boolean;
  detailLevel?: "detailed" | "basic"; generationError?: string | null; generationAttempts?: number }): Promise<SavedBrief> {
  const { companyId, runId, evidence, response, gaps } = input;
  const rendered = renderBrief({ companyId, name: input.name, order: input.order,
    callDate: input.callDate, owner: input.owner, baseFacts: input.baseFacts, evidence, response, gaps, detailLevel: input.detailLevel,
    ...(input.generationError ? { failure: input.generationError } : {}) });
  const words = rendered.markdown.split("<details>")[0]!.split(/\s+/).filter(Boolean).length;
  if (words > 360) throw new DomainError("invalid_input", "reviewed brief exceeds 360 words");
  const sourceIds = [...new Set(evidence.filter(e => rendered.usedEvidence.includes(e.id)).map(e => e.sourceId))];
  return db.transaction(async tx => {
    await lockEvidence(tx, "solo-call-brief-record-type");
    await lockEvidence(tx, `call-brief:${input.callDate}:${companyId}`);
    const doc = await saveDocument(tx, { companyId, runId, path: `other/call-brief-${input.callDate}.md`,
      title: `Private call brief ${input.callDate}`, contentMd: rendered.markdown, sourceIds,
      factIds: [...new Set(evidence.flatMap(e => e.factId ? [e.factId] : []))],
      recordIds: [...new Set(evidence.flatMap(e => e.recordId ? [e.recordId] : []))], createdBy: BRIEF_TYPE });
    const selectedEvidence = evidence.filter(e => rendered.usedEvidence.includes(e.id)).map(e => ({ ...e,
      text: e.kind === "sec" || e.kind === "schedule_a" ? e.text : rendered.facts.filter(f => f.evidenceId === e.id).map(f => f.quote).join("\n") }));
    const data: SavedBrief = { version: BRIEF_VERSION, call_date: input.callDate, company_id: companyId,
      company_name: input.name, owner: input.owner, status: "ready", reason: input.generationError ?? null,
      response: response!, baseFacts: input.baseFacts, facts: rendered.facts, evidence: selectedEvidence,
      fetches: input.fetches, gaps, brochureFound: input.brochureFound, websiteRead: input.websiteRead,
      sourceCount: rendered.sourceCount, documentId: doc.id, markdown: rendered.markdown, opener: rendered.opener,
      words, detailLevel: input.detailLevel ?? "detailed", validationPassed: input.detailLevel !== "basic",
      generationError: input.generationError ?? null, generationAttempts: input.generationAttempts ?? 1 };
    const writes = await upsertRecords(tx, { companyId, runId, createdBy: BRIEF_TYPE, records: [{
      type: BRIEF_TYPE, naturalKey: ["call_date"], sourceIds, data: data as unknown as Record<string, unknown>,
    }] });
    const failed = writes.find(w => !w.ok); if (failed && !failed.ok) throw new Error(failed.error);
    for (const written of writes) if (written.ok) await tx.update(records).set({ verification: "doc_only" }).where(eq(records.id, written.id));
    return data;
  });
}

export async function callBriefAttempts(db: Db, input: { companyId: string; limit?: number; includeContext?: boolean }) {
  const rows = await db.select({ id: providerCalls.id, runId: providerCalls.runId, model: providerCalls.model,
    gzip: blobs.gzip, prompt: providerCalls.promptSha256 }).from(providerCalls).innerJoin(researchRuns, eq(providerCalls.runId, researchRuns.id))
    .innerJoin(blobs, eq(providerCalls.responseSha256, blobs.sha256))
    .where(and(eq(researchRuns.companyId, input.companyId), eq(providerCalls.model, CODEX_MODEL)))
    .orderBy(desc(providerCalls.id)).limit(input.limit ?? 2);
  const attempts = [];
  for (const row of rows) {
    let context: unknown;
    if (input.includeContext && row.prompt) {
      const [blob] = await db.select().from(blobs).where(eq(blobs.sha256, row.prompt));
      const prompt = blob ? gunzipSync(blob.gzip).toString("utf8") : "";
      const start = prompt.indexOf('\n{"callDate"');
      if (prompt.startsWith("Prepare a concise, honest solo-adviser cold-call brief") && start >= 0) {
        context = JSON.parse(prompt.slice(start + 1).split("\nRepair the previous invalid response.")[0]!) as unknown;
      }
    }
    attempts.push({ id: row.id, runId: row.runId, model: row.model,
      response: JSON.parse(gunzipSync(row.gzip).toString("utf8")) as unknown, ...(context ? { context } : {}) });
  }
  return { companyId: input.companyId, attempts };
}

export async function saveCallBriefFromAttempt(db: Db, input: BriefBatch & { companyId: string; attemptId: number; response: unknown }) {
  await validateBatch(db, input);
  if (!input.companyIds.includes(input.companyId)) throw new DomainError("invalid_input", "reviewed firm must be in the ordered list");
  const [call] = await db.select({ runId: providerCalls.runId, prompt: providerCalls.promptSha256 }).from(providerCalls)
    .innerJoin(researchRuns, eq(providerCalls.runId, researchRuns.id)).where(and(eq(providerCalls.id, input.attemptId),
      eq(researchRuns.companyId, input.companyId), eq(providerCalls.model, CODEX_MODEL)));
  if (!call?.prompt || !call.runId) throw new DomainError("not_found", "company-owned Codex attempt not found");
  const [blob] = await db.select().from(blobs).where(eq(blobs.sha256, call.prompt));
  const prompt = blob ? gunzipSync(blob.gzip).toString("utf8") : "";
  const start = prompt.indexOf('\n{"callDate"');
  if (!prompt.startsWith("Prepare a concise, honest solo-adviser cold-call brief") || start < 0) throw new DomainError("invalid_input", "attempt is not a call-brief extraction");
  const raw = prompt.slice(start + 1).split("\nRepair the previous invalid response.")[0]!;
  const context = JSON.parse(raw) as { callDate: string; firm: { name: string }; facts: CitedFact[]; evidence: Evidence[] };
  if (context.callDate !== input.callDate) throw new DomainError("invalid_input", "attempt belongs to another call date");
  // New directly verified SEC fields can supplement an older draft without a refetch/model call.
  const current = await storedBriefEvidence(db, input.companyId, input.callDate);
  for (const fact of current.baseFacts) if (!context.facts.some(f => f.id === fact.id)) context.facts.push(fact);
  for (const evidence of current.evidence) if (!context.evidence.some(e => e.id === evidence.id)) context.evidence.push(evidence);
  const checked = confirmedBrochureEvidence(context.evidence);
  context.evidence = checked.evidence;
  const response = groundBrief(input.response, context.evidence, context.facts);
  const previous = (await savedBriefs(db, input)).get(input.companyId);
  const owner = context.facts.find(f => f.label === "owner")?.text.split(" — ")[0] ?? null;
  const data = await persistBrief(db, { companyId: input.companyId, runId: call.runId, name: context.firm.name,
    order: input.companyIds.indexOf(input.companyId) + 1, callDate: input.callDate, owner,
    baseFacts: context.facts, evidence: context.evidence, response,
    gaps: [...new Set([...(previous?.gaps ?? []), ...(checked.dropped && !checked.brochureFound ? ["Form ADV Part 2A not found; relationship summary or other PDF excluded"] : [])])], fetches: previous?.fetches ?? [],
    brochureFound: checked.brochureFound,
    websiteRead: previous?.websiteRead ?? context.evidence.some(e => e.kind === "website") });
  return { companyId: input.companyId, documentId: data.documentId, ...await exportCallBriefs(db, input) };
}
async function validateBatch(db: Db, input: BriefBatch) {
  if (!isValidDateString(input.callDate)) throw new DomainError("invalid_input", "callDate must be YYYY-MM-DD");
  if (new Set(input.companyIds).size !== input.companyIds.length || !input.companyIds.length) throw new DomainError("invalid_input", "provide distinct ordered company IDs");
  const [sector] = await db.select().from(sectors).where(eq(sectors.id, input.sectorId));
  if (!sector || sector.evidenceLibrary) throw new DomainError("invalid_input", "prospect sector required");
  const eligible = await db.select({ id: sectorCompanies.companyId }).from(sectorCompanies).where(and(
    eq(sectorCompanies.sectorId, input.sectorId), isNull(sectorCompanies.removedAt),
    eq(sectorCompanies.riaDecision, "Accept"), eq(sectorCompanies.riaTier, 0), inArray(sectorCompanies.companyId, input.companyIds)));
  if (eligible.length !== input.companyIds.length) throw new DomainError("invalid_input", "every call-list firm must be an active Accept Tier 0 member");
  return { sector, dir: resolve("var", "sectors", sectorSlug(sector.name), "analysis", `call-briefs-${input.callDate}`) };
}
async function savedBriefs(db: Db, input: BriefBatch) {
  const rows = await db.select({ companyId: records.companyId, data: records.data }).from(records).where(and(
    inArray(records.companyId, input.companyIds), eq(records.type, BRIEF_TYPE), sql`${records.data}->>'call_date' = ${input.callDate}`));
  return new Map(rows.map(r => [r.companyId, r.data as unknown as SavedBrief]));
}

export async function exportCallBriefs(db: Db, input: BriefBatch) {
  const { dir } = await validateBatch(db, input);
  const saved = await savedBriefs(db, input);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const csv = [["company_id", "opener", "question 1", "question 2", "question 3", "top guess", "source count", "backup", "check", "brief type", "name missing"].map(csvCell).join(",")];
  const items = [];
  for (const [index, companyId] of input.companyIds.entries()) {
    const brief = saved.get(companyId);
    if (!brief) { items.push({ order: index + 1, companyId, status: "pending", reason: "not prepared yet" }); continue; }
    const file = join(dir, `${String(index + 1).padStart(2, "0")}-${companyId}.md`);
    if (brief.status !== "ready") {
      await writeFile(file, `# ${String(index + 1).padStart(2, "0")} · ${companyId}\n\nBrief not ready: ${brief.reason ?? "preparation failed"}.\n`, { mode: 0o600 });
      csv.push([companyId, `Brief not ready: ${brief.reason}`, "not found", "not found", "not found", "not found", 0, "not found", "", "failed", "yes"].map(csvCell).join(","));
      items.push({ order: index + 1, companyId, status: brief.status, reason: brief.reason, path: file }); continue;
    }
    const rendered = renderBrief({ companyId, name: brief.company_name, order: index + 1, callDate: input.callDate,
      owner: brief.owner, baseFacts: brief.baseFacts, evidence: brief.evidence, response: brief.response, gaps: brief.gaps, detailLevel: brief.detailLevel,
      ...(brief.reason ? { failure: brief.reason } : {}) });
    await writeFile(file, rendered.markdown, { mode: 0o600 });
    csv.push([companyId, rendered.opener, ...rendered.questionTexts, rendered.topGuess, rendered.sourceCount, rendered.backup,
      brief.baseFacts.filter(f => f.label === "check").map(f => f.text).join("; "), brief.detailLevel ?? "detailed", brief.owner ? "no" : "yes"].map(csvCell).join(","));
    items.push({ order: index + 1, companyId, status: brief.status, reason: brief.reason, path: file, words: brief.words,
      brochureFound: brief.brochureFound, websiteRead: brief.websiteRead, sourceCount: rendered.sourceCount,
      detailLevel: brief.detailLevel ?? "detailed", validationPassed: brief.validationPassed ?? true, nameMissing: !brief.owner,
      flagged: brief.baseFacts.some(f => f.label === "check") });
  }
  const csvPath = join(dir, "call-briefs.csv"); await writeFile(csvPath, csv.join("\n") + "\n", { mode: 0o600 });
  return { directory: dir, csvPath, ready: items.filter(i => i.status === "ready").length, total: input.companyIds.length,
    detailed: items.filter(i => i.detailLevel === "detailed").length, basic: items.filter(i => i.detailLevel === "basic").length, items };
}

export async function callBriefsStatus(db: Db, input: BriefBatch) {
  await validateBatch(db, input);
  const saved = await savedBriefs(db, input);
  const skipReasons: Record<string, number> = {};
  const items = input.companyIds.map((companyId, i) => {
    const brief = saved.get(companyId);
    for (const fetch of brief?.fetches ?? []) {
      if (fetch.status !== "ok") {
        const key = `${fetch.status}: ${fetch.reason ?? "not available"}`; skipReasons[key] = (skipReasons[key] ?? 0) + 1;
      }
    }
    return { order: i + 1, companyId, status: brief?.status ?? "pending", reason: brief?.reason ?? null,
      documentId: brief?.documentId ?? null, brochureFound: brief?.brochureFound ?? false,
      websiteRead: brief?.websiteRead ?? false, words: brief?.words ?? null,
      detailLevel: brief?.status === "ready" ? brief.detailLevel ?? "detailed" : null,
      validationPassed: brief?.status === "ready" && (brief.validationPassed ?? true),
      nameMissing: !brief?.owner, flagged: brief?.baseFacts.some(f => f.label === "check") ?? false,
      generationAttempts: brief?.generationAttempts ?? 0, generationError: brief?.generationError ?? null };
  });
  return { total: items.length, prepared: saved.size, brochuresFound: items.filter(i => i.brochureFound).length,
    websitesRead: items.filter(i => i.websiteRead).length, ready: items.filter(i => i.status === "ready").length,
    detailed: items.filter(i => i.detailLevel === "detailed").length, basic: items.filter(i => i.detailLevel === "basic").length,
    validationPassed: items.filter(i => i.validationPassed).length,
    namesMissing: items.filter(i => i.nameMissing).length, flagged: items.filter(i => i.flagged).length, skipReasons, items };
}

const active = new WeakMap<Db, Set<string>>();
export async function prepareCallBriefs(db: Db, input: BriefBatch & { offset?: number; limit?: number; concurrency?: number; force?: boolean },
  call: ExtractorCall = dockerCodexExtractorCall, readiness = readCodexSnapshot) {
  await validateBatch(db, input);
  const key = `${input.sectorId}:${input.callDate}`;
  const running = active.get(db) ?? new Set<string>(); active.set(db, running);
  if (running.has(key)) throw new DomainError("conflict", "this call-list batch is already preparing");
  running.add(key);
  try {
    // Pin this job to Codex. Never read/change the global provider mode or any quota breaker/job.
    const snapshot = await readiness();
    let providerFailure: string | null = codexHasCapacity(snapshot) ? null : `Codex unavailable: ${snapshot.error ?? "quota"}`;
    const saved = await savedBriefs(db, input);
    const offset = input.offset ?? 0;
    const queue = input.companyIds.slice(offset, offset + (input.limit ?? 20));
    const denied: DeniedHosts = new Map();
    const priorBlocks = await db.select({ url: sources.url, error: sources.error }).from(sources).where(and(
      eq(sources.httpStatus, 403), sql`${sources.fetchedAt} > now() - interval '24 hours'`,
      sql`${sources.url} like 'https://%adviserinfo.sec.gov/%'`));
    for (const block of priorBlocks) denied.set(new URL(block.url).hostname, `known SEC HTTP 403: ${block.error ?? "blocked"}`);
    let prepared = 0, reused = 0;
    const errors: { companyId: string; reason: string }[] = [];
    const workers = Array.from({ length: Math.min(input.concurrency ?? 3, 4) }, async () => {
      for (;;) {
        const companyId = queue.shift(); if (!companyId) return;
        if (!input.force && saved.get(companyId)?.version === BRIEF_VERSION && saved.get(companyId)?.status === "ready") { reused++; continue; }
        let observed: Awaited<ReturnType<typeof publicBriefEvidence>> | undefined;
        try {
          const stored = await storedBriefEvidence(db, companyId, input.callDate);
          if (!stored.evidence.length) throw new DomainError("invalid_input", "no cited SEC evidence available");
          const runId = await getOrCreateManualRun(db, companyId);
          const web = await publicBriefEvidence(db, { companyId, runId, website: stored.company.website, crd: stored.company.secCrd, denied });
          observed = web;
          const evidence = [...stored.evidence, ...web.evidence], gaps = [...stored.gaps, ...web.gaps];
          const prompt = briefPrompt({ callDate: input.callDate, firm: { name: stored.company.name ?? companyId, crd: stored.company.secCrd }, facts: stored.baseFacts, evidence });
          let response: BriefResponse | undefined, error = "", attempts = 0;
          for (let attempt = 0; attempt < 2; attempt++) {
            if (providerFailure) { error = providerFailure; break; }
            const finalPrompt = attempt ? `${prompt}\nRepair the previous invalid response. Validation: ${error}. Return only corrected JSON; keep the body under 340 words.` : prompt;
            const start = Date.now();
            try {
              attempts++;
              const result = await call({ runId, area: `call_brief_${input.callDate}`, prompt: finalPrompt, schema: responseSchema() });
              const [run] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId));
              if (run) await logExtractorCall(db, run, { seq: attempt, prompt: finalPrompt, json: result.json, raw: result.raw, usage: result.usage, durationMs: Date.now() - start });
              response = groundBrief(result.json, evidence, stored.baseFacts);
              const preview = renderBrief({ companyId, name: stored.company.name ?? companyId, order: input.companyIds.indexOf(companyId) + 1,
                callDate: input.callDate, owner: stored.owner, baseFacts: stored.baseFacts, evidence, response, gaps });
              const words = preview.markdown.split("<details>")[0]!.split(/\s+/).filter(Boolean).length;
              if (words > 360) throw new Error(`brief body too long: ${words} words`);
              break;
            } catch (e) {
              response = undefined; error = e instanceof Error ? e.message.slice(0, 250) : "invalid brief";
              if (e instanceof CodexCallError && (e.kind === "auth" || e.kind === "quota")) providerFailure = error;
            }
          }
          const detailLevel = response ? "detailed" : "basic";
          const generationError = response ? null : `Detailed read unavailable: ${error}`;
          if (!response) {
            errors.push({ companyId, reason: generationError! });
            response = groundBrief(basicBrief(stored.baseFacts), stored.evidence, stored.baseFacts);
          }
          const savedData = await persistBrief(db, { companyId, runId, name: stored.company.name ?? companyId,
            order: input.companyIds.indexOf(companyId) + 1, callDate: input.callDate, owner: stored.owner,
            baseFacts: stored.baseFacts, evidence, response, gaps, fetches: web.notes,
            brochureFound: web.brochureFound, websiteRead: web.websiteRead, detailLevel, generationError, generationAttempts: attempts });
          saved.set(companyId, savedData); prepared++;
          // A completed firm is immediately reviewable; filenames retain call-list order.
          await exportCallBriefs(db, input);
        } catch (e) {
          const reason = e instanceof Error ? e.message.slice(0, 500) : "brief preparation failed";
          errors.push({ companyId, reason });
          const [source] = await db.select({ id: sources.id }).from(sources).where(eq(sources.companyId, companyId)).limit(1);
          if (source) {
            const data = { version: BRIEF_VERSION, call_date: input.callDate, company_id: companyId, company_name: companyId,
              status: "failed", reason, owner: null, response: { facts: [], tasks: [], guesses: [], questions: [], avoid: [] },
              baseFacts: [], facts: [], evidence: [], fetches: observed?.notes ?? [], gaps: observed?.gaps ?? [],
              brochureFound: observed?.brochureFound ?? false, websiteRead: observed?.websiteRead ?? false,
              sourceCount: 0, documentId: "", markdown: "", opener: "", words: 0 };
            await db.transaction(async tx => {
              await lockEvidence(tx, "solo-call-brief-record-type");
              await upsertRecords(tx, { companyId, createdBy: BRIEF_TYPE, records: [{ type: BRIEF_TYPE, naturalKey: ["call_date"], sourceIds: [source.id], data }] });
            });
          }
        }
      }
    });
    await Promise.all(workers);
    return { prepared, reused, errors, ...await exportCallBriefs(db, input) };
  } finally { running.delete(key); }
}
