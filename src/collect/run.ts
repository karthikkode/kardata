import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies, documents, researchRuns, type Area } from "../db/schema.js";
import { toEffectiveCompany } from "../domain/companies.js";
import { DomainError } from "../domain/errors.js";
import { saveDocument } from "../domain/research/documents.js";
import { setAreaStatus } from "../domain/research/status.js";
import { recordEvent } from "./db.js";
import { BudgetExceededError, CancelledError } from "./fetch.js";
import { COLLECTORS } from "./collectors/index.js";
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
}

export async function executeCollectRun(
  db: Db,
  runId: string,
  opts: CollectorOptions & { keepOpen?: boolean } = {},
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
  const wanted = (collector: (typeof COLLECTORS)[number]): boolean =>
    !requested || requested.length === 0 || collector.areas.some((a) => requested.includes(a));
  const active = COLLECTORS.filter(wanted);

  await db
    .update(researchRuns)
    .set({ status: "running", startedAt: new Date(), finishedAt: null, error: null })
    .where(eq(researchRuns.id, runId));

  const collected: AreaOutcome[] = [];
  let fatal: string | null = null;
  let cancelled = false;
  for (const collector of active) {
    const [fresh] = await db
      .select({ status: researchRuns.status })
      .from(researchRuns)
      .where(eq(researchRuns.id, runId));
    if (fresh?.status === "cancelled" || cancelled) {
      cancelled = true;
      break;
    }
    await recordEvent(db, runId, "collector_start", { collector: collector.name });
    try {
      const result = await collector.run(ctx);
      collected.push(...result.outcomes);
      if (result.fatal && !fatal) fatal = result.fatal;
      await recordEvent(db, runId, "collector_end", {
        collector: collector.name,
        outcomes: result.outcomes.map((o) => `${o.area}:${o.status}`),
      });
    } catch (err) {
      if (err instanceof CancelledError) {
        cancelled = true;
        await recordEvent(db, runId, "collector_end", {
          collector: collector.name,
          outcomes: [],
          cancelled: true,
        });
        break;
      }
      const message = err instanceof Error ? err.message : String(err);
      await recordEvent(db, runId, "error", { collector: collector.name, message });
      for (const area of collector.areas) {
        collected.push({ area, status: "error", reason: message });
      }
      await recordEvent(db, runId, "collector_end", {
        collector: collector.name,
        outcomes: collector.areas.map((a) => `${a}:error`),
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
  return { runId, status, outcomes };
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
