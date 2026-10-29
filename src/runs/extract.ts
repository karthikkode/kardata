import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, eq, like } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  area as areaEnum,
  documents,
  factKeys,
  findings,
  researchRuns,
  recordTypes,
  sources,
  type ResearchRun,
} from "../db/schema.js";
import { recordEvent } from "../collect/db.js";
import { DomainError } from "../domain/errors.js";
import { logExtractorCall } from "../domain/logging/provider-calls.js";
import { addFacts } from "../domain/research/facts.js";
import { addFinding } from "../domain/research/findings.js";
import { verifyRunExtraction, type GroundCounts } from "../domain/research/grounding.js";
import { blobText } from "../domain/research/reads.js";
import { upsertRecords } from "../domain/research/records.js";
import { MuseHandle } from "../harness/muse.js";
import type { HarnessUsage } from "../harness/types.js";
import { extractRunArgs, prepareExtractInput } from "../harness/extract.js";
import { PROMPT_AREAS } from "./prompt.js";

export const EXTRACT_AREAS = [...PROMPT_AREAS];
export const EXTRACT_NOTES_BUDGET = 60_000;
export const SYNTHESIS_AREA = "synthesis";
const SOURCE_TEXT_MAX = 15_000;
/** Muse can sit silent for minutes under load; 120s killed most pilot calls (2026-10-27). */
export const EXTRACT_STALL_MS = 300_000;
/** A failed extractor call (stall, container exit) is retried this many times. */
export const EXTRACT_CALL_RETRIES = 1;

type AreaName = (typeof areaEnum.enumValues)[number];

function extractDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "prompts", "extract-v4");
}

export function extractSchema(): string {
  return readFileSync(join(extractDir(), "schema.json"), "utf8");
}

function extractTemplate(name: string): string {
  return readFileSync(join(extractDir(), name), "utf8");
}

function assertArea(area: string): AreaName {
  if (!(EXTRACT_AREAS as readonly string[]).includes(area)) {
    throw new DomainError("invalid_input", `unknown extraction area "${area}"`);
  }
  return area as AreaName;
}

// ---- Notes gathering ----

export interface AreaNotes {
  notes: string;
  sourceIds: string[];
}

async function sourceBlock(db: Db, sourceId: string): Promise<string> {
  const [row] = await db
    .select({ url: sources.url, title: sources.title, blobSha256: sources.blobSha256 })
    .from(sources)
    .where(eq(sources.id, sourceId));
  if (!row) return `### ${sourceId}\n(missing source)\n`;
  let text = "(no text captured)";
  if (row.blobSha256) {
    const blob = await blobText(db, row.blobSha256);
    if (blob) text = blob.text;
  }
  if (text.length > SOURCE_TEXT_MAX) text = `${text.slice(0, SOURCE_TEXT_MAX)}\n…[source truncated]`;
  return `### ${sourceId}\n${row.title ?? row.url}\n${text}\n`;
}

function truncateNotes(notes: string): string {
  if (notes.length <= EXTRACT_NOTES_BUDGET) return notes;
  return `${notes.slice(0, EXTRACT_NOTES_BUDGET)}\n…[notes truncated to budget]`;
}

/**
 * The run's current agent documents (one area, or all areas for synthesis)
 * plus the text of every source they cite. Docs first, then cited sources
 * in citation order; the id list is always complete. Legacy notes often cite
 * nothing, so the run's other ok sources are listed too (id + url, no body)
 * and stay citable.
 */
