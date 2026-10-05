// Provider gateway (B4.1). The backend's only entry to the agents/
// providers: Meta in the product, fake in hermetic tests, resolved from
// environment, with keys flowing exclusively from the agents live config
// (env/secret store — never code, logs, transcripts, or fixtures).
//
// Two redaction rules are structural, not conventional:
//   1. The per-call log carries shapes and counters only (provider, ok,
//      latency, usage, error code). Prompt/response text and key material
//      never reach the log sink.
//   2. Typed `t.provider.error` events carry code/retryable/provider/
//      latency only — no free-text detail, so events are provably key-free.
// Failure detail (the adapter message) is returned to the workflow caller
// for debugging, never logged or appended.
import {
  DeltaAccumulator,
  FakeProvider,
  MetaAdapter,
  ProviderError,
  emptyUsage,
  readLiveConfig,
  type FakeStep,
  type LiveProviderConfig,
  type ProviderAdapter,
  type ProviderRequest,
  type ProviderResponse,
  type Usage,
} from '@kardata/agents'
import {
  DEFAULT_EFFORT,
  defaultModelFor,
  findModel,
  type RegistryEnv,
} from './registry.js'

export type ProviderSelection = 'meta' | 'fake'

const SELECTIONS: ProviderSelection[] = ['meta', 'fake']

export class ProviderGatewayError extends Error {
  constructor(
    readonly code: 'provider_unknown' | 'provider_key_missing' | 'provider_unconfigured',
    message: string,
  ) {
    super(message)
    this.name = 'ProviderGatewayError'
  }
}

/** Unset chooses Meta; an unsupported configured provider fails closed. */
export function resolveSelection(value: string | undefined): ProviderSelection {
  const normalized = (value ?? '').trim().toLowerCase()
  if (!normalized) return 'meta'
  if ((SELECTIONS as string[]).includes(normalized)) return normalized as ProviderSelection
  throw new ProviderGatewayError('provider_unknown', `unsupported provider ${normalized}`)
}

export interface ResolveOptions {
  fakeSteps?: FakeStep[]
  config?: LiveProviderConfig
  /** Per-message model pin; validated against the registry, and falls back
   * to the env-configured default when absent. */
  model?: string
}

/** Per-message selection (a session's stored {provider, model, reasoning}).
 * The stored provider wins when present; otherwise the KARDATA_PROVIDER
 * fallback applies. The model defaults to the stored model, else the
 * env-configured default for the resolved provider. Unknown providers or
 * models throw ProviderGatewayError (never a network call); a pinned model
 * on fake is rejected the same way, since it could never take
 * effect. Missing keys surface from resolveAdapter as provider_key_missing. */
export interface MessageSelection {
  provider?: string
  model?: string
  reasoning?: boolean
  effort?: string
}

export interface EffectiveSelection {
  provider: ProviderSelection
  model?: string
  reasoning: boolean
  /** Reasoning depth for providers that accept it; undefined when the
   * model offers no depth control. */
  effort?: string
}

