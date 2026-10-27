import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { area, companies, researchRuns, sectorCompanies, type AgentOptions, type ResearchRun } from "../db/schema.js";
import { DomainError, isUniqueViolation } from "../domain/errors.js";
import { resolvePromptVersion } from "./prompt.js";

/**
 * Agent research batches (Stage 3b Step 2). researchStart creates one
 * kind=agent run per company; the agent runner (agent-runner.ts) drives them
 * through collecting → researching → terminal.
 */

export const RESEARCH_BATCH_MAX = 100;
export const DEFAULT_RECOLLECT_DAYS = 14;
export const DEFAULT_MAX_MINUTES = 40;
export const DEFAULT_MAX_MODEL_STEPS = 100;
export const BRIEF_MAX_BYTES = 2048;

export interface ResearchStartInput {
  companyIds: string[];
  areas?: string[];
  recollectIfOlderThanDays?: number;
  maxMinutes?: number;
  maxModelSteps?: number;
  brief?: string;
  promptVersion?: string;
  sectorId?: string;
  /** Stage 5: tag the run as a company-job subjob at creation (avoids a claim race). */
  companyJobId?: string;
  stage?: NonNullable<ResearchRun["stage"]>;
}

export type ResearchStartEntry =
  | { companyId: string; runId: string; status: "queued" }
  | { companyId: string; runId: string; status: "already_running" };

export interface ResearchStartResult {
  batchId: string;
  runs: ResearchStartEntry[];
}

function validatedAreas(areas: string[] | undefined): ResearchRun["requestedAreas"] {
  if (areas === undefined) return null;
  const names = area.enumValues as readonly string[];
  for (const a of areas) {
    if (!names.includes(a)) {
      throw new DomainError("invalid_input", `unknown area "${a}". Valid areas: ${names.join(", ")}`);
    }
  }
  return areas as ResearchRun["requestedAreas"];
}

function validatedOptions(input: ResearchStartInput): AgentOptions {
  const recollectDays = input.recollectIfOlderThanDays ?? DEFAULT_RECOLLECT_DAYS;
  if (!Number.isFinite(recollectDays) || recollectDays < 0) {
    throw new DomainError("invalid_input", "recollectIfOlderThanDays must be >= 0");
  }
  const maxMinutes = input.maxMinutes ?? DEFAULT_MAX_MINUTES;
  if (!Number.isFinite(maxMinutes) || maxMinutes <= 0) {
    throw new DomainError("invalid_input", "maxMinutes must be positive");
  }
  const maxModelSteps = input.maxModelSteps ?? DEFAULT_MAX_MODEL_STEPS;
  if (!Number.isInteger(maxModelSteps) || maxModelSteps <= 0) {
    throw new DomainError("invalid_input", "maxModelSteps must be a positive integer");
  }
  if (input.brief !== undefined && Buffer.byteLength(input.brief, "utf8") > BRIEF_MAX_BYTES) {
    throw new DomainError("invalid_input", `brief is at most ${BRIEF_MAX_BYTES} bytes`);
  }
  return {
    recollectDays,
    maxMinutes,
    maxModelSteps,
    ...(input.brief === undefined ? {} : { brief: input.brief }),
  };
}

export async function researchStart(db: Db, input: ResearchStartInput): Promise<ResearchStartResult> {
  if (input.companyIds.length === 0) {
    throw new DomainError("invalid_input", "at least one company id is required");
  }
  if (input.companyIds.length > RESEARCH_BATCH_MAX) {
    throw new DomainError("invalid_input", `at most ${RESEARCH_BATCH_MAX} companies per batch`);
  }
  const unique = [...new Set(input.companyIds)];
  const requestedAreas = validatedAreas(input.areas);
  const options = validatedOptions(input);
  const promptVersion = resolvePromptVersion(input.promptVersion);
  const found = await db
    .select({ id: companies.id })
    .from(companies)
    .where(inArray(companies.id, unique));
  const missing = unique.filter((id) => !found.some((f) => f.id === id));
  if (missing.length > 0) {
    throw new DomainError("invalid_input", `unknown companies: ${missing.join(", ")}`);
  }
  if (input.sectorId) {
    const memberRows = await db
      .select({ companyId: sectorCompanies.companyId })
      .from(sectorCompanies)
      .where(eq(sectorCompanies.sectorId, input.sectorId));
    const members = new Set(memberRows.map((r) => r.companyId));
    const outside = unique.filter((id) => !members.has(id));
    if (outside.length > 0) {
      throw new DomainError("invalid_input", `${outside.length} companies are not in this sector`);
    }
  }

  const batchId = randomUUID();
  const runs: ResearchStartEntry[] = [];
  for (const companyId of unique) {
    try {
      const [row] = await db
        .insert(researchRuns)
        .values({
          id: randomUUID(),
          companyId,
          kind: "agent",
          status: "queued",
          requestedAreas,
          batchId,
          agentOptions: options,
          promptVersion,
          companyJobId: input.companyJobId ?? null,
          stage: input.stage ?? null,
        })
        .returning({ id: researchRuns.id });
      if (!row) throw new Error("run insert returned no row");
      runs.push({ companyId, runId: row.id, status: "queued" });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const [active] = await db
        .select({ id: researchRuns.id })
        .from(researchRuns)
        .where(
          and(eq(researchRuns.companyId, companyId), sql`${researchRuns.status} IN ('queued', 'running')`),
        );
      if (!active) throw new Error("unique violation but no active run found");
      runs.push({ companyId, runId: active.id, status: "already_running" });
    }
  }
  return { batchId, runs };
}

/**
 * Fresh when a collect run finished successfully within the window. Failed or
 * cancelled collects gathered nothing, so they don't count.
 */
export async function hasFreshCollect(db: Db, companyId: string, recollectDays: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - recollectDays * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ id: researchRuns.id })
    .from(researchRuns)
    .where(
      and(
        eq(researchRuns.companyId, companyId),
        eq(researchRuns.kind, "collect"),
        gt(researchRuns.finishedAt, cutoff),
        sql`${researchRuns.status} IN ('succeeded', 'partial')`,
      ),
    )
    .orderBy(desc(researchRuns.finishedAt))
    .limit(1);
  return row !== undefined;
}
