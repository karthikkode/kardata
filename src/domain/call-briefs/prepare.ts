import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { records, researchRuns, sectorCompanies, sectors, sources } from "../../db/schema.js";
import { dockerCodexExtractorCall } from "../../harness/codex-extract.js";
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
import { BRIEF_TYPE, BRIEF_VERSION, briefPrompt, csvCell, groundBrief, renderBrief, responseSchema, type BriefResponse, type CitedFact, type Evidence } from "./brief.js";
import { publicBriefEvidence, storedBriefEvidence, type DeniedHosts, type FetchNote } from "./evidence.js";

export interface BriefBatch { sectorId: string; companyIds: string[]; callDate: string }
interface SavedBrief {
  version: string; call_date: string; company_id: string; company_name: string; owner: string | null; status: string; reason: string | null;
  response: BriefResponse; baseFacts: CitedFact[]; facts: CitedFact[]; evidence: Evidence[];
  fetches: FetchNote[]; gaps: string[]; brochureFound: boolean; websiteRead: boolean;
  sourceCount: number; documentId: string; markdown: string; opener: string; words: number;
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
  const csv = [["company_id", "opener", "question 1", "question 2", "question 3", "top guess", "source count"].map(csvCell).join(",")];
  const items = [];
  for (const [index, companyId] of input.companyIds.entries()) {
    const brief = saved.get(companyId);
    if (!brief) { items.push({ order: index + 1, companyId, status: "pending", reason: "not prepared yet" }); continue; }
    const file = join(dir, `${String(index + 1).padStart(2, "0")}-${companyId}.md`);
    if (brief.status !== "ready") {
      await writeFile(file, `# ${String(index + 1).padStart(2, "0")} · ${companyId}\n\nBrief not ready: ${brief.reason ?? "preparation failed"}.\n`, { mode: 0o600 });
      csv.push([companyId, `Brief not ready: ${brief.reason}`, "not found", "not found", "not found", "not found", 0].map(csvCell).join(","));
      items.push({ order: index + 1, companyId, status: brief.status, reason: brief.reason, path: file }); continue;
    }
    const rendered = renderBrief({ companyId, name: brief.company_name, order: index + 1, callDate: input.callDate,
      owner: brief.owner, baseFacts: brief.baseFacts, evidence: brief.evidence, response: brief.response, gaps: brief.gaps,
      ...(brief.reason ? { failure: brief.reason } : {}) });
    await writeFile(file, rendered.markdown, { mode: 0o600 });
    csv.push([companyId, rendered.opener, ...rendered.questionTexts, rendered.topGuess, rendered.sourceCount].map(csvCell).join(","));
    items.push({ order: index + 1, companyId, status: brief.status, reason: brief.reason, path: file, words: brief.words,
      brochureFound: brief.brochureFound, websiteRead: brief.websiteRead, sourceCount: rendered.sourceCount });
  }
  const csvPath = join(dir, "call-briefs.csv"); await writeFile(csvPath, csv.join("\n") + "\n", { mode: 0o600 });
  return { directory: dir, csvPath, ready: saved.size, total: input.companyIds.length, items };
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
      websiteRead: brief?.websiteRead ?? false, words: brief?.words ?? null };
  });
  return { total: items.length, prepared: saved.size, brochuresFound: items.filter(i => i.brochureFound).length,
    websitesRead: items.filter(i => i.websiteRead).length, skipReasons, items };
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
    if (!codexHasCapacity(snapshot)) throw new DomainError("invalid_input", `Codex unavailable: ${snapshot.error ?? "quota"}`);
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
          let response: BriefResponse | undefined, error = "";
          for (let attempt = 0; attempt < 2; attempt++) {
            const finalPrompt = attempt ? `${prompt}\nRepair the previous invalid response. Validation: ${error}. Return only corrected JSON; keep the body under 340 words.` : prompt;
            const start = Date.now();
            const result = await call({ runId, area: `call_brief_${input.callDate}`, prompt: finalPrompt, schema: responseSchema() });
            const [run] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId));
            if (run) await logExtractorCall(db, run, { seq: attempt, prompt: finalPrompt, json: result.json, raw: result.raw, usage: result.usage, durationMs: Date.now() - start });
            try {
              response = groundBrief(result.json, evidence, stored.baseFacts);
              const preview = renderBrief({ companyId, name: stored.company.name ?? companyId, order: input.companyIds.indexOf(companyId) + 1,
                callDate: input.callDate, owner: stored.owner, baseFacts: stored.baseFacts, evidence, response, gaps });
              const words = preview.markdown.split("<details>")[0]!.split(/\s+/).filter(Boolean).length;
              if (words > 360) throw new Error(`brief body too long: ${words} words`);
              break;
            } catch (e) { response = undefined; error = e instanceof Error ? e.message.slice(0, 250) : "invalid brief"; }
          }
          if (!response) throw new Error(`Codex response failed evidence/length checks: ${error}`);
          const rendered = renderBrief({ companyId, name: stored.company.name ?? companyId, order: input.companyIds.indexOf(companyId) + 1,
            callDate: input.callDate, owner: stored.owner, baseFacts: stored.baseFacts, evidence, response, gaps });
          const sourceIds = [...new Set(evidence.filter(e => rendered.usedEvidence.includes(e.id)).map(e => e.sourceId))];
          const savedData = await db.transaction(async tx => {
            await lockEvidence(tx, "solo-call-brief-record-type");
            await lockEvidence(tx, `call-brief:${input.callDate}:${companyId}`);
            const doc = await saveDocument(tx, { companyId, runId, path: `other/call-brief-${input.callDate}.md`,
              title: `Private call brief ${input.callDate}`, contentMd: rendered.markdown, sourceIds,
              factIds: [...new Set(evidence.flatMap(e => e.factId ? [e.factId] : []))],
              recordIds: [...new Set(evidence.flatMap(e => e.recordId ? [e.recordId] : []))], createdBy: BRIEF_TYPE });
            const selectedEvidence = evidence.filter(e => rendered.usedEvidence.includes(e.id)).map(e => ({ ...e,
              text: e.kind === "sec" || e.kind === "schedule_a" ? e.text : rendered.facts.filter(f => f.evidenceId === e.id).map(f => f.quote).join("\n") }));
            const data: SavedBrief = { version: BRIEF_VERSION, call_date: input.callDate, company_id: companyId,
              company_name: stored.company.name ?? companyId, owner: stored.owner, status: "ready", reason: null,
              response: response!, baseFacts: stored.baseFacts, facts: rendered.facts, evidence: selectedEvidence,
              fetches: web.notes, gaps, brochureFound: web.brochureFound, websiteRead: web.websiteRead,
              sourceCount: rendered.sourceCount, documentId: doc.id, markdown: rendered.markdown, opener: rendered.opener,
              words: rendered.markdown.split("<details>")[0]!.split(/\s+/).filter(Boolean).length };
            const writes = await upsertRecords(tx, { companyId, runId, createdBy: BRIEF_TYPE, records: [{
              type: BRIEF_TYPE, naturalKey: ["call_date"], sourceIds, data: data as unknown as Record<string, unknown>,
            }] });
            const failed = writes.find(w => !w.ok); if (failed && !failed.ok) throw new Error(failed.error);
            for (const written of writes) if (written.ok) await tx.update(records).set({ verification: "doc_only" }).where(eq(records.id, written.id));
            return data;
          });
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
