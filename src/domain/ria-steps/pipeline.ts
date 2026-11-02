import type { Db } from "../../db/client.js";
import type { RiaStep } from "../../db/schema.js";
import { DomainError } from "../errors.js";
import { eligibleCompanyIds } from "./status.js";
import { runRiaStep, type RunStepOutcome, type StepHandlers } from "./runner.js";
import { MAX_RIA_AI, riaAiSlots, riaCollectSlots } from "./slots.js";
import { storedSourceStats } from "./stored-source.js";
import { cleanStoredOfficerTitles } from "./officers.js";

export interface PipelineResult {
  considered: number;
  completed: number;
  failed: number;
  retries: number;
  stopped: "pause" | "quota" | null;
  steps: Partial<Record<RiaStep, { done: number; gap: number; failed: number; skipped: number }>>;
}
const progress = new WeakMap<Db, Set<{ sectorId: string; startedAt: string; result: PipelineResult }>>();
export function riaPipelineStatus(db: Db) {
  return { sources: { ...storedSourceStats }, ai: riaAiSlots.snapshot(), collection: riaCollectSlots.snapshot(), pipelines: [...(progress.get(db) ?? [])] };
}
const active = new WeakMap<Db, Set<string>>();

/** Continuously replenish company workers; no batch barrier between firms. */
export async function runRiaPipeline(db: Db, input: { sectorId: string; companyIds: string[]; concurrency?: number }, handlers: StepHandlers): Promise<PipelineResult> {
  if (input.concurrency !== undefined && (!Number.isInteger(input.concurrency) || input.concurrency < 1 || input.concurrency > MAX_RIA_AI)) throw new DomainError("invalid_input", "concurrency must be 1..64");
  const ids = [...new Set(input.companyIds)];
  const eligible = new Set(await eligibleCompanyIds(db, input.sectorId));
  if (ids.some((id) => !eligible.has(id))) throw new DomainError("invalid_input", "pipeline accepts eligible sector members only");
  let locked = active.get(db);
  if (!locked) { locked = new Set(); active.set(db, locked); }
  const keys = ids.map((id) => `${input.sectorId}:${id}`);
  if (keys.some((key) => locked.has(key))) throw new DomainError("invalid_input", "a requested firm is already in an active RIA pipeline");
  for (const key of keys) locked.add(key);
  const result: PipelineResult = { considered: ids.length, completed: 0, failed: 0, retries: 0, stopped: null, steps: {} };
  const queue = [...ids];
  let fatal = false;
  let reports = progress.get(db);
  if (!reports) { reports = new Set(); progress.set(db, reports); }
  const report = { sectorId: input.sectorId, startedAt: new Date().toISOString(), result };
  reports.add(report);
  const step = async (name: RiaStep, id: string): Promise<RunStepOutcome> => {
    let value = await runRiaStep(db, { sectorId: input.sectorId, step: name, companyIds: [id], concurrency: 1, skipDone: false }, handlers);
    if (value.failed && !value.stopped) {
      // One bounded retry handles transient model/network errors; success is
      // recorded once, and a remaining failure stays explicit for the operator.
      result.retries += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
      value = await runRiaStep(db, { sectorId: input.sectorId, step: name, companyIds: [id], concurrency: 1, skipDone: false }, handlers);
    }
    const totals = result.steps[name] ?? { done: 0, gap: 0, failed: 0, skipped: 0 };
    totals.done += value.done; totals.gap += value.gap; totals.failed += value.failed;
    totals.skipped += value.skippedDone + value.skippedInFlight; result.steps[name] = totals;
    if (value.stopped) result.stopped = value.stopped;
    return value;
  };
  try {
    if (!ids.length) return result;
    await cleanStoredOfficerTitles(db, { sectorId: input.sectorId, companyIds: ids, dryRun: false });
    const settled = await Promise.allSettled(Array.from({ length: Math.min(ids.length, input.concurrency ?? MAX_RIA_AI, MAX_RIA_AI) }, async () => {
      try {
        while (!result.stopped && !fatal) {
          const id = queue.shift(); if (!id) return;
          const outcomes: RunStepOutcome[] = [];
          await riaCollectSlots.run(async () => {
            for (const name of ["firm_data", "brochure"] as const) {
              if (result.stopped || fatal) return;
              outcomes.push(await step(name, id));
            }
          });
          if (result.stopped || fatal) return;
          outcomes.push(...await Promise.all([step("ops_read", id), step("contacts", id)]));
          if (outcomes.some((r) => r.stopped)) return;
          outcomes.push(await step("signals", id));
          if (outcomes.some((r) => r.stopped)) return;
          if (outcomes.some((r) => r.failed)) result.failed += 1;
          else result.completed += 1;
        }
      } catch (error) { fatal = true; throw error; }
    }));
    const rejected = settled.find((r) => r.status === "rejected");
    if (rejected?.status === "rejected") throw rejected.reason;
    return result;
  } finally {
    reports.delete(report);
    for (const key of keys) locked.delete(key);
  }
}
