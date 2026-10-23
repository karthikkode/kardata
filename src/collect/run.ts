import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies, documents, researchRuns, type Area, type ResearchRun } from "../db/schema.js";
import { toEffectiveCompany } from "../domain/companies.js";
import { getPreflightReport } from "../domain/company-jobs/preflight.js";
import { DomainError } from "../domain/errors.js";
import { saveDocument } from "../domain/research/documents.js";
import { setAreaStatus } from "../domain/research/status.js";
import { ADAPTERS, resolvePlanAdapters, skippedOutcomes, type SourceAdapter } from "./adapters.js";
import { recordEvent } from "./db.js";
import { BudgetExceededError, CancelledError } from "./fetch.js";
import {
  DEFAULT_ENDPOINTS,
  type AreaOutcome,
  type AreaOutcomeStatus,
  type CollectorCtx,
  type CollectorOptions,
  type RunShared,
} from "./collectors/types.js";

// Merge precedence across collectors covering the same area: evidence wins,
// then failures (a failure may hide data), then absence, then inapplicability.
const PRECEDENCE: AreaOutcomeStatus[] = ["done", "blocked", "error", "not_found", "skipped"];

export interface CollectRunResult {
  runId: string;
  status: "succeeded" | "partial" | "failed" | "cancelled";
  outcomes: AreaOutcome[];
  /** Adapter ids attempted, in run order. */
  adapters: string[];
  /** Adapters skipped by detect(), with reasons. */
  skippedAdapters: { id: string; reason: string }[];
  /** Plan ids no adapter covers (company jobs pause on these before starting; recorded here defensively). */
  unknownAdapters: string[];
}

export interface RunAdapters {
  adapters: SourceAdapter[];
  unknown: string[];
  /** True when a preflight plan selected the adapters. */
  planned: boolean;
}

/**
 * Which adapters a run executes. Company collect subjobs run exactly their
 * preflight plan; everything else runs all adapters (area filter applies).
 */
export async function resolveRunAdapters(db: Db, run: ResearchRun): Promise<RunAdapters> {
  if (!run.companyJobId || run.stage !== "collect") {
    return { adapters: [...ADAPTERS], unknown: [], planned: false };
  }
  const report = await getPreflightReport(db, run.companyJobId);
  const raw = (report?.report as { adaptersRequired?: unknown } | null)?.adaptersRequired;
  const ids = Array.isArray(raw)
    ? raw
        .map((entry) =>
          typeof entry === "object" && entry !== null && typeof (entry as { adapterId?: unknown }).adapterId === "string"
            ? ((entry as { adapterId: string }).adapterId)
            : "",
        )
        .filter((id) => id !== "")
    : null;
  if (ids === null) {
    await recordEvent(db, run.id, "log", { adapter_plan_missing: true });
    return { adapters: [...ADAPTERS], unknown: [], planned: false };
  }
  const { adapters, unknown } = resolvePlanAdapters(ids);
  return { adapters, unknown, planned: true };
}

