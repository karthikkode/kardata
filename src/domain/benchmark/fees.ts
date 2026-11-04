import { createHash, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { facts, sources } from "../../db/schema.js";
import { CodexCallError } from "../../harness/codex-extract.js";
import type { ExtractorCall } from "../../runs/extract.js";
import { getOrCreateManualRun } from "../../runs/queue.js";
import { parseQuotaExhaustion } from "../quota/breaker.js";
import { addFacts, type AddFactItem } from "../research/facts.js";
import { upsertRecords } from "../research/records.js";
import { createBrochureStep } from "../ria-steps/handlers.js";
import { riaExtractorCall, riaProviderGate, withRiaProvider } from "../ria-steps/provider.js";
import { riaStepPaused, RiaStepInterrupted, runRiaStep, type StepHandler } from "../ria-steps/runner.js";
import { stepState } from "../ria-steps/status.js";
import { lockEvidence } from "../sec-adv/evidence.js";
import { FEE_SCHEMA, feeReviewResponse } from "./fee-extraction.js";
import { loadBrochureEvidence, needsWrapFiling, reviewBrochures } from "./brochure-review.js";

export const FEE_COLLECTOR = "benchmark_fee_schedule";
export const FEE_VERSION = "adv-2a-v4";
const fetchFeeBrochures = createBrochureStep(false, true);
const ATTEMPTS = 3;

export interface FeeMetrics {
  companyId: string;
  attempts: number;
  retries: number;
  unmeteredAttempts: number;
  elapsedMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  outcome: "done" | "gap" | "failed" | "cached" | "interrupted";
  reason?: string;
  classification?: string;
  reviewedPages?: number;
  readMode?: "item_5" | "full_fallback";
  scheduleDrops?: number;
  models?: string[];
}

function terminalProviderError(error: unknown) {
  return error instanceof RiaStepInterrupted || (error instanceof CodexCallError && error.kind !== "execution") ||
    parseQuotaExhaustion(error instanceof Error ? error.message : String(error)).exhausted;
}

export function createFeeStep(call: ExtractorCall, observe: (metrics: FeeMetrics) => void, fetchBrochure: StepHandler = fetchFeeBrochures): StepHandler {
  return async (db, sectorId, companyId) => {
    const started = performance.now();
    const metrics: FeeMetrics = { companyId, elapsedMs: 0, attempts: 0, retries: 0, unmeteredAttempts: 0,
      inputTokens: null, outputTokens: null, outcome: "failed" };
    try {
      let evidence = await loadBrochureEvidence(db, companyId);
      let reason = "no usable dated fee brochure";
      if (!evidence.firmFound || !evidence.passages.length || needsWrapFiling(evidence.item5, evidence.passages)) {
        let fetched = await fetchBrochure(db, sectorId, companyId);
        if (/fetch error.*HTTP 503/i.test(fetched.reason ?? "")) {
          await sleep(30_000);
          fetched = await fetchBrochure(db, sectorId, companyId);
        }
        evidence = await loadBrochureEvidence(db, companyId);
        if (fetched.reason) reason = fetched.reason;
        if (/fetch error.*(?:HTTP 429|HTTP 5\d\d|timeout|fetch failed|network)/i.test(reason)) throw new Error(reason);
        if (fetched.status === "gap") {
          evidence.gaps.push(reason);
          if (/fetch error|unreadable/i.test(reason)) evidence.complete = false;
        }
      }
      const inputHash = createHash("sha256").update(JSON.stringify({
        version: FEE_VERSION, documents: evidence.passages.map(passage => [passage.documentId, passage.sourceId, passage.page]),
        gaps: evidence.gaps, reason,
      })).digest("hex");
      const prior = await stepState(db, sectorId, companyId, "fee_schedule");
      if (prior?.inputHash === inputHash && prior.status !== "failed") {
        metrics.outcome = "cached";
        return { status: prior.status, inputHash, cached: true };
      }
      const runId = await getOrCreateManualRun(db, companyId);
      const extraction = evidence.passages.length ? await reviewBrochures(evidence.passages, evidence, async prompt => {
        for (let attempt = 1; ; attempt++) {
          metrics.attempts++;
          if (attempt > 1) metrics.retries++;
          let metered = false;
          try {
            const extracted = await call({ runId, area: "fee_schedule", prompt, schema: FEE_SCHEMA });
            if (extracted.usage) {
              metered = true;
              metrics.inputTokens = (metrics.inputTokens ?? 0) + extracted.usage.inputTokens + extracted.usage.cachedTokens;
              if (extracted.usage.model) metrics.models = [...new Set([...(metrics.models ?? []), extracted.usage.model])];
              metrics.outputTokens = (metrics.outputTokens ?? 0) + extracted.usage.outputTokens;
            }
            return feeReviewResponse.parse(extracted.json);
          } catch (error) {
            if (error instanceof RiaStepInterrupted) {
              metrics.attempts--;
              if (attempt > 1) metrics.retries--;
              metered = true;
            }
            if (terminalProviderError(error) || attempt === ATTEMPTS) throw error;
          } finally {
            if (!metered) metrics.unmeteredAttempts++;
          }
        }
      }) : null;
      if (extraction) {
        metrics.classification = extraction.classification;
        metrics.reviewedPages = extraction.coverage.reviewedPages;
        metrics.readMode = extraction.readMode;
        metrics.scheduleDrops = extraction.drops.length;
      } else if (evidence.gaps.length) reason = evidence.gaps.join("; ");
      const usableFees = extraction && extraction.classification !== "no_grounded_schedule";
      if (extraction && !usableFees) reason = ["No grounded fee terms in the reviewed brochure", ...extraction.coverage.gaps].join("; ");
      const status = usableFees ? "available" : "unavailable";
      await db.transaction(async tx => {
        await lockEvidence(tx, `company:${companyId}:fees`);
        const [existing] = await tx.select({ id: facts.id }).from(facts).where(and(eq(facts.companyId, companyId),
          eq(facts.key, "fee_schedule.status"), eq(facts.createdBy, FEE_COLLECTOR),
          eq(facts.qualifiers, { extraction: FEE_VERSION, input: inputHash })));
        if (existing) return;
        const sourceIds = evidence.sourceIds.length ? evidence.sourceIds : (await tx.insert(sources).values({
          id: randomUUID(), runId, companyId, url: "kardata:benchmark/fee-extraction",
          finalUrl: "kardata:benchmark/fee-extraction", collector: FEE_COLLECTOR, status: "not_found", error: reason,
        }).returning({ id: sources.id })).map(row => row.id);
        const common = { qualifiers: { extraction: FEE_VERSION, input: inputHash }, asOf: extraction?.benchmarkScope?.date ?? evidence.date ?? null, sourceIds };
        const factsToWrite: AddFactItem[] = [{ ...common, key: "fee_schedule.status", value: status, note: usableFees ? null : reason }];
        if (extraction) {
          const { preliminary, ...summary } = extraction;
          factsToWrite.push({ ...common, key: "firm.fee_schedule", value: summary,
            quote: extraction.tierQuotes[0] ?? null, quoteSourceId: extraction.tierQuotes.length ? extraction.benchmarkScope?.sourceId : null,
            note: extraction.formula });
          const saved = await upsertRecords(tx, { companyId, runId, createdBy: FEE_COLLECTOR, records: [{
            type: "fee_schedule_terms", naturalKey: ["input_hash"], sourceIds,
            data: { input_hash: inputHash, brochure_date: evidence.date, extraction: summary, preliminary },
          }] });
          if (!saved[0]?.ok) throw new Error("could not save grounded fee terms");
        }
        const saved = await addFacts(tx, { companyId, runId, createdBy: FEE_COLLECTOR, facts: factsToWrite });
        const failure = saved.find(row => !row.ok);
        if (failure && !failure.ok) throw new Error(failure.error);
      });
      metrics.outcome = usableFees ? "done" : "gap";
      if (!usableFees) metrics.reason = reason;
      return { status: metrics.outcome, reason: metrics.reason, inputHash, tokensUsed: metrics.inputTokens };
    } catch (error) {
      if (error instanceof RiaStepInterrupted) metrics.outcome = "interrupted";
      metrics.reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      throw error;
    } finally {
      metrics.elapsedMs = Math.round(performance.now() - started);
      observe(metrics);
    }
  };
}

export function feePilotSummary(results: FeeMetrics[], cohortSize: number, elapsedMs: number) {
  const measured = results.filter(row => row.outcome !== "cached" && row.outcome !== "interrupted");
  const retries = measured.reduce((sum, row) => sum + row.retries, 0);
  const input = measured.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0);
  const output = measured.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0);
  const size = measured.length;
  const missingTokenReports = measured.reduce((sum, row) => sum + row.unmeteredAttempts, 0);
  const classifications: Record<string, number> = {};
  for (const row of measured) {
    if (row.classification) classifications[row.classification] = (classifications[row.classification] ?? 0) + 1;
  }
  return {
    measured: size, classifications, interrupted: results.filter(row => row.outcome === "interrupted").length, meanRetries: size ? retries / size : 0,
    gaps: measured.filter(row => row.outcome === "gap").length, failures: measured.filter(row => row.outcome === "failed").length,
    missingTokenReports,
    projected: size ? { companies: cohortSize, inputTokens: Math.ceil(input * cohortSize / size),
      outputTokens: Math.ceil(output * cohortSize / size), elapsedMs: Math.ceil(elapsedMs * cohortSize / size),
      tokensAreLowerBound: missingTokenReports > 0 } : null,
  };
}

