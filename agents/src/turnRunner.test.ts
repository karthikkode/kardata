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
  toolOperationId,
  type RecoveryOperation,
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
  it.each([false, true])('does not publish a late tool completion or checkpoint after owner cancellation (resumed=%s)', async (resumed) => {
    const abort = new AbortController()
    let release: (value: { content: string }) => void = () => undefined
    let entered: () => void = () => undefined
    const called = new Promise<void>((resolve) => { entered = resolve })
    const completions: string[] = []
    const checkpoint = vi.fn()
    const pending = runKarbotTurn({ systemPrompt: 'TEST instructions', messages: [{ role: 'user', text: 'TEST tool' }, ...(resumed ? [{ role: 'assistant' as const, toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }] }] : [])], signal: abort.signal,
      ...(resumed ? { resume: { round: 1, usage: emptyUsage(), toolCalls: 1 } } : {}),
      provider: new FakeProvider([{ text: '', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }] }]),
      mcp: { listTools: async () => [sessionTool()], callTool: async () => { entered(); return new Promise((resolve) => { release = resolve }) } },
      sink: { onDelta: () => undefined, onTool: (_id, _name, state) => { completions.push(state) } }, onCheckpoint: checkpoint,
    })
    await called
    const checkpointsBeforeCancellation = checkpoint.mock.calls.length
    abort.abort(new Error('TEST owner cancelled'))
    release({ content: 'Late result' })
    await expect(pending).rejects.toThrow('TEST owner cancelled')
    expect(completions).not.toContain('done')
    expect(completions).not.toContain('failed')
    expect(checkpoint).toHaveBeenCalledTimes(checkpointsBeforeCancellation)
  })
  it('aborts a timed-out provider and suppresses late frames even if it ignores cancellation', async () => {
    let release: () => void = () => undefined
    let finish: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const ended = new Promise<void>((resolve) => { finish = resolve })
    let signal: AbortSignal | undefined
    const provider: ProviderAdapter = {
      providerName: 'timeout-test', chat: async () => { throw new Error('unused') },
      async *chatStream(request) { signal = request.signal; await gate; try { yield { kind: 'text_delta', text: 'TEST late reply' }; yield { kind: 'done', usage: emptyUsage() } } finally { finish() } },
    }
    const { sink, deltas } = memorySink()
    const turn = runKarbotTurn({ provider, mcp: memoryMcp(), sink, systemPrompt: 'sys', messages: [], timeoutMs: 5 })
    const failure = await turn.then(() => null, (error: unknown) => error)
    release(); await ended
    expect(failure).not.toBeNull()
    expect(signal?.aborted).toBe(true)
    expect(deltas).toEqual([])
  })
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
  it.each(['headers', 'body'])('bounds a hung %s response and aborts transport', async (stage) => {
    let transportSignal: AbortSignal | undefined
    const client = new StreamableMcpClient({ endpoint: 'https://mcp.internal/mcp', token: 'test-token', timeoutMs: 10,
      fetchFn: async (_url, init) => {
        transportSignal = init.signal
        if (stage === 'headers') return new Promise(() => undefined)
        return { ok: true, status: 200, text: () => new Promise(() => undefined) }
      },
    })
    await expect(client.listTools()).rejects.toThrow(/deadline/)
    expect(transportSignal?.aborted).toBe(true)
  })
  it('does not dispatch after the owning activity was cancelled', async () => {
    const abort = new AbortController(); abort.abort()
    const fetchFn = vi.fn()
    const client = new StreamableMcpClient({ endpoint: 'https://mcp.internal/mcp', token: 'test-token', signal: abort.signal, fetchFn })
    await expect(client.listTools()).rejects.toThrow(/aborted|cancelled/)
    expect(fetchFn).not.toHaveBeenCalled()
  })
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


