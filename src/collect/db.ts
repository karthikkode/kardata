import { eq } from "drizzle-orm";
import { researchRuns, runEvents } from "../db/schema.js";
import type { DbLike } from "../db/client.js";

export type RunEventType =
  | "fetch"
  | "collector_start"
  | "collector_end"
  | "area_status"
  | "error"
  | "log"
  | "mcp_call"
  | "agent_finish"
  | "phase"
  | "harness";

/**
 * Append a run event and touch last_activity_at. Two plain queries, never in a
 * transaction: callers span network I/O, which must not hold a transaction open.
 */
export async function recordEvent(
  db: DbLike,
  runId: string,
  type: RunEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(runEvents).values({ runId, type, payload });
  await db
    .update(researchRuns)
    .set({ lastActivityAt: new Date() })
    .where(eq(researchRuns.id, runId));
}
