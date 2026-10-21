import { eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { httpFetches, researchRuns } from "../../db/schema.js";

/** One row per fetchUrl call: the final outcome, never the body (bodies live in sources/blobs). */

export interface HttpFetchOutcome {
  statusCode: number | null;
  bytes: number | null;
  durationMs: number;
  sourceId?: string | null;
  error?: string | null;
}

export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname || "(invalid)";
  } catch {
    return "(invalid)";
  }
}

export async function logHttpFetch(
  db: Db,
  req: { runId: string; companyId: string; collector: string; url: string },
  outcome: HttpFetchOutcome,
): Promise<void> {
  const [run] = await db
    .select({ companyJobId: researchRuns.companyJobId })
    .from(researchRuns)
    .where(eq(researchRuns.id, req.runId));
  await db.insert(httpFetches).values({
    companyJobId: run?.companyJobId ?? null,
    runId: req.runId,
    companyId: req.companyId,
    collector: req.collector,
    url: req.url.slice(0, 2000),
    host: safeHostname(req.url),
    statusCode: outcome.statusCode,
    bytes: outcome.bytes,
    durationMs: outcome.durationMs,
    sourceId: outcome.sourceId ?? null,
    error: outcome.error?.slice(0, 500) ?? null,
  });
}
