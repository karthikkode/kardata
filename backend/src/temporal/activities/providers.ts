// Provider gateway activities (B4.1). `executeProviderChat` resolves the
// env-selected agents/ provider, runs one guarded chat, and on failure
// returns a typed outcome (code/retryable/provider/latency — no free
// text, so the outcome is provably key-free). Side effects arrive as
// deps so the matrix is unit-provable without a Temporal worker.
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
} from '../../providers/provider-gateway.js'
import type { FakeStep, LiveProviderConfig, ProviderRequest } from '@kardata/agents'

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
  /** Fleet Meta permit; absent in unit deps. Only used for live Meta calls. */
  permit?(): Promise<() => Promise<void>>
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
  // Fleet permit first (live Meta only): permit failures throw past the
  // outcome below so the activity retries instead of failing honestly.
  // Fail-closed: a permit-store error must not run Meta unthrottled.
  let releasePermit: (() => Promise<void>) | undefined
  if (input.fakeSteps === undefined && deps.permit && resolveSelection(input.provider) === 'meta') {
    releasePermit = await deps.permit()
  }
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
        ...(effective.model === undefined ? {} : { model: effective.model }),
        log: deps.log,
        onDelta: async (text) => {
          await deps.publishDelta({ threadKey, runKey, text })
        },
      })
    } else {
      outcome = await chatOnce(adapter, input.request, {
        timeoutMs: input.timeoutMs,
        ...(effective.model === undefined ? {} : { model: effective.model }),
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
    deps.log({ op: 'provider.chat', provider: input.provider, ok: false, latencyMs: 0, code, latency_ms: 0, outcome: 'error' })
  } finally {
    await releasePermit?.()
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
