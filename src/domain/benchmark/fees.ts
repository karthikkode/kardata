import { createHash, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { documents, facts, riaStepRuns, sources } from "../../db/schema.js";
import { CodexCallError } from "../../harness/codex-extract.js";
import type { ExtractorCall } from "../../runs/extract.js";
import { getOrCreateManualRun } from "../../runs/queue.js";
import { DomainError } from "../errors.js";
import { parseQuotaExhaustion } from "../quota/breaker.js";
import { addFacts, type AddFactItem } from "../research/facts.js";
import { upsertRecords } from "../research/records.js";
import { isValidDateString } from "../research/validate.js";
import { splitBrochureItems, FULL_BROCHURE_PATH } from "../ria-steps/brochure.js";
import { brochureStep } from "../ria-steps/handlers.js";
import { riaExtractorCall } from "../ria-steps/provider.js";
import { runRiaStep, type StepHandler } from "../ria-steps/runner.js";
import { stepState } from "../ria-steps/status.js";
import { lockEvidence } from "../sec-adv/evidence.js";
import { activeMembers } from "../sec-adv/snapshot.js";
import { FEE_SCHEMA, feePrompt, groundFeeExtraction } from "./fee-extraction.js";

export const FEE_COLLECTOR = "benchmark_fee_schedule";
export const FEE_VERSION = "adv-2a-v1";
export const ITEM_5_PATH = "financials/brochure-item-5.md";
const ITEM_CAP = 30_000;
const ATTEMPTS = 3;

export interface FeeMetrics {
  companyId: string;
  attempts: number;
  retries: number;
  unmeteredAttempts: number;
  elapsedMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  outcome: "done" | "gap" | "failed" | "cached";
  reason?: string;
}

export async function currentItem5(db: Db, companyId: string) {
  const read = async (path: string) => (await db.select().from(documents).where(and(
    eq(documents.companyId, companyId), eq(documents.path, path), eq(documents.isCurrent, true),
  )))[0];
  const item = await read(ITEM_5_PATH);
  const full = await read(FULL_BROCHURE_PATH);
  const candidates = [item, full].flatMap(doc => {
    const date = doc?.title.match(/\b\d{4}-\d\d-\d\d\b/)?.[0];
    return doc && date && isValidDateString(date) ? [{ doc, date }] : [];
  }).sort((a, b) => b.date.localeCompare(a.date) || b.doc.createdAt.valueOf() - a.doc.createdAt.valueOf());
  for (const { doc, date } of candidates) {
    const text = doc.path === FULL_BROCHURE_PATH ? splitBrochureItems(doc.contentMd ?? "")["5"] ?? "" : doc.contentMd ?? "";
    if (text.trim().length >= 40 && text.length <= ITEM_CAP &&
        !/\.{6,}/.test(text.slice(0, 300)) && doc.sourceIds?.length) {
      return { id: doc.id, text, date, sourceIds: doc.sourceIds };
    }
  }
  return null;
}

function terminalProviderError(error: unknown) {
  return (error instanceof CodexCallError && error.kind !== "execution") ||
    parseQuotaExhaustion(error instanceof Error ? error.message : String(error)).exhausted;
}

export function createFeeStep(call: ExtractorCall, observe: (metrics: FeeMetrics) => void, fetchBrochure: StepHandler = brochureStep): StepHandler {
  return async (db, sectorId, companyId) => {
    const started = performance.now();
    const metrics: FeeMetrics = { companyId, elapsedMs: 0, attempts: 0, retries: 0, unmeteredAttempts: 0,
      inputTokens: null, outputTokens: null, outcome: "failed" };
    try {
      let item = await currentItem5(db, companyId);
      let reason = "no usable dated Item 5";
      if (!item) {
        let fetched = await fetchBrochure(db, sectorId, companyId);
        if (/fetch error.*HTTP 503/i.test(fetched.reason ?? "")) {
          await sleep(30_000);
          fetched = await fetchBrochure(db, sectorId, companyId);
        }
        item = await currentItem5(db, companyId);
        if (fetched.reason) reason = fetched.reason;
        if (!item && /fetch error.*(?:HTTP 429|HTTP 5\d\d|timeout|fetch failed|network)/i.test(reason)) throw new Error(reason);
      }
      const inputHash = createHash("sha256").update(`${FEE_VERSION}:${item?.id ?? reason}`).digest("hex");
      const prior = await stepState(db, sectorId, companyId, "fee_schedule");
      if (prior?.inputHash === inputHash && prior.status !== "failed") {
        metrics.outcome = "cached";
        return { status: prior.status, inputHash, cached: true };
      }
      const runId = await getOrCreateManualRun(db, companyId);
      let result: ReturnType<typeof groundFeeExtraction> | null = null;
      if (item) {
        const prompt = feePrompt(item.text);
        for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
          metrics.attempts = attempt;
          let metered = false;
          try {
            const extracted = await call({ runId, area: "fee_schedule", prompt, schema: FEE_SCHEMA });
            if (extracted.usage) {
              metered = true;
              metrics.inputTokens = (metrics.inputTokens ?? 0) + extracted.usage.inputTokens + extracted.usage.cachedTokens;
              metrics.outputTokens = (metrics.outputTokens ?? 0) + extracted.usage.outputTokens;
            }
            result = groundFeeExtraction(extracted.json, item.text);
            break;
          } catch (error) {
            if (terminalProviderError(error) || attempt === ATTEMPTS) throw error;
          } finally {
            if (!metered) metrics.unmeteredAttempts++;
          }
        }
      }
      const extraction = result;
      const status = extraction ? "available" : "unavailable";
      await db.transaction(async tx => {
        await lockEvidence(tx, `company:${companyId}:fees`);
        const [existing] = await tx.select({ id: facts.id }).from(facts).where(and(eq(facts.companyId, companyId),
          eq(facts.key, "fee_schedule.status"), eq(facts.createdBy, FEE_COLLECTOR),
          eq(facts.qualifiers, { extraction: FEE_VERSION, input: inputHash })));
        if (existing) return;
        const sourceIds = item ? item.sourceIds : (await tx.insert(sources).values({
          id: randomUUID(), runId, companyId, url: "kardata:benchmark/fee-extraction",
          finalUrl: "kardata:benchmark/fee-extraction", collector: FEE_COLLECTOR, status: "not_found", error: reason,
        }).returning({ id: sources.id })).map(row => row.id);
        const common = { qualifiers: { extraction: FEE_VERSION, input: inputHash }, asOf: item?.date ?? null, sourceIds };
        const factsToWrite: AddFactItem[] = [{ ...common, key: "fee_schedule.status", value: status, note: extraction ? null : reason }];
        if (extraction && item) {
          factsToWrite.push({ ...common, key: "firm.fee_schedule", value: extraction,
            quote: extraction.tierQuotes[0] ?? null, quoteSourceId: extraction.tierQuotes.length ? sourceIds[0] : null,
            note: extraction.formula });
          const saved = await upsertRecords(tx, { companyId, runId, createdBy: FEE_COLLECTOR, records: [{
            type: "fee_schedule_terms", naturalKey: ["input_hash"], sourceIds,
            data: { input_hash: inputHash, brochure_date: item.date, extraction },
          }] });
          if (!saved[0]?.ok) throw new Error("could not save grounded fee terms");
        }
        const saved = await addFacts(tx, { companyId, runId, createdBy: FEE_COLLECTOR, facts: factsToWrite });
        const failure = saved.find(row => !row.ok);
        if (failure && !failure.ok) throw new Error(failure.error);
      });
      metrics.outcome = extraction ? "done" : "gap";
      if (!extraction) metrics.reason = reason;
      return { status: metrics.outcome, reason: metrics.reason, inputHash, tokensUsed: metrics.inputTokens };
    } catch (error) {
      metrics.reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      throw error;
    } finally {
      metrics.retries = Math.max(metrics.attempts - 1, 0);
      metrics.elapsedMs = Math.round(performance.now() - started);
      observe(metrics);
    }
  };
}