export async function gatherAreaNotes(db: Db, runId: string, area: string | null): Promise<AreaNotes> {
  const conds = [
    eq(documents.runId, runId),
    eq(documents.isCurrent, true),
    like(documents.createdBy, "agent:%"),
  ];
  if (area !== null) conds.push(eq(documents.area, assertArea(area)));
  const docs = await db
    .select({
      path: documents.path,
      title: documents.title,
      contentMd: documents.contentMd,
      sourceIds: documents.sourceIds,
    })
    .from(documents)
    .where(and(...conds))
    .orderBy(asc(documents.path));
  const parts: string[] = [];
  const seen = new Set<string>();
  const sourceIds: string[] = [];
  for (const doc of docs) {
    parts.push(`## ${doc.path ?? doc.title}\n${doc.contentMd}\n`);
    for (const id of doc.sourceIds) {
      if (!seen.has(id)) {
        seen.add(id);
        sourceIds.push(id);
      }
    }
  }
  for (const id of sourceIds) {
    parts.push(await sourceBlock(db, id));
  }
  const runSources = await db
    .select({ id: sources.id, url: sources.url, title: sources.title })
    .from(sources)
    .where(and(eq(sources.runId, runId), eq(sources.status, "ok")))
    .orderBy(asc(sources.fetchedAt));
  for (const src of runSources) {
    if (seen.has(src.id)) continue;
    seen.add(src.id);
    sourceIds.push(src.id);
    parts.push(`### ${src.id}\n${src.title ?? src.url}\n(not cited by the notes; cite only for claims the notes state)\n`);
  }
  return { notes: truncateNotes(parts.join("\n")), sourceIds };
}

// ---- Prompt assembly ----

export interface AreaVocab {
  keys: string;
  types: string;
}

export async function fetchAreaVocab(db: Db, area: AreaName): Promise<AreaVocab> {
  assertArea(area);
  const keys = await db
    .select({
      key: factKeys.key,
      valueType: factKeys.valueType,
      description: factKeys.description,
      qualifierNames: factKeys.qualifierNames,
      status: factKeys.status,
    })
    .from(factKeys)
    .where(eq(factKeys.area, area));
  const types = await db
    .select({
      name: recordTypes.name,
      description: recordTypes.description,
      fields: recordTypes.fields,
      status: recordTypes.status,
    })
    .from(recordTypes)
    .where(eq(recordTypes.area, area));
  const keyLines = keys
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((k) => {
      const quals =
        k.qualifierNames.length > 0 ? `, qualifiers: ${k.qualifierNames.join(", ")}` : "";
      const prov = k.status === "provisional" ? " [provisional]" : "";
      return `- ${k.key} (${k.valueType}${quals}): ${k.description}${prov}`;
    });
  const typeLines = types
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => {
      const fields = t.fields.map((f) => f.name).join(", ");
      const prov = t.status === "provisional" ? " [provisional]" : "";
      return `- ${t.name}: ${t.description} (fields: ${fields || "free"})${prov}`;
    });
  return {
    keys: keyLines.length > 0 ? keyLines.join("\n") : "(no registered keys — invent dotted names)",
    types: typeLines.length > 0 ? typeLines.join("\n") : "(no registered types — invent names)",
  };
}

function substitute(template: string, values: Record<string, string>): string {
  let rendered = template;
  for (const [key, value] of Object.entries(values)) {
    rendered = rendered.split(`{{${key}}}`).join(value);
  }
  return rendered;
}

export function assembleAreaPrompt(area: string, vocab: AreaVocab, gathered: AreaNotes): string {
  assertArea(area);
  return substitute(extractTemplate(`areas/${area}.md`), {
    area,
    vocabKeys: vocab.keys,
    vocabTypes: vocab.types,
    sourceIds: JSON.stringify(gathered.sourceIds),
    notes: gathered.notes,
  });
}

export function assembleSynthesisPrompt(gathered: AreaNotes): string {
  return substitute(extractTemplate("synthesis.md"), {
    sourceIds: JSON.stringify(gathered.sourceIds),
    notes: gathered.notes,
  });
}

export async function buildAreaPrompt(db: Db, runId: string, area: string): Promise<string> {
  const [vocab, gathered] = await Promise.all([
    fetchAreaVocab(db, assertArea(area)),
    gatherAreaNotes(db, runId, area),
  ]);
  return assembleAreaPrompt(area, vocab, gathered);
}

export async function buildSynthesisPrompt(db: Db, runId: string): Promise<string> {
  const gathered = await gatherAreaNotes(db, runId, null);
  return assembleSynthesisPrompt(gathered);
}

// ---- JSON validation ----

