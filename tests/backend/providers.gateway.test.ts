// Provider gateway (B4.1). Fake matrix over executeProviderChat with
// in-memory deps — no Temporal worker needed: success shape, retryable vs
// fatal vs unauthorized failures, timeout, the typed error event, and the
// redaction proof (no prompt/response text or key material in any log line
// or event payload). The live probe round-trips DeepSeek/Meta exactly like
// the direct agents probe and skips without keys.
import { describe, expect, it } from 'vitest'
import {
  chatOnce,
  probeProvider,
  resolveAdapter,
  resolveSelection,
  streamChat,
  type ChatLogFields,
} from '../../backend/src/providers/gateway.js'
import {
  executeProviderChat,
  type ProviderChatDeps,
  type ProviderChatInput,
} from '../../backend/src/temporal/activities/providers.js'
import {
  emptyUsage,
  MetaAdapter,
  readLiveConfig,
  type LiveProviderConfig,
  type ProviderAdapter,
  type ProviderRequest,
} from '@kardata/agents'

const NO_KEYS: LiveProviderConfig = {
  metaApiKey: undefined,
  metaModel: 'muse-spark-1.3-contributor',
  metaMode: 'chat',
  metaBaseUrl: 'https://api.meta.ai/v1',
}

function request(): ProviderRequest {
  return {
    systemPrompt: 'Be brief.',
    messages: [{ role: 'user', text: 'Say hi.' }],
    tools: [],
    toolChoice: { mode: 'none' },
  }
}

function deps(): ProviderChatDeps & { logs: ChatLogFields[]; events: unknown[]; deltas: unknown[] } {
  const logs: ChatLogFields[] = []
  const events: unknown[] = []
  const deltas: unknown[] = []
  return {
    logs,
    events,
    deltas,
    log: (fields) => logs.push(fields),
    appendErrorEvent: async (event) => {
      events.push(event)
    },
    publishDelta: async (delta) => {
      deltas.push(delta)
    },
  }
}

function input(overrides: Partial<ProviderChatInput> = {}): ProviderChatInput {
  return {
    sessionId: 's-gw',
    idempotencyKey: 'gw:1',
    provider: 'fake',
    request: request(),
    ...overrides,
  }
}

