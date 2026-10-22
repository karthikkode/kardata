import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { companyJobs, researchRuns, runEvents } from "../../db/schema.js";
import { DomainError } from "../errors.js";
import { describeCompanyJob, isTerminalSubjob, type CompanyStage } from "./status.js";

/** Same default as the agent runner (AGENT_STALL_SECONDS); read here to stay layer-clean. */
function stallSeconds(): number {
  const raw = Number(process.env.AGENT_STALL_SECONDS ?? "300");
  return Number.isFinite(raw) && raw > 0 ? raw : 300;
}

export interface LiveCall {
  at: Date;
  tool: string;
  status: string;
}

export interface LiveArea {
  area: string;
  status: string;
  updatedAt: Date;
}

export interface LiveActive {
  stage: CompanyStage;
  runId: string;
  runStatus: string;
  phase: string | null;
  startedAt: Date | null;
  lastActivityAt: Date | null;
  secondsSinceActivity: number | null;
  stallInSeconds: number | null;
  runInputTokens: number;
  childAgents: number;
  areas: LiveArea[];
  recentCalls: LiveCall[];
}

export interface CompanyJobLive {
  job: {
    id: string;
    status: string;
    currentStage: string | null;
    pauseReason: string | null;
    inputTokensSpent: number;
  };
  stages: { stage: CompanyStage; status: string | null; attempts: number }[];
  active: LiveActive | null;
}

function usageInputTokens(usage: unknown): number {
  if (typeof usage !== "object" || usage === null) return 0;
  const u = usage as { inputTokens?: unknown; cachedTokens?: unknown };
  return (typeof u.inputTokens === "number" ? u.inputTokens : 0) + (typeof u.cachedTokens === "number" ? u.cachedTokens : 0);
}

function childCount(usage: unknown): number {
  if (typeof usage !== "object" || usage === null) return 0;
  const children = (usage as { children?: unknown }).children;
  return Array.isArray(children) ? children.length : 0;
}

/** Live view of a job: what the active run is doing right now (or null when idle). Read-only. */
export async function companyJobLive(db: Db, jobId: string): Promise<CompanyJobLive> {
  const [job] = await db.select().from(companyJobs).where(eq(companyJobs.id, jobId));
  if (!job) throw new DomainError("not_found", `company job not found: ${jobId}`);
  const view = await describeCompanyJob(db, jobId);
  const now = Date.now();
  const stallMs = stallSeconds() * 1000;
  const runRows = await db
    .select({ stage: researchRuns.stage })
    .from(researchRuns)
    .where(eq(researchRuns.companyJobId, jobId));
  const attempts = new Map<CompanyStage, number>();
  for (const row of runRows) {
    if (row.stage) attempts.set(row.stage as CompanyStage, (attempts.get(row.stage as CompanyStage) ?? 0) + 1);
  }
  const live: CompanyJobLive = {
    job: {
      id: job.id,
      status: job.status,
      currentStage: job.currentStage,
      pauseReason: job.pauseReason,
      inputTokensSpent: job.inputTokensSpent,
    },
    stages: view.stages.map((s) => ({
      stage: s.stage,
      status: s.run?.status ?? null,
      attempts: attempts.get(s.stage) ?? 0,
    })),
    active: null,
  };
  const active = view.stages.find((s) => s.run && !isTerminalSubjob(s.run.status));
  if (!active?.run) return live;
  const run = active.run;
  const areaRows = await db.execute<{ area: string; status: string; updated_at: Date }>(sql`
    SELECT DISTINCT ON (s.area) s.area, s.status, s.updated_at
    FROM area_statuses s WHERE s.run_id = ${run.id}
    ORDER BY s.area, s.updated_at DESC`);
  const callRows = await db
    .select({ at: runEvents.at, payload: runEvents.payload })
    .from(runEvents)
    .where(and(eq(runEvents.runId, run.id), eq(runEvents.type, "mcp_call")))
    .orderBy(desc(runEvents.id))
    .limit(10);
  const since = run.lastActivityAt ? Math.max(0, Math.round((now - run.lastActivityAt.getTime()) / 1000)) : null;
  live.active = {
    stage: active.stage,
    runId: run.id,
    runStatus: run.status,
    phase: run.agentPhase,
    startedAt: run.startedAt,
    lastActivityAt: run.lastActivityAt,
    secondsSinceActivity: since,
    stallInSeconds: since === null ? null : Math.max(0, Math.round(stallMs / 1000) - since),
    runInputTokens: usageInputTokens(run.agentUsage),
    childAgents: childCount(run.agentUsage),
    areas: areaRows.map((r) => ({ area: r.area, status: r.status, updatedAt: new Date(r.updated_at) })),
    recentCalls: callRows.map((r) => {
      const payload = (r.payload ?? {}) as { tool?: unknown; status?: unknown };
      return {
        at: r.at,
        tool: typeof payload.tool === "string" ? payload.tool : "?",
        status: typeof payload.status === "string" ? payload.status : "?",
      };
    }),
  };
  return live;
}
