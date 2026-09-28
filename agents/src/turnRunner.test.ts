// Karbot turn runner tests. Fake provider plus in-memory MCP/sink doubles
// only — no network, no credentials, no environment.
import { describe, expect, it, vi } from 'vitest'
import { BudgetTracker, RepetitionTracker } from './budgets.js'
import { frozenClock } from './clock.js'
import type { SummaryArtifact } from './condense.js'
import type { ContextSnapshot } from './context.js'
import { FakeProvider } from './fake.js'
import { emptyUsage, type ProviderAdapter, type ToolDefinition } from './providers.js'
import {
  createClosedMcpClient,
  runKarbotTurn,
  StreamableMcpClient,
  type TurnRunnerMcpClient,
} from './turnRunner.js'

function sessionTool(): ToolDefinition {
  return {
    name: 'db.list_sessions',
    description: 'List sessions.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  }
}

function memoryMcp(): TurnRunnerMcpClient & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  return {
    calls,
    async listTools(): Promise<ToolDefinition[]> {
      return [sessionTool()]
    },
    async callTool(name: string, args: Record<string, unknown>): Promise<{ content: string; isError?: boolean }> {
      calls.push({ name, args })
      return { content: `sessions: []` }
    },
  }
}

function memorySink(): { deltas: string[]; sink: { onDelta(text: string): void } } {
  const deltas: string[] = []
  return { deltas, sink: { onDelta: (text: string): void => void deltas.push(text) } }
}

