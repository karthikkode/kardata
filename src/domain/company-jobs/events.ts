import type { Db } from "../../db/client.js";
import { jobEvents } from "../../db/schema.js";
import type { CompanyStage } from "./status.js";

/** Append a stage-transition / job-lifecycle event. Small, worker-internal. */
export async function logJobEvent(
  db: Db,
  jobId: string,
  type: string,
  stage: CompanyStage | null = null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(jobEvents).values({ jobId, type, stage, payload });
}
