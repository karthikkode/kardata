// Adapter cassette tests. T2.2-T2.4. Fixtures are checked-in cassettes:
// recorded wire bodies replayed through injected fetch, zero network.
// Live re-recording is manual (request capture to fixture) until T10.4 probes.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MetaAdapter } from './meta.js'
import { OpenAICompatAdapter } from './openai-compat.js'
import { emptyUsage, type ProviderRequest } from './providers.js'
import { readSseData } from './transport.js'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function jsonFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtures, name), 'utf8'))
}

function stubFetch(body: string, contentType: string, status = 200): typeof fetch {
  return (async () => new Response(body, { status, headers: { 'content-type': contentType } })) as typeof fetch
}

function request(): ProviderRequest {
  return {
    systemPrompt: 'sys',
    messages: [{ role: 'user', text: 'go' }],
    tools: [
      {
        name: 'hound_search',
        description: 'search',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
      },
    ],
    toolChoice: { mode: 'auto' },
  }
}

describe('provider terminal completion evidence', () => {
  it.each([
    ['stop', 'complete'], ['tool_calls', 'complete'], ['function_call', 'complete'],
    ['length', 'incomplete'], ['content_filter', 'incomplete'],
    [null, undefined], ['TEST unfamiliar', undefined], [undefined, undefined],
  ] as const)('maps Chat finish reason %s without guessing or discarding the partial reply', async (reason, expected) => {
    for (const Adapter of [MetaAdapter, OpenAICompatAdapter]) {
      const body = { choices: [{ message: { content: 'TEST retained partial reply' }, ...(reason === undefined ? {} : { finish_reason: reason }) }], usage: { prompt_tokens: 11, completion_tokens: 7 } }
      const adapter = new Adapter({ apiKey: 'TEST key', model: 'TEST model', baseUrl: 'https://TEST-provider.example', fetchFn: stubFetch(JSON.stringify(body), 'application/json') })
      const response = await adapter.chat(request())
      expect(response.completion).toBe(expected)
      if (expected === undefined) expect(response).not.toHaveProperty('completion')
      expect(response.text).toBe('TEST retained partial reply')
      expect(response.usage).toMatchObject({ inputTokens: 11, outputTokens: 7 })
    }
  })
  it.each([
    ['completed', 'complete'], ['incomplete', 'incomplete'], ['failed', 'incomplete'], ['cancelled', 'incomplete'],
    ['in_progress', undefined], ['queued', undefined], ['TEST unfamiliar', undefined], [undefined, undefined],
  ] as const)('maps Responses status %s only when it proves terminal completion', async (status, expected) => {
    const body = { ...(status === undefined ? {} : { status }), output: [{ type: 'message', content: [{ type: 'output_text', text: 'TEST preserved response' }] }], usage: { input_tokens: 9, output_tokens: 3 } }
    const adapter = new MetaAdapter({ apiKey: 'TEST key', model: 'TEST model', mode: 'responses', fetchFn: stubFetch(JSON.stringify(body), 'application/json') })
    const response = await adapter.chat(request())
    expect(response.completion).toBe(expected)
    if (expected === undefined) expect(response).not.toHaveProperty('completion')
    expect(response.text).toBe('TEST preserved response')
    expect(response.usage).toMatchObject({ inputTokens: 9, outputTokens: 3 })
  })
  it.each(['stop', 'length', undefined] as const)('retains explicit Chat terminal metadata across stream EOF (%s)', async (reason) => {
    const frame = { choices: [{ delta: { content: 'TEST streamed reply' }, ...(reason === undefined ? {} : { finish_reason: reason }) }] }
    const adapter = new MetaAdapter({ apiKey: 'TEST key', model: 'TEST model', fetchFn: stubFetch(`data: ${JSON.stringify(frame)}\n\n`, 'text/event-stream') })
    const events = []
    for await (const event of adapter.chatStream(request())) events.push(event)
    const done = events.find((event) => event.kind === 'done')
    expect(done).toEqual({ kind: 'done', usage: emptyUsage(), ...(reason === undefined ? {} : { completion: reason === 'stop' ? 'complete' : 'incomplete' }) })
  })
  it.each(['completed', 'incomplete', undefined] as const)('preserves Responses stream terminal status %s without treating EOF as proof', async (status) => {
    const terminal = { type: status === 'incomplete' ? 'response.incomplete' : 'response.completed', response: { ...(status === undefined ? {} : { status }), usage: { input_tokens: 4, output_tokens: 2 } } }
    const frames = [{ type: 'response.output_text.delta', delta: 'TEST retained streamed text' }, terminal].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
    const adapter = new MetaAdapter({ apiKey: 'TEST key', model: 'TEST model', mode: 'responses', fetchFn: stubFetch(frames, 'text/event-stream') })
    const events = []
    for await (const event of adapter.chatStream(request())) events.push(event)
    expect(events[0]).toEqual({ kind: 'text_delta', text: 'TEST retained streamed text' })
    expect(events.at(-1)).toEqual({ kind: 'done', usage: { ...emptyUsage(), inputTokens: 4, outputTokens: 2 }, ...(status === undefined ? {} : { completion: status === 'completed' ? 'complete' : 'incomplete' }) })
  })
})