describe('runKarbotTurn', () => {
  it('shows a tool as soon as its provider stream starts', async () => {
    let release: () => void = () => undefined
    let announce: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { announce = resolve })
    const seen: Array<{ name: string; state: string }> = []
    const provider: ProviderAdapter = {
      providerName: 'stream-test',
      async chat() { throw new Error('unused') },
      async *chatStream() {
        yield { kind: 'toolcall_start', index: 0, key: 'c1' }
        await gate
        yield { kind: 'toolcall_end', index: 0, call: { id: 'c1', name: 'db.list_sessions', args: {} } }
        yield { kind: 'done', usage: emptyUsage() }
      },
    }
    const turn = runKarbotTurn({
      provider, mcp: memoryMcp(), systemPrompt: 'sys', messages: [{ role: 'user', text: 'list' }], maxTurns: 1,
      sink: { onDelta() {}, onTool(_id, name, state) { seen.push({ name, state }); if (seen.length === 1) announce() } },
    })
    await started
    expect(seen).toEqual([{ name: 'Tool call', state: 'running' }])
    release()
    await turn
    expect(seen.at(-1)).toEqual({ name: 'db.list_sessions', state: 'done' })
  })
  it('reports a tool as running before MCP resolves, then completes it', async () => {
    const provider = new FakeProvider([
      { text: '', toolCalls: [{ id: 'call-1', name: 'db.list_sessions', args: {} }] },
      { text: 'done' },
    ])
    let release: () => void = () => undefined
    let announce: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { announce = resolve })
    const events: Array<{ id: string; name: string; state: string; round: number }> = []
    const mcp: TurnRunnerMcpClient = {
      async listTools() { return [sessionTool()] },
      async callTool() { announce(); await gate; return { content: 'sessions: []' } },
    }
    const turn = runKarbotTurn({
      provider, mcp, systemPrompt: 'sys', messages: [{ role: 'user', text: 'list' }],
      sink: { onDelta() {}, onTool(id, name, state, round) { events.push({ id, name, state, round }) } },
    })
    await started
    expect(events).toEqual([
      { id: 'call-1', name: 'Tool call', state: 'running', round: 1 },
      { id: 'call-1', name: 'db.list_sessions', state: 'running', round: 1 },
    ])
    release()
    await turn
    expect(events).toEqual([
      { id: 'call-1', name: 'Tool call', state: 'running', round: 1 },
      { id: 'call-1', name: 'db.list_sessions', state: 'running', round: 1 },
      { id: 'call-1', name: 'db.list_sessions', state: 'done', round: 1 },
    ])
  })
  it('streams deltas to the sink and executes tool calls through MCP', async () => {
    const provider = new FakeProvider([
      {
        text: 'checking ',
        toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }],
      },
      { text: 'done' },
    ])
    const mcp = memoryMcp()
    const { deltas, sink } = memorySink()
    const result = await runKarbotTurn({
      provider,
      mcp,
      sink,
      systemPrompt: 'You are Karbot.',
      messages: [{ role: 'user', text: 'hi' }],
    })
    expect(result.text).toBe('done')
    expect(result.turns).toBe(2)
    expect(result.toolCalls.map((call) => call.name)).toEqual(['db.list_sessions'])
    expect(mcp.calls).toEqual([{ name: 'db.list_sessions', args: {} }])
    expect(deltas.join('')).toBe('checking done')
    expect(provider.remaining).toBe(0)
    expect(result.usage.inputTokens + result.usage.outputTokens).toBe(0)
  })

  it('dispatches one round of tool calls together, keeping history order', async () => {
    const provider = new FakeProvider([
      {
        text: '',
        toolCalls: [
          { id: 'c1', name: 'db.list_sessions', args: {} },
          { id: 'c2', name: 'db.list_sessions', args: {} },
        ],
      },
      { text: 'done' },
    ])
    const started: string[] = []
    let releaseBoth: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { releaseBoth = resolve })
    const mcp: TurnRunnerMcpClient = {
      async listTools() { return [sessionTool()] },
      async callTool(name, args) {
        started.push(`${name}:${JSON.stringify(args)}`)
        await gate
        return { content: 'sessions: []' }
      },
    }
    const { sink } = memorySink()
    const turn = runKarbotTurn({
      provider,
      mcp,
      sink,
      systemPrompt: 'You are Karbot.',
      messages: [{ role: 'user', text: 'hi' }],
    })
    await vi.waitFor(() => expect(started).toHaveLength(2))
    releaseBoth()
    const result = await turn
    // Both dispatched before either resolved; completion keeps call order.
    expect(result.toolCalls.map((call) => call.id)).toEqual(['c1', 'c2'])
    expect(provider.calls[1]?.messages.filter((message) => message.role === 'tool').map((message) => message.toolResult?.toolCallId)).toEqual(['c1', 'c2'])
  })

  it('accumulates reasoning deltas into the result and sink', async () => {
    const provider = new FakeProvider([{ text: 'done', reasoning: 'thinking it over' }])
    const seen: string[] = []
    const { sink } = memorySink()
    const result = await runKarbotTurn({
      provider,
      mcp: memoryMcp(),
      sink: { onDelta: sink.onDelta, onReasoning: (text) => void seen.push(text) },
      systemPrompt: 'You are Karbot.',
      messages: [{ role: 'user', text: 'hi' }],
    })
    expect(result.text).toBe('done')
    expect(result.reasoning).toBe('thinking it over')
    expect(seen).toEqual(['thinking it over'])
  })

  it('passes reasoningEffort through to the provider request', async () => {
    const provider = new FakeProvider([{ text: 'done' }])
    const { sink } = memorySink()
    await runKarbotTurn({
      provider,
      mcp: memoryMcp(),
      sink,
      systemPrompt: 'You are Karbot.',
      messages: [{ role: 'user', text: 'hi' }],
      reasoningEffort: 'low',
    })
    expect(provider.calls.map((call) => call.reasoningEffort)).toEqual(['low'])
  })

  it('passes temperature through and rejects out-of-range values', async () => {
    const provider = new FakeProvider([{ text: 'done' }])
    const { sink } = memorySink()
    await runKarbotTurn({
      provider,
      mcp: memoryMcp(),
      sink,
      systemPrompt: 'You are Karbot.',
      messages: [{ role: 'user', text: 'hi' }],
      temperature: 0.9,
    })
    expect(provider.calls.map((call) => call.temperature)).toEqual([0.9])
    const { sink: sink2 } = memorySink()
    await expect(
      runKarbotTurn({
        provider: new FakeProvider([{ text: 'done' }]),
        mcp: memoryMcp(),
        sink: sink2,
        systemPrompt: 'You are Karbot.',
        messages: [{ role: 'user', text: 'hi' }],
        temperature: 2.5,
      }),
    ).rejects.toThrow('temperature')
  })

  it('turns tool errors into tool messages and keeps going', async () => {
    const provider = new FakeProvider([
      { text: '', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }] },
      { text: 'recovered' },
    ])
    const failing: TurnRunnerMcpClient = {
      async listTools(): Promise<ToolDefinition[]> {
        return [sessionTool()]
      },
      async callTool(): Promise<{ content: string; isError?: boolean }> {
        return { content: 'boom', isError: true }
      },
    }
    const { sink } = memorySink()
    const result = await runKarbotTurn({
      provider,
      mcp: failing,
      sink,
      systemPrompt: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
    })
    expect(result.text).toBe('recovered')
    const toolMessages = provider.calls[1]?.messages.filter((message) => message.role === 'tool') ?? []
    expect(toolMessages.length).toBe(1)
    expect(toolMessages[0]?.toolResult?.isError).toBe(true)
  })

  it('stops at maxTurns when the model keeps calling tools', async () => {
    const provider = new FakeProvider([
      { text: 'a', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }] },
      { text: 'b', toolCalls: [{ id: 'c2', name: 'db.list_sessions', args: {} }] },
      { text: 'c' },
    ])
    const { sink } = memorySink()
    const result = await runKarbotTurn({
      provider,
      mcp: memoryMcp(),
      sink,
      systemPrompt: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      maxTurns: 2,
    })
    expect(result.turns).toBe(2)
    expect(result.text).toBe('b')
    expect(provider.remaining).toBe(1)
  })

  it('rejects out-of-range options without calling the provider', async () => {
    const provider = new FakeProvider([{ text: 'x' }])
    const { sink } = memorySink()
    await expect(
      runKarbotTurn({ provider, mcp: memoryMcp(), sink, systemPrompt: 's', messages: [], maxTurns: 0 }),
    ).rejects.toThrow(RangeError)
    expect(provider.remaining).toBe(1)
  })
})

