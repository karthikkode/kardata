// Queryable provider rounds and tool calls (P3.5). The projector turns
// one t.provider.round event into one execution_rounds row and one
// t.tool.call event into one tool_calls row; retries are separate
// attempts, resumed replays emit no round (no call was made). Trace ids
// ride the event row; sector/parent attribution resolves here so
// emitters stay lean.
import { z } from 'zod'
import { appendEvent, type Db, type ProjectableEvent } from './events.js'
import { getSession } from './sessions.js'

const PROVIDER_ROUND_EVENT = 't.provider.round'
const TOOL_CALL_EVENT = 't.tool.call'

const ProviderRoundPayload = z.object({
  runId: z.string().min(1).max(255),
  threadKey: z.string().min(1).max(255),
  sessionId: z.string().min(1).max(255).nullable(),
  sectorId: z.string().min(1).max(255).optional(),
  turnKind: z.enum(['chat', 'research', 'subagent', 'compaction', 'file-summary', 'plan']),
  round: z.number().int().nonnegative(),
  attempt: z.number().int().nonnegative(),
  model: z.string().min(1).max(255),
  provider: z.string().min(1).max(255),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  latencyMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cachedTokens: z.number().int().nonnegative().nullable(),
  outcome: z.enum(['ok', 'error', 'timeout', 'cancelled']),
  errorCode: z.string().min(1).max(255).optional(),
  requestRef: z.string().min(1).max(1024).optional(),
  responseRef: z.string().min(1).max(1024).optional(),
  contextVersion: z.number().int().optional(),
  planVersion: z.number().int().nullable().optional(),
})

const ToolCallPayload = z.object({
  runId: z.string().min(1).max(255),
  threadKey: z.string().min(1).max(255),
  round: z.number().int().nonnegative(),
  attempt: z.number().int().nonnegative(),
  /** Provider call id: parallel duplicate calls in one round stay distinct
   * rows. Carried in the event only; the table does not store it. */
  callId: z.string().min(1).max(255),
  tool: z.string().min(1).max(255),
  argsHash: z.string().regex(/^[a-f0-9]{64}$/),
  argsRef: z.string().min(1).max(1024).optional(),
  resultRef: z.string().min(1).max(1024).optional(),
  outcome: z.enum(['ok', 'error']),
  latencyMs: z.number().int().nonnegative().nullable(),
  errorCode: z.string().min(1).max(255).optional(),
  at: z.string().datetime(),
})

export type ProviderRoundInput = z.input<typeof ProviderRoundPayload>
export type ToolCallInput = z.input<typeof ToolCallPayload>

/** Validated appends: emitters fail fast here so the projector never
 * chokes on a malformed round/tool event. */
export async function appendProviderRoundEvent(db: Db, partition: string, idempotencyKey: string, payload: ProviderRoundInput): Promise<void> {
  await appendEvent(db, { idempotencyKey, partition, type: PROVIDER_ROUND_EVENT, payload: ProviderRoundPayload.parse(payload) })
}

export async function appendToolCallEvent(db: Db, partition: string, idempotencyKey: string, payload: ToolCallInput): Promise<void> {
  await appendEvent(db, { idempotencyKey, partition, type: TOOL_CALL_EVENT, payload: ToolCallPayload.parse(payload) })
}

async function parentThreadOf(db: Db, threadKey: string): Promise<string | null> {
  if (!threadKey.startsWith('agent:')) return null
  const { rows } = await db.query<{ payload: { parentWorkflowId?: unknown; parentSessionId?: unknown } }>(
    `SELECT payload FROM events WHERE type = 't.subagent.launched' AND payload->>'childId' = $1 ORDER BY seq DESC LIMIT 1`,
    [threadKey.slice('agent:'.length)],
  )
  const launch = rows[0]?.payload
  const parentWorkflowId = typeof launch?.parentWorkflowId === 'string' ? launch.parentWorkflowId : undefined
  if (!parentWorkflowId || parentWorkflowId === 'unknown') {
    return typeof launch?.parentSessionId === 'string' ? launch.parentSessionId : null
  }
  return parentWorkflowId.startsWith('session-run-') ? parentWorkflowId.slice('session-run-'.length) : `agent:${parentWorkflowId}`
}

export async function projectProviderRound(db: Db, event: ProjectableEvent): Promise<boolean> {
  const round = ProviderRoundPayload.parse(event.payload)
  const session = round.sessionId ? await getSession(db, round.sessionId).catch(() => null) : null
  const sectorId = round.sectorId ?? session?.sectorId ?? null
  await db.query(
    `INSERT INTO execution_rounds (trace_id, run_id, thread_key, session_id, sector_id, parent_thread_key, kind, round, attempt, model, provider, started_at, finished_at, latency_ms, input_tokens, output_tokens, cached_tokens, outcome, error_code, request_ref, response_ref, context_version, plan_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,$13::timestamptz,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     ON CONFLICT (run_id, thread_key, round, attempt) DO NOTHING`,
    [event.traceId ?? null, round.runId, round.threadKey, round.sessionId, sectorId, await parentThreadOf(db, round.threadKey),
      round.turnKind, round.round, round.attempt, round.model, round.provider, round.startedAt, round.finishedAt,
      round.latencyMs, round.inputTokens, round.outputTokens, round.cachedTokens, round.outcome,
      round.errorCode ?? null, round.requestRef ?? null, round.responseRef ?? null,
      round.contextVersion ?? null, round.planVersion ?? null],
  )
  return true
}

export async function projectToolCall(db: Db, event: ProjectableEvent): Promise<boolean> {
  const call = ToolCallPayload.parse(event.payload)
  // Same-thread rounds run sequentially and the round event appends
  // before its tool events, so the latest-started round at tool time is
  // the caller. Stays null when the round row is genuinely absent.
  const owner = await db.query<{ id: number }>(
    `SELECT id FROM execution_rounds WHERE thread_key = $1 AND started_at <= $2::timestamptz ORDER BY started_at DESC, id DESC LIMIT 1`,
    [call.threadKey, call.at],
  )
  await db.query(
    `INSERT INTO tool_calls (round_id, thread_key, tool, args_hash, args_ref, result_ref, outcome, latency_ms, error_code, at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz)`,
    [owner.rows[0]?.id ?? null, call.threadKey, call.tool, call.argsHash, call.argsRef ?? null,
      call.resultRef ?? null, call.outcome, call.latencyMs, call.errorCode ?? null, call.at],
  )
  return true
}