export function feePilotSummary(results: FeeMetrics[], cohortSize: number, elapsedMs: number) {
  const measured = results.filter(row => row.outcome !== "cached");
  const retries = measured.reduce((sum, row) => sum + row.retries, 0);
  const input = measured.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0);
  const output = measured.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0);
  const size = measured.length;
  const missingTokenReports = measured.reduce((sum, row) => sum + row.unmeteredAttempts, 0);
  return {
    measured: size, meanRetries: size ? retries / size : 0,
    gaps: measured.filter(row => row.outcome === "gap").length, failures: measured.filter(row => row.outcome === "failed").length,
    missingTokenReports,
    projected: size ? { companies: cohortSize, inputTokens: Math.ceil(input * cohortSize / size),
      outputTokens: Math.ceil(output * cohortSize / size), elapsedMs: Math.ceil(elapsedMs * cohortSize / size),
      tokensAreLowerBound: missingTokenReports > 0 } : null,
  };
}

export async function runBenchmarkFees(db: Db, input: {
  sectorId: string; companyIds?: string[]; afterCompanyId?: string; limit?: number; concurrency?: number; pilot?: boolean;
}) {
  const cohort = await activeMembers(db, input.sectorId);
  const wanted = input.companyIds && new Set(input.companyIds);
  const limit = input.limit ?? 100;
  const selected = wanted ? cohort.filter(row => wanted.has(row.id)) :
    cohort.filter(row => !input.afterCompanyId || row.id > input.afterCompanyId).slice(0, limit);
  if (wanted && wanted.size !== selected.length) throw new DomainError("invalid_input", "selected companies must be active sector members");
  if (input.pilot && (!wanted || selected.length < 20 || selected.length > 30)) throw new DomainError("invalid_input", "select 20–30 firms for a pilot");
  const concurrency = input.concurrency ?? 4;
  const started = performance.now();
  const results: FeeMetrics[] = [];
  const handler = createFeeStep(riaExtractorCall(db), row => results.push(row));
  let stopped: "pause" | "quota" | "retry_threshold" | null = null;
  let nextCompanyId: string | null = null;
  for (let i = 0; i < selected.length; i += concurrency) {
    const ids = selected.slice(i, i + concurrency).map(row => row.id);
    const offset = results.length;
    const result = await runRiaStep(db, { sectorId: input.sectorId, companyIds: ids, step: "fee_schedule", concurrency, skipDone: false },
      { fee_schedule: handler });
    for (const metrics of results.slice(offset)) {
      if (metrics.outcome === "cached") continue;
      await db.update(riaStepRuns).set({ telemetry: { ...metrics } }).where(and(
        eq(riaStepRuns.sectorId, input.sectorId), eq(riaStepRuns.companyId, metrics.companyId), eq(riaStepRuns.step, "fee_schedule"),
      ));
    }
    stopped = result.stopped;
    if (input.pilot && feePilotSummary(results, cohort.length, performance.now() - started).meanRetries > 1) stopped ??= "retry_threshold";
    if (stopped) break;
    nextCompanyId = ids.at(-1) ?? null;
  }
  const elapsedMs = Math.round(performance.now() - started);
  return { results, stopped, nextCompanyId, concurrency, elapsedMs,
    summary: feePilotSummary(results, cohort.length, elapsedMs) };
}
