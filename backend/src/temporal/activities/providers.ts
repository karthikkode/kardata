// Provider gateway activities (B4.1). `providerChatActivity` is the
// workflow-facing model call: it resolves the env-selected agents/
// provider, runs one guarded chat, and on failure appends a typed
// `t.provider.error` event (code/retryable/provider/latency — no free
// text, so the event is provably key-free) before returning the outcome.
// With `input.stream` set, the chat streams: every text delta publishes
// one ephemeral outbox frame, and the resolved outcome stays the single
// persisted result.
// The pure core (`executeProviderChat`) takes its side effects as deps so
// the matrix is unit-provable without a Temporal worker; this wrapper
// supplies the activity log and the pool-backed event append plus a
// heartbeat loop for long provider calls.
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { Context } from '@temporalio/activity'
import { appendEvent, publishOutboxFrame, recordHeartbeat } from '../../db/index.js'
import { TRACER_NAME, startSpan } from '../../observability/tracing.js'
import {
  chatOnce,
  resolveAdapter,
  resolveEffectiveSelection,
  resolveSelection,
  streamChat,
  type ChatLogFields,
  type ChatOutcome,
  type EffectiveSelection,
  type ProviderSelection,
} from '../../providers/gateway.js'
import type { FakeStep, LiveProviderConfig, ProviderRequest } from '@kardata/agents'
import { workerPoolFromEnv } from '../../db/index.js'

export const PROVIDER_ERROR_EVENT = 't.provider.error'

export interface ProviderChatInput {
  sessionId: string
  idempotencyKey: string
  provider: ProviderSelection | string
  /** Per-message model pin (a session's stored model). Validated against
   * the registry with env fallback; absent means the env default. */
  model?: string
  /** Per-message reasoning flag; absent inherits the model's capability. */
  reasoning?: boolean
  request: ProviderRequest
  timeoutMs?: number
  /** Test/seed path: scripted fake steps. Never set in production. */
  fakeSteps?: FakeStep[]
  /** Test path: live-config override so hermetic tests never touch env. */
  config?: LiveProviderConfig
  /** When set, the chat streams: every text delta publishes one ephemeral
   * outbox frame for the thread, and the resolved outcome is still the
   * single persisted result. Absent means buffered (chatOnce). */
  stream?: {
    threadKey: string
    runKey: string
  }
}

export interface ProviderChatDeps {
  log(fields: ChatLogFields): void
  appendErrorEvent(input: {
    idempotencyKey: string
    partition: string
    type: typeof PROVIDER_ERROR_EVENT
    payload: Record<string, unknown>
  }): Promise<void>
  /** Delta sink for streamed chats; unit deps record in memory. */
  publishDelta(input: { threadKey: string; runKey: string; text: string }): Promise<void>
}

/** Pure core: resolve → guarded chat → typed error event on failure. The
 * success path appends nothing (the workflow owns the reply); every
 * failure path — including misconfiguration — records exactly one typed
 * event, so provider failures are never silent. */
export async function executeProviderChat(
  input: ProviderChatInput,
  deps: ProviderChatDeps,
): Promise<ChatOutcome> {
  let outcome: ChatOutcome
  try {
    const selection = resolveSelection(input.provider)
    // A pinned model goes through strict per-message resolution (session
    // selection wins, env fallback, unknown pairs rejected); otherwise the
    // legacy env path resolves exactly as before.
    const effective: EffectiveSelection =
      input.model === undefined && input.reasoning === undefined
        ? { provider: selection, reasoning: false }
        : resolveEffectiveSelection(
            { provider: selection, model: input.model, reasoning: input.reasoning },
            { config: input.config },
          )
    const adapter = resolveAdapter(effective.provider, {
      fakeSteps: input.fakeSteps,
      config: input.config,
      model: effective.model,
    })
    if (input.stream) {
      const { threadKey, runKey } = input.stream
      outcome = await streamChat(adapter, input.request, {
        timeoutMs: input.timeoutMs,
        log: deps.log,
        onDelta: async (text) => {
          await deps.publishDelta({ threadKey, runKey, text })
        },
      })
    } else {
      outcome = await chatOnce(adapter, input.request, {
        timeoutMs: input.timeoutMs,
        log: deps.log,
      })
    }
  } catch (error) {
    // Resolution failures (unknown selection or missing key)
    // are provider failures too: same typed event, never silent.
    const code = 'provider_unconfigured' as const
    outcome = {
      ok: false,
      providerName: input.provider,
      code,
      retryable: false,
      latencyMs: 0,
      detail: error instanceof Error ? error.message.slice(0, 500) : 'unknown provider error',
    }
    deps.log({ op: 'provider.chat', provider: input.provider, ok: false, latencyMs: 0, code })
  }
  if (!outcome.ok) {
    await deps.appendErrorEvent({
      idempotencyKey: input.idempotencyKey,
      partition: `session:${input.sessionId}`,
      type: PROVIDER_ERROR_EVENT,
      payload: {
        provider: outcome.providerName,
        code: outcome.code,
        retryable: outcome.retryable,
        latencyMs: outcome.latencyMs,
      },
    })
  }
  return outcome
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function providerChatActivity(input: ProviderChatInput): Promise<ChatOutcome> {
  const context = Context.current()
  const pool = workerPoolFromEnv()
  // Heartbeat while the provider works so long calls never trip the
  // activity heartbeat timeout. The settled flag (not cancellation) stops
  // the loop: no heartbeat may fire after the activity settles.
  let settled = false
  const beating = (async () => {
    try {
      while (!settled) {
        await Promise.race([sleep(5_000), context.cancelled])
        if (settled) break
        context.heartbeat({ sessionId: input.sessionId, at: Date.now() })
        // Operation heartbeat for the stall sweeper (B5.3): 5 s cadence
        // matches the loop, so every beat is stored.
        await recordHeartbeat(pool, `session-run-${input.sessionId}`, 'provider.chat', true)
      }
    } catch {
      // Cancellation races the beat; the chat race below owns the outcome.
    }
  })()
  // Activity span (B5.2): joins the trace when the workflow passed one
  // through, else opens a fresh trace with session attributes for the
  // workflow/run-id join.
  const span = startSpan(trace.getTracer(TRACER_NAME), 'activity.providerChat', undefined, {
    kind: SpanKind.INTERNAL,
    attributes: { session_id: input.sessionId },
  })
  try {
    // Cancellation surfaces as a rejected promise (turn.ts pattern): the
    // workflow sees CancelledFailure instead of an orphaned provider call.
    const outcome = await Promise.race([
      executeProviderChat(input, {
        log: (fields) => context.log.info('provider.chat', { ...fields }),
        appendErrorEvent: async (event) => {
          await appendEvent(pool, event)
        },
        publishDelta: async (delta) => {
          await publishOutboxFrame(pool, delta.threadKey, 'delta', {
            runKey: delta.runKey,
            text: delta.text,
          })
        },
      }),
      context.cancelled,
    ])
    if (!outcome.ok) span.setStatus({ code: SpanStatusCode.ERROR, message: outcome.code })
    else span.setStatus({ code: SpanStatusCode.OK })
    return outcome
  } catch (error) {
    // Re-raised unchanged: cancellation must still surface as
    // CancelledFailure, never a generic activity error.
    span.setStatus({ code: SpanStatusCode.ERROR })
    throw error
  } finally {
    span.end()
    settled = true
    void beating
  }
}