export function resolveEffectiveSelection(
  message: MessageSelection = {},
  options: { envValue?: string; config?: LiveProviderConfig; env?: RegistryEnv } = {},
): EffectiveSelection {
  const rawProvider = message.provider?.trim() ? message.provider.trim() : undefined
  let provider: ProviderSelection
  if (rawProvider !== undefined) {
    const normalized = rawProvider.toLowerCase()
    if (!(SELECTIONS as string[]).includes(normalized)) {
      throw new ProviderGatewayError('provider_unknown', `unknown provider ${rawProvider}`)
    }
    provider = normalized as ProviderSelection
  } else {
    provider = resolveSelection(options.envValue ?? process.env['KARDATA_PROVIDER'])
  }
  if (provider !== 'meta') {
    if (message.model !== undefined) {
      throw new ProviderGatewayError(
        'provider_unknown',
        `model ${message.model} cannot pin provider ${provider}`,
      )
    }
    return { provider, reasoning: message.reasoning ?? false }
  }
  const env = options.env ?? process.env
  let model: string
  if (message.model !== undefined) {
    model = message.model
  } else if (options.config !== undefined) {
    model = options.config.metaModel
  } else {
    model = defaultModelFor(provider, env)
  }
  // The live config is the effective env: a test-injected config model is
  // selectable exactly like an env-configured one.
  const lookupEnv: RegistryEnv =
    options.config === undefined
      ? env
      : {
          ...env,
          KARDATA_META_MODEL: options.config.metaModel,
          KARDATA_META_MODE: options.config.metaMode,
        }
  const entry = findModel(provider, model, lookupEnv)
  if (!entry) {
    throw new ProviderGatewayError('provider_unknown', `unknown model ${model} for provider ${provider}`)
  }
  // Depth resolves after the model: an explicit level must be listed for
  // it, otherwise the stored value is rejected instead of silently sent.
  // Listed models without a stored level use the provider default depth.
  let effort: string | undefined
  if (message.effort !== undefined) {
    if (!entry.efforts.includes(message.effort)) {
      throw new ProviderGatewayError(
        'provider_unknown',
        `unknown effort ${message.effort} for model ${model}`,
      )
    }
    effort = message.effort
  } else if (entry.efforts.length > 0) {
    effort = DEFAULT_EFFORT
  }
  return { provider, model, reasoning: message.reasoning ?? entry.reasoning === 'native', ...(effort === undefined ? {} : { effort }) }
}

/** Resolves a selection to a live adapter. Throws ProviderGatewayError
 * (never a network call) when the selection names no provider, needs a
 * key that is absent. */
export function resolveAdapter(
  selection: ProviderSelection,
  options: ResolveOptions = {},
): ProviderAdapter {
  const config = options.config ?? readLiveConfig()
  switch (selection) {
    case 'meta': {
      if (!config.metaApiKey) {
        throw new ProviderGatewayError(
          'provider_key_missing',
          'meta selected but KARDATA_META_KEY is unset',
        )
      }
      return new MetaAdapter({
        apiKey: config.metaApiKey,
        model: options.model ?? config.metaModel,
        mode: config.metaMode === 'responses'
          ? 'responses'
          : (options.model ? findModel('meta', options.model)?.mode : undefined) ?? config.metaMode,
        baseUrl: config.metaBaseUrl,
      })
    }
    case 'fake':
      return new FakeProvider([...(options.fakeSteps ?? [])])
  }
}

type ProviderFailureCode =
  | 'provider_timeout'
  | 'provider_unauthorized'
  | 'provider_failed'
  | 'provider_unconfigured'

export type ChatOutcome =
  | {
      ok: true
      providerName: string
      text: string
      toolCalls: ProviderResponse['toolCalls']
      usage: Usage
      latencyMs: number
    }
  | {
      ok: false
      providerName: string
      code: ProviderFailureCode
      retryable: boolean
      latencyMs: number
      /** Adapter message for the workflow caller. Never logged/appended. */
      detail: string
    }

/** One provider round (P3.2.4): every model call logs these fields, on
 * `provider.round` lines from turn loops and direct callers, and flattened
 * onto the legacy `provider.chat` gateway lines. cached_tokens is the
 * prompt-cache read count; model/round/tokens stay absent when unknown. */
export interface ProviderRoundLogFields {
  op: 'provider.round'
  provider: string
  model?: string
  round?: number
  latency_ms: number
  input_tokens?: number
  output_tokens?: number
  cached_tokens?: number
  outcome: 'ok' | 'error'
  code?: string
  sector_id?: string
}