describe('input-token endpoint availability', () => {
  it('bounds billing-error JSON before classifying its whitelisted code', async () => {
    let cancelled = false
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('A'.repeat(64 * 1024 + 1))) }, cancel() { cancelled = true } })
    const adapter = new MetaAdapter({ apiKey: 'TEST key', model: 'TEST model', mode: 'responses', fetchFn: async () => new Response(stream, { status: 402 }) })
    await expect(adapter.countInputTokens!(request())).rejects.toMatchObject({ name: 'ProviderError', message: expect.stringContaining('byte limit') })
    expect(cancelled).toBe(true)
  })
  it.each([{}, { input_tokens: -1 }, { input_tokens: 0.5 }, { input_tokens: Number.MAX_SAFE_INTEGER + 1 }])('preserves malformed successful counter replies as failures: %j', async (body) => {
    const adapter = new MetaAdapter({ apiKey: 'TEST key', model: 'TEST model', mode: 'responses', fetchFn: stubFetch(JSON.stringify(body), 'application/json') })
    await expect(adapter.countInputTokens!(request())).rejects.toMatchObject({ name: 'ProviderError' })
  })
  it.each([404, 405, 501])('classifies only unsupported counter HTTP%s as unavailable', async (status) => {
    const adapter = new MetaAdapter({ apiKey: 'TEST key', model: 'TEST model', mode: 'responses', fetchFn: stubFetch('TEST private endpoint body', 'text/plain', status) })
    await expect(adapter.countInputTokens!(request())).rejects.toMatchObject({ name: 'TokenCountUnavailableError', code: 'token_count_unavailable', status, reason: 'unsupported' })
  })
  it('classifies the exact count-only billing code without retaining raw body/message', async () => {
    const adapter = new MetaAdapter({ apiKey: 'TEST key', model: 'TEST model', mode: 'responses', fetchFn: stubFetch(JSON.stringify({ error: { code: 'billing_not_configured', message: 'TEST private billing message' } }), 'application/json', 402) })
    const error = await adapter.countInputTokens!(request()).catch((failure: unknown) => failure)
    expect(error).toMatchObject({ name: 'TokenCountUnavailableError', code: 'token_count_unavailable', status: 402, reason: 'billing_not_configured' })
    expect(String(error)).not.toContain('TEST private')
  })
  it.each([402, 401, 403, 429, 503])('keeps HTTP%s generic errors distinct from counter unavailability', async (status) => {
    const adapter = new MetaAdapter({ apiKey: 'TEST key', model: 'TEST model', mode: 'responses', fetchFn: stubFetch(JSON.stringify({ error: { code: 'TEST another code', message: 'TEST secret message' } }), 'application/json', status) })
    const error = await adapter.countInputTokens!(request()).catch((failure: unknown) => failure)
    expect(error).toMatchObject({ name: 'ProviderError' })
    expect(String(error)).not.toContain('TEST secret')
  })
})