export async function executeCollectRun(
  db: Db,
  runId: string,
  opts: CollectorOptions & { keepOpen?: boolean; adapters?: SourceAdapter[] } = {},
): Promise<CollectRunResult> {
  const [run] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId));
  if (!run) throw new DomainError("not_found", `run not found: ${runId}`);
  const [company] = await db.select().from(companies).where(eq(companies.id, run.companyId));
  if (!company) throw new DomainError("not_found", `company not found: ${run.companyId}`);

  const shared: RunShared = {};
  const ctx: CollectorCtx = {
    db,
    runId,
    companyId: company.id,
    company,
    effective: toEffectiveCompany(company),
    endpoints: { ...DEFAULT_ENDPOINTS, ...opts.endpoints },
    privateHostAllowlist: opts.privateHostAllowlist ?? [],
    shared,
  };

  const requested = run.requestedAreas;
  const onlyAdapters = run.requestedAdapters;
  const resolved = opts.adapters ? { adapters: opts.adapters, unknown: [], planned: false } : await resolveRunAdapters(db, run);
  const wanted = (adapter: SourceAdapter): boolean =>
    (!requested || requested.length === 0 || adapter.areas.some((a) => requested.includes(a))) &&
    (!onlyAdapters || onlyAdapters.length === 0 || onlyAdapters.includes(adapter.id));
  const active = resolved.adapters.filter(wanted);

  await db
    .update(researchRuns)
    .set({ status: "running", startedAt: new Date(), finishedAt: null, error: null })
    .where(eq(researchRuns.id, runId));

  const collected: AreaOutcome[] = [];
  const skippedAdapters: { id: string; reason: string }[] = [];
  let fatal: string | null = null;
  let cancelled = false;
  for (const adapter of active) {
    const [fresh] = await db
      .select({ status: researchRuns.status })
      .from(researchRuns)
      .where(eq(researchRuns.id, runId));
    if (fresh?.status === "cancelled" || cancelled) {
      cancelled = true;
      break;
    }
    await recordEvent(db, runId, "collector_start", { collector: adapter.id, version: adapter.version });
    if (adapter.detect) {
      const detected = await adapter.detect(ctx);
      if (!detected.applies) {
        const reason = detected.reason ?? "not applicable";
        collected.push(...skippedOutcomes(adapter, reason));
        skippedAdapters.push({ id: adapter.id, reason });
        await recordEvent(db, runId, "collector_end", {
          collector: adapter.id,
          version: adapter.version,
          outcomes: adapter.areas.map((a) => `${a}:not_found`),
          skipped: true,
          reason,
        });
        continue;
      }
    }
    try {
      const result = await adapter.collect(ctx);
      collected.push(...result.outcomes);
      if (result.fatal && !fatal) fatal = result.fatal;
      await recordEvent(db, runId, "collector_end", {
        collector: adapter.id,
        version: adapter.version,
        outcomes: result.outcomes.map((o) => `${o.area}:${o.status}`),
      });
    } catch (err) {
      if (err instanceof CancelledError) {
        cancelled = true;
        await recordEvent(db, runId, "collector_end", {
          collector: adapter.id,
          version: adapter.version,
          outcomes: [],
          cancelled: true,
        });
        break;
      }
      const message = err instanceof Error ? err.message : String(err);
      await recordEvent(db, runId, "error", { collector: adapter.id, message });
      for (const area of adapter.areas) {
        collected.push({ area, status: "error", reason: message });
      }
      await recordEvent(db, runId, "collector_end", {
        collector: adapter.id,
        version: adapter.version,
        outcomes: adapter.areas.map((a) => `${a}:error`),
      });
      if (err instanceof BudgetExceededError) {
        const covered = new Set(collected.map((o) => o.area));
        for (const c of active) {
          for (const area of c.areas) {
            if (!covered.has(area)) {
              collected.push({ area, status: "error", reason: message });
              covered.add(area);
            }
          }
        }
        break;
      }
    }
  }

  const scoped =
    requested && requested.length > 0 ? collected.filter((o) => requested.includes(o.area)) : collected;
  const outcomes = mergeOutcomes(scoped);
  for (const outcome of outcomes) {
    await setAreaStatus(db, {
      runId,
      area: outcome.area,
      status: outcome.status,
      reason: outcome.status === "done" ? null : (outcome.reason ?? outcome.status),
    });
    await recordEvent(db, runId, "area_status", {
      area: outcome.area,
      status: outcome.status,
      ...(outcome.status === "done" ? {} : { reason: outcome.reason ?? outcome.status }),
    });
  }

  await writeSummary(db, ctx, outcomes);

  const status = cancelled
    ? "cancelled"
    : fatal
      ? "failed"
      : outcomes.some((o) => o.status === "blocked" || o.status === "error")
        ? "partial"
        : "succeeded";
  // Agent runs collect as their first phase and stay open for researching.
  if (!opts.keepOpen) {
    await db
      .update(researchRuns)
      .set({ status, finishedAt: new Date(), error: fatal })
      .where(eq(researchRuns.id, runId));
  }
  return {
    runId,
    status,
    outcomes,
    adapters: active.map((a) => a.id),
    skippedAdapters,
    unknownAdapters: resolved.unknown,
  };
}

function mergeOutcomes(collected: AreaOutcome[]): AreaOutcome[] {
  const byArea = new Map<Area, AreaOutcome[]>();
  for (const outcome of collected) {
    const list = byArea.get(outcome.area) ?? [];
    list.push(outcome);
    byArea.set(outcome.area, list);
  }
  const merged: AreaOutcome[] = [];
  for (const [area, list] of byArea) {
    list.sort((a, b) => PRECEDENCE.indexOf(a.status) - PRECEDENCE.indexOf(b.status));
    const winner = list[0] as AreaOutcome;
    const reasons = [...new Set(list.filter((o) => o.status === winner.status && o.reason).map((o) => o.reason as string))];
    merged.push({
      area,
      status: winner.status,
      ...(winner.status === "done" || reasons.length === 0 ? {} : { reason: reasons.join("; ") }),
    });
  }
  merged.sort((a, b) => a.area.localeCompare(b.area));
  return merged;
}

async function writeSummary(db: Db, ctx: CollectorCtx, outcomes: AreaOutcome[]): Promise<void> {
  const rows = await db
    .select({ id: documents.id, area: documents.area })
    .from(documents)
    .where(eq(documents.runId, ctx.runId));
  const byArea = new Map<string, string[]>();
  for (const row of rows) {
    const key = row.area ?? "general";
    const list = byArea.get(key) ?? [];
    list.push(row.id);
    byArea.set(key, list);
  }
  const lines = outcomes.map((o) => {
    const ids = byArea.get(o.area) ?? [];
    const detail = o.status === "done" ? ids.join(", ") || "no documents" : (o.reason ?? o.status);
    return `- ${o.area}: ${o.status} (${detail})`;
  });
  if (lines.length === 0) lines.push("(no areas completed)");
  await saveDocument(db, {
    companyId: ctx.companyId,
    runId: ctx.runId,
    path: "meta/run-summary.md",
    kind: "summary",
    title: "Run summary",
    contentMd: lines.join("\n"),
    sourceIds: [],
    createdBy: "run",
  });
}
