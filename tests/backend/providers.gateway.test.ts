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
  providerRoundFields,
  resolveAdapter,
  resolveSelection,
  streamChat,
  wrapAdapterWithPermit,
  type ChatLogFields,
} from '../../backend/src/providers/provider-gateway.js'
import { MetaPermitTimeout } from '../../backend/src/db/index.js'
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

describe('provider gateway (B4.1) [F:backend.activity.providers.executeProviderChat] [F:backend.activity.providers.PROVIDER_ERROR_EVENT] [F:backend.activity.turn.sleep]', () => {
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

  it('emits P3.2.4 round fields on every gateway chat line', async () => {
    const d = deps()
    await executeProviderChat(input({ fakeSteps: [{ text: 'hi' }] }), d)
    expect(d.logs).toHaveLength(1)
    expect(d.logs[0]).toMatchObject({
      op: 'provider.chat',
      provider: 'fake',
      ok: true,
      latency_ms: expect.any(Number),
      input_tokens: expect.any(Number),
      output_tokens: expect.any(Number),
      cached_tokens: expect.any(Number),
      outcome: 'ok',
    })
    // Fake rejects pinned models, so the unpinned line carries no model key.
    expect('model' in (d.logs[0] as object)).toBe(false)
  })

  it('passes model and round through to the chat line', async () => {
    const stub: ProviderAdapter = {
      providerName: 'stub',
      chat: async () => ({ text: 'hi', reasoning: '', toolCalls: [], usage: emptyUsage() }),
      chatStream: () => {
        throw new Error('chatOnce test must not stream')
      },
    }
    const d = deps()
    await chatOnce(stub, request(), { model: 'm-stub', round: 3, log: d.log })
    expect(d.logs).toHaveLength(1)
    expect(d.logs[0]).toMatchObject({ op: 'provider.chat', model: 'm-stub', round: 3, outcome: 'ok' })
  })

  it('builds provider.round lines with optional model/round/tokens', () => {
    expect(
      providerRoundFields({
        provider: 'meta',
        model: 'm',
        round: 2,
        latencyMs: 41,
        usage: { ...emptyUsage(), inputTokens: 10, outputTokens: 4 },
        outcome: 'ok',
      }),
    ).toEqual({
      op: 'provider.round',
      provider: 'meta',
      model: 'm',
      round: 2,
      latency_ms: 41,
      input_tokens: 10,
      output_tokens: 4,
      cached_tokens: 0,
      outcome: 'ok',
    })
    expect(providerRoundFields({ provider: 'meta', latencyMs: 3, outcome: 'error', code: 'provider_timeout' })).toEqual({
      op: 'provider.round',
      provider: 'meta',
      latency_ms: 3,
      outcome: 'error',
      code: 'provider_timeout',
    })
  })
})

describe('fleet meta permit (P4.2)', () => {
  function stubAdapter(events: string[], fail?: Error): ProviderAdapter {
    return {
      providerName: 'meta',
      chat: async () => {
        events.push('chat')
        if (fail) throw fail
        return { text: 'hi', toolCalls: [], usage: emptyUsage(), completion: 'complete' as const }
      },
      chatStream: async function* () {
        events.push('stream')
        if (fail) throw fail
        yield { kind: 'text_delta' as const, text: 'hi' }
        yield { kind: 'done' as const, usage: emptyUsage() }
      },
    }
  }

  function acquireSpy(events: string[]): { acquire: () => Promise<() => Promise<void>>; released: () => number } {
    let released = 0
    return {
      released: () => released,
      acquire: async () => {
        events.push('acquire')
        return async () => {
          events.push('release')
          released += 1
        }
      },
    }
  }

  it('holds the permit exactly across one chat call', async () => {
    const events: string[] = []
    const spy = acquireSpy(events)
    const wrapped = wrapAdapterWithPermit(stubAdapter(events), spy.acquire)
    const response = await wrapped.chat(request())
    expect(response.text).toBe('hi')
    expect(events).toEqual(['acquire', 'chat', 'release'])
  })

  it('holds the permit across stream consumption and releases after', async () => {
    const events: string[] = []
    const spy = acquireSpy(events)
    const wrapped = wrapAdapterWithPermit(stubAdapter(events), spy.acquire)
    let text = ''
    for await (const event of wrapped.chatStream(request())) {
      if (event.kind === 'text_delta') text += event.text
    }
    expect(text).toBe('hi')
    expect(events).toEqual(['acquire', 'stream', 'release'])
  })

  it('releases the permit when the call fails', async () => {
    const events: string[] = []
    const spy = acquireSpy(events)
    const wrapped = wrapAdapterWithPermit(stubAdapter(events, new Error('vendor down')), spy.acquire)
    await expect(wrapped.chat(request())).rejects.toThrow('vendor down')
    expect(spy.released()).toBe(1)
  })

  it('executeProviderChat skips the permit for scripted fake steps', async () => {
    const d = deps()
    let acquired = 0
    const outcome = await executeProviderChat(input({ fakeSteps: [{ text: 'hi' }] }), {
      ...d,
      permit: async () => {
        acquired += 1
        return async () => undefined
      },
    })
    expect(outcome.ok).toBe(true)
    expect(acquired).toBe(0)
  })

  it('a permit timeout throws past the outcome so the activity retries', async () => {
    const d = deps()
    await expect(executeProviderChat(
      input({ provider: 'meta' }),
      { ...d, permit: async () => { throw new MetaPermitTimeout('TEST no permit') } },
    )).rejects.toBeInstanceOf(MetaPermitTimeout)
    expect(d.events).toHaveLength(0)
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