describe('uncertain mutation recovery', () => {
  it('parks before a new provider round and checkpoints the original operation', async () => {
    const call = { id: 'mutation-1', name: 'db.create_session', args: { title: 'TEST intent' } }
    const provider = new FakeProvider([{ text: '', toolCalls: [call] }, { text: 'Must not run while outcome is uncertain.' }])
    const checkpoints: Array<{ messages: import('./providers.js').ChatMessage[]; blocked?: RecoveryOperation[] }> = []
    const result = await runKarbotTurn({ provider, operationKey: 'TEST operation', systemPrompt: 'TEST', messages: [{ role: 'user', text: 'TEST create' }], sink: { onDelta: () => undefined }, mcp: { listTools: async () => [sessionTool()], callTool: async (_name, _args, operationId) => ({ content: 'TEST lost reply', isError: true, recovery: { operationId: operationId!, reason: 'TEST uncertain effect' } }) }, onCheckpoint: async (messages, _round, _usage, _tools, blocked) => { checkpoints.push({ messages: structuredClone(messages), blocked }) } })
    expect(provider.calls).toHaveLength(1)
    expect(result.recoveryHalt).toEqual([{ operationId: 'TEST operation:mutation-1', call, serializedCall: JSON.stringify(call), reason: 'TEST uncertain effect' }])
    expect(result.budgetTripped).toBeUndefined()
    expect(checkpoints.at(-1)?.blocked).toEqual(result.recoveryHalt)
    expect(checkpoints.at(-1)?.messages.at(-1)?.toolResult?.toolCallId).toBe(call.id)
  })
  it.each([false, true])('retries the same id before model continuation after compacted=%s', async (compacted) => {
    const call = { id: 'mutation-1', name: 'db.create_session', args: { title: 'TEST intent' } }
    const operation = { operationId: 'TEST original identity', call, reason: 'TEST lost reply' }
    const provider = new FakeProvider([{ text: 'TEST completed original operation.' }])
    const seen: string[] = []
    const messages: import('./providers.js').ChatMessage[] = compacted ? [{ role: 'assistant', text: 'TEST compacted task summary' }] : [{ role: 'assistant', toolCalls: [call] }, { role: 'tool', toolResult: { toolCallId: call.id, toolName: call.name, content: 'TEST uncertain', isError: true } }]
    const result = await runKarbotTurn({ provider, operationKey: 'TEST operation', systemPrompt: 'TEST', messages, resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] }, sink: { onDelta: () => undefined }, mcp: { listTools: async () => [sessionTool()], callTool: async (_name, args, operationId) => { expect(args).toEqual(call.args); seen.push(operationId!); return { content: 'TEST original completed receipt' } } } })
    expect(seen).toEqual([operation.operationId])
    expect(provider.calls).toHaveLength(1)
    expect(result.recoveryHalt).toBeUndefined()
    expect(provider.calls[0]?.messages.filter((message) => message.role === 'tool')).toHaveLength(1)
  })
  it('keeps a still-pending operation parked without another provider call', async () => {
    const operation = { operationId: 'TEST original identity', call: { id: 'mutation-1', name: 'db.create_session', args: {} }, reason: 'TEST pending' }
    const provider = new FakeProvider([{ text: 'Must not run' }])
    const result = await runKarbotTurn({ provider, systemPrompt: 'TEST', messages: [], resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] }, sink: { onDelta: () => undefined }, mcp: { listTools: async () => [sessionTool()], callTool: async () => ({ content: 'TEST pending', isError: true, recovery: { operationId: operation.operationId, reason: 'TEST pending' } }) } })
    expect(provider.calls).toHaveLength(0)
    expect(result.recoveryHalt).toHaveLength(1)
  })
  it('preserves short legacy ids and bounds long deterministic operation identities', () => {
    expect(toolOperationId('run', 'call')).toBe('run:call')
    const first = toolOperationId('x'.repeat(200), 'call')
    expect(first).toHaveLength(67)
    expect(first).toBe(toolOperationId('x'.repeat(200), 'call'))
    expect(first).not.toBe(toolOperationId('x'.repeat(200), 'different'))
  })
})