const qualifierPair = z.object({ name: z.string(), value: z.string() });

// extract-v2: every item carries the verbatim quote supporting it plus the
// id of the source the quote comes from (both required keys; empty when
// the item has no grounding span, which verifies as unverified).
const quoteShape = {
  quote: z.string(),
  quote_source_id: z.string(),
};

const extractionJson = z.object({
  facts: z
    .array(
      z.object({
        key: z.string(),
        value: z.unknown(),
        value_json: z.string().nullable().optional(),
        unit: z.string().nullable().optional(),
        currency: z.string().nullable().optional(),
        qualifiers: z.array(qualifierPair).nullable().optional(),
        as_of: z.string().nullable().optional(),
        source_ids: z.array(z.string()),
        confidence: z.string(),
        note: z.string().nullable().optional(),
        ...quoteShape,
      }),
    )
    .default([]),
  records: z
    .array(
      z.object({
        type: z.string(),
        data: z.string(),
        source_ids: z.array(z.string()),
        natural_key: z.array(z.string()).nullable().optional(),
        ...quoteShape,
      }),
    )
    .default([]),
  findings: z
    .array(
      z.object({
        claim: z.string(),
        detail: z.string().nullable().optional(),
        source_ids: z.array(z.string()),
        record_refs: z.array(z.number()).nullable().optional(),
        confidence: z.string(),
        status: z.string(),
        ...quoteShape,
      }),
    )
    .default([]),
});

export interface ValidFact {
  key: string;
  value: unknown;
  qualifiers?: Record<string, string>;
  asOf?: string;
  sourceIds: string[];
  confidence: string;
  note?: string;
  quote?: string;
  quoteSourceId?: string;
}

export interface ValidRecord {
  type: string;
  data: Record<string, unknown>;
  sourceIds: string[];
  naturalKey?: string[];
  quote?: string;
  quoteSourceId?: string;
}

export interface ValidFinding {
  claim: string;
  detail?: string;
  sourceIds: string[];
  recordRefs: number[];
  confidence: string;
  status: string;
  quote?: string;
  quoteSourceId?: string;
}

export interface ValidatedExtraction {
  facts: ValidFact[];
  records: ValidRecord[];
  findings: ValidFinding[];
  droppedOutOfList: number;
  droppedInvalid: number;
}

/**
 * Shape-check the extractor's JSON, resolve the strict-schema encodings
 * (value_json, qualifier pairs, data string), and drop items citing ids
 * outside the provided list. The domain layer remains the backstop for
 * value/enum validation.
 */
