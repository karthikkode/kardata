import { eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { harnessSettings, type RiaStep } from "../../db/schema.js";
import { quotaSnapshotWeeklyPct } from "../quota/breaker.js";
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
}

export type StepHandler = (db: Db, sectorId: string, companyId: string) => Promise<StepResult>;
export type StepHandlers = Partial<Record<RiaStep, StepHandler>>;

export const AI_STEPS: ReadonlySet<RiaStep> = new Set(["fees", "contacts"]);

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
  stopped: "pause" | "quota" | null;
  tokensUsed: number;
}

export async function runRiaStep(
  db: Db,
  input: { sectorId: string; step: RiaStep; companyIds?: string[]; limit?: number; concurrency?: number },
  handlers: StepHandlers,
): Promise<RunStepOutcome> {
  const handler = handlers[input.step];
  if (!handler) throw new Error(`no handler for ria step ${input.step}`);
  const explicit = input.companyIds !== undefined;
  let ids: string[] = explicit ? [...(input.companyIds ?? [])] : await eligibleCompanyIds(db, input.sectorId);
  if (input.limit !== undefined) ids = ids.slice(0, input.limit);
  const outcome: RunStepOutcome = {
    step: input.step,
    considered: ids.length,
    done: 0,
    gap: 0,
    failed: 0,
    skippedDone: 0,
    stopped: null,
    tokensUsed: 0,
  };
  const queue = [...ids];
  const workers = Array.from({ length: Math.max(1, Math.min(input.concurrency ?? 4, 16)) }, async () => {
    for (;;) {
      if (outcome.stopped) return;
      const companyId = queue.shift();
      if (companyId === undefined) return;
      if (await riaStepPaused(db)) {
        outcome.stopped = "pause";
        return;
      }
      if (AI_STEPS.has(input.step)) {
        const snap = await quotaSnapshotWeeklyPct(db);
        if (snap.weeklyPct !== null && snap.weeklyPct >= 90) {
          outcome.stopped = "quota";
          return;
        }
      }
      if (!explicit) {
        const existing = await stepState(db, input.sectorId, companyId, input.step);
        if (existing?.status === "done") {
          outcome.skippedDone += 1;
          continue;
        }
      }
      try {
        const result = await handler(db, input.sectorId, companyId);
        await recordStep(db, {
          sectorId: input.sectorId,
          companyId,
          step: input.step,
          status: result.status,
          reason: result.reason ?? null,
          inputHash: result.inputHash ?? null,
          tokensUsed: result.tokensUsed ?? null,
        });
        outcome[result.status] += 1;
        outcome.tokensUsed += result.tokensUsed ?? 0;
      } catch (err) {
        // The deepest cause names the actual failure (e.g. the Postgres
        // constraint); the wrapper message is a truncated query dump.
        let deepest = "step error";
        let cur: unknown = err;
        for (let i = 0; i < 5 && cur instanceof Error; i++) {
          deepest = cur.message;
          cur = (cur as { cause?: unknown }).cause;
        }
        await recordStep(db, {
          sectorId: input.sectorId,
          companyId,
          step: input.step,
          status: "failed",
          reason: deepest.slice(0, 300),
        });
        outcome.failed += 1;
      }
    }
  });
  await Promise.all(workers);
  return outcome;
}