describe('MetaAdapter', () => {
  it.each([false, true])('clamps Meta Responses none to auto without adding tools (stream=%s)', async (stream) => {
    let body: Record<string, unknown> | undefined
    const adapter = new MetaAdapter({ apiKey: 'TEST key', model: 'TEST model', mode: 'responses', fetchFn: async (_url, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(stream ? 'data: [DONE]\n\n' : JSON.stringify({ status: 'completed', output: [], usage: {} }), { headers: { 'content-type': stream ? 'text/event-stream' : 'application/json' } })
    } })
    const input = { ...request(), tools: [], toolChoice: { mode: 'none' as const } }
    if (stream) { for await (const _event of adapter.chatStream(input)) { /* consume */ } } else await adapter.chat(input)
    expect(body).toMatchObject({ tool_choice: 'auto', tools: [] })
    expect(input.toolChoice.mode).toBe('none')
  })
  it('maps chat-wire parallel calls with zeroed cache counters', async () => {
    const adapter = new MetaAdapter({
      apiKey: 'test',
      model: 'muse-spark-1.3',
      fetchFn: stubFetch(JSON.stringify(jsonFixture('meta-chat.json')), 'application/json'),
    })
    const response = await adapter.chat(request())
    expect(response.toolCalls.map((call) => call.id)).toEqual(['call_m1', 'call_m2'])
    expect(response.usage.cacheHitTokens).toBe(0)
    expect(response.usage.cacheMissTokens).toBe(0)
    expect(response.usage.cacheReadTokens).toBe(41)
  })

  it('clamps tool_choice to auto on the Meta Chat wire', async () => {
    let sentBody = ''
    const adapter = new MetaAdapter({
      apiKey: 'test',
      model: 'muse-spark-1.3',
      fetchFn: (async (_url, init) => {
        sentBody = String(init?.body ?? '')
        return new Response(JSON.stringify(jsonFixture('meta-chat.json')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof fetch,
    })
    await adapter.chat({ ...request(), toolChoice: { mode: 'required' } })
    const body = JSON.parse(sentBody) as { tool_choice: unknown }
    expect(body.tool_choice).toBe('auto')
  })

  it('yields reasoning deltas for reasoning_content chunks', async () => {
    const sse = [
      { choices: [{ delta: { reasoning_content: 'first thought' } }] },
      { choices: [{ delta: { content: 'answer' } }] },
    ]
      .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
      .join('')
    const adapter = new MetaAdapter({
      apiKey: 'test',
      model: 'muse-spark-1.3',
      fetchFn: (async () =>
        new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch,
    })
    const kinds: string[] = []
    for await (const event of adapter.chatStream({ ...request(), tools: [] })) {
      kinds.push(event.kind)
    }
    expect(kinds).toEqual(['reasoning_delta', 'text_delta', 'done'])
  })

  it('requests and streams Meta Responses reasoning summaries', async () => {
    let sentBody = ''
    const sse = [
      { type: 'response.reasoning_summary_text.delta', delta: 'Checked the evidence. ' },
      { type: 'response.output_text.delta', delta: 'The claim needs a source.' },
      { type: 'response.completed', response: { usage: { input_tokens: 12, output_tokens: 8 } } },
      '[DONE]',
    ].map((frame) => `data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n\n`).join('')
    const adapter = new MetaAdapter({
      apiKey: 'test', model: 'muse-spark-1.3', mode: 'responses',
      fetchFn: (async (_url, init) => {
        sentBody = String(init?.body ?? '')
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }) as typeof fetch,
    })
    const seen = []
    for await (const event of adapter.chatStream({ ...request(), tools: [], reasoningEffort: 'high' })) seen.push(event)
    expect(JSON.parse(sentBody)).toMatchObject({ reasoning: { effort: 'high', summary: 'auto' } })
    expect(seen).toEqual([
      { kind: 'reasoning_delta', text: 'Checked the evidence. ' },
      { kind: 'text_delta', text: 'The claim needs a source.' },
      { kind: 'done', usage: { ...emptyUsage(), inputTokens: 12, outputTokens: 8 } },
    ])
  })

  it('surfaces a Meta Responses stream failure instead of an empty answer', async () => {
    const sse = `data: ${JSON.stringify({ type: 'response.failed', response: { error: { code: 'server_error' } } })}\n\n`
    const adapter = new MetaAdapter({
      apiKey: 'test', model: 'muse-spark-1.3', mode: 'responses',
      fetchFn: (async () => new Response(sse, { status: 200 })) as typeof fetch,
    })
    const consume = async () => {
      for await (const _event of adapter.chatStream({ ...request(), tools: [], reasoningEffort: 'high' })) {
        // The server fails before a completed answer.
      }
    }
    await expect(consume()).rejects.toThrow(/Responses stream failed: server_error/)
  })

  it('omits the system message when no system prompt is set', async () => {
    // Meta 400s on a content-less messages[0] (live-verified): every sent
    // message must carry content.
    let sentBody = ''
    const adapter = new MetaAdapter({
      apiKey: 'test',
      model: 'muse-spark-1.3',
      fetchFn: (async (_url, init) => {
        sentBody = String(init?.body ?? '')
        return new Response(JSON.stringify(jsonFixture('meta-chat.json')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof fetch,
    })
    await adapter.chat({ ...request(), systemPrompt: '' })
    const body = JSON.parse(sentBody) as { messages: Array<{ role: string; content?: unknown }> }
    expect(body.messages.length).toBeGreaterThan(0)
    for (const message of body.messages) {
      expect(typeof message.content).toBe('string')
    }
    expect(body.messages.some((message) => message.role === 'system')).toBe(false)
  })

  it('sends reasoning_effort on the wire when the request carries one', async () => {
    let sentBody = ''
    const adapter = new MetaAdapter({
      apiKey: 'test',
      model: 'muse-spark-1.3',
      fetchFn: (async (_url, init) => {
        sentBody = String(init?.body ?? '')
        return new Response(JSON.stringify(jsonFixture('meta-chat.json')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof fetch,
    })
    await adapter.chat({ ...request(), reasoningEffort: 'high' })
    const body = JSON.parse(sentBody) as { reasoning_effort?: unknown }
    expect(body.reasoning_effort).toBe('high')
  })

  it('omits reasoning_effort when the request carries none', async () => {
    let sentBody = ''
    const adapter = new MetaAdapter({
      apiKey: 'test',
      model: 'muse-spark-1.3',
      fetchFn: (async (_url, init) => {
        sentBody = String(init?.body ?? '')
        return new Response(JSON.stringify(jsonFixture('meta-chat.json')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof fetch,
    })
    await adapter.chat(request())
    const body = JSON.parse(sentBody) as Record<string, unknown>
    expect('reasoning_effort' in body).toBe(false)
  })

  it('maps responses-wire output items by call_id', async () => {
    const adapter = new MetaAdapter({
      apiKey: 'test',
      model: 'muse-spark-1.3',
      mode: 'responses',
      fetchFn: stubFetch(JSON.stringify(jsonFixture('meta-responses.json')), 'application/json'),
    })
    const response = await adapter.chat(request())
    expect(response.text).toBe('Verifying both.')
    expect(response.toolCalls.map((call) => call.id)).toEqual(['call_r1', 'call_r2'])
    expect(response.usage.inputTokens).toBe(700)
  })
})

describe('OpenAICompatAdapter', () => {
  it('binds a third provider with config only', async () => {
    const adapter = new OpenAICompatAdapter({
      apiKey: 'test',
      model: 'third-party-model',
      baseUrl: 'https://example.com/v1',
      fetchFn: stubFetch(JSON.stringify(jsonFixture('generic-chat.json')), 'application/json'),
    })
    const response = await adapter.chat(request())
    expect(response.text).toBe('All done, no tools needed.')
    expect(response.toolCalls).toEqual([])
  })

describe('incremental SSE streaming', () => {
  it('yields chat deltas before the provider stream closes', async () => {
    const encoder = new TextEncoder()
    let push!: (bytes: Uint8Array) => void
    let finish!: () => void
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"he"}}]}\n\n'))
        push = (bytes) => controller.enqueue(bytes)
        finish = () => controller.close()
      },
    })
    const fetchFn = (async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch
    const adapter = new OpenAICompatAdapter({ apiKey: 'test', model: 'test-model', baseUrl: 'https://compat.test/v1', fetchFn })
    const iterator = adapter.chatStream(request())[Symbol.asyncIterator]()
    // First delta arrives while the provider stream is still open: proves
    // incremental parsing instead of buffer-then-flush at close.
    const first = await iterator.next()
    expect(first.done).toBe(false)
    expect(first.value).toEqual({ kind: 'text_delta', text: 'he' })
    push(encoder.encode('data: {"choices":[{"delta":{"content":"llo"}}]}\n\ndata: [DONE]\n\n'))
    finish()
    const rest = []
    for await (const event of { [Symbol.asyncIterator]: () => iterator }) rest.push(event)
    expect(rest).toEqual([{ kind: 'text_delta', text: 'llo' }, { kind: 'done', usage: emptyUsage() }])
  }, 10000)

  it('reassembles frames and multibyte text split across chunks', async () => {
    const encoder = new TextEncoder()
    const bytes = encoder.encode('data: {"choices":[{"delta":{"content":"héllo"}}]}\n\n')
    // Split between the two bytes of é: streaming decode must survive it.
    const cut = bytes.indexOf(0xc3) + 1
    expect(cut).toBeGreaterThan(0)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut))
        controller.enqueue(bytes.slice(cut))
        controller.close()
      },
    })
    const seen: string[] = []
    for await (const data of readSseData(new Response(body))) seen.push(data)
    expect(seen).toEqual(['{"choices":[{"delta":{"content":"héllo"}}]}'])
  })

  it('yields CRLF framed deltas before the provider closes', async () => {
    const encoder = new TextEncoder()
    let finish!: () => void
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: first\r\n\r\n'))
        finish = () => controller.close()
      },
    })
    const iterator = readSseData(new Response(body))[Symbol.asyncIterator]()
    expect(await iterator.next()).toEqual({ value: 'first', done: false })
    finish()
    expect((await iterator.next()).done).toBe(true)
  })
})
})

describe('MetaAdapter image parts', () => {
  it('sends message images as data-URL parts, never raw bytes', async () => {
    let sentBody = ''
    const adapter = new MetaAdapter({
      apiKey: 'test',
      model: 'muse-spark-1.3-contributor',
      fetchFn: (async (_url, init) => {
        sentBody = String(init?.body ?? '')
        return new Response(JSON.stringify(jsonFixture('meta-chat.json')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof fetch,
    })
    const raw = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')
    await adapter.chat({
      ...request(),
      messages: [
        { role: 'user', text: 'transcribe', images: [{ mediaType: 'image/png', base64: raw }] },
      ],
    })
    const body = JSON.parse(sentBody) as { messages: Array<{ role: string; content: unknown }> }
    const user = body.messages.find((message) => message.role === 'user')
    expect(user?.content).toEqual([
      { type: 'text', text: 'transcribe' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${raw}` } },
    ])
  })
})