export function providerRoundFields(input: {
  provider: string
  model?: string
  round?: number
  latencyMs: number
  usage?: Usage
  outcome: 'ok' | 'error'
  code?: string
  sectorId?: string
}): ProviderRoundLogFields {
  return {
    op: 'provider.round',
    provider: input.provider,
    ...(input.model ? { model: input.model } : {}),
    ...(input.round !== undefined ? { round: input.round } : {}),
    latency_ms: input.latencyMs,
    ...(input.usage ? { input_tokens: input.usage.inputTokens, output_tokens: input.usage.outputTokens, cached_tokens: input.usage.cacheReadTokens } : {}),
    outcome: input.outcome,
    ...(input.code ? { code: input.code } : {}),
    ...(input.sectorId ? { sector_id: input.sectorId } : {}),
  }
}

export interface ChatLogFields {
  op: 'provider.chat'
  provider: string
  ok: boolean
  latencyMs: number
  usage?: Usage
  code?: ProviderFailureCode
  model?: string
  round?: number
  latency_ms: number
  input_tokens?: number
  output_tokens?: number
  cached_tokens?: number
  outcome: 'ok' | 'error'
}

const UNAUTHORIZED = /401|unauthorized|invalid api key|authentication/i

/** Timeout-race sentinel: identity-compared, never confused with a real error. */
const CHAT_TIMEOUT: unique symbol = Symbol('kardata.provider.chat.timeout')

function toFailure(
  providerName: string,
  latencyMs: number,
  error: unknown,
): Extract<ChatOutcome, { ok: false }> {
  if (error instanceof ProviderError) {
    const unauthorized = UNAUTHORIZED.test(error.message)
    return {
      ok: false,
      providerName,
      code: unauthorized ? 'provider_unauthorized' : 'provider_failed',
      retryable: unauthorized ? false : error.retryable,
      latencyMs,
      detail: error.message.slice(0, 500),
    }
  }
  // Unknown transport errors default to retryable: Temporal's retry policy
  // bounds the retries, and a transient blip must not poison the turn.
  return {
    ok: false,
    providerName,
    code: 'provider_failed',
    retryable: true,
    latencyMs,
    detail: error instanceof Error ? error.message.slice(0, 500) : 'unknown provider error',
  }
}

type ChatCallOptions = { timeoutMs?: number; model?: string; round?: number; log?: (fields: ChatLogFields) => void }

function roundExtras(options: ChatCallOptions): Pick<ChatLogFields, 'model' | 'round'> {
  return {
    ...(options.model ? { model: options.model } : {}),
    ...(options.round !== undefined ? { round: options.round } : {}),
  }
}

function logChatSuccess(
  options: ChatCallOptions,
  adapter: ProviderAdapter,
  latencyMs: number,
  usage: Usage,
): void {
  options.log?.({
    op: 'provider.chat',
    provider: adapter.providerName,
    ok: true,
    latencyMs,
    usage,
    ...roundExtras(options),
    latency_ms: latencyMs,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cached_tokens: usage.cacheReadTokens,
    outcome: 'ok',
  })
}

function chatCallFailure(
  adapter: ProviderAdapter,
  options: ChatCallOptions,
  started: number,
  timeoutMs: number,
  error: unknown,
): Extract<ChatOutcome, { ok: false }> {
  const latencyMs = Date.now() - started
  if (error === CHAT_TIMEOUT) {
    options.log?.({ op: 'provider.chat', provider: adapter.providerName, ok: false, latencyMs, code: 'provider_timeout', ...roundExtras(options), latency_ms: latencyMs, outcome: 'error' })
    return {
      ok: false,
      providerName: adapter.providerName,
      code: 'provider_timeout',
      retryable: true,
      latencyMs,
      detail: `provider call exceeded ${timeoutMs} ms`,
    }
  }
  const failure = toFailure(adapter.providerName, latencyMs, error)
  options.log?.({
    op: 'provider.chat',
    provider: adapter.providerName,
    ok: false,
    latencyMs,
    code: failure.code,
    ...roundExtras(options),
    latency_ms: latencyMs,
    outcome: 'error',
  })
  return failure
}

/** One guarded model call. Logs shapes/counters only; the timeout wins the
 * race (the underlying call is left to settle — activity cancellation is
 * Temporal's path, not a dangling-fetch hunt). */
