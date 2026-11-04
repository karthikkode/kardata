import { eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { harnessSettings, type RiaStep } from "../../db/schema.js";
import { quotaBreakerSet, parseQuotaExhaustion } from "../quota/breaker.js";
import { riaProviderGate, withRiaProvider } from "./provider.js";
import { CodexCallError } from "../../harness/codex-extract.js";
import { MAX_RIA_AI, riaAiSlots } from "./slots.js";
import { eligibleCompanyIds, recordStep, stepState, type StepOutcome } from "./status.js";

/**
 * RIA step runner (Stage 5.8 B2): batch steps over eligible firms, no
 * company-job stages. Skips firms already done (explicit lists re-run),
 * honours ria_step_pause and the 90% weekly quota stop for AI steps.
 */

export interface StepResult {
  status: StepOutcome;
  reason?: string | null;
  inputHash?: string | null;
  tokensUsed?: number | null;
  cached?: boolean;
}

export type StepHandler = (db: Db, sectorId: string, companyId: string) => Promise<StepResult>;
export type StepHandlers = Partial<Record<RiaStep, StepHandler>>;

export const AI_STEPS: ReadonlySet<RiaStep> = new Set(["ops_read", "contacts", "fee_schedule"]);

const PAUSE_KEY = "ria_step_paused";

export async function riaStepPaused(db: Db): Promise<boolean> {
  const [row] = await db.select().from(harnessSettings).where(eq(harnessSettings.key, PAUSE_KEY));
  const value = row?.value as { paused?: unknown } | null;
  return value?.paused === true;
}

export async function setRiaStepPaused(db: Db, paused: boolean): Promise<void> {
  await db
    .insert(harnessSettings)
    .values({ key: PAUSE_KEY, value: { paused }, updatedAt: new Date() })
    .onConflictDoUpdate({ target: harnessSettings.key, set: { value: { paused }, updatedAt: new Date() } });
}

export interface RunStepOutcome {
  step: RiaStep;
  considered: number;
  done: number;
  gap: number;
  failed: number;
  skippedDone: number;
  skippedInFlight: number;
  stopped: "pause" | "quota" | null;
  tokensUsed: number;
}

const inFlight = new WeakMap<Db, Map<string, Promise<void>>>();

export async function runRiaStep(
  db: Db,
  input: { sectorId: string; step: RiaStep; companyIds?: string[]; limit?: number; concurrency?: number; skipDone?: boolean },
  handlers: StepHandlers,
): Promise<RunStepOutcome> {
  const handler = handlers[input.step];
  if (!handler) throw new Error(`no handler for ria step ${input.step}`);
  const explicit = input.companyIds !== undefined;
  let ids: string[] = explicit ? [...new Set(input.companyIds ?? [])] : await eligibleCompanyIds(db, input.sectorId);
  if (input.limit !== undefined) ids = ids.slice(0, input.limit);
  const outcome: RunStepOutcome = {
    step: input.step,
    considered: ids.length,
    done: 0,
    gap: 0,
    failed: 0,
    skippedDone: 0,
    skippedInFlight: 0,
    stopped: null,
    tokensUsed: 0,
  };
  const queue = [...ids];
  let running = inFlight.get(db);
  if (!running) { running = new Map(); inFlight.set(db, running); }
  const workers = Array.from({ length: Math.max(1, Math.min(input.concurrency ?? 4, MAX_RIA_AI)) }, async () => {
    for (;;) {
      if (outcome.stopped) return;
      const companyId = queue.shift();
      if (companyId === undefined) return;
      if (input.skipDone ?? !explicit) {
        const existing = await stepState(db, input.sectorId, companyId, input.step);
        if (existing?.status === "done") { outcome.skippedDone += 1; continue; }
      }
      const key = `${input.sectorId}:${companyId}:${input.step}`;
      const current = running.get(key);
      if (current) {
        await current; outcome.skippedInFlight += 1;
        const shared = await stepState(db, input.sectorId, companyId, input.step);
        if (shared?.status === "failed") outcome.failed += 1;
        if (await riaStepPaused(db)) outcome.stopped = "pause";
        else if (AI_STEPS.has(input.step) && !(await riaProviderGate(db)).available) outcome.stopped = "quota";
        continue;
      }
      const execute = async () => {
        // Recheck after waiting for a shared slot: quota/pause may have changed.
        if (await riaStepPaused(db)) { outcome.stopped = "pause"; return; }
        const provider = AI_STEPS.has(input.step) ? await riaProviderGate(db) : null;
        if (provider && !provider.available) { outcome.stopped = "quota"; return; }
        try {
          const work = () => handler(db, input.sectorId, companyId);
          const result = await (provider ? withRiaProvider(provider.provider, work) : work());
          if (result.cached) { outcome.skippedDone += 1; return; }
          await recordStep(db, { sectorId: input.sectorId, companyId, step: input.step, ...result });
          outcome[result.status] += 1;
          outcome.tokensUsed += result.tokensUsed ?? 0;
        } catch (err) {
          let deepest = "step error";
          let cur: unknown = err;
          for (let i = 0; i < 5 && cur instanceof Error; i++) { deepest = cur.message; cur = (cur as { cause?: unknown }).cause; }
          if (err instanceof CodexCallError && (err.kind === "quota" || err.kind === "auth")) outcome.stopped = "quota";
          const quota = err instanceof CodexCallError ? { exhausted: false, resumeAt: null } : parseQuotaExhaustion(deepest);
          if (quota.exhausted) {
            outcome.stopped = "quota";
            await quotaBreakerSet(db, { trippedAt: new Date().toISOString(), resumeAt: quota.resumeAt?.toISOString() ?? null, estimated: false, jobIds: [], error: deepest.slice(0, 600) });
          }
          await recordStep(db, { sectorId: input.sectorId, companyId, step: input.step, status: "failed", reason: deepest.slice(0, 300) });
          outcome.failed += 1;
        }
      };
      const work = Promise.resolve().then(() => AI_STEPS.has(input.step) ? riaAiSlots.run(execute) : execute());
      running.set(key, work);
      try { await work; } finally { running.delete(key); }
    }
  });
  await Promise.all(workers);
  return outcome;
}