describe('mutation transport certainty', () => {
  function clientFor(readOnly: boolean, response: 'lost' | 'uncertain' | 'before' | 'malformed' | 'read-error') {
    return new StreamableMcpClient({ endpoint: 'https://mcp.internal/mcp', token: 'TEST credential', fetchFn: async (_url, init) => {
      const request = JSON.parse(init.body) as { method: string; id: string | number }
      if (request.method === 'tools/call') {
        if (response === 'lost') throw new Error('TEST reply lost')
        const result = response === 'malformed' ? 42 : { isError: true, content: [{ type: 'text', text: 'TEST tool error' }], ...(response === 'before' ? { _meta: { 'kardata/retry-safe-before-effect': true } } : response === 'uncertain' ? { _meta: { 'kardata/operation-uncertain': true } } : {}) }
        return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) }
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: request.id, result: request.method === 'tools/list' ? { tools: [{ name: 'test.operation', inputSchema: { type: 'object' }, annotations: { readOnlyHint: readOnly } }] } : {} }) }
    } })
  }
  it.each(['lost', 'uncertain', 'malformed'] as const)('retains original operation identity for %s mutation replies', async (response) => {
    const client = clientFor(false, response)
    await client.listTools()
    expect((await client.callTool('test.operation', {}, 'TEST identity')).recovery?.operationId).toBe('TEST identity')
  })
  it('does not park a server-proven pre-effect failure', async () => {
    const client = clientFor(false, 'before')
    await client.listTools()
    expect((await client.callTool('test.operation', {}, 'TEST identity')).recovery).toBeUndefined()
  })
  it('does not treat a declared read failure as an uncertain mutation', async () => {
    const client = clientFor(true, 'read-error')
    await client.listTools()
    expect((await client.callTool('test.operation', {}, 'TEST identity')).recovery).toBeUndefined()
  })
})


it('keeps original uncertainty when a retry is denied before effect', async () => {
  const operation = { operationId: 'TEST original identity', call: { id: 'mutation-1', name: 'db.create_session', args: {} }, reason: 'TEST original reply lost' }
  const provider = new FakeProvider([{ text: 'Must not run' }])
  const result = await runKarbotTurn({ provider, systemPrompt: 'TEST', messages: [], resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] }, sink: { onDelta: () => undefined }, mcp: { listTools: async () => [sessionTool()], callTool: async () => ({ content: 'TEST permission denied before retry', isError: true }) } })
  expect(provider.calls).toHaveLength(0)
  expect(result.recoveryHalt?.[0]?.operationId).toBe(operation.operationId)
})
it('never dispatches an old operation under a changed execution authority', async () => {
  const operation = { authorityId: 'TEST old authority', operationId: 'TEST original identity', call: { id: 'mutation-1', name: 'db.create_session', args: {} }, reason: 'TEST original reply lost' }
  const provider = new FakeProvider([{ text: 'Must not run' }]), callTool = vi.fn()
  const result = await runKarbotTurn({ provider, systemPrompt: 'TEST', messages: [], resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] }, sink: { onDelta: () => undefined }, mcp: { authorityId: 'TEST new authority', listTools: async () => [sessionTool()], callTool } })
  expect(callTool).not.toHaveBeenCalled()
  expect(provider.calls).toHaveLength(0)
  expect(result.recoveryHalt?.[0]?.operationId).toBe(operation.operationId)
})