describe('provider gateway (B4.1)', () => {
  it('uses Responses for reasoning-capable Meta models', () => {
    const config = { ...NO_KEYS, metaApiKey: 'test' }
    const reasoning = resolveAdapter('meta', { config, model: 'muse-spark-1.3-contributor' })
    const plain = resolveAdapter('meta', { config, model: 'muse-spark-1.2-contributor' })
    expect(reasoning).toBeInstanceOf(MetaAdapter)
    expect((reasoning as MetaAdapter).mode).toBe('responses')
    expect((plain as MetaAdapter).mode).toBe('chat')
  })
  it('defaults to Meta and rejects removed providers', () => {
    expect(resolveSelection(' Meta ')).toBe('meta')
    expect(resolveSelection('fake')).toBe('fake')
    expect(resolveSelection(undefined)).toBe('meta')
    expect(resolveSelection('')).toBe('meta')
    expect(() => resolveSelection('deepseek')).toThrow(/unsupported provider/)
    expect(() => resolveSelection('router')).toThrow(/unsupported provider/)
  })

  it('refuses Meta without a key', () => {
    expect(() => resolveAdapter('meta', { config: NO_KEYS })).toThrow(/KARDATA_META_KEY/)
    expect(resolveAdapter('fake', { fakeSteps: [] }).providerName).toBe('fake')
  })

  it('returns the fake success with shapes-only logging and no event', async () => {
    const d = deps()
    const outcome = await executeProviderChat(
      input({
        fakeSteps: [
          {
            text: 'hello',
            toolCalls: [{ id: 'c1', name: 'ping', args: { text: 'hi' } }],
            usage: { inputTokens: 3 },
          },
        ],
      }),
      d,
    )
    expect(outcome).toMatchObject({ ok: true, providerName: 'fake', text: 'hello' })
    if (!outcome.ok) throw new Error('expected success')
    expect(outcome.toolCalls).toHaveLength(1)
    expect(outcome.usage.inputTokens).toBe(3)
    expect(d.events).toHaveLength(0)
    expect(d.logs).toHaveLength(1)
    expect(d.logs[0]).toMatchObject({ op: 'provider.chat', provider: 'fake', ok: true })
    const logged = JSON.stringify(d.logs)
    expect(logged).not.toContain('Be brief.')
    expect(logged).not.toContain('Say hi.')
    expect(logged).not.toContain('hello')
  })

  it('maps retryable failure to a typed error event', async () => {
    const d = deps()
    const outcome = await executeProviderChat(
      input({ fakeSteps: [{ error: 'boom', retryable: true }] }),
      d,
    )
    expect(outcome).toMatchObject({
      ok: false,
      providerName: 'fake',
      code: 'provider_failed',
      retryable: true,
    })
    expect(d.events).toHaveLength(1)
    const event = d.events[0] as Record<string, unknown>
    expect(event['type']).toBe('t.provider.error')
    expect(event['idempotencyKey']).toBe('gw:1')
    expect(event['partition']).toBe('session:s-gw')
    expect(event['payload']).toMatchObject({
      provider: 'fake',
      code: 'provider_failed',
      retryable: true,
    })
    expect(typeof (event['payload'] as Record<string, unknown>)['latencyMs']).toBe('number')
    expect(d.logs[0]).toMatchObject({ op: 'provider.chat', ok: false, code: 'provider_failed' })
  })

  it('marks fatal errors non-retryable and 401s unauthorized', async () => {
    const fatal = deps()
    const fatalOutcome = await executeProviderChat(
      input({ fakeSteps: [{ error: 'nope', retryable: false }] }),
      fatal,
    )
    expect(fatalOutcome).toMatchObject({ ok: false, code: 'provider_failed', retryable: false })

    const denied = deps()
    const deniedOutcome = await executeProviderChat(
      input({ fakeSteps: [{ error: '401 Unauthorized', retryable: true }] }),
      denied,
    )
    // The 401 sniff wins over the adapter's retryable flag: retrying a bad
    // key is pure burn.
    expect(deniedOutcome).toMatchObject({
      ok: false,
      code: 'provider_unauthorized',
      retryable: false,
    })
  })

  it('times out a hanging provider as retryable', async () => {
    const hanging: ProviderAdapter = {
      providerName: 'slow',
      chat: () => new Promise(() => undefined),
      chatStream: () => (async function* () {})(),
    }
    const outcome = await chatOnce(hanging, request(), { timeoutMs: 30 })
    expect(outcome).toMatchObject({ ok: false, code: 'provider_timeout', retryable: true })
  })

  it('records misconfiguration as a typed event, never silent', async () => {
    const d = deps()
    const outcome = await executeProviderChat(input({ provider: 'router', config: NO_KEYS }), d)
    expect(outcome).toMatchObject({ ok: false, code: 'provider_unconfigured', retryable: false })
    expect(d.events).toHaveLength(1)
    expect((d.events[0] as Record<string, unknown>)['type']).toBe('t.provider.error')
  })

  it('keeps secrets and message text out of every log line and event', async () => {
    const d = deps()
    const outcome = await executeProviderChat(
      input({
        request: {
          systemPrompt: 'SYS-SENTINEL-AAA',
          messages: [{ role: 'user', text: 'MSG-SENTINEL-BBB' }],
          tools: [],
          toolChoice: { mode: 'none' },
        },
        fakeSteps: [{ error: 'ERR-SENTINEL-CCC', retryable: false }],
      }),
      d,
    )
    expect(outcome.ok).toBe(false)
    const exposed = `${JSON.stringify(d.logs)} ${JSON.stringify(d.events)}`
    for (const sentinel of ['SYS-SENTINEL-AAA', 'MSG-SENTINEL-BBB', 'ERR-SENTINEL-CCC']) {
      expect(exposed).not.toContain(sentinel)
    }
    // The failure detail still reaches the workflow caller for debugging —
    // the boundary is logs and events, not the return value.
    if (outcome.ok) throw new Error('expected failure')
    expect(outcome.detail).toContain('ERR-SENTINEL-CCC')
  })

  it('streams fake text as ordered deltas with one accumulated outcome', async () => {
    const d = deps()
    const outcome = await executeProviderChat(
      input({
        fakeSteps: [
          {
            text: 'hello',
            toolCalls: [{ id: 'c1', name: 'ping', args: { text: 'hi' } }],
            usage: { inputTokens: 3 },
          },
        ],
        stream: { threadKey: 't-stream', runKey: 'run-1' },
      }),
      d,
    )
    expect(outcome).toMatchObject({ ok: true, providerName: 'fake', text: 'hello' })
    if (!outcome.ok) throw new Error('expected success')
    expect(outcome.toolCalls).toHaveLength(1)
    expect(d.deltas).toEqual([{ threadKey: 't-stream', runKey: 'run-1', text: 'hello' }])
    expect(d.events).toHaveLength(0)
  })

  it('publishes nothing when streaming is not requested', async () => {
    const d = deps()
    const outcome = await executeProviderChat(input({ fakeSteps: [{ text: 'hi' }] }), d)
    expect(outcome).toMatchObject({ ok: true, text: 'hi' })
    expect(d.deltas).toHaveLength(0)
  })

  it('records a streamed failure as a typed event with no partial outcome', async () => {
    const d = deps()
    const outcome = await executeProviderChat(
      input({
        fakeSteps: [{ error: 'mid-stream', retryable: true }],
        stream: { threadKey: 't-stream', runKey: 'run-1' },
      }),
      d,
    )
    expect(outcome).toMatchObject({ ok: false, code: 'provider_failed' })
    expect(d.deltas).toHaveLength(0)
    expect(d.events).toHaveLength(1)
  })

  it('accumulates multi-delta streams in order', async () => {
    const seen: string[] = []
    const stub: ProviderAdapter = {
      providerName: 'stub',
      chat: () => {
        throw new Error('streaming test must not call buffered chat')
      },
      chatStream: () =>
        (async function* () {
          yield { kind: 'text_delta', text: 'he' }
          yield { kind: 'text_delta', text: 'llo' }
          yield { kind: 'done', usage: { ...emptyUsage(), outputTokens: 2 } }
        })(),
    }
    const outcome = await streamChat(stub, request(), {
      onDelta: (text) => {
        seen.push(text)
      },
    })
    expect(seen).toEqual(['he', 'llo'])
    expect(outcome).toMatchObject({ ok: true, text: 'hello' })
    if (!outcome.ok) throw new Error('expected success')
    expect(outcome.usage.outputTokens).toBe(2)
  })

  it('times out a hanging stream as retryable', async () => {
    const hanging: ProviderAdapter = {
      providerName: 'slow-stream',
      chat: () => new Promise(() => undefined),
      chatStream: () =>
        (async function* () {
          await new Promise(() => undefined)
          yield { kind: 'text_delta', text: 'never' }
        })(),
    }
    const outcome = await streamChat(hanging, request(), { timeoutMs: 30 })
    expect(outcome).toMatchObject({ ok: false, code: 'provider_timeout', retryable: true })
  })
})

const live = readLiveConfig()

describe.skipIf(!live.metaApiKey)('live backend probe: meta (B4.1)', () => {
  it(
    'matches the direct agents probe: one forced ping plus usage',
    async () => {
      const probed = await probeProvider('meta')
      expect(probed.provider).toBe('meta')
      expect(probed.toolCalls).toBeGreaterThan(0)
      expect(probed.toolCallNames[0]).toBe('ping')
      expect(probed.usage.inputTokens).toBeGreaterThan(0)
    },
    120_000,
  )
})