describe('runKarbotTurn harness', () => {
  const limits = {
    maxTurns: 10,
    maxToolCalls: 10,
    maxTokens: 1_000_000,
    maxCost: 100,
    maxWallMs: 60_000,
    maxStalledTurns: 5,
  }

  it('halts before the provider call when a budget is already tripped', async () => {
    const provider = new FakeProvider([{ text: 'hi' }])
    const { sink } = memorySink()
    const budgets = new BudgetTracker({ ...limits, maxTurns: 1 }, frozenClock(0))
    budgets.noteTurn(true)
    const result = await runKarbotTurn({
      provider,
      mcp: memoryMcp(),
      sink,
      systemPrompt: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      harness: { budgets },
    })
    expect(result.budgetTripped).toEqual(['turns'])
    expect(provider.remaining).toBe(1)
  })

  it('records token and tool-call usage into the budget tracker', async () => {
    const provider = new FakeProvider([
      { text: 'a', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }], usage: { inputTokens: 40, outputTokens: 2 } },
      { text: 'done', usage: { inputTokens: 50, outputTokens: 3 } },
    ])
    const { sink } = memorySink()
    const budgets = new BudgetTracker({ ...limits, maxTokens: 1 }, frozenClock(0))
    await runKarbotTurn({
      provider,
      mcp: memoryMcp(),
      sink,
      systemPrompt: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      harness: { budgets },
    })
    expect(budgets.tripped()).toEqual(['tokens'])
  })

  it('accounts the final reply-only round into the budget tracker', async () => {
    const provider = new FakeProvider([
      { text: 'done', usage: { inputTokens: 50, outputTokens: 3 } },
    ])
    const { sink } = memorySink()
    const budgets = new BudgetTracker({ ...limits, maxTurns: 1 }, frozenClock(0))
    const result = await runKarbotTurn({
      provider,
      mcp: memoryMcp(),
      sink,
      systemPrompt: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      harness: { budgets },
    })
    expect(result.text).toBe('done')
    // Pre-fix the lone round broke before accounting, so the tracker saw
    // zero turns and tripped nothing.
    expect(budgets.tripped()).toEqual(['turns'])
    expect(result.turns).toBe(1)
  })

  it('halts a repeating tool loop with a repetition verdict', async () => {
    const repeat = { id: 'c1', name: 'db.list_sessions', args: {} }
    const provider = new FakeProvider([
      { text: 'a', toolCalls: [repeat] },
      { text: 'b', toolCalls: [{ ...repeat, id: 'c2' }] },
      { text: 'c', toolCalls: [{ ...repeat, id: 'c3' }] },
      { text: 'unreached' },
    ])
    const mcp = memoryMcp()
    const { sink } = memorySink()
    const result = await runKarbotTurn({
      provider,
      mcp,
      sink,
      systemPrompt: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      harness: { repetition: new RepetitionTracker() },
    })
    expect(result.repetitionHalt?.verdict).toBe('replan')
    expect(mcp.calls).toHaveLength(3)
    expect(provider.remaining).toBe(1)
  })

  it('emits hash-chained snapshots for every provider round', async () => {
    const provider = new FakeProvider([
      { text: 'a', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }] },
      { text: 'done' },
    ])
    const { sink } = memorySink()
    const snapshots: ContextSnapshot[] = []
    await runKarbotTurn({
      provider,
      mcp: memoryMcp(),
      sink,
      systemPrompt: 'sys',
      messages: [{ role: 'user', text: 'hi' }],
      harness: {
        versions: { tools: { 'db.list_sessions': '2' }, prompt: 'karbot.7', policy: 'policy.3' },
        onSnapshot: (snapshot) => void snapshots.push(snapshot),
      },
    })
    expect(snapshots).toHaveLength(2)
    expect(snapshots[0]?.parentHash).toBeUndefined()
    expect(snapshots[1]?.parentHash).toBe(snapshots[0]?.hash)
    expect(snapshots[0]?.toolVersions).toEqual({ 'db.list_sessions': '2' })
  })

  it('condenses history before the provider call when over maxSize', async () => {
    const provider = new FakeProvider([{ text: 'done' }])
    const { sink } = memorySink()
    const summaries: SummaryArtifact[] = []
    const result = await runKarbotTurn({
      provider,
      mcp: memoryMcp(),
      sink,
      systemPrompt: 'sys',
      messages: [
        { role: 'user', text: 'one' },
        { role: 'assistant', text: 'two' },
        { role: 'user', text: 'three' },
        { role: 'assistant', text: 'four' },
        { role: 'user', text: 'five' },
      ],
      harness: {
        condense: {
          maxSize: 4,
          keepFirst: 1,
          summarize: () => Promise.resolve('earlier stuff'),
          onCondense: (summary) => void summaries.push(summary),
        },
      },
    })
    expect(result.condensed).toHaveLength(1)
    expect(summaries).toHaveLength(1)
    const sent = provider.calls[0]?.messages ?? []
    expect(sent.length).toBeLessThan(5)
    expect(sent.some((message) => message.text?.includes('earlier stuff'))).toBe(true)
  })
})