it('records original operations before dispatch when the result checkpoint fails', async () => {
  const call = { id: 'TEST checkpoint call', name: 'db.create_session', args: { title: 'TEST once' } }
  const provider = new FakeProvider([{ text: '', toolCalls: [call] }])
  let saved: RecoveryOperation[] | undefined
  let checkpoints = 0
  const callTool = vi.fn(async () => {
    expect(saved?.[0]?.operationId).toBe('TEST checkpoint run:TEST checkpoint call')
    return { content: 'TEST committed effect' }
  })
  await expect(runKarbotTurn({ provider, operationKey: 'TEST checkpoint run', systemPrompt: 'TEST', messages: [], sink: { onDelta: () => undefined }, mcp: { authorityId: 'TEST authority', listTools: async () => [sessionTool()], callTool }, onCheckpoint: async (_messages, _round, _usage, _tools, blocked) => {
    if (++checkpoints === 2) throw new Error('TEST result persistence unavailable')
    saved = structuredClone(blocked)
  } })).rejects.toThrow('TEST result persistence unavailable')
  expect(callTool).toHaveBeenCalledTimes(1)
  expect(saved).toEqual([{ authorityId: 'TEST authority', operationId: 'TEST checkpoint run:TEST checkpoint call', call, serializedCall: JSON.stringify(call), reason: expect.any(String) }])
})
it('parks thrown client errors under the original identity before another provider round', async () => {
  const call = { id: 'TEST thrown call', name: 'db.create_session', args: {} }
  const provider = new FakeProvider([{ text: '', toolCalls: [call] }, { text: 'Must not run' }])
  const result = await runKarbotTurn({ provider, operationKey: 'TEST thrown run', systemPrompt: 'TEST', messages: [], sink: { onDelta: () => undefined }, mcp: { listTools: async () => [sessionTool()], callTool: async () => { throw new Error('TEST client failure') } } })
  expect(provider.calls).toHaveLength(1)
  expect(result.recoveryHalt?.[0]?.operationId).toBe('TEST thrown run:TEST thrown call')
})

it('does not dispatch prepared assistant calls after recovery authority denial', async () => {
  const call = { id: 'TEST prepared call', name: 'db.create_session', args: { title: 'TEST original' } }
  const operation = { authorityId: 'TEST old authority', operationId: 'TEST prepared identity', call, reason: 'TEST prepared before worker loss' }
  const provider = new FakeProvider([{ text: 'Must not run' }]), callTool = vi.fn()
  const checkpoint = vi.fn(async () => undefined)
  const result = await runKarbotTurn({ provider, operationKey: 'TEST operation', systemPrompt: 'TEST', messages: [{ role: 'assistant', toolCalls: [call] }], resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] }, sink: { onDelta: () => undefined }, mcp: { authorityId: 'TEST new authority', listTools: async () => [sessionTool()], callTool }, onCheckpoint: checkpoint })
  expect(callTool).not.toHaveBeenCalled()
  expect(provider.calls).toHaveLength(0)
  expect(result.recoveryHalt?.[0]).toMatchObject({ authorityId: operation.authorityId, operationId: operation.operationId })
  expect(checkpoint.mock.calls).toHaveLength(1)
})

it.each([1, 3])('resumes %s prepared calls with one complete original tool group', async (count) => {
  const calls = Array.from({ length: count }, (_, index) => ({ id: `TEST prepared ${index}`, name: 'db.create_session', args: { title: `TEST original ${index}` } }))
  const operations = calls.map((call) => ({ authorityId: 'TEST authority', operationId: `TEST original:${call.id}`, call, reason: 'TEST prepared before worker loss' }))
  const provider = new FakeProvider([{ text: 'TEST confirmed original operations' }])
  const seen: string[] = []
  const result = await runKarbotTurn({ provider, systemPrompt: 'TEST', messages: [{ role: 'assistant', toolCalls: calls }], resume: { round: 1, usage: emptyUsage(), toolCalls: count, blockedOperations: operations }, sink: { onDelta: () => undefined }, mcp: { authorityId: 'TEST authority', listTools: async () => [sessionTool()], callTool: async (_name, _args, identity) => { seen.push(identity!); return { content: 'TEST confirmed receipt' } } } })
  expect(result.recoveryHalt).toBeUndefined()
  expect(seen).toEqual(operations.map((operation) => operation.operationId))
  const history = provider.calls[0]!.messages
  expect(history.filter((message) => message.role === 'assistant' && message.toolCalls?.length)).toHaveLength(1)
  expect(history[0]!.toolCalls).toEqual(calls)
  expect(history.slice(1).map((message) => message.toolResult?.toolCallId)).toEqual(calls.map((call) => call.id))
})

