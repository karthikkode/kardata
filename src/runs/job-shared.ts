import type { ResearchRun } from "../db/schema.js";
import { DomainError } from "../domain/errors.js";

/** Shared company-job helpers (moved from the removed bulk feeder). */

export const JOB_SAME_ERROR_PAUSE = 3;

export interface JobBudget {
  maxTokens?: number;
  maxHours?: number;
}

export function checkBudget(budget: JobBudget | undefined): {
  maxTokens: number | null;
  maxHours: number | null;
} {
  const maxTokens = budget?.maxTokens ?? null;
  const maxHours = budget?.maxHours ?? null;
  if (maxTokens !== null && (!Number.isInteger(maxTokens) || maxTokens < 1)) {
    throw new DomainError("invalid_input", "budget.maxTokens must be a positive integer");
  }
  if (maxHours !== null && (!Number.isFinite(maxHours) || maxHours <= 0 || maxHours > 720)) {
    throw new DomainError("invalid_input", "budget.maxHours must be within (0, 720]");
  }
  return { maxTokens, maxHours };
}

const USAGE_LIMIT = /usage|quota|subscription|rate.?limit|429|overloaded|capacity|billing/i;

/** Coarse failure class for the 3-same-errors auto-pause. */
export function classifyRunError(run: ResearchRun): { errorClass: string; error: string } {
  if (run.status === "stalled") return { errorClass: "stall", error: "run stalled" };
  const text = run.error ?? run.status;
  if (USAGE_LIMIT.test(text)) return { errorClass: "usage_limit", error: text };
  if (/time limit/i.test(text)) return { errorClass: "time_limit", error: text };
  if (/server stopped/i.test(text)) return { errorClass: "server_stopped", error: text };
  if (/^all areas blocked/i.test(text)) return { errorClass: "all_blocked", error: text };
  if (/^no area notes/i.test(text)) return { errorClass: "no_notes", error: text };
  return { errorClass: "failed", error: text };
}

export function usageInputTokens(run: ResearchRun): number {
  const usage = run.agentUsage;
  if (!usage) return 0;
  return (usage.inputTokens ?? 0) + (usage.cachedTokens ?? 0);
}