describe('StreamableMcpClient', () => {
  it('posts JSON-RPC with the injected endpoint and bearer token', async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: string }> = []
    const client = new StreamableMcpClient({
      endpoint: 'https://mcp.internal/mcp',
      token: 'scoped-token',
      fetchFn: async (url, init) => {
        seen.push({ url, headers: init.headers, body: init.body })
        const body = JSON.parse(init.body) as { method: string }
        if (body.method === 'initialize') {
          return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) }
        }
        if (body.method === 'notifications/initialized') {
          return { ok: true, status: 202, text: async () => '' }
        }
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              result: { tools: [{ name: 'db.list_sessions', description: 'List.', inputSchema: { type: 'object' } }] },
            }),
        }
      },
    })
    const tools = await client.listTools()
    expect(tools.map((tool) => tool.name)).toEqual(['db.list_sessions'])
    expect(seen[0]?.url).toBe('https://mcp.internal/mcp')
    expect(seen[0]?.headers['authorization']).toBe('Bearer scoped-token')
    for (const request of seen) {
      expect(request.body).not.toContain('scoped-token')
      expect(request.headers['authorization']).toContain('Bearer ')
    }
  })

  it('sends the grant header when narrowed, omits it otherwise', async () => {
    const seen: Array<Record<string, string>> = []
    const fetchFn = async (_url: string, init: { headers: Record<string, string> }) => {
      seen.push(init.headers)
      return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }) }
    }
    const at = (client: number, request: number): Record<string, string> | undefined => {
      const owned = seen.filter((_, index) => Math.floor(index / 3) === client)
      return owned[request]
    }
    const narrowed = new StreamableMcpClient({
      endpoint: 'https://mcp.internal/mcp',
      token: 'scoped-token',
      grant: ['db.get_sector', ' db.kb_search '],
      fetchFn,
    })
    await narrowed.listTools()
    // initialize, notifications/initialized, tools/list: every exchange
    // carries the narrowed grant.
    for (const index of [0, 1, 2]) {
      expect(at(0, index)?.['x-kardata-tool-grant']).toBe('db.get_sector,db.kb_search')
    }
    const open = new StreamableMcpClient({
      endpoint: 'https://mcp.internal/mcp',
      token: 'scoped-token',
      fetchFn,
    })
    await open.listTools()
    for (const index of [0, 1, 2]) {
      expect(at(1, index)).not.toHaveProperty('x-kardata-tool-grant')
    }
    const blank = new StreamableMcpClient({
      endpoint: 'https://mcp.internal/mcp',
      token: 'scoped-token',
      grant: ['  '],
      fetchFn,
    })
    await blank.listTools()
    for (const index of [0, 1, 2]) {
      expect(at(2, index)).not.toHaveProperty('x-kardata-tool-grant')
    }
  })

  it('reads SSE streams and surfaces tool errors without the token', async () => {
    const client = new StreamableMcpClient({
      endpoint: 'https://mcp.internal/mcp',
      token: 'secret-token',
      fetchFn: async (_url, init) => {
        const body = JSON.parse(init.body) as { method: string }
        if (body.method !== 'tools/call') {
          return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) }
        }
        const frame = JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          result: { content: [{ type: 'text', text: 'row' }], isError: false },
        })
        return { ok: true, status: 200, text: async () => `data: ${frame}\n\n` }
      },
    })
    const outcome = await client.callTool('db.list_sessions', {})
    expect(outcome).toEqual({ content: 'row', isError: false })
  })
})

describe('createClosedMcpClient', () => {
  it('lists no tools and reports calls unavailable', async () => {
    const client = createClosedMcpClient('mcp unconfigured')
    expect(await client.listTools()).toEqual([])
    expect(await client.callTool('db.list_sessions', {})).toEqual({
      content: expect.stringContaining('db.list_sessions'),
      isError: true,
    })
  })
})