it.each(['TEST unicode Ω', 'TEST newline\n', 'TEST trailing '])('normalizes header-unsafe operation identities: %s', (callId) => {
  const id = toolOperationId('TEST run', callId)
  expect(id).toMatch(/^op:[a-f0-9]{64}$/)
  expect(id).toBe(toolOperationId('TEST run', callId))
  expect(id).not.toBe(toolOperationId('TEST run', `${callId}different`))
})


describe('provider execution persistence boundaries', () => {
  it('stores refreshed exact requests and results before tool dispatch and the next round', async () => {
    const call = { id: 'TEST record call', name: 'db.list_sessions', args: { nested: { value: 'TEST argument' } } }
    const provider = new FakeProvider([{ text: '', toolCalls: [call] }, { text: 'TEST final' }])
    const order: string[] = [], requests: unknown[] = [], responses: unknown[] = [], results: unknown[] = []
    await runKarbotTurn({ provider, operationKey: 'TEST record run', systemPrompt: 'TEST stable', messages: [{ role: 'user', text: 'TEST initial' }], sink: { onDelta: () => undefined },
      mcp: { listTools: async () => [sessionTool()], callTool: async () => { order.push('dispatch'); return { content: 'TEST exact tool result' } } },
      beforeRound: async (round, current) => ({ systemPrompt: `TEST context version ${round}`, messages: current.messages }),
      onProviderRequest: async (round, request) => { order.push(`request${round}`); requests.push(request) },
      onProviderResponse: async (round, response) => { order.push(`response${round}`); responses.push(response) },
      onToolResult: async (_round, original, outcome, operationId) => { order.push('result'); results.push({ original, outcome, operationId }) },
    })
    expect(order).toEqual(['request1', 'response1', 'dispatch', 'result', 'request2', 'response2'])
    expect(requests).toEqual(provider.calls.map(({ signal: _signal, ...request }) => request))
    expect(requests[0]).not.toHaveProperty('signal')
    expect(responses).toEqual([{ text: '', reasoning: '', toolCalls: [call], usage: emptyUsage() }, { text: 'TEST final', reasoning: '', toolCalls: [], usage: emptyUsage() }])
    expect(results).toEqual([{ original: call, outcome: { content: 'TEST exact tool result' }, operationId: 'TEST record run:TEST record call' }])
  })
  it('does not execute the provider when request persistence fails', async () => {
    const provider = new FakeProvider([{ text: 'TEST must not run' }])
    await expect(runKarbotTurn({ provider, systemPrompt: 'TEST', messages: [], mcp: memoryMcp(), sink: memorySink().sink, onProviderRequest: async () => { throw new Error('TEST storage unavailable') } })).rejects.toThrow('TEST storage unavailable')
    expect(provider.calls).toHaveLength(0)
  })
  it('does not dispatch tools when provider response persistence fails', async () => {
    const mcp = memoryMcp()
    await expect(runKarbotTurn({ provider: new FakeProvider([{ text: '', toolCalls: [{ id: 'TEST call', name: 'db.list_sessions', args: {} }] }]), systemPrompt: 'TEST', messages: [], mcp, sink: memorySink().sink, onProviderResponse: async () => { throw new Error('TEST response storage unavailable') } })).rejects.toThrow('TEST response storage unavailable')
    expect(mcp.calls).toHaveLength(0)
  })
})

