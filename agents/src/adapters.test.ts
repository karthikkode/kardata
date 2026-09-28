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

describe('MetaAdapter', () => {
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