export function validateExtractionJson(area: string, allowedIds: string[], json: unknown): ValidatedExtraction {
  void area;
  const allowed = new Set(allowedIds);
  const out: ValidatedExtraction = { facts: [], records: [], findings: [], droppedOutOfList: 0, droppedInvalid: 0 };
  const parsed = extractionJson.safeParse(json);
  if (!parsed.success) {
    // Unshaped output: nothing is salvageable; count it as one invalid drop.
    out.droppedInvalid += 1;
    return out;
  }
  const citedOutside = (ids: string[]): boolean => ids.some((id) => !allowed.has(id));
  // A quote anchored to an id outside the provided list is an invented id.
  const quoteOutside = (quoteSourceId: string): boolean =>
    quoteSourceId.trim() !== "" && !allowed.has(quoteSourceId);
  const cleanQuote = (quote: string, quoteSourceId: string): { quote?: string; quoteSourceId?: string } => {
    const outQuote: { quote?: string; quoteSourceId?: string } = {};
    if (quote.trim() !== "") outQuote.quote = quote;
    if (quoteSourceId.trim() !== "") outQuote.quoteSourceId = quoteSourceId;
    return outQuote;
  };
  for (const fact of parsed.data.facts) {
    if (typeof fact.key !== "string" || fact.key.trim() === "" || fact.source_ids.length === 0) {
      out.droppedInvalid += 1;
      continue;
    }
    if (citedOutside(fact.source_ids) || quoteOutside(fact.quote_source_id)) {
      out.droppedOutOfList += 1;
      continue;
    }
    let value: unknown = fact.value ?? null;
    if (fact.value_json !== undefined && fact.value_json !== null) {
      try {
        value = JSON.parse(fact.value_json) as unknown;
      } catch {
        out.droppedInvalid += 1;
        continue;
      }
    }
    // A bare number plus a currency code is money; the domain takes no
    // separate unit, so a unit rides along in the note.
    let note = fact.note ?? undefined;
    if (typeof value === "number" && fact.currency) {
      value = { amount: value, currency: fact.currency };
    }
    if (fact.unit) note = note ? `${note} [unit: ${fact.unit}]` : `[unit: ${fact.unit}]`;
    if (value === null || value === undefined) {
      out.droppedInvalid += 1;
      continue;
    }
    const item: ValidFact = {
      key: fact.key.trim(),
      value,
      sourceIds: fact.source_ids,
      confidence: fact.confidence,
      ...cleanQuote(fact.quote, fact.quote_source_id),
    };
    if (fact.qualifiers) {
      item.qualifiers = {};
      for (const q of fact.qualifiers) item.qualifiers[q.name] = q.value;
    }
    if (fact.as_of) item.asOf = fact.as_of;
    if (note) item.note = note;
    out.facts.push(item);
  }
  for (const record of parsed.data.records) {
    if (typeof record.type !== "string" || record.type.trim() === "" || record.source_ids.length === 0) {
      out.droppedInvalid += 1;
      continue;
    }
    if (citedOutside(record.source_ids) || quoteOutside(record.quote_source_id)) {
      out.droppedOutOfList += 1;
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(record.data) as unknown;
    } catch {
      out.droppedInvalid += 1;
      continue;
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      out.droppedInvalid += 1;
      continue;
    }
    const obj = data as Record<string, unknown>;
    const item: ValidRecord = {
      type: record.type.trim(),
      data: obj,
      sourceIds: record.source_ids,
      ...cleanQuote(record.quote, record.quote_source_id),
    };
    // natural_key names data fields; values slipped in by the model are not
    // keys of the object, so they fall back to the server default.
    if (record.natural_key) {
      const usable = record.natural_key.filter((n) => n in obj);
      if (usable.length > 0) item.naturalKey = usable;
    }
    out.records.push(item);
  }
  for (const finding of parsed.data.findings) {
    if (typeof finding.claim !== "string" || finding.claim.trim() === "" || finding.source_ids.length === 0) {
      out.droppedInvalid += 1;
      continue;
    }
    if (citedOutside(finding.source_ids) || quoteOutside(finding.quote_source_id)) {
      out.droppedOutOfList += 1;
      continue;
    }
    out.findings.push({
      claim: finding.claim.trim(),
      detail: finding.detail ?? undefined,
      sourceIds: finding.source_ids,
      recordRefs: finding.record_refs ?? [],
      confidence: finding.confidence,
      status: finding.status,
      ...cleanQuote(finding.quote, finding.quote_source_id),
    });
  }
  return out;
}

// ---- Writing ----

export interface ExtractionWriteCounts {
  writtenFacts: number;
  writtenRecords: number;
  writtenFindings: number;
  rejected: number;
  /** First few domain rejection reasons, for forensics. Capped. */
  rejections: string[];
  droppedOutOfList: number;
  droppedInvalid: number;
}

const REJECTION_CAP = 10;

function capReason(list: string[], reason: string): void {
  if (list.length < REJECTION_CAP) list.push(reason.slice(0, 200));
}

/**
 * Write one validated extraction through the domain layer with
 * created_by = extractor:<area>. record_refs resolve against the records
 * just written (refs to failed records are dropped with the ref).
 */