it('retains a paid final response and usage through recording failure without calling the provider again', async () => {
  const actualUsage = { ...emptyUsage(), inputTokens: 121, outputTokens: 17, cacheReadTokens: 40 }
  const provider = new FakeProvider([])
  provider.chatStream = async function* () { yield { kind: 'text_delta', text: 'TEST original paid response' }; yield { kind: 'done', usage: actualUsage } }
  const calls = vi.spyOn(provider, 'chatStream')
  let saved: { messages: Parameters<NonNullable<import('./turnRunner.js').KarbotTurnOptions['onCheckpoint']>>[0]; meta: NonNullable<import('./turnRunner.js').KarbotTurnOptions['resume']> } | undefined
  const archive = vi.fn(async () => { throw new Error('TEST archive unavailable') })
  const base = { provider, operationKey: 'TEST paid operation', systemPrompt: 'TEST stable instructions', messages: [], mcp: memoryMcp(), sink: memorySink().sink, onCheckpoint: async (messages: Parameters<NonNullable<import('./turnRunner.js').KarbotTurnOptions['onCheckpoint']>>[0], round: number, usage: typeof actualUsage, toolCalls: number, blockedOperations?: RecoveryOperation[], pendingResponse?: import('./turnRunner.js').PendingProviderResponse) => { saved = structuredClone({ messages, meta: { round, usage, toolCalls, blockedOperations, pendingResponse } }) } }
  await expect(runKarbotTurn({ ...base, onProviderResponse: archive })).rejects.toThrow('TEST archive unavailable')
  expect(saved?.meta.usage).toEqual(actualUsage)
  expect(saved?.meta.pendingResponse?.response.text).toBe('TEST original paid response')
  const persisted = vi.fn(async () => undefined)
  const result = await runKarbotTurn({ ...base, messages: saved!.messages, resume: saved!.meta, onProviderResponse: persisted })
  expect(calls).toHaveBeenCalledTimes(1)
  expect(persisted).toHaveBeenCalledWith(1, expect.objectContaining({ text: 'TEST original paid response', usage: actualUsage }), undefined)
  expect(result.text).toBe('TEST original paid response'); expect(result.usage).toEqual(actualUsage)
  expect(saved?.meta.pendingResponse?.response.text).toBe('TEST original paid response')
})

it('records a pending paid tool response before dispatching any recovered operation', async () => {
  const call = { id: 'TEST paid call', name: 'db.list_sessions', args: {} }
  const mcp = memoryMcp(), order: string[] = []
  const request = mcp.callTool
  mcp.callTool = async (name, args) => { order.push('tool'); return request(name, args) }
  const pendingResponse = { round: 1, metadata: { contextVersion: 7, planVersion: 3 }, response: { text: '', reasoning: 'TEST retained reasoning', toolCalls: [call], usage: emptyUsage() } }
  const result = await runKarbotTurn({ operationKey: 'TEST paid tool operation', provider: new FakeProvider([{ text: 'TEST final after recovered tool' }]), systemPrompt: 'TEST', messages: [{ role: 'assistant', text: '', toolCalls: [call] }], resume: { round: 1, usage: emptyUsage(), toolCalls: 1, pendingResponse }, mcp, sink: memorySink().sink, onProviderResponse: async (round, _response, original) => { if (round === 1) expect(original).toEqual(pendingResponse.metadata); order.push('archive') } })
  expect(order.slice(0, 2)).toEqual(['archive', 'tool'])
  expect(result.text).toBe('TEST final after recovered tool')
})

it.each([false, true])('restores original nested argument order but rejects changed serialized arguments (changed=%s)', async (changed) => {
  const call = { id: 'TEST ordered call', name: 'db.list_sessions', args: { zOuter: { longerProperty: 'TEST retained', a: 1 }, aOuter: true } }
  const storedCall = { ...call, args: { aOuter: true, zOuter: { a: 1, longerProperty: changed ? 'TEST tampered' : 'TEST retained' } } }
  const operation: RecoveryOperation = { authorityId: 'TEST authority', operationId: 'TEST original operation', call: storedCall, serializedCall: JSON.stringify(call), reason: 'TEST unknown reply' }
  const seen: string[] = []
  const provider = new FakeProvider([{ text: 'TEST finished' }])
  const result = await runKarbotTurn({ provider, systemPrompt: 'TEST', messages: [], resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] }, mcp: { authorityId: 'TEST authority', listTools: async () => [sessionTool()], callTool: async (_name, args, id) => { seen.push(JSON.stringify(args)); expect(id).toBe(operation.operationId); return { content: 'TEST recorded reply' } } }, sink: memorySink().sink })
  if (changed) { expect(seen).toEqual([]); expect(provider.calls).toHaveLength(0); expect(result.recoveryHalt).toHaveLength(1) }
  else { expect(seen).toEqual([JSON.stringify(call.args)]); expect(result.text).toBe('TEST finished') }
})
