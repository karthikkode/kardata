import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  httpFetches,
  jobEvents,
  providerCalls,
  researchRuns,
  runEvents,
  type HttpFetch,
  type JobEvent,
  type ProviderCall,
} from "../../db/schema.js";

/**
 * Replay bundle for one company job: every log table ordered oldest-first.
 * Capture lives here; a future simulator replays from exactly this shape.
 */

export interface ReplayMcpCall {
  at: Date;
  runId: string;
  tool: string;
  status: string;
  args: string;
  resultSize: number | null;
}

export interface JobReplay {
  providerCalls: ProviderCall[];
  jobEvents: JobEvent[];
  httpFetches: HttpFetch[];
  mcpCalls: ReplayMcpCall[];
}

export async function jobReplay(db: Db, jobId: string): Promise<JobReplay> {
  const runs = await db
    .select({ id: researchRuns.id })
    .from(researchRuns)
    .where(eq(researchRuns.companyJobId, jobId));
  const runIds = runs.map((r) => r.id);
  const [calls, events, fetches, mcp] = await Promise.all([
    db.select().from(providerCalls).where(eq(providerCalls.companyJobId, jobId)).orderBy(asc(providerCalls.id)),
    db.select().from(jobEvents).where(eq(jobEvents.jobId, jobId)).orderBy(asc(jobEvents.id)),
    db.select().from(httpFetches).where(eq(httpFetches.companyJobId, jobId)).orderBy(asc(httpFetches.id)),
    runIds.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(runEvents)
          .where(and(inArray(runEvents.runId, runIds), eq(runEvents.type, "mcp_call")))
          .orderBy(asc(runEvents.at), asc(runEvents.id)),
  ]);
  return {
    providerCalls: calls,
    jobEvents: events,
    httpFetches: fetches,
    mcpCalls: mcp.map((r) => {
      const payload = (r.payload ?? {}) as Record<string, unknown>;
      return {
        at: r.at,
        runId: r.runId,
        tool: typeof payload.tool === "string" ? payload.tool : "?",
        status: typeof payload.status === "string" ? payload.status : "?",
        args: typeof payload.args === "string" ? payload.args : "",
        resultSize: typeof payload.resultSize === "number" ? payload.resultSize : null,
      };
    }),
  };
}