export async function runBenchmarkFeeWave(db: Db, input: {
  jobId: string;
  sectorId: string;
  companyIds: string[];
  shouldContinue: () => boolean;
  onResult: (result: FeeMetrics) => Promise<void>;
}): Promise<"pause" | "quota" | null> {
  const extract = riaExtractorCall(db);
  const work = input.companyIds.map(async companyId => {
    if (!input.shouldContinue()) return "pause" as const;
    let metrics: FeeMetrics | undefined;
    const handler = createFeeStep(async request => {
      if (!input.shouldContinue() || await riaStepPaused(db)) throw new RiaStepInterrupted("pause");
      const gate = await riaProviderGate(db);
      if (!gate.available) throw new RiaStepInterrupted("quota");
      return withRiaProvider(gate.provider, () => extract(request));
    }, row => { metrics = row; });
    const result = await runRiaStep(db, {
      sectorId: input.sectorId, companyIds: [companyId], step: "fee_schedule",
      telemetry: (_id, stopped) => {
        if (!metrics) return undefined;
        if (stopped === "quota" && metrics.outcome === "failed") metrics.outcome = "interrupted";
        return { ...metrics, feeJobId: input.jobId };
      },
    }, { fee_schedule: handler });
    if (metrics) await input.onResult(metrics);
    else if (!result.stopped) {
      throw new Error("fee worker did not produce a result");
    }
    return result.stopped;
  });
  // Drain all concurrent handlers before releasing the job lease, even if
  // persisting one result failed.
  const results = await Promise.allSettled(work);
  let stopped: "pause" | "quota" | null = null;
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
    stopped ??= result.value;
  }
  return stopped;
}
