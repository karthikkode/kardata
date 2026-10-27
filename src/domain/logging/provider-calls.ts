import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { providerCalls, type ResearchRun } from "../../db/schema.js";
import type { HarnessUsage } from "../../harness/types.js";
import type { CompanyStage } from "../company-jobs/status.js";
import { storeBlob } from "../research/sources.js";

/**
 * Provider-call logging (Stage 5 Phase 3): one row per AI call. Agent runs
 * log a dispatch row (turn-1 prompt) at launch plus one row per
 * goal_usage_attribution record post-run; extractor calls log inline.
 * costUsd stays null until a price map exists (deliberately, not silently).
 */

export interface SessionCallMessage {
  phase: string | null;
  text: string;
}

export interface SessionCallTool {
  name: string;
  call_id: string | null;
}

/** One parsed provider call, as emitted by harness/session-reader.mjs. */
export interface SessionCall {
  usage_id: string | null;
  session_id: string;
  child_session_id: string | null;
  seq: number;
  response_id: string | null;
  model: string | null;
  provider: string | null;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  at: string | null;
  messages: SessionCallMessage[];
  tool_calls: SessionCallTool[];
}

function stageForRun(run: ResearchRun): CompanyStage {
  if (run.stage) return run.stage as CompanyStage;
  // Legacy agent rows predate stages; they only ever researched.
  return "research";
}

/** Dispatch row: the exact turn-1 prompt, captured before the run starts. */
export async function logDispatchPrompt(db: Db, run: ResearchRun, prompt: string): Promise<number> {
  const sha = await storeBlob(db, "text/plain", Buffer.from(prompt, "utf8"));
  const [row] = await db
    .insert(providerCalls)
    .values({
      companyJobId: run.companyJobId,
      runId: run.id,
      stage: stageForRun(run),
      promptSha256: sha,
      seq: 0,
    })
    .returning({ id: providerCalls.id });
  if (!row) throw new Error("dispatch prompt insert returned no row");
  return row.id;
}

export async function attachDispatchSession(db: Db, dispatchId: number, sessionId: string): Promise<void> {
  await db.update(providerCalls).set({ sessionId }).where(eq(providerCalls.id, dispatchId));
}

function validDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function ingestSessionCalls(
  db: Db,
  run: ResearchRun,
  calls: SessionCall[],
): Promise<{ inserted: number }> {
  let inserted = 0;
  for (const call of calls) {
    let responseSha: string | null = null;
    if (call.messages.length > 0 || call.tool_calls.length > 0) {
      responseSha = await storeBlob(
        db,
        "application/json",
        Buffer.from(
          JSON.stringify({
            response_id: call.response_id,
            messages: call.messages,
            tool_calls: call.tool_calls,
          }),
          "utf8",
        ),
      );
    }
    const values = {
      companyJobId: run.companyJobId,
      runId: run.id,
      stage: stageForRun(run),
      usageId: call.usage_id,
      sessionId: call.session_id,
      childSessionId: call.child_session_id,
      seq: call.seq,
      responseId: call.response_id,
      model: call.model,
      provider: call.provider,
      responseSha256: responseSha,
      inputTokens: call.input_tokens,
      outputTokens: call.output_tokens,
      cachedTokens: call.cached_tokens,
      reasoningTokens: call.reasoning_tokens,
      ...(validDate(call.at) ? { at: validDate(call.at) as Date } : {}),
    };
    if (call.usage_id) {
      const rows = await db
        .insert(providerCalls)
        .values(values)
        .onConflictDoNothing({
          target: providerCalls.usageId,
          where: isNotNull(providerCalls.usageId),
        })
        .returning({ id: providerCalls.id });
      inserted += rows.length;
    } else {
      await db.insert(providerCalls).values(values);
      inserted += 1;
    }
  }
  await backfillDispatchPrompt(db, run.id);
  return { inserted };
}

/**
 * The turn-1 prompt belongs to the session's first call: copy it there for
 * replay. The dispatch row stays as the standalone record (same blob, no
 * extra storage).
 */
export async function backfillDispatchPrompt(db: Db, runId: string): Promise<void> {
  const [dispatch] = await db
    .select()
    .from(providerCalls)
    .where(
      and(
        eq(providerCalls.runId, runId),
        isNull(providerCalls.usageId),
        isNotNull(providerCalls.promptSha256),
      ),
    )
    .orderBy(asc(providerCalls.id))
    .limit(1);
  if (!dispatch?.promptSha256) return;
  const [first] = await db
    .select({ id: providerCalls.id })
    .from(providerCalls)
    .where(
      and(
        eq(providerCalls.runId, runId),
        isNotNull(providerCalls.usageId),
        isNull(providerCalls.promptSha256),
      ),
    )
    .orderBy(asc(providerCalls.seq), asc(providerCalls.id))
    .limit(1);
  if (!first) return;
  await db
    .update(providerCalls)
    .set({ promptSha256: dispatch.promptSha256 })
    .where(eq(providerCalls.id, first.id));
}

export interface ExtractorCallLog {
  seq: number;
  prompt: string;
  /** Raw response text when the caller kept it; else the parsed JSON is stored. */
  raw?: string;
  json: unknown;
  usage: HarnessUsage | undefined;
  durationMs: number;
}

async function insertToollessCall(
  db: Db,
  run: ResearchRun,
  stage: "extraction" | "sector_preflight" | "icp",
  log: ExtractorCallLog,
): Promise<void> {
  const promptSha = await storeBlob(db, "text/plain", Buffer.from(log.prompt, "utf8"));
  const responseText = log.raw ?? JSON.stringify(log.json);
  const responseSha = responseText
    ? await storeBlob(db, "application/json", Buffer.from(responseText, "utf8"))
    : null;
  await db.insert(providerCalls).values({
    companyJobId: run.companyJobId,
    runId: run.id,
    stage,
    seq: log.seq,
    model: log.usage?.model ?? null,
    promptSha256: promptSha,
    responseSha256: responseSha,
    inputTokens: log.usage?.inputTokens ?? 0,
    outputTokens: log.usage?.outputTokens ?? 0,
    cachedTokens: log.usage?.cachedTokens ?? 0,
    reasoningTokens: log.usage?.reasoningTokens ?? 0,
    durationMs: log.durationMs,
  });
}

/** One extractor CLI call, logged inline while extraction runs. */
export async function logExtractorCall(db: Db, run: ResearchRun, log: ExtractorCallLog): Promise<void> {
  await insertToollessCall(db, run, "extraction", log);
}

/** One sector-preflight classifier call, logged the same way. */
export async function logClassifierCall(db: Db, run: ResearchRun, log: ExtractorCallLog): Promise<void> {
  await insertToollessCall(db, run, "sector_preflight", log);
}

/** One ICP judge call (Stage 5.5), logged the same way so quota windows count it. */
export async function logIcpCall(db: Db, run: ResearchRun, log: ExtractorCallLog): Promise<void> {
  await insertToollessCall(db, run, "icp", log);
}