export async function chatOnce(
  adapter: ProviderAdapter,
  request: ProviderRequest,
  options: ChatCallOptions = {},
): Promise<ChatOutcome> {
  const timeoutMs = options.timeoutMs ?? 60_000
  const started = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const response = await Promise.race([
      adapter.chat(request),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(CHAT_TIMEOUT), timeoutMs)
      }),
    ])
    const latencyMs = Date.now() - started
    logChatSuccess(options, adapter, latencyMs, response.usage)
    return {
      ok: true,
      providerName: adapter.providerName,
      text: response.text,
      toolCalls: response.toolCalls,
      usage: response.usage,
      latencyMs,
    }
  } catch (error) {
    return chatCallFailure(adapter, options, started, timeoutMs, error)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export interface StreamChatOptions {
  timeoutMs?: number
  model?: string
  round?: number
  log?: (fields: ChatLogFields) => void
  /** Called once per text delta, in stream order. Throwing aborts the read. */
  onDelta?: (text: string) => void | Promise<void>
}

/** Streaming twin of chatOnce: consumes adapter.chatStream, forwards every
 * text_delta to onDelta, and resolves to the same ChatOutcome shape —
 * accumulated text, tool calls, and the terminal usage. Deltas are an
 * ephemeral transport concern: only the returned outcome is persisted. */
export async function streamChat(
  adapter: ProviderAdapter,
  request: ProviderRequest,
  options: StreamChatOptions = {},
): Promise<ChatOutcome> {
  const timeoutMs = options.timeoutMs ?? 60_000
  const started = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const outcome = await Promise.race([
      (async () => {
        let text = ''
        const toolcalls = new DeltaAccumulator()
        let usage: Usage = emptyUsage()
        for await (const event of adapter.chatStream(request)) {
          if (event.kind === 'text_delta') {
            text += event.text
            await options.onDelta?.(event.text)
          } else if (event.kind === 'done') {
            usage = event.usage
          } else {
            toolcalls.push(event)
          }
        }
        return { text, toolCalls: toolcalls.calls(), usage }
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(CHAT_TIMEOUT), timeoutMs)
      }),
    ])
    const latencyMs = Date.now() - started
    logChatSuccess(options, adapter, latencyMs, outcome.usage)
    return {
      ok: true,
      providerName: adapter.providerName,
      text: outcome.text,
      toolCalls: outcome.toolCalls,
      usage: outcome.usage,
      latencyMs,
    }
  } catch (error) {
    return chatCallFailure(adapter, options, started, timeoutMs, error)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** The agents-identical live round trip: one ping tool call with usage
 * counters. Meta Chat clamps to auto, so the prompt insists instead. */
export async function probeProvider(
  selection: 'meta',
  options: { timeoutMs?: number; log?: (fields: ChatLogFields) => void } = {},
): Promise<{
  provider: string
  latencyMs: number
  toolCalls: number
  toolCallNames: string[]
  usage: Usage
}> {
  const adapter = resolveAdapter(selection)
  const started = Date.now()
  const outcome = await chatOnce(
    adapter,
    {
      systemPrompt: 'You are a probe harness. Follow tool instructions exactly.',
      messages: [{ role: 'user', text: 'Call the ping tool with text hello. You must call it.' }],
      tools: [
        {
          name: 'ping',
          description: 'Reply with the given text.',
          parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        },
      ],
      toolChoice: { mode: 'auto' },
    },
    options,
  )
  if (!outcome.ok) {
    throw new ProviderGatewayError(
      'provider_unconfigured',
      `live probe via ${selection} failed: ${outcome.code} (${outcome.detail})`,
    )
  }
  return {
    provider: outcome.providerName,
    latencyMs: Date.now() - started,
    toolCalls: outcome.toolCalls.length,
    toolCallNames: outcome.toolCalls.map((call) => call.name),
    usage: outcome.usage,
  }
}
