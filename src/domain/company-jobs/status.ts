import { eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { companyJobs, researchRuns, type CompanyJob, type ResearchRun } from "../../db/schema.js";
import { DomainError } from "../errors.js";

/** Pipeline stages in order. Every company job runs all four, always. */
export const COMPANY_STAGES = ["preflight", "collect", "research", "extraction"] as const;
export type CompanyStage = (typeof COMPANY_STAGES)[number];

const TERMINAL_SUBJOB = ["succeeded", "partial", "failed", "stalled", "cancelled"] as const;

export function isTerminalSubjob(status: string): boolean {
  return (TERMINAL_SUBJOB as readonly string[]).includes(status);
}

/** A stage counts as done only on success (partial collect is a success, as in bulk jobs). */
export function isStageComplete(run: ResearchRun | null): boolean {
  return run !== null && (run.status === "succeeded" || run.status === "partial");
}

export function isStageFailed(run: ResearchRun | null): boolean {
  return run !== null && (run.status === "failed" || run.status === "stalled" || run.status === "cancelled");
}

export interface StageState {
  stage: CompanyStage;
  /** Latest subjob for the stage (retries supersede), or null if never attempted. */
  run: ResearchRun | null;
}

/**
 * Derived company completion (AC-2). This is the only definition of done:
 * complete ⟺ all four stages complete. Anything else is incomplete (still
 * working or waiting) or failed (a stage failed and needs a retry).
 */
export type CompanyDerived = "incomplete" | "complete" | "failed";

export interface CompanyJobDescription {
  job: CompanyJob;
  stages: StageState[];
  derived: CompanyDerived;
  /** Earliest stage that still needs work, or null when complete. */
  nextStage: CompanyStage | null;
}

export async function describeCompanyJob(db: Db, jobId: string): Promise<CompanyJobDescription> {
  const [job] = await db.select().from(companyJobs).where(eq(companyJobs.id, jobId));
  if (!job) throw new DomainError("not_found", `company job not found: ${jobId}`);
  const rows = await db.select().from(researchRuns).where(eq(researchRuns.companyJobId, jobId));
  const latest = new Map<CompanyStage, ResearchRun>();
  for (const row of rows) {
    if (row.stage === null) continue;
    const stage = row.stage as CompanyStage;
    if (!COMPANY_STAGES.includes(stage)) continue;
    const prev = latest.get(stage);
    if (!prev || row.createdAt.getTime() >= prev.createdAt.getTime()) latest.set(stage, row);
  }
  const stages: StageState[] = COMPANY_STAGES.map((stage) => ({ stage, run: latest.get(stage) ?? null }));
  // A failed stage anywhere means the whole company failed (atomicity);
  // complete needs all four stages; otherwise still working or waiting.
  let derived: CompanyDerived = "incomplete";
  if (stages.some((s) => isStageFailed(s.run))) derived = "failed";
  else if (stages.every((s) => isStageComplete(s.run))) derived = "complete";
  const next = stages.find((s) => !isStageComplete(s.run));
  return { job, stages, derived, nextStage: next?.stage ?? null };
}