export async function writeExtraction(
  db: Db,
  companyId: string,
  runId: string,
  area: string,
  validated: ValidatedExtraction,
): Promise<ExtractionWriteCounts> {
  const createdBy = `extractor:${area}`;
  const counts: ExtractionWriteCounts = {
    writtenFacts: 0,
    writtenRecords: 0,
    writtenFindings: 0,
    rejected: 0,
    rejections: [],
    droppedOutOfList: validated.droppedOutOfList,
    droppedInvalid: validated.droppedInvalid,
  };
  if (validated.facts.length > 0) {
    const results = await addFacts(db, {
      companyId,
      runId,
      createdBy,
      facts: validated.facts.map((f) => ({
        key: f.key,
        value: f.value,
        qualifiers: f.qualifiers,
        asOf: f.asOf,
        sourceIds: f.sourceIds,
        confidence: f.confidence,
        note: f.note,
        quote: f.quote,
        quoteSourceId: f.quoteSourceId,
      })),
    });
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r?.ok) {
        counts.writtenFacts += 1;
      } else {
        counts.rejected += 1;
        capReason(counts.rejections, `fact ${validated.facts[i]?.key ?? "?"}: ${r?.ok === false ? r.error : "unknown"}`);
      }
    }
  }
  const recordIds: (string | null)[] = [];
  if (validated.records.length > 0) {
    const results = await upsertRecords(db, {
      companyId,
      runId,
      createdBy,
      records: validated.records.map((r) => ({
        type: r.type,
        data: r.data,
        sourceIds: r.sourceIds,
        naturalKey: r.naturalKey,
        quote: r.quote,
        quoteSourceId: r.quoteSourceId,
      })),
    });
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r?.ok) {
        counts.writtenRecords += 1;
        recordIds.push(r.id);
      } else {
        counts.rejected += 1;
        recordIds.push(null);
        capReason(
          counts.rejections,
          `record ${validated.records[i]?.type ?? "?"}: ${r?.ok === false ? r.error : "unknown"}`,
        );
      }
    }
  }
  for (const finding of validated.findings) {
    const recordIdsResolved = finding.recordRefs
      .filter((i) => Number.isInteger(i) && i >= 0 && i < recordIds.length)
      .map((i) => recordIds[i] as string | null)
      .filter((id): id is string => id !== null);
    try {
      await addFinding(db, {
        companyId,
        runId,
        area: area === SYNTHESIS_AREA ? "other" : area,
        claim: finding.claim,
        detail: finding.detail ?? null,
        sourceIds: finding.sourceIds,
        factIds: [],
        recordIds: recordIdsResolved,
        confidence: finding.confidence,
        status: finding.status,
        createdBy,
        quote: finding.quote ?? null,
        quoteSourceId: finding.quoteSourceId ?? null,
      });
      counts.writtenFindings += 1;
    } catch (err) {
      counts.rejected += 1;
      capReason(counts.rejections, `finding: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return counts;
}

// ---- Muse calls ----

export interface ExtractorCallResult {
  json: unknown;
  usage: HarnessUsage | undefined;
  /** Raw response text when the caller kept it (for the call log). */
  raw?: string;
}

/** One tool-less schema call; injectable for tests. */
export type ExtractorCall = (input: { runId: string; area: string; prompt: string }) => Promise<ExtractorCallResult>;

export const dockerExtractorCall: ExtractorCall = async ({ runId, area, prompt }) => {
  const input = await prepareExtractInput(prompt, extractSchema());
  try {
    const child = spawn("docker", extractRunArgs({ runId, area, inputDir: input.dir }), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2000);
    });
    const handle = new MuseHandle(child, EXTRACT_STALL_MS);
    const consume = (async () => {
      for await (const event of handle.events) {
        void event;
      }
    })();
    const result = await handle.wait();
    await consume;
    if (result.exitCode !== 0) {
      const detail = stderr.trim() === "" ? "no stderr" : stderr.trim().split("\n").slice(-3).join(" | ");
      throw new Error(`extraction container exited ${result.exitCode}: ${detail}`);
    }
    let json: unknown;
    try {
      json = JSON.parse(result.finalMessage) as unknown;
    } catch {
      throw new Error("extraction returned invalid JSON");
    }
    return { json, usage: result.usage, raw: result.finalMessage };
  } finally {
    await input.cleanup();
  }
};

function addUsage(total: HarnessUsage | undefined, usage: HarnessUsage | undefined): HarnessUsage | undefined {
  if (!usage) return total;
  if (!total) return { ...usage };
  return {
    model: total.model ?? usage.model,
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    cachedTokens: total.cachedTokens + usage.cachedTokens,
    reasoningTokens: total.reasoningTokens + usage.reasoningTokens,
    calls: total.calls + usage.calls,
  };
}

export interface AreaExtractionOutcome extends ExtractionWriteCounts {
  area: string;
  usage: HarnessUsage | undefined;
  error: string | null;
}

export interface RunExtractionOutcome {
  areas: AreaExtractionOutcome[];
  usage: HarnessUsage | undefined;
  verification: GroundCounts & { total: number; error: string | null };
}

async function extractOneArea(
  db: Db,
  run: ResearchRun,
  area: string,
  call: ExtractorCall,
  seq: number,
): Promise<AreaExtractionOutcome> {
  const outcome: AreaExtractionOutcome = {
    area,
    usage: undefined,
    error: null,
    writtenFacts: 0,
    writtenRecords: 0,
    writtenFindings: 0,
    rejected: 0,
    rejections: [],
    droppedOutOfList: 0,
    droppedInvalid: 0,
  };
  try {
    const scope = area === SYNTHESIS_AREA ? null : assertArea(area);
    const [vocab, gathered] = await Promise.all([
      scope === null ? null : fetchAreaVocab(db, scope),
      gatherAreaNotes(db, run.id, scope),
    ]);
    const prompt =
      vocab === null
        ? assembleSynthesisPrompt(gathered)
        : assembleAreaPrompt(area, vocab, gathered);
    const callStarted = Date.now();
    let result: ExtractorCallResult | undefined;
    for (let attempt = 0; ; attempt += 1) {
      try {
        result = await call({ runId: run.id, area, prompt });
        break;
      } catch (err) {
        if (attempt >= EXTRACT_CALL_RETRIES) throw err;
        const message = err instanceof Error ? err.message : String(err);
        await recordEvent(db, run.id, "log", { extractionRetry: { area, attempt: attempt + 1, error: message.slice(0, 300) } });
      }
    }
    outcome.usage = result.usage;
    // Provider-call log; logging must never fail the extraction.
    try {
      await logExtractorCall(db, run, {
        seq,
        prompt,
        raw: result.raw,
        json: result.json,
        usage: result.usage,
        durationMs: Date.now() - callStarted,
      });
    } catch (err) {
      console.error(`extractor call log failed for ${run.id}/${area}: ${err instanceof Error ? err.message : err}`);
    }
    const validated = validateExtractionJson(area, gathered.sourceIds, result.json);
    const counts = await writeExtraction(db, run.companyId, run.id, area, validated);
    Object.assign(outcome, counts);
  } catch (err) {
    outcome.error = err instanceof Error ? err.message : String(err);
  }
  await recordEvent(db, run.id, "log", {
    extraction: {
      area,
      inputTokens: outcome.usage?.inputTokens ?? 0,
      outputTokens: outcome.usage?.outputTokens ?? 0,
      cachedTokens: outcome.usage?.cachedTokens ?? 0,
      reasoningTokens: outcome.usage?.reasoningTokens ?? 0,
      calls: outcome.usage?.calls ?? 0,
      writtenFacts: outcome.writtenFacts,
      writtenRecords: outcome.writtenRecords,
      writtenFindings: outcome.writtenFindings,
      rejected: outcome.rejected,
      rejections: outcome.rejections,
      droppedOutOfList: outcome.droppedOutOfList,
      droppedInvalid: outcome.droppedInvalid,
      error: outcome.error,
    },
  });
  return outcome;
}

/** Run the 7 area extractions plus the synthesis call, sequentially. */
export async function runExtraction(
  db: Db,
  run: ResearchRun,
  opts: { call?: ExtractorCall } = {},
): Promise<RunExtractionOutcome> {
  const call = opts.call ?? dockerExtractorCall;
  const areas: AreaExtractionOutcome[] = [];
  let usage: HarnessUsage | undefined;
  const allAreas = [...EXTRACT_AREAS, SYNTHESIS_AREA];
  for (let seq = 0; seq < allAreas.length; seq += 1) {
    const area = allAreas[seq] as string;
    const outcome = await extractOneArea(db, run, area, call, seq);
    areas.push(outcome);
    usage = addUsage(usage, outcome.usage);
  }
  // Grounding labels rows; it must never fail the extraction itself.
  let verification: GroundCounts & { total: number; error: string | null } = {
    verified: 0,
    docOnly: 0,
    mismatch: 0,
    unverified: 0,
    verifiedValue: 0,
    total: 0,
    error: null,
  };
  try {
    const counts = await verifyRunExtraction(db, run.id);
    verification = { ...counts, error: null };
  } catch (err) {
    verification.error = err instanceof Error ? err.message : String(err);
  }
  await recordEvent(db, run.id, "log", { grounding: { ...verification } });
  return { areas, usage, verification };
}

/**
 * Company jobs: an extraction with any failed area call (after retries) is a
 * failed stage, never a silent success with nothing written. The job can
 * then be retried (company_job_retry reruns extraction only).
 */
export function assertExtractionComplete(outcome: RunExtractionOutcome): void {
  const failed = outcome.areas.filter((a) => a.error !== null);
  if (failed.length === 0) return;
  const first = failed[0]?.error ?? "";
  throw new Error(
    `extraction incomplete: ${failed.length} of ${outcome.areas.length} area calls failed (${failed.map((a) => a.area).join(", ")}): ${first.slice(0, 200)}`,
  );
}

/**
 * Operator re-extraction of a terminal agent run. Prior extractor findings
 * for the run are removed first so a re-run replaces them (facts version
 * naturally, records upsert by natural key).
 */
export async function extractRun(
  db: Db,
  runId: string,
  opts: { call?: ExtractorCall } = {},
): Promise<RunExtractionOutcome> {
  const [run] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId));
  if (!run) throw new DomainError("not_found", `run not found: ${runId}`);
  if (run.kind !== "agent") throw new DomainError("invalid_input", `run ${runId} is not an agent run`);
  if (run.status === "queued" || run.status === "running") {
    throw new DomainError("invalid_input", `run ${runId} is still ${run.status}`);
  }
  await db.delete(findings).where(and(eq(findings.runId, runId), like(findings.createdBy, "extractor:%")));
  const previousPhase = run.agentPhase;
  await db.update(researchRuns).set({ agentPhase: "extracting" }).where(eq(researchRuns.id, runId));
  await recordEvent(db, runId, "phase", { phase: "extracting" });
  try {
    const outcome = await runExtraction(db, run, opts);
    if (outcome.usage) {
      const merged = addUsage(
        run.agentUsage
          ? {
              model: run.agentUsage.model,
              inputTokens: run.agentUsage.inputTokens,
              outputTokens: run.agentUsage.outputTokens,
              cachedTokens: run.agentUsage.cachedTokens,
              reasoningTokens: run.agentUsage.reasoningTokens,
              calls: run.agentUsage.calls,
            }
          : undefined,
        outcome.usage,
      );
      await db
        .update(researchRuns)
        .set({
          agentUsage: merged
            ? {
                model: merged.model,
                inputTokens: merged.inputTokens,
                outputTokens: merged.outputTokens,
                cachedTokens: merged.cachedTokens,
                reasoningTokens: merged.reasoningTokens,
                calls: merged.calls,
                childrenIncluded: run.agentUsage?.childrenIncluded ?? false,
                ...(run.agentUsage?.children ? { children: run.agentUsage.children } : {}),
                ...(run.agentUsage?.note ? { note: run.agentUsage.note } : {}),
              }
            : null,
        })
        .where(eq(researchRuns.id, runId));
    }
    return outcome;
  } finally {
    await db.update(researchRuns).set({ agentPhase: previousPhase }).where(eq(researchRuns.id, runId));
    await recordEvent(db, runId, "phase", { phase: previousPhase });
  }
}
