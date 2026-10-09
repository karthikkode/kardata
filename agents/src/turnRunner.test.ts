// Karbot turn runner tests. Fake provider plus in-memory MCP/sink doubles
// only — no network, no credentials, no environment.
import { describe, expect, it, vi } from 'vitest'
import { BudgetTracker, fingerprintAction, RepetitionTracker } from './budgets.js'
import { frozenClock } from './clock.js'
import type { SummaryArtifact } from './condense.js'
import { assembleContext, createSnapshot, estimateMessagesTokens, estimateTokens, type ContextSnapshot } from './context.js'
import { FakeProvider } from './fake.js'
import { emptyUsage, type ChatMessage, type ProviderAdapter, type ToolDefinition } from './providers.js'
import {
  createClosedMcpClient,
  OperationRecoveryError,
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

describe('runKarbotTurn [F:agents.turnRunner.runKarbotTurn]', () => {
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
    expect((failure as Error).message).toContain('timed out')
    expect(signal?.aborted).toBe(true)
    expect(deltas).toEqual([])
  })
  it('acquires the fleet permit before the round timer starts', async () => {
    // Contended permit (300 ms wait) with a 100 ms round budget and a fast
    // provider: succeeds only if the wait does not burn the timer.
    let acquired = false
    let released = false
    const { sink } = memorySink()
    const result = await runKarbotTurn({
      provider: new FakeProvider([{ text: 'TEST fast reply' }]),
      mcp: memoryMcp(), sink, systemPrompt: 'sys', messages: [{ role: 'user', text: 'TEST hi' }],
      timeoutMs: 100,
      acquirePermit: async () => {
        await new Promise((resolve) => setTimeout(resolve, 300))
        acquired = true
        return async () => { released = true }
      },
    })
    expect(acquired).toBe(true)
    expect(released).toBe(true)
    expect(result.text).toBe('TEST fast reply')
  })
  it('aborts a contended permit wait on owner cancellation', async () => {
    const abort = new AbortController()
    let entered: () => void = () => undefined
    const called = new Promise<void>((resolve) => { entered = resolve })
    const pending = runKarbotTurn({
      provider: new FakeProvider([{ text: 'TEST never' }]),
      mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages: [],
      signal: abort.signal,
      acquirePermit: (signal) => {
        entered()
        return new Promise<() => Promise<void>>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      },
    })
    await called
    abort.abort(new Error('TEST owner cancelled'))
    await expect(pending).rejects.toThrow('TEST owner cancelled')
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

  it.each([[1], [10]])('runs with maxTurns=%s (boundaries pass)', async (maxTurns) => {
    const provider = new FakeProvider([{ text: 'TEST done' }])
    const { sink } = memorySink()
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink, systemPrompt: 'TEST', messages: [], maxTurns })
    expect(result.text).toBe('TEST done')
    expect(result.turns).toBe(1)
  })

  it.each([[0], [11], [1.5], [NaN]])('rejects maxTurns=%s without calling the provider', async (maxTurns) => {
    const provider = new FakeProvider([{ text: 'TEST unused' }])
    const { sink } = memorySink()
    await expect(
      runKarbotTurn({ provider, mcp: memoryMcp(), sink, systemPrompt: 'TEST', messages: [], maxTurns }),
    ).rejects.toThrow(/maxTurns must be an integer 1\.\.10/)
    expect(provider.remaining).toBe(1)
  })

  it('runs with timeoutMs=1 and rejects non-positive values', async () => {
    const provider = new FakeProvider([{ text: 'TEST done' }])
    const { sink } = memorySink()
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink, systemPrompt: 'TEST', messages: [], timeoutMs: 1 })
    expect(result.text).toBe('TEST done')
    for (const timeoutMs of [0, -1, 2.5]) {
      const rejected = new FakeProvider([{ text: 'TEST unused' }])
      await expect(
        runKarbotTurn({ provider: rejected, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'TEST', messages: [], timeoutMs }),
      ).rejects.toThrow(/timeoutMs must be a positive integer/)
      expect(rejected.remaining).toBe(1)
    }
  })

  it('rejects a non-string systemPrompt and a non-array messages', async () => {
    const { sink } = memorySink()
    await expect(
      runKarbotTurn({ provider: new FakeProvider([{ text: 'x' }]), mcp: memoryMcp(), sink, systemPrompt: 123 as unknown as string, messages: [] }),
    ).rejects.toThrow(/systemPrompt must be a string/)
    await expect(
      runKarbotTurn({ provider: new FakeProvider([{ text: 'x' }]), mcp: memoryMcp(), sink, systemPrompt: 'TEST', messages: {} as unknown as ChatMessage[] }),
    ).rejects.toThrow(/messages must be an array/)
  })

  it.each([[0], [2]])('runs with temperature=%s and forwards it', async (temperature) => {
    const provider = new FakeProvider([{ text: 'TEST done' }])
    const { sink } = memorySink()
    await runKarbotTurn({ provider, mcp: memoryMcp(), sink, systemPrompt: 'TEST', messages: [], temperature })
    expect(provider.calls.map((call) => call.temperature)).toEqual([temperature])
  })

  it.each([[-0.5], [2.1], [NaN]])('rejects temperature=%s without calling the provider', async (temperature) => {
    const provider = new FakeProvider([{ text: 'TEST unused' }])
    const { sink } = memorySink()
    await expect(
      runKarbotTurn({ provider, mcp: memoryMcp(), sink, systemPrompt: 'TEST', messages: [], temperature }),
    ).rejects.toThrow(/temperature must be a number 0\.\.2/)
    expect(provider.remaining).toBe(1)
  })

  it('accumulates every usage counter across rounds', async () => {
    const provider = new FakeProvider([
      { text: '', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }], usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 20, cacheHitTokens: 7, cacheMissTokens: 3 } },
      { text: 'TEST done', usage: { inputTokens: 4, outputTokens: 6, cacheReadTokens: 50, cacheWriteTokens: 10, cacheHitTokens: 1, cacheMissTokens: 9 } },
    ])
    const { sink } = memorySink()
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink, systemPrompt: 'TEST', messages: [] })
    expect(result.usage).toEqual({ inputTokens: 14, outputTokens: 11, cacheReadTokens: 150, cacheWriteTokens: 30, cacheHitTokens: 8, cacheMissTokens: 12 })
  })
})

describe('toolOperationId edges [F:agents.turnRunner.toolOperationId]', () => {
  it('keeps the readable triple at exactly 128 chars, hashes at 129', () => {
    expect(toolOperationId('x'.repeat(124), 1, 0)).toBe(`${'x'.repeat(124)}:1:0`)
    expect(toolOperationId('x'.repeat(125), 1, 0)).toMatch(/^op:[0-9a-f]{64}$/)
  })

  it('hashes edge-space, empty, and control-char keys but keeps interior spaces and single chars', () => {
    for (const key of [' a', 'a ', '', 'a\tb']) {
      expect(toolOperationId(key, 1, 0)).toMatch(/^op:[0-9a-f]{64}$/)
    }
    expect(toolOperationId('a b', 1, 0)).toBe('a b:1:0')
    expect(toolOperationId('a', 1, 0)).toBe('a:1:0')
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

describe('StreamableMcpClient [F:agents.turnRunner.StreamableMcpClient]', () => {
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

  it('sends the traceparent thunk value on every exchange, omits it when empty', async () => {
    const seen: Array<Record<string, string>> = []
    const fetchFn = async (_url: string, init: { headers: Record<string, string> }) => {
      seen.push(init.headers)
      return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }) }
    }
    let current: string | undefined = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    const traced = new StreamableMcpClient({
      endpoint: 'https://mcp.internal/mcp',
      token: 'scoped-token',
      traceparent: () => current,
      fetchFn,
    })
    await traced.listTools()
    // initialize, notifications/initialized, tools/list: the thunk is
    // read fresh per exchange, so mid-turn trace changes propagate.
    expect(seen).toHaveLength(3)
    for (const headers of seen) {
      expect(headers['traceparent']).toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')
    }
    current = undefined
    const untraced = new StreamableMcpClient({
      endpoint: 'https://mcp.internal/mcp',
      token: 'scoped-token',
      traceparent: () => current,
      fetchFn,
    })
    await untraced.listTools()
    for (const headers of seen.slice(3)) {
      expect(headers).not.toHaveProperty('traceparent')
    }
    const absent = new StreamableMcpClient({ endpoint: 'https://mcp.internal/mcp', token: 'scoped-token', fetchFn })
    await absent.listTools()
    for (const headers of seen.slice(6)) {
      expect(headers).not.toHaveProperty('traceparent')
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

describe('listTools normalization [F:agents.turnRunner.StreamableMcpClient]', () => {
  function mcpFetch(responses: Record<string, unknown>) {
    return async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { method: string; id: unknown }
      if (!(body.method in responses)) throw new Error(`unexpected mcp method ${body.method}`)
      return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: body.id, result: responses[body.method] }) }
    }
  }
  function clientFor(toolsResult: unknown) {
    return new StreamableMcpClient({
      endpoint: 'https://mcp.internal/mcp',
      token: 'TEST credential',
      fetchFn: mcpFetch({ initialize: {}, 'notifications/initialized': {}, 'tools/list': toolsResult }),
    })
  }

  it('drops entries without a string name and keeps the rest in order', async () => {
    const client = clientFor({ tools: [null, 42, 'x', [], {}, { name: 7 }, { name: 'ok.tool' }, { name: 'second.tool' }] })
    const tools = await client.listTools()
    expect(tools.map((tool) => tool.name)).toEqual(['ok.tool', 'second.tool'])
  })

  it('normalizes schemas: types default, descriptions fall back, enums and required keep strings only', async () => {
    const client = clientFor({
      tools: [
        { name: 's.tool', description: 'Has desc', inputSchema: { properties: { q: { type: 'integer', description: 'Q', enum: ['a', 'b'] }, n: { type: 5 }, x: 'skip', e: { type: 'string', enum: ['ok', 7] } }, required: ['q', 9] } },
        { name: 'plain' },
        { name: 'dflt', description: 5 },
      ],
    })
    // Strict: a description/enum the server omits must stay absent, not
    // arrive as an explicit undefined that downstream spreads forward.
    expect(await client.listTools()).toStrictEqual([
      {
        name: 's.tool', description: 'Has desc',
        parameters: {
          type: 'object',
          properties: { q: { type: 'integer', description: 'Q', enum: ['a', 'b'] }, n: { type: 'string' }, e: { type: 'string' } },
          required: ['q'], additionalProperties: false,
        },
      },
      { name: 'plain', description: 'plain', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
      { name: 'dflt', description: 'dflt', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
    ])
  })

  it.each([[42], [{ foo: 1 }], [{ tools: 'x' }], [null]])('treats a malformed tools/list result (%s) as no tools', async (result) => {
    expect(await clientFor(result).listTools()).toEqual([])
  })

  it('tracks read-only tools from annotations, ignoring malformed entries', async () => {
    const client = clientFor({
      tools: [
        { name: 'ro.tool', annotations: { readOnlyHint: true } },
        { name: 'rw.tool', annotations: { readOnlyHint: false } },
        { name: 'na.tool' },
        { name: 'wx.tool', annotations: 'x' },
        { name: 7, annotations: { readOnlyHint: true } },
        null,
      ],
    })
    expect(await client.listTools()).toHaveLength(4)
    expect(client.isReadOnlyTool('ro.tool')).toBe(true)
    expect(client.isReadOnlyTool('rw.tool')).toBe(false)
    expect(client.isReadOnlyTool('na.tool')).toBe(false)
    expect(client.isReadOnlyTool('wx.tool')).toBe(false)
    expect((client.isReadOnlyTool as unknown as (name: unknown) => boolean)(7)).toBe(false)
    expect(client.isReadOnlyTool('missing.tool')).toBe(false)
  })

  it('re-scans read-only flags on every listTools call', async () => {
    const sequences: unknown[] = [{ tools: [{ name: 'ro.tool', annotations: { readOnlyHint: true } }] }, { tools: [{ name: 'ro.tool' }] }]
    let calls = 0
    const client = new StreamableMcpClient({
      endpoint: 'https://mcp.internal/mcp',
      token: 'TEST credential',
      fetchFn: async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { method: string; id: unknown }
        if (body.method === 'tools/list') {
          const result = sequences[Math.min(calls++, sequences.length - 1)]
          return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: body.id, result }) }
        }
        if (body.method === 'initialize' || body.method === 'notifications/initialized') {
          return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }) }
        }
        throw new Error(`unexpected mcp method ${body.method}`)
      },
    })
    await client.listTools()
    expect(client.isReadOnlyTool('ro.tool')).toBe(true)
    await client.listTools()
    expect(client.isReadOnlyTool('ro.tool')).toBe(false)
  })
})

describe('rpc envelope and handshake [F:agents.turnRunner.StreamableMcpClient]', () => {
  interface Seen { method: string; id: unknown; body: Record<string, unknown>; headers: Record<string, string>; httpMethod: string }
  function rawFetch(respond: (body: { method: string; id: unknown }) => { status?: number; ok?: boolean; text: string }, seen: Seen[] = []) {
    return async (_url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
      const parsed = JSON.parse(init.body) as { method: string; id: unknown }
      seen.push({ method: parsed.method, id: parsed.id, body: JSON.parse(init.body) as Record<string, unknown>, headers: init.headers, httpMethod: init.method })
      const next = respond(parsed)
      return { ok: next.ok ?? true, status: next.status ?? 200, text: async () => next.text }
    }
  }
  const envelope = (id: unknown, result: unknown): string => JSON.stringify({ jsonrpc: '2.0', id, result })
  function clientForBodies(bodies: Record<string, string>, seen: Seen[] = [], extra: Record<string, unknown> = {}) {
    return new StreamableMcpClient({
      endpoint: 'https://mcp.internal/mcp', token: 'TEST credential', ...(extra as { execution?: { threadKey: string; signature: string } }),
      fetchFn: rawFetch((parsed) => {
        if (!(parsed.method in bodies)) throw new Error(`unexpected mcp method ${parsed.method}`)
        return { text: bodies[parsed.method] as string }
      }, seen),
    })
  }

  it('handshakes once, then posts JSON-RPC with sequential ids', async () => {
    const seen: Seen[] = []
    const client = clientForBodies({ initialize: envelope(1, {}), 'notifications/initialized': '', 'tools/list': envelope(3, { tools: [] }) }, seen)
    expect(await client.listTools()).toEqual([])
    expect(seen.map((s) => s.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
    expect(seen[0]?.body).toEqual({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'karbot-turn', version: '3' } } })
    expect(seen[2]?.body).toEqual({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} })
    await client.listTools()
    expect(seen.map((s) => s.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/list'])
    expect(seen[3]?.id).toBe(4)
  })

  it('still lists tools when the hello handshake fails', async () => {
    const seen: Seen[] = []
    const client = new StreamableMcpClient({
      endpoint: 'https://mcp.internal/mcp', token: 'TEST credential',
      fetchFn: rawFetch((parsed) => {
        if (parsed.method === 'initialize') throw new Error('TEST stateless responder')
        if (parsed.method === 'tools/list') return { text: envelope(parsed.id, { tools: [{ name: 'ok.tool' }] }) }
        throw new Error(`unexpected mcp method ${parsed.method}`)
      }, seen),
    })
    expect((await client.listTools()).map((t) => t.name)).toEqual(['ok.tool'])
    expect(seen.map((s) => s.method)).toContain('tools/list')
  })

  it('sends POST with content, accept, auth, idempotency, and execution headers', async () => {
    const seen: Seen[] = []
    const client = clientForBodies(
      { initialize: envelope(1, {}), 'notifications/initialized': '', 'tools/call': envelope('op-1', { content: [{ type: 'text', text: 'ok' }], isError: false }) },
      seen, { execution: { threadKey: 'thread-1', signature: 'sig-1' } },
    )
    const outcome = await client.callTool('some.tool', { a: 1 }, 'op-1')
    expect(outcome).toEqual({ content: 'ok', isError: false })
    const call = seen.find((s) => s.method === 'tools/call')
    expect(call?.httpMethod).toBe('POST')
    expect(call?.headers['content-type']).toBe('application/json')
    expect(call?.headers['accept']).toBe('application/json, text/event-stream')
    expect(call?.headers['authorization']).toBe('Bearer TEST credential')
    expect(call?.headers['idempotency-key']).toBe('op-1')
    expect(call?.headers['x-kardata-thread']).toBe('thread-1')
    expect(call?.headers['x-kardata-execution']).toBe('sig-1')
    expect(call?.body).toEqual({ jsonrpc: '2.0', id: 'op-1', method: 'tools/call', params: { name: 'some.tool', arguments: { a: 1 } } })
    expect(seen.find((s) => s.method === 'tools/list')).toBeUndefined()
  })

  it('omits idempotency and execution headers when the call carries none', async () => {
    const seen: Seen[] = []
    const client = clientForBodies({ initialize: envelope(1, {}), 'notifications/initialized': '', 'tools/call': envelope(3, { content: [{ type: 'text', text: 'ok' }], isError: false }) }, seen)
    await client.callTool('some.tool', {})
    const call = seen.find((s) => s.method === 'tools/call')
    expect(call?.headers).not.toHaveProperty('idempotency-key')
    expect(call?.headers).not.toHaveProperty('x-kardata-thread')
    expect(call?.headers).not.toHaveProperty('x-kardata-execution')
    expect(call?.id).toBe(3)
  })

  it('maps HTTP failures to method-named errors with a before-effect flag', async () => {
    for (const [status, beforeEffect] of [[500, false], [429, true], [403, true]] as const) {
      const client = new StreamableMcpClient({
        endpoint: 'https://mcp.internal/mcp', token: 'TEST credential',
        fetchFn: async () => ({ ok: false, status, text: async () => 'TEST server refused' }),
      })
      const failure = await client.listTools().then(() => null, (error: unknown) => error as Error & { beforeEffect?: boolean })
      expect(failure?.message).toBe(`mcp request 'tools/list' failed with HTTP ${status}`)
      expect(failure?.beforeEffect).toBe(beforeEffect)
    }
  })

  it('rethrows transport errors unwrapped', async () => {
    const boom = new Error('TEST down')
    const client = new StreamableMcpClient({
      endpoint: 'https://mcp.internal/mcp', token: 'TEST credential',
      fetchFn: async () => { throw boom },
    })
    await expect(client.listTools()).rejects.toBe(boom)
  })

  it.each([['not json{{{'], ['42'], ['"str"'], ['null']])('rejects a malformed envelope (%s) naming the method', async (body) => {
    const client = clientForBodies({ initialize: envelope(1, {}), 'notifications/initialized': '', 'tools/list': body })
    await expect(client.listTools()).rejects.toThrow(`mcp request 'tools/list' returned a malformed envelope`)
  })

  it('rejects error envelopes with the server message, defaulting when absent', async () => {
    const failing = clientForBodies({ initialize: envelope(1, {}), 'notifications/initialized': '', 'tools/list': JSON.stringify({ jsonrpc: '2.0', id: 3, error: { message: 'TEST boom' } }) })
    await expect(failing.listTools()).rejects.toThrow(`mcp request 'tools/list' failed: TEST boom`)
    const vague = clientForBodies({ initialize: envelope(1, {}), 'notifications/initialized': '', 'tools/list': JSON.stringify({ jsonrpc: '2.0', id: 3, error: { code: -1 } }) })
    await expect(vague.listTools()).rejects.toThrow(`mcp request 'tools/list' failed: unknown mcp error`)
  })

  it('caps a runaway server error message at 300 chars', async () => {
    const long = `TEST ${( 'x'.repeat(400) )}`
    const client = clientForBodies({ initialize: envelope(1, {}), 'notifications/initialized': '', 'tools/list': JSON.stringify({ jsonrpc: '2.0', id: 3, error: { message: long } }) })
    const failure = await client.listTools().then(() => null, (error: unknown) => error as Error)
    expect(failure?.message).toBe(`mcp request 'tools/list' failed: ${long.slice(0, 300)}`)
  })

  it('rejects a non-SSE body even when a later line looks like data', async () => {
    const frame = envelope(1, { tools: [{ name: 'must.not.parse' }] })
    const client = clientForBodies({ initialize: envelope(1, {}), 'notifications/initialized': '', 'tools/list': `garbage\ndata: ${frame}` })
    await expect(client.listTools()).rejects.toThrow(`mcp request 'tools/list' returned a malformed envelope`)
  })

  it('parses plain JSON with surrounding whitespace', async () => {
    const client = clientForBodies({ initialize: envelope(1, {}), 'notifications/initialized': '', 'tools/list': `  ${envelope(3, { tools: [{ name: 'ws.tool' }] })}  ` })
    expect((await client.listTools()).map((t) => t.name)).toEqual(['ws.tool'])
  })

  it('reads the first data line of SSE, skipping comments, blanks, and [DONE]', async () => {
    const frame = envelope(1, { tools: [{ name: 'sse.tool' }] })
    const client = clientForBodies({ initialize: envelope(1, {}), 'notifications/initialized': '', 'tools/list': `: session open\n\ndata: [DONE]\ndata: \nnote-{"x":1}\ndata: ${frame}\n\n` })
    expect((await client.listTools()).map((t) => t.name)).toEqual(['sse.tool'])
  })

  it('parses SSE bodies with leading blank lines and odd trailing whitespace', async () => {
    const frame = envelope(1, { tools: [{ name: 'odd.tool' }] })
    const client = clientForBodies({ initialize: envelope(1, {}), 'notifications/initialized': '', 'tools/list': `\n\ndata: ${frame}\u00a0\n\n` })
    expect((await client.listTools()).map((t) => t.name)).toEqual(['odd.tool'])
  })

  it('rejects SSE streams with no parseable data line', async () => {
    const client = clientForBodies({ initialize: envelope(1, {}), 'notifications/initialized': '', 'tools/list': 'data: {{{oops\n: comment\n\n' })
    await expect(client.listTools()).rejects.toThrow(`mcp request 'tools/list' returned a malformed envelope`)
  })
})

describe('client construction [F:agents.turnRunner.StreamableMcpClient]', () => {
  it.each([['', 'token', 'endpoint'], [123, 'token', 'endpoint'], ['https://mcp.internal/mcp', '', 'token'], ['https://mcp.internal/mcp', 123, 'token']] as const)(
    'rejects endpoint=%s token=%s (%s invalid)',
    (endpoint, token, _label) => {
      expect(() => new StreamableMcpClient({ endpoint: endpoint as string, token: token as string })).toThrow(/endpoint must be a non-empty string|token must be a non-empty string/)
    },
  )

  it.each([[0], [-1], [NaN], [Infinity]])('rejects timeoutMs=%s', (timeoutMs) => {
    expect(() => new StreamableMcpClient({ endpoint: 'https://mcp.internal/mcp', token: 'TEST credential', timeoutMs })).toThrow(/timeoutMs must be positive and finite/)
  })

  it('accepts a positive timeoutMs and uses it for the exchange deadline', async () => {
    const client = new StreamableMcpClient({
      endpoint: 'https://mcp.internal/mcp', token: 'TEST credential', timeoutMs: 10,
      fetchFn: async () => new Promise(() => undefined),
    })
    await expect(client.listTools()).rejects.toThrow(/deadline/)
  })

  it('stamps a stable 64-hex authority id per endpoint, credential, thread, and grant set', () => {
    const base = { endpoint: 'https://mcp.internal/mcp', token: 'TEST credential' }
    const first = new StreamableMcpClient(base)
    expect(first.authorityId).toMatch(/^[0-9a-f]{64}$/)
    expect(new StreamableMcpClient(base).authorityId).toBe(first.authorityId)
    expect(new StreamableMcpClient({ ...base, token: 'other' }).authorityId).not.toBe(first.authorityId)
    expect(new StreamableMcpClient({ ...base, endpoint: 'https://other/mcp' }).authorityId).not.toBe(first.authorityId)
    expect(new StreamableMcpClient({ ...base, grant: ['db.a'] }).authorityId).not.toBe(first.authorityId)
    expect(new StreamableMcpClient({ ...base, execution: { threadKey: 't1', signature: 's' } }).authorityId).not.toBe(first.authorityId)
    expect(new StreamableMcpClient({ ...base, execution: { threadKey: 't2', signature: 's' } }).authorityId).not.toBe(
      new StreamableMcpClient({ ...base, execution: { threadKey: 't1', signature: 's' } }).authorityId,
    )
  })

  it('treats the grant as a set for identity: order never changes the authority id', () => {
    const left = new StreamableMcpClient({ endpoint: 'https://mcp.internal/mcp', token: 'TEST credential', grant: ['db.b', 'db.a'] })
    const right = new StreamableMcpClient({ endpoint: 'https://mcp.internal/mcp', token: 'TEST credential', grant: ['db.a', 'db.b'] })
    expect(left.authorityId).toBe(right.authorityId)
    expect(new StreamableMcpClient({ endpoint: 'https://mcp.internal/mcp', token: 'TEST credential', grant: ['db.a'] }).authorityId).not.toBe(
      new StreamableMcpClient({ endpoint: 'https://mcp.internal/mcp', token: 'TEST credential', grant: ['db.b'] }).authorityId,
    )
  })
})

describe('createClosedMcpClient [F:agents.turnRunner.createClosedMcpClient]', () => {
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
    expect(result.recoveryHalt).toEqual([{ operationId: 'TEST operation:1:0', call, serializedCall: JSON.stringify(call), reason: 'TEST uncertain effect' }])
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
  it('keys operations by run, round, and call index with bounded long identities [F:agents.turnRunner.toolOperationId]', () => {
    expect(toolOperationId('run', 1, 0)).toBe('run:1:0')
    expect(toolOperationId('run', 2, 3)).toBe('run:2:3')
    const first = toolOperationId('x'.repeat(200), 1, 0)
    expect(first).toHaveLength(67)
    expect(first).toBe(toolOperationId('x'.repeat(200), 1, 0))
    expect(first).not.toBe(toolOperationId('x'.repeat(200), 1, 1))
    expect(first).not.toBe(toolOperationId('x'.repeat(200), 2, 0))
  })
  it('reuses identical keys when a round regenerates provider call ids', async () => {
    const seen: string[] = []
    const turn = (ids: string[]) => runKarbotTurn({ provider: new FakeProvider([{ text: '', toolCalls: ids.map((id, index) => ({ id, name: 'db.create_session', args: { title: `TEST replay ${index}` } })) }, { text: 'TEST done' }]), operationKey: 'TEST stable run', systemPrompt: 'TEST', messages: [{ role: 'user', text: 'TEST go' }], sink: { onDelta: () => undefined }, mcp: { listTools: async () => [sessionTool()], callTool: async (_name, _args, operationId) => { seen.push(operationId!); return { content: 'TEST committed' } } } })
    await turn(['call-alpha', 'call-beta'])
    await turn(['call-one', 'call-two'])
    expect(seen).toEqual(['TEST stable run:1:0', 'TEST stable run:1:1', 'TEST stable run:1:0', 'TEST stable run:1:1'])
  })
})


describe('OperationRecoveryError [F:agents.turnRunner.OperationRecoveryError]', () => {
  it('carries the operation_uncertain code with its operations', () => {
    const operations = [{ operationId: 'TEST op', call: { id: 'c1', name: 'db.create_session', args: {} }, reason: 'TEST lost' }]
    const error = new OperationRecoveryError(operations)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('OperationRecoveryError')
    expect(error.code).toBe('operation_uncertain')
    expect(error.message).toContain('uncertain')
    expect(error.operations).toBe(operations)
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

describe('callTool outcomes [F:agents.turnRunner.StreamableMcpClient]', () => {
  type CallBehavior = { throw: unknown } | { status: number } | { result: unknown }
  function callClient(behavior: CallBehavior, tools: unknown[] = [{ name: 't.op' }], signal?: AbortSignal) {
    const seen: Array<{ method: string; body: Record<string, unknown> }> = []
    const client = new StreamableMcpClient({
      endpoint: 'https://mcp.internal/mcp', token: 'TEST credential', signal,
      fetchFn: async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { method: string; id: unknown }
        seen.push({ method: body.method, body: JSON.parse(init.body) as Record<string, unknown> })
        if (body.method === 'tools/call') {
          if ('throw' in behavior) throw behavior.throw
          if ('status' in behavior) return { ok: false, status: behavior.status, text: async () => 'TEST refused' }
          return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: body.id, result: behavior.result }) }
        }
        if (body.method === 'tools/list') {
          return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools } }) }
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }) }
      },
    })
    return { client, seen }
  }
  const READONLY = [{ name: 't.op', annotations: { readOnlyHint: true } }]

  it('parks a lost mutating reply under the original operation with its message', async () => {
    const { client, seen } = callClient({ throw: new Error('TEST reply lost') })
    const outcome = await client.callTool('t.op', { a: 1 }, 'op-1')
    expect(outcome).toEqual({ content: 'TEST reply lost', isError: true, recovery: { authorityId: client.authorityId, operationId: 'op-1', reason: 'The mutation reply was not confirmed.' } })
    expect(seen.find((s) => s.method === 'tools/call')?.body.params).toEqual({ name: 't.op', arguments: { a: 1 } })
  })

  it('returns a plain error result for a lost reply with no operation id', async () => {
    const { client } = callClient({ throw: new Error('TEST reply lost') })
    expect(await client.callTool('t.op', {})).toEqual({ content: 'TEST reply lost', isError: true })
  })

  it('returns a plain error result for a lost read-only reply', async () => {
    const { client } = callClient({ throw: new Error('TEST reply lost') }, READONLY)
    await client.listTools()
    expect(await client.callTool('t.op', {}, 'op-1')).toEqual({ content: 'TEST reply lost', isError: true })
  })

  it('names non-Error transport failures without their value', async () => {
    const { client } = callClient({ throw: 'TEST string failure' })
    expect(await client.callTool('t.op', {}, 'op-1')).toEqual({ content: 'mcp tool call failed', isError: true, recovery: { authorityId: client.authorityId, operationId: 'op-1', reason: 'The mutation reply was not confirmed.' } })
  })

  it('converts a before-effect HTTP failure into a plain error naming the call', async () => {
    const { client } = callClient({ status: 403 })
    expect(await client.callTool('t.op', {}, 'op-1')).toEqual({ content: `mcp request 'tools/call' failed with HTTP 403`, isError: true })
  })

  it('parks an after-effect HTTP failure under the original operation', async () => {
    const { client } = callClient({ status: 500 })
    expect(await client.callTool('t.op', {}, 'op-1')).toEqual({ content: `mcp request 'tools/call' failed with HTTP 500`, isError: true, recovery: { authorityId: client.authorityId, operationId: 'op-1', reason: 'The mutation reply was not confirmed.' } })
  })

  it('throws instead of returning when aborted during a failure', async () => {
    const abort = new AbortController()
    abort.abort(new Error('TEST owner cancelled'))
    const { client } = callClient({ throw: new Error('TEST reply lost') }, [{ name: 't.op' }], abort.signal)
    await expect(client.callTool('t.op', {}, 'op-1')).rejects.toThrow('TEST owner cancelled')
  })

  it.each([[42], [{ content: 'x' }]])('parks a malformed result (%s) under the original operation', async (result) => {
    const { client } = callClient({ result })
    expect(await client.callTool('t.op', {}, 'op-1')).toEqual({ content: `tool 't.op' returned a malformed result`, isError: true, recovery: { authorityId: client.authorityId, operationId: 'op-1', reason: 'The mutation response was malformed.' } })
  })

  it('returns a plain error for a malformed result with no operation id or a read-only tool', async () => {
    const plain = callClient({ result: 42 })
    expect(await plain.client.callTool('t.op', {})).toEqual({ content: `tool 't.op' returned a malformed result`, isError: true })
    const ro = callClient({ result: 42 }, READONLY)
    await ro.client.listTools()
    expect(await ro.client.callTool('t.op', {}, 'op-1')).toEqual({ content: `tool 't.op' returned a malformed result`, isError: true })
  })

  it('joins text blocks with newlines, skipping blocks without text', async () => {
    const { client } = callClient({ result: { content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }, 42, 'x', { text: 7 }] } })
    expect(await client.callTool('t.op', {}, 'op-1')).toEqual({ content: 'a\nb', isError: false })
  })

  it('parks an unflagged server error under the original operation', async () => {
    const { client } = callClient({ result: { content: [{ type: 'text', text: 'TEST broke' }], isError: true } })
    expect(await client.callTool('t.op', {}, 'op-1')).toEqual({ content: 'TEST broke', isError: true, recovery: { authorityId: client.authorityId, operationId: 'op-1', reason: 'The server could not confirm a retry-safe mutation outcome.' } })
  })

  it('returns a plain error for a retry-safe server error', async () => {
    const { client } = callClient({ result: { content: [{ type: 'text', text: 'TEST denied' }], isError: true, _meta: { 'kardata/retry-safe-before-effect': true } } })
    expect(await client.callTool('t.op', {}, 'op-1')).toEqual({ content: 'TEST denied', isError: true })
  })

  it('treats non-true isError flags as success', async () => {
    for (const isError of ['yes', 1]) {
      const { client } = callClient({ result: { content: [{ type: 'text', text: 'ok' }], isError } })
      expect(await client.callTool('t.op', {}, 'op-1')).toEqual({ content: 'ok', isError: false })
    }
  })

  it('returns a plain error for a read-only server error with an operation id', async () => {
    const { client } = callClient({ result: { content: [{ type: 'text', text: 'TEST broke' }], isError: true } }, READONLY)
    await client.listTools()
    expect(await client.callTool('t.op', {}, 'op-1')).toEqual({ content: 'TEST broke', isError: true })
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
    expect(saved?.[0]?.operationId).toBe('TEST checkpoint run:1:0')
    return { content: 'TEST committed effect' }
  })
  await expect(runKarbotTurn({ provider, operationKey: 'TEST checkpoint run', systemPrompt: 'TEST', messages: [], sink: { onDelta: () => undefined }, mcp: { authorityId: 'TEST authority', listTools: async () => [sessionTool()], callTool }, onCheckpoint: async (_messages, _round, _usage, _tools, blocked) => {
    if (++checkpoints === 2) throw new Error('TEST result persistence unavailable')
    saved = structuredClone(blocked)
  } })).rejects.toThrow('TEST result persistence unavailable')
  expect(callTool).toHaveBeenCalledTimes(1)
  expect(saved).toEqual([{ authorityId: 'TEST authority', operationId: 'TEST checkpoint run:1:0', call, serializedCall: JSON.stringify(call), reason: expect.any(String) }])
})
it('parks thrown client errors under the original identity before another provider round', async () => {
  const call = { id: 'TEST thrown call', name: 'db.create_session', args: {} }
  const provider = new FakeProvider([{ text: '', toolCalls: [call] }, { text: 'Must not run' }])
  const result = await runKarbotTurn({ provider, operationKey: 'TEST thrown run', systemPrompt: 'TEST', messages: [], sink: { onDelta: () => undefined }, mcp: { listTools: async () => [sessionTool()], callTool: async () => { throw new Error('TEST client failure') } } })
  expect(provider.calls).toHaveLength(1)
  expect(result.recoveryHalt?.[0]?.operationId).toBe('TEST thrown run:1:0')
})
it('turns a read-only transport failure into a plain error result without halting', async () => {
  const call = { id: 'TEST lookup call', name: 'db.list_sessions', args: {} }
  const provider = new FakeProvider([{ text: '', toolCalls: [call] }, { text: 'TEST gap reported' }])
  const result = await runKarbotTurn({ provider, operationKey: 'TEST lookup run', systemPrompt: 'TEST', messages: [], sink: { onDelta: () => undefined }, mcp: { listTools: async () => [sessionTool()], callTool: async () => { throw new Error('TEST connect ECONNREFUSED') }, isReadOnlyTool: (name) => name === 'db.list_sessions' } })
  expect(provider.calls).toHaveLength(2)
  expect(result.recoveryHalt ?? []).toEqual([])
  expect(result.text).toBe('TEST gap reported')
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

it.each(['TEST unicode Ω', 'TEST newline\n', 'TEST trailing '])('normalizes header-unsafe operation keys: %s', (operationKey) => {
  const id = toolOperationId(operationKey, 1, 0)
  expect(id).toMatch(/^op:[a-f0-9]{64}$/)
  expect(id).toBe(toolOperationId(operationKey, 1, 0))
  expect(id).not.toBe(toolOperationId(operationKey, 1, 1))
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
    expect(responses).toEqual([{ text: '', reasoning: '', toolCalls: [call], usage: emptyUsage(), completion: 'complete' }, { text: 'TEST final', reasoning: '', toolCalls: [], usage: emptyUsage(), completion: 'complete' }])
    expect(results).toEqual([{ original: call, outcome: { content: 'TEST exact tool result' }, operationId: 'TEST record run:1:0' }])
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

it.each(['complete', 'incomplete', undefined] as const)('preserves terminal completion %s in a serialized paid-response checkpoint and resume', async (completion) => {
  const provider = new FakeProvider([{ text: 'TEST preserved paid reply', completion: completion ?? null }])
  const calls = vi.spyOn(provider, 'chatStream')
  let saved: { messages: Parameters<NonNullable<import('./turnRunner.js').KarbotTurnOptions['onCheckpoint']>>[0]; meta: NonNullable<import('./turnRunner.js').KarbotTurnOptions['resume']> } | undefined
  const base = { provider, operationKey: 'TEST completion checkpoint', systemPrompt: 'TEST', messages: [], mcp: memoryMcp(), sink: memorySink().sink,
    onCheckpoint: async (messages: Parameters<NonNullable<import('./turnRunner.js').KarbotTurnOptions['onCheckpoint']>>[0], round: number, usage: ReturnType<typeof emptyUsage>, toolCalls: number, blockedOperations?: RecoveryOperation[], pendingResponse?: import('./turnRunner.js').PendingProviderResponse) => { saved = JSON.parse(JSON.stringify({ messages, meta: { round, usage, toolCalls, blockedOperations, pendingResponse } })) as typeof saved },
  }
  await expect(runKarbotTurn({ ...base, onProviderResponse: async () => { throw new Error('TEST archive acknowledgement unavailable') } })).rejects.toThrow('TEST archive acknowledgement unavailable')
  expect(saved!.meta.pendingResponse!.response.completion).toBe(completion)
  if (completion === undefined) expect(saved!.meta.pendingResponse!.response).not.toHaveProperty('completion')
  const persist = vi.fn(async () => undefined)
  await runKarbotTurn({ ...base, messages: saved!.messages, resume: saved!.meta, onProviderResponse: persist })
  expect(calls).toHaveBeenCalledOnce()
  expect(persist).toHaveBeenCalledWith(1, saved!.meta.pendingResponse!.response, undefined)
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

describe('turn request defaults [F:agents.turnRunner.runKarbotTurn]', () => {
  it('sends toolChoice auto when the caller sets none', async () => {
    const provider = new FakeProvider([{ text: 'TEST done' }])
    await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'TEST', messages: [] })
    expect(provider.calls[0]?.toolChoice).toEqual({ mode: 'auto' })
  })

  it('returns the executed calls in order with exact outcomes', async () => {
    const calls = [
      { id: 'c1', name: 'db.list_sessions', args: {} },
      { id: 'c2', name: 'db.list_sessions', args: {} },
    ]
    const provider = new FakeProvider([{ text: '', toolCalls: calls }, { text: 'TEST done' }])
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'TEST', messages: [] })
    expect(result.toolCalls).toEqual(calls)
    expect(result.toolOutcomes).toEqual([
      { id: 'c1', name: 'db.list_sessions', state: 'done' },
      { id: 'c2', name: 'db.list_sessions', state: 'done' },
    ])
  })

  it('returns empty text and reasoning when recovery halts before any round', async () => {
    const operation = { operationId: 'TEST original identity', call: { id: 'mutation-1', name: 'db.create_session', args: {} }, reason: 'TEST pending' }
    const provider = new FakeProvider([{ text: 'Must not run' }])
    const result = await runKarbotTurn({ provider, systemPrompt: 'TEST', messages: [], resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] }, sink: { onDelta: () => undefined }, mcp: { listTools: async () => [sessionTool()], callTool: async () => ({ content: 'TEST pending', isError: true, recovery: { operationId: operation.operationId, reason: 'TEST pending' } }) } })
    expect(result.text).toBe('')
    expect(result.reasoning).toBe('')
    expect(result.recoveryHalt).toHaveLength(1)
  })
})

describe('turn resume accounting [F:agents.turnRunner.runKarbotTurn]', () => {
  const roomy = { maxCost: 999999, maxWallMs: 999999999, maxStalledTurns: 99 }
  function resumeOptions(budgets: BudgetTracker) {
    return {
      provider: new FakeProvider([{ text: 'TEST done' }]),
      mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'TEST', messages: [] as ChatMessage[],
      resume: { round: 3, toolCalls: 5, usage: { ...emptyUsage(), inputTokens: 10, outputTokens: 5 } },
      harness: { budgets },
    }
  }

  it('restores exact turns, tool calls, and tokens from resume before gating', async () => {
    const budgets = new BudgetTracker({ maxTurns: 3, maxToolCalls: 5, maxTokens: 15, ...roomy }, frozenClock(0))
    const options = resumeOptions(budgets)
    const result = await runKarbotTurn(options)
    expect(result.budgetTripped).toEqual(['turns', 'toolCalls', 'tokens'])
    expect(options.provider.calls).toHaveLength(0)
  })

  it('runs one more round when resume sits exactly one below every cap', async () => {
    const budgets = new BudgetTracker({ maxTurns: 4, maxToolCalls: 6, maxTokens: 16, ...roomy }, frozenClock(0))
    const options = resumeOptions(budgets)
    const result = await runKarbotTurn(options)
    expect(result.budgetTripped).toBeUndefined()
    expect(result.text).toBe('TEST done')
    expect(options.provider.calls).toHaveLength(1)
  })

  it('checkpoints prepared operations with their pending reason before dispatch', async () => {
    const checkpoints: Array<{ blocked?: RecoveryOperation[] }> = []
    const call = { id: 'c1', name: 'db.create_session', args: {} }
    await runKarbotTurn({ provider: new FakeProvider([{ text: '', toolCalls: [call] }, { text: 'TEST done' }]),
      operationKey: 'TEST prep', systemPrompt: 'TEST', messages: [], mcp: memoryMcp(), sink: memorySink().sink,
      onCheckpoint: async (_messages, _round, _usage, _tools, blocked) => { checkpoints.push({ blocked: blocked ? structuredClone(blocked) : undefined }) } })
    const prepared = checkpoints.flatMap((checkpoint) => checkpoint.blocked ?? []).find((op) => op.operationId === 'TEST prep:1:0')
    expect(prepared?.reason).toBe('Execution was prepared; its result has not yet been durably confirmed.')
  })

  it('checkpoints empty blocked lists when the turn has no operation key', async () => {
    const blockeds: unknown[] = []
    const call = { id: 'c1', name: 'db.create_session', args: {} }
    await runKarbotTurn({ provider: new FakeProvider([{ text: '', toolCalls: [call] }, { text: 'TEST done' }]),
      systemPrompt: 'TEST', messages: [], mcp: memoryMcp(), sink: memorySink().sink,
      onCheckpoint: async (_messages, _round, _usage, _tools, blocked) => { blockeds.push(blocked) } })
    expect(blockeds.length).toBeGreaterThan(0)
    for (const blocked of blockeds) expect(blocked).toEqual([])
  })
})

describe('dispatch error shaping [F:agents.turnRunner.runKarbotTurn]', () => {
  function throwingMcp(error: unknown): TurnRunnerMcpClient {
    return { listTools: async () => [sessionTool()], callTool: async () => { throw error } }
  }

  it('caps a thrown MCP error at 500 chars in the tool message', async () => {
    const provider = new FakeProvider([{ text: '', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }] }, { text: 'TEST done' }])
    await runKarbotTurn({ provider, mcp: throwingMcp(new Error(`TEST ${'y'.repeat(600)}`)), sink: memorySink().sink, systemPrompt: 'TEST', messages: [] })
    const toolMessages = provider.calls[1]?.messages.filter((message) => message.role === 'tool') ?? []
    expect(toolMessages).toHaveLength(1)
    expect(toolMessages[0]?.toolResult?.content).toHaveLength(500)
  })

  it('names non-Error MCP failures without their value', async () => {
    const provider = new FakeProvider([{ text: '', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }] }, { text: 'TEST done' }])
    await runKarbotTurn({ provider, mcp: throwingMcp('TEST string failure'), sink: memorySink().sink, systemPrompt: 'TEST', messages: [] })
    const toolMessages = provider.calls[1]?.messages.filter((message) => message.role === 'tool') ?? []
    expect(toolMessages[0]?.toolResult?.content).toBe('mcp tool call failed')
  })

  it('marks thrown MCP failures failed on the sink, outcomes, and recovery reason', async () => {
    const states: string[] = []
    const provider = new FakeProvider([{ text: '', toolCalls: [{ id: 'c1', name: 'db.create_session', args: {} }] }, { text: 'Must not run' }])
    const result = await runKarbotTurn({ provider, operationKey: 'TEST dispatch run', mcp: throwingMcp(new Error('TEST client failure')), sink: { onDelta: () => undefined, onTool: (_id, _name, state) => { states.push(state) } }, systemPrompt: 'TEST', messages: [] })
    expect(states).toEqual(['running', 'running', 'failed'])
    expect(result.toolOutcomes).toEqual([{ id: 'c1', name: 'db.create_session', state: 'failed' }])
    expect(result.recoveryHalt?.[0]?.reason).toBe('The tool client failed without confirming whether the operation took effect.')
    expect(provider.calls).toHaveLength(1)
  })

  it('replays the original operation id to persistence on retry', async () => {
    const seen: Array<string | undefined> = []
    const operation = { operationId: 'TEST original', call: { id: 'mutation-1', name: 'db.create_session', args: {} }, reason: 'TEST lost' }
    await runKarbotTurn({ provider: new FakeProvider([{ text: 'TEST done' }]), operationKey: 'TEST retry run', systemPrompt: 'TEST', messages: [],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] },
      sink: { onDelta: () => undefined }, mcp: { listTools: async () => [sessionTool()], callTool: async () => ({ content: 'TEST ok' }) },
      onToolResult: async (_round, _call, _outcome, operationId) => { seen.push(operationId) } })
    expect(seen).toEqual(['TEST original'])
  })
})

describe('pending-response resume [F:agents.turnRunner.runKarbotTurn]', () => {
  const pendingCall = { id: 'c1', name: 'db.create_session', args: {} }

  it('replays a pending response without hooks and completes a quiet one', async () => {
    const provider = new FakeProvider([{ text: 'Must not run' }])
    const result = await runKarbotTurn({ provider, systemPrompt: 'TEST', messages: [{ role: 'user', text: 'TEST hi' }],
      resume: { round: 2, usage: emptyUsage(), toolCalls: 0, pendingResponse: { round: 2, response: { text: 'TEST pending reply', reasoning: '', toolCalls: [], usage: emptyUsage() } } },
      sink: memorySink().sink, mcp: memoryMcp() })
    expect(result.text).toBe('TEST pending reply')
    expect(result.turns).toBe(2)
    expect(provider.calls).toHaveLength(0)
  })

  it('merges a pending response with calls into history and dispatches it', async () => {
    const seen: string[] = []
    const provider = new FakeProvider([{ text: 'TEST after' }])
    const checkpoints: Array<{ round: number }> = []
    const result = await runKarbotTurn({ provider, operationKey: 'TEST pending', systemPrompt: 'TEST', messages: [{ role: 'user', text: 'TEST hi' }],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 0, pendingResponse: { round: 1, response: { text: 'TEST pending', reasoning: '', toolCalls: [pendingCall], usage: emptyUsage() } } },
      sink: memorySink().sink,
      mcp: { listTools: async () => [sessionTool()], callTool: async (_name, _args, operationId) => { seen.push(operationId!); return { content: 'TEST ok' } } },
      onCheckpoint: async (_messages, round) => { checkpoints.push({ round }) } })
    expect(seen).toEqual(['TEST pending:1:0'])
    expect(result.toolCalls).toEqual([pendingCall])
    expect(checkpoints.map((c) => c.round)).toContain(1)
    expect(provider.calls[0]?.messages.filter((m) => m.role === 'assistant')).toHaveLength(1)
    expect(provider.calls[0]?.messages.filter((m) => m.role === 'tool')).toHaveLength(1)
  })

  it('does not duplicate a pending response already in history', async () => {
    const provider = new FakeProvider([{ text: 'TEST after' }])
    await runKarbotTurn({ provider, systemPrompt: 'TEST',
      messages: [{ role: 'user', text: 'TEST hi' }, { role: 'assistant', text: 'TEST pending', toolCalls: [pendingCall] }, { role: 'user', text: 'TEST later' }],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 1, pendingResponse: { round: 1, response: { text: 'TEST pending', reasoning: '', toolCalls: [pendingCall], usage: emptyUsage() } } },
      sink: memorySink().sink, mcp: memoryMcp() })
    expect(provider.calls[0]?.messages.filter((m) => m.role === 'assistant' && m.text === 'TEST pending')).toHaveLength(1)
  })

  it('does not duplicate a quiet pending response already in history', async () => {
    const provider = new FakeProvider([{ text: 'Must not run' }])
    const result = await runKarbotTurn({ provider, systemPrompt: 'TEST',
      messages: [{ role: 'assistant', text: 'TEST pending' }],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 0, pendingResponse: { round: 1, response: { text: 'TEST pending', reasoning: '', toolCalls: [], usage: emptyUsage() } } },
      sink: memorySink().sink, mcp: memoryMcp() })
    expect(result.text).toBe('TEST pending')
    expect(provider.calls).toHaveLength(0)
  })

  it('pushes a pending response that differs in text or tool calls', async () => {
    const provider = new FakeProvider([{ text: 'TEST after' }, { text: 'TEST after' }])
    await runKarbotTurn({ provider, systemPrompt: 'TEST', messages: [{ role: 'assistant', text: 'TEST other' }],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 0, pendingResponse: { round: 1, response: { text: 'TEST pending', reasoning: '', toolCalls: [pendingCall], usage: emptyUsage() } } },
      sink: memorySink().sink, mcp: memoryMcp() })
    const assistants = provider.calls[0]?.messages.filter((m) => m.role === 'assistant') ?? []
    expect(assistants.map((m) => m.text)).toEqual(['TEST other', 'TEST pending'])
  })
})

describe('blocked-operation retry [F:agents.turnRunner.runKarbotTurn]', () => {
  const retryCall = { id: 'mutation-1', name: 'db.create_session', args: { title: 'TEST intent' } }

  it('halts with the conflict reason when the receipt disagrees with preserved arguments', async () => {
    const stored = { ...retryCall, args: { title: 'TEST tampered' } }
    const operation: RecoveryOperation = { operationId: 'TEST op', call: stored, serializedCall: JSON.stringify(retryCall), reason: 'TEST lost' }
    const provider = new FakeProvider([{ text: 'Must not run' }])
    const result = await runKarbotTurn({ provider, systemPrompt: 'TEST', messages: [],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] },
      sink: memorySink().sink, mcp: memoryMcp() })
    expect(result.recoveryHalt).toHaveLength(1)
    expect(result.recoveryHalt?.[0]?.reason).toBe('The original tool-call receipt conflicts with its preserved arguments. Owner review is required.')
    expect(provider.calls).toHaveLength(0)
  })

  it('halts with the authority reason when the execution authority changed', async () => {
    const operation = { authorityId: 'TEST old', operationId: 'TEST op', call: retryCall, reason: 'TEST lost' }
    const provider = new FakeProvider([{ text: 'Must not run' }])
    const result = await runKarbotTurn({ provider, systemPrompt: 'TEST', messages: [],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] },
      sink: memorySink().sink, mcp: { authorityId: 'TEST new', listTools: async () => [sessionTool()], callTool: async () => ({ content: 'Must not run' }) } })
    expect(result.recoveryHalt?.[0]?.reason).toBe('The original execution authority is unavailable or changed.')
    expect(provider.calls).toHaveLength(0)
  })

  it('retries under a matching authority and reports the sink round', async () => {
    const rounds: number[] = []
    const operation = { authorityId: 'TEST same', operationId: 'TEST op', call: retryCall, reason: 'TEST lost' }
    const provider = new FakeProvider([{ text: 'TEST done' }])
    const result = await runKarbotTurn({ provider, systemPrompt: 'TEST', messages: [],
      resume: { round: 2, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] },
      sink: { onDelta: () => undefined, onTool: (_id, _name, _state, round) => { rounds.push(round) } },
      mcp: { authorityId: 'TEST same', listTools: async () => [sessionTool()], callTool: async () => ({ content: 'TEST ok' }) } })
    expect(result.recoveryHalt).toBeUndefined()
    expect(result.text).toBe('TEST done')
    expect(rounds).toContain(2)
  })

  it('replaces the tool message in place and flags success honestly', async () => {
    const operation = { operationId: 'TEST op', call: retryCall, reason: 'TEST lost' }
    const provider = new FakeProvider([{ text: 'TEST done' }])
    await runKarbotTurn({ provider, systemPrompt: 'TEST',
      messages: [{ role: 'assistant', toolCalls: [retryCall] }, { role: 'tool', toolResult: { toolCallId: retryCall.id, toolName: retryCall.name, content: 'TEST stale', isError: true } }],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] },
      sink: memorySink().sink, mcp: { listTools: async () => [sessionTool()], callTool: async () => ({ content: 'TEST fresh' }) } })
    expect(provider.calls[0]?.messages).toEqual([
      { role: 'assistant', toolCalls: [retryCall] },
      { role: 'tool', toolResult: { toolCallId: retryCall.id, toolName: retryCall.name, content: 'TEST fresh', isError: false } },
    ])
  })

  it('appends the assistant and tool pair when history lacks both', async () => {
    const operation = { operationId: 'TEST op', call: retryCall, reason: 'TEST lost' }
    const provider = new FakeProvider([{ text: 'TEST done' }])
    await runKarbotTurn({ provider, systemPrompt: 'TEST', messages: [{ role: 'assistant', text: 'TEST other' }],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] },
      sink: memorySink().sink, mcp: { listTools: async () => [sessionTool()], callTool: async () => ({ content: 'TEST ok' }) } })
    expect(provider.calls[0]?.messages).toEqual([
      { role: 'assistant', text: 'TEST other' },
      { role: 'assistant', toolCalls: [retryCall] },
      { role: 'tool', toolResult: { toolCallId: retryCall.id, toolName: retryCall.name, content: 'TEST ok', isError: false } },
    ])
  })

  it('appends only the tool message when the assistant call is already there', async () => {
    const operation = { operationId: 'TEST op', call: retryCall, reason: 'TEST lost' }
    const provider = new FakeProvider([{ text: 'TEST done' }])
    await runKarbotTurn({ provider, systemPrompt: 'TEST', messages: [{ role: 'assistant', toolCalls: [retryCall] }],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] },
      sink: memorySink().sink, mcp: { listTools: async () => [sessionTool()], callTool: async () => ({ content: 'TEST ok' }) } })
    expect(provider.calls[0]?.messages).toEqual([
      { role: 'assistant', toolCalls: [retryCall] },
      { role: 'tool', toolResult: { toolCallId: retryCall.id, toolName: retryCall.name, content: 'TEST ok', isError: false } },
    ])
  })

  it('keeps the server recovery reason and falls back when it carries none', async () => {
    for (const [recovery, reason] of [
      [{ operationId: 'TEST op', reason: 'TEST server reason' }, 'TEST server reason'],
      [{ operationId: 'TEST op' } as { operationId: string; reason: string }, 'This retry failed; the original effect is still unconfirmed.'],
    ] as const) {
      const operation = { operationId: 'TEST op', call: retryCall, reason: 'TEST lost' }
      const provider = new FakeProvider([{ text: 'Must not run' }])
      const result = await runKarbotTurn({ provider, systemPrompt: 'TEST', messages: [],
        resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] },
        sink: memorySink().sink, mcp: { listTools: async () => [sessionTool()], callTool: async () => ({ content: 'TEST bad', isError: true, recovery }) } })
      expect(result.recoveryHalt?.[0]?.reason).toBe(reason)
      expect(provider.calls).toHaveLength(0)
    }
  })
})

describe('pending-tools resume [F:agents.turnRunner.runKarbotTurn]', () => {
  const pendingCalls = [
    { id: 'p1', name: 'db.create_session', args: {} },
    { id: 'p2', name: 'db.create_session', args: {} },
  ]

  function pendingOptions(outcome: (operationId: string) => Promise<{ content: string; isError?: boolean; recovery?: { operationId: string; reason: string } }>) {
    const checkpoints: Array<{ round: number; tools: number }> = []
    const sinkRounds: number[] = []
    const opIds: Array<string | undefined> = []
    const provider = new FakeProvider([{ text: 'TEST after' }])
    return {
      provider, checkpoints, sinkRounds, opIds,
      options: {
        provider, operationKey: 'TEST pending run', systemPrompt: 'TEST',
        messages: [{ role: 'user', text: 'TEST hi' } as ChatMessage, { role: 'assistant', toolCalls: pendingCalls } as ChatMessage],
        resume: { round: 1, usage: emptyUsage(), toolCalls: 5 },
        sink: { onDelta: () => undefined, onTool: (_id: string, _name: string, _state: 'running' | 'done' | 'failed', round: number) => { sinkRounds.push(round) } },
        mcp: { listTools: async () => [sessionTool()], callTool: async (_name: string, _args: Record<string, unknown>, operationId?: string) => { opIds.push(operationId); return outcome(operationId ?? '') } },
        onCheckpoint: async (_messages: ChatMessage[], round: number, _usage: unknown, tools: number) => { checkpoints.push({ round, tools }) },
      },
    }
  }

  it('dispatches pending calls at the resume round with exact checkpoint counts', async () => {
    const built = pendingOptions(async () => ({ content: 'TEST ok' }))
    const result = await runKarbotTurn(built.options as never)
    expect(built.opIds).toEqual(['TEST pending run:1:0', 'TEST pending run:1:1'])
    expect(built.sinkRounds).toContain(1)
    expect(built.checkpoints).toEqual([{ round: 1, tools: 5 }, { round: 1, tools: 5 }])
    expect(result.toolCalls).toEqual(pendingCalls)
    expect(result.toolOutcomes).toEqual([
      { id: 'p1', name: 'db.create_session', state: 'done' },
      { id: 'p2', name: 'db.create_session', state: 'done' },
    ])
  })

  it('dispatches pending calls at round zero without resume', async () => {
    const opIds: Array<string | undefined> = []
    const provider = new FakeProvider([{ text: 'TEST after' }])
    const result = await runKarbotTurn({ provider, operationKey: 'TEST fresh run', systemPrompt: 'TEST',
      messages: [{ role: 'assistant', toolCalls: [pendingCalls[0]!] }],
      sink: memorySink().sink,
      mcp: { listTools: async () => [sessionTool()], callTool: async (_name, _args, operationId) => { opIds.push(operationId); return { content: 'TEST ok' } } } })
    expect(opIds).toEqual(['TEST fresh run:0:0'])
    expect(result.toolCalls).toEqual([pendingCalls[0]])
  })

  it('marks a failing pending call failed and continues the turn', async () => {
    const states: string[] = []
    const built = pendingOptions(async () => ({ content: 'TEST bad', isError: true }))
    const result = await runKarbotTurn({ ...built.options, sink: { onDelta: () => undefined, onTool: (_id: string, _name: string, state: 'running' | 'done' | 'failed') => { states.push(state) } } } as never)
    expect(states).toEqual(['running', 'failed', 'running', 'failed'])
    expect(result.toolOutcomes.every((o) => o.state === 'failed')).toBe(true)
    expect(result.recoveryHalt).toBeUndefined()
    expect(result.text).toBe('TEST after')
  })

  it('halts on a recovering pending call with the exact operation', async () => {
    const built = pendingOptions(async (operationId) => ({ content: 'TEST lost', isError: true, recovery: { operationId, reason: 'TEST uncertain' } }))
    const result = await runKarbotTurn(built.options as never)
    expect(built.provider.calls).toHaveLength(0)
    expect(result.recoveryHalt).toEqual([
      { authorityId: undefined, operationId: 'TEST pending run:1:0', call: pendingCalls[0], serializedCall: JSON.stringify(pendingCalls[0]), reason: 'TEST uncertain' },
      { authorityId: undefined, operationId: 'TEST pending run:1:1', call: pendingCalls[1], serializedCall: JSON.stringify(pendingCalls[1]), reason: 'TEST uncertain' },
    ])
  })
})

describe('resume drain ledger [F:agents.turnRunner.runKarbotTurn]', () => {
  const drainCalls = [
    { id: 'd1', name: 'db.list_sessions', args: {} },
    { id: 'd2', name: 'db.list_sessions', args: {} },
  ]
  type Checkpoint = { round: number; toolCalls: number; ops?: unknown; history: ChatMessage[] }
  function drainHarness(callTool: (call: { id: string }) => Promise<{ content: string; isError?: boolean; recovery?: { operationId: string; authorityId?: string; reason?: string } }>, resumeToolCalls = 5) {
    const provider = new FakeProvider([{ text: 'TEST after drain' }])
    const checkpoints: Checkpoint[] = []
    const toolEvents: Array<{ state: string; round: number }> = []
    const resultRounds: number[] = []
    const options = {
      provider, operationKey: 'TEST drain', systemPrompt: 'TEST',
      messages: [{ role: 'assistant' as const, toolCalls: drainCalls }],
      resume: { round: 3, usage: emptyUsage(), toolCalls: resumeToolCalls },
      sink: { onDelta: () => undefined, onTool: (_id: string, _name: string, state: 'running' | 'done' | 'failed', round: number) => void toolEvents.push({ state, round }) },
      mcp: { authorityId: 'TEST drain authority', listTools: async () => [sessionTool()], callTool: async (name: string, _args: Record<string, unknown>) => callTool({ id: name }) },
      onCheckpoint: async (history: ChatMessage[], round: number, _usage: unknown, toolCalls: number, ops?: unknown) => void checkpoints.push({ round, toolCalls, ops, history: structuredClone(history) }),
      onToolResult: async (round: number) => void resultRounds.push(round),
    }
    return { provider, checkpoints, toolEvents, resultRounds, options }
  }

  it('keeps a recovery reason verbatim on a failed blocked retry', async () => {
    const call = { id: 'b1', name: 'db.list_sessions', args: {} }
    const operation: RecoveryOperation = { authorityId: 'TEST authority', operationId: 'TEST op', call, serializedCall: JSON.stringify(call), reason: 'TEST blocked' }
    const provider = new FakeProvider([{ text: 'TEST never' }])
    const result = await runKarbotTurn({ provider, systemPrompt: 'TEST', messages: [],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] },
      sink: { onDelta: () => undefined },
      mcp: { authorityId: 'TEST authority', listTools: async () => [sessionTool()], callTool: async () => ({ content: 'TEST still lost', isError: true, recovery: { operationId: 'TEST op', reason: 'TEST kept verbatim' } }) } })
    expect(provider.calls).toHaveLength(0)
    expect(result.recoveryHalt?.[0]?.reason).toBe('TEST kept verbatim')
  })

  it('falls back to the default retry note when recovery carries no reason', async () => {
    const call = { id: 'b1', name: 'db.list_sessions', args: {} }
    const operation: RecoveryOperation = { authorityId: 'TEST authority', operationId: 'TEST op', call, serializedCall: JSON.stringify(call), reason: 'TEST blocked' }
    const result = await runKarbotTurn({ provider: new FakeProvider([{ text: 'TEST never' }]), systemPrompt: 'TEST', messages: [],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] },
      sink: { onDelta: () => undefined },
      mcp: { authorityId: 'TEST authority', listTools: async () => [sessionTool()], callTool: async () => ({ content: 'TEST failed silently', isError: true }) } })
    expect(result.recoveryHalt?.[0]?.reason).toBe('This retry failed; the original effect is still unconfirmed.')
  })

  it('checkpoints the resume round with exact carried totals and prepared operations', async () => {
    const built = drainHarness(async () => ({ content: 'TEST ok' }))
    await runKarbotTurn(built.options as never)
    const drainPoints = built.checkpoints.filter((c) => c.round === 3)
    expect(drainPoints.map((c) => c.toolCalls)).toEqual([5, 5])
    expect(drainPoints[0]?.ops).toEqual([
      { authorityId: 'TEST drain authority', operationId: 'TEST drain:3:0', call: drainCalls[0], serializedCall: JSON.stringify(drainCalls[0]), reason: 'Execution was prepared; its result has not yet been durably confirmed.' },
      { authorityId: 'TEST drain authority', operationId: 'TEST drain:3:1', call: drainCalls[1], serializedCall: JSON.stringify(drainCalls[1]), reason: 'Execution was prepared; its result has not yet been durably confirmed.' },
    ])
    expect(drainPoints[1]?.ops).toEqual([])
  })

  it('floors carried totals at zero when the pending turn exceeds the count', async () => {
    const built = drainHarness(async () => ({ content: 'TEST ok' }), 1)
    await runKarbotTurn(built.options as never)
    const drainPoints = built.checkpoints.filter((c) => c.round === 3)
    expect(drainPoints.map((c) => c.toolCalls)).toEqual([2, 2])
  })

  it('reports drain rounds through the sink and tool-result hooks', async () => {
    const built = drainHarness(async () => ({ content: 'TEST ok' }))
    await runKarbotTurn(built.options as never)
    expect(built.toolEvents).toEqual([
      { state: 'running', round: 3 }, { state: 'done', round: 3 },
      { state: 'running', round: 3 }, { state: 'done', round: 3 },
    ])
    expect(built.resultRounds).toEqual([3, 3])
  })

  it('ledgers drained outcomes with exact content and error flags', async () => {
    let n = 0
    const built = drainHarness(async () => (++n === 1 ? { content: 'TEST one' } : { content: 'TEST two', isError: true }))
    const result = await runKarbotTurn(built.options as never)
    const post = built.checkpoints.filter((c) => c.round === 3)[1]?.history.filter((m) => m.role === 'tool') ?? []
    expect(post).toHaveLength(2)
    expect(post[0]?.toolResult).toEqual({ toolCallId: 'd1', toolName: 'db.list_sessions', content: 'TEST one', isError: false })
    expect(post[1]?.toolResult).toEqual({ toolCallId: 'd2', toolName: 'db.list_sessions', content: 'TEST two', isError: true })
    expect(result.toolOutcomes).toEqual([
      { id: 'd1', name: 'db.list_sessions', state: 'done' },
      { id: 'd2', name: 'db.list_sessions', state: 'failed' },
    ])
  })

  it('returns drained calls in execution order', async () => {
    const built = drainHarness(async () => ({ content: 'TEST ok' }))
    const result = await runKarbotTurn(built.options as never)
    expect(result.toolCalls).toEqual(drainCalls)
  })

  it('halts with the full recovery identity when a drained call is uncertain', async () => {
    const built = drainHarness(async () => ({ content: 'TEST lost', isError: true, recovery: { operationId: 'TEST drain op', authorityId: 'TEST outcome authority', reason: 'TEST uncertain drain' } }))
    const result = await runKarbotTurn(built.options as never)
    expect(built.provider.calls).toHaveLength(0)
    expect(result.recoveryHalt).toEqual([
      { authorityId: 'TEST outcome authority', operationId: 'TEST drain op', call: drainCalls[0], serializedCall: JSON.stringify(drainCalls[0]), reason: 'TEST uncertain drain' },
      { authorityId: 'TEST outcome authority', operationId: 'TEST drain op', call: drainCalls[1], serializedCall: JSON.stringify(drainCalls[1]), reason: 'TEST uncertain drain' },
    ])
  })
})

describe('beforeRound refresh [F:agents.turnRunner.runKarbotTurn]', () => {
  it('exposes the live system prompt, history, and tools to beforeRound', async () => {
    const provider = new FakeProvider([{ text: 'TEST done' }])
    const messages: ChatMessage[] = [{ role: 'user', text: 'TEST hello' }]
    let seen: { systemPrompt?: string; messages?: ChatMessage[]; tools?: unknown } | undefined
    await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'TEST sys', messages,
      beforeRound: async (_round, current) => { seen = structuredClone(current); return {} } })
    expect(seen?.systemPrompt).toBe('TEST sys')
    expect(seen?.messages).toEqual(messages)
    expect(seen?.tools).toEqual([sessionTool()])
  })

  it('sends the refreshed system prompt to the provider', async () => {
    const provider = new FakeProvider([{ text: 'TEST done' }])
    await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'TEST stale', messages: [],
      beforeRound: async () => ({ systemPrompt: 'TEST refreshed v1' }) })
    expect(provider.calls[0]?.systemPrompt).toBe('TEST refreshed v1')
  })

  it('sends rewritten messages to the provider for the round', async () => {
    const provider = new FakeProvider([{ text: 'TEST done' }])
    const rewritten: ChatMessage[] = [{ role: 'user', text: 'TEST rewritten' }]
    await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'TEST sys',
      messages: [{ role: 'user', text: 'TEST original' }],
      beforeRound: async () => ({ messages: rewritten }) })
    expect(provider.calls[0]?.messages).toEqual([{ role: 'user', text: 'TEST rewritten' }])
  })
})

describe('pre-round condensation [F:agents.turnRunner.runKarbotTurn]', () => {
  const forgottenText = `TEST forget me ${'x'.repeat(400)}`
  function tokenMessages(): ChatMessage[] {
    return [
      { role: 'user', text: 'TEST keep head' },
      { role: 'user', text: forgottenText },
      { role: 'user', text: `TEST tail 2 ${'y'.repeat(400)}` },
      { role: 'user', text: `TEST tail 3 ${'y'.repeat(400)}` },
      { role: 'user', text: `TEST tail 4 ${'y'.repeat(400)}` },
      { role: 'user', text: `TEST tail 5 ${'y'.repeat(400)}` },
    ]
  }

  it('condenses on tokens with few messages and records the tokens reason', async () => {
    const messages = tokenMessages()
    const tokenCount = estimateTokens('sys') + estimateMessagesTokens(messages)
    const provider = new FakeProvider([{ text: 'TEST done' }])
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages,
      harness: { condense: { maxSize: 8, keepFirst: 1, tokenCap: tokenCount - 1, summarize: async (forgotten) => {
        expect(forgotten.map((m) => m.text)).toEqual([forgottenText])
        return 'TEST big summary'
      } } } })
    expect(result.condensed).toEqual([{ forgetStart: 1, forgetEnd: 2, summaryText: 'TEST big summary', summarizer: 'unit:compaction', reason: 'tokens' }])
    const sent = provider.calls[0]?.messages ?? []
    expect(sent).toHaveLength(6)
    expect(sent[1]?.text).toContain('TEST big summary')
    expect(sent.some((m) => m.text === forgottenText)).toBe(false)
  })

  it('leaves history untouched at exactly the token cap', async () => {
    const messages = tokenMessages()
    const tokenCount = estimateTokens('sys') + estimateMessagesTokens(messages)
    const provider = new FakeProvider([{ text: 'TEST done' }])
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages,
      harness: { condense: { maxSize: 8, keepFirst: 1, tokenCap: tokenCount, summarize: async () => 'TEST must not run' } } })
    expect(result.condensed).toBeUndefined()
    expect(provider.calls[0]?.messages).toEqual(messages)
  })

  it('leaves history untouched under the token cap', async () => {
    const messages = tokenMessages()
    const tokenCount = estimateTokens('sys') + estimateMessagesTokens(messages)
    const provider = new FakeProvider([{ text: 'TEST done' }])
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages,
      harness: { condense: { maxSize: 8, keepFirst: 1, tokenCap: tokenCount + 100, summarize: async () => 'TEST must not run' } } })
    expect(result.condensed).toBeUndefined()
    expect(provider.calls[0]?.messages).toEqual(messages)
  })

  it('leaves history untouched without a token cap and few messages', async () => {
    const messages: ChatMessage[] = [{ role: 'user', text: 'one' }, { role: 'assistant', text: 'two' }, { role: 'user', text: 'three' }]
    const provider = new FakeProvider([{ text: 'TEST done' }])
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages,
      harness: { condense: { maxSize: 8, keepFirst: 1, summarize: async () => 'TEST must not run' } } })
    expect(result.condensed).toBeUndefined()
    expect(provider.calls[0]?.messages).toEqual(messages)
  })

  it('leaves history untouched at exactly maxSize', async () => {
    const messages: ChatMessage[] = [{ role: 'user', text: 'one' }, { role: 'assistant', text: 'two' }, { role: 'user', text: 'three' }, { role: 'assistant', text: 'four' }]
    const provider = new FakeProvider([{ text: 'TEST done' }])
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages,
      harness: { condense: { maxSize: 4, keepFirst: 1, summarize: async () => 'TEST must not run' } } })
    expect(result.condensed).toBeUndefined()
    expect(provider.calls[0]?.messages).toEqual(messages)
  })

  it('condenses on size with the events reason when tokens are under cap', async () => {
    const messages: ChatMessage[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((text, i) => ({ role: i % 2 ? 'assistant' : 'user', text }) as ChatMessage)
    const provider = new FakeProvider([{ text: 'TEST done' }])
    const summaries: SummaryArtifact[] = []
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages,
      harness: { condense: { maxSize: 4, keepFirst: 1, tokenCap: 1_000_000, summarize: async () => 'TEST size summary', onCondense: (summary) => void summaries.push(summary) } } })
    expect(result.condensed?.[0]?.reason).toBe('events')
    expect(summaries).toEqual(result.condensed)
    const sent = provider.calls[0]?.messages ?? []
    expect(sent.length).toBeLessThan(6)
    expect(sent.some((m) => m.text?.includes('TEST size summary'))).toBe(true)
  })

  it('completes condensation without an onCondense hook', async () => {
    const messages: ChatMessage[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((text, i) => ({ role: i % 2 ? 'assistant' : 'user', text }) as ChatMessage)
    const provider = new FakeProvider([{ text: 'TEST done' }])
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages,
      harness: { condense: { maxSize: 4, keepFirst: 1, summarize: async () => 'TEST hookless' } } })
    expect(result.condensed).toHaveLength(1)
    expect(result.text).toBe('TEST done')
  })
})

describe('stream accumulation [F:agents.turnRunner.runKarbotTurn]', () => {
  it('rejects on owner abort mid-stream and suppresses late frames', async () => {
    const abort = new AbortController()
    let release: () => void = () => undefined
    let finish: () => void = () => undefined
    let entered: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const ended = new Promise<void>((resolve) => { finish = resolve })
    const started = new Promise<void>((resolve) => { entered = resolve })
    let signal: AbortSignal | undefined
    const provider: ProviderAdapter = {
      providerName: 'abort-test', chat: async () => { throw new Error('unused') },
      async *chatStream(request) { signal = request.signal; entered(); await gate; try { yield { kind: 'text_delta', text: 'TEST late' }; yield { kind: 'done', usage: emptyUsage() } } finally { finish() } },
    }
    const { sink, deltas } = memorySink()
    const pending = runKarbotTurn({ provider, mcp: memoryMcp(), sink, systemPrompt: 'sys', messages: [], signal: abort.signal })
    await started
    abort.abort(new Error('TEST owner stopped'))
    release(); await ended
    await expect(pending).rejects.toThrow('TEST owner stopped')
    expect(signal?.aborted).toBe(true)
    expect(deltas).toEqual([])
  })

  it('accumulates reasoning deltas into the result and the sink', async () => {
    const provider = new FakeProvider([{ text: 'TEST done', reasoning: 'TEST thinking' }])
    const heard: Array<{ text: string; round: number }> = []
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: { onDelta: () => undefined, onReasoning: (text, round) => void heard.push({ text, round }) }, systemPrompt: 'sys', messages: [] })
    expect(result.reasoning).toBe('TEST thinking')
    expect(heard).toEqual([{ text: 'TEST thinking', round: 1 }])
  })

  it('completes reasoning rounds without an onReasoning hook', async () => {
    const provider = new FakeProvider([{ text: 'TEST done', reasoning: 'TEST unheard' }])
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages: [] })
    expect(result.reasoning).toBe('TEST unheard')
    expect(result.text).toBe('TEST done')
  })

  it('announces streamed tool start, end, and dispatch in order', async () => {
    const events: Array<{ id: string; name: string; state: string; round: number }> = []
    let round = 0
    const provider: ProviderAdapter = {
      providerName: 'seq-test', chat: async () => { throw new Error('unused') },
      async *chatStream() {
        round += 1
        if (round === 1) {
          yield { kind: 'toolcall_start', index: 0, key: 'c1' }
          yield { kind: 'toolcall_end', index: 0, call: { id: 'c1', name: 'db.list_sessions', args: {} } }
          yield { kind: 'done', usage: emptyUsage(), completion: 'complete' }
        } else {
          yield { kind: 'text_delta', text: 'TEST done' }
          yield { kind: 'done', usage: emptyUsage(), completion: 'complete' }
        }
      },
    }
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: { onDelta: () => undefined, onTool: (id, name, state, round) => void events.push({ id, name, state, round }) }, systemPrompt: 'sys', messages: [] })
    expect(events).toEqual([
      { id: 'c1', name: 'Tool call', state: 'running', round: 1 },
      { id: 'c1', name: 'db.list_sessions', state: 'running', round: 1 },
      { id: 'c1', name: 'db.list_sessions', state: 'done', round: 1 },
    ])
    expect(result.toolCalls).toHaveLength(1)
  })

  it('ignores unknown stream events after done and completes the round', async () => {
    const provider: ProviderAdapter = {
      providerName: 'mystery-test', chat: async () => { throw new Error('unused') },
      async *chatStream() {
        yield { kind: 'text_delta', text: 'TEST hi' }
        yield { kind: 'done', usage: emptyUsage(), completion: 'complete' }
        yield { kind: 'mystery-pulse', payload: 1 } as never
      },
    }
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages: [] })
    expect(result.text).toBe('TEST hi')
  })

  it('keeps the last completion when a later done frame omits it', async () => {
    let seen: { completion?: string; usage?: unknown } | undefined
    const first = { ...emptyUsage(), inputTokens: 1 }
    const second = { ...emptyUsage(), inputTokens: 2 }
    const provider: ProviderAdapter = {
      providerName: 'done-test', chat: async () => { throw new Error('unused') },
      async *chatStream() {
        yield { kind: 'text_delta', text: 'TEST hi' }
        yield { kind: 'done', usage: first, completion: 'complete' }
        yield { kind: 'done', usage: second }
      },
    }
    await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages: [],
      onProviderResponse: async (_round, response) => { seen = response } })
    expect(seen?.completion).toBe('complete')
    expect(seen?.usage).toEqual(second)
  })

  it('keeps incomplete sticky against a later complete frame', async () => {
    let seen: { completion?: string; usage?: unknown } | undefined
    const first = { ...emptyUsage(), inputTokens: 1 }
    const second = { ...emptyUsage(), inputTokens: 2 }
    const provider: ProviderAdapter = {
      providerName: 'done-test', chat: async () => { throw new Error('unused') },
      async *chatStream() {
        yield { kind: 'text_delta', text: 'TEST hi' }
        yield { kind: 'done', usage: first, completion: 'incomplete' }
        yield { kind: 'done', usage: second, completion: 'complete' }
      },
    }
    await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages: [],
      onProviderResponse: async (_round, response) => { seen = response } })
    expect(seen?.completion).toBe('incomplete')
    expect(seen?.usage).toEqual(second)
  })

  it('ledgers the assistant turn with exact role, text, and tool calls', async () => {
    const call = { id: 'c1', name: 'db.list_sessions', args: {} }
    const provider = new FakeProvider([{ text: '', toolCalls: [call] }, { text: 'TEST final' }])
    let finalHistory: ChatMessage[] = []
    await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages: [{ role: 'user', text: 'TEST go' }],
      onProviderResponse: async () => undefined,
      onCheckpoint: async (history) => { finalHistory = structuredClone(history) } })
    expect(provider.calls[1]?.messages).toEqual([
      { role: 'user', text: 'TEST go' },
      { role: 'assistant', text: '', toolCalls: [call] },
      { role: 'tool', toolResult: { toolCallId: 'c1', toolName: 'db.list_sessions', content: 'sessions: []', isError: false } },
    ])
    const finalAssistant = finalHistory.at(-1)
    expect(finalAssistant?.role).toBe('assistant')
    expect(finalAssistant?.text).toBe('TEST final')
    expect(finalAssistant?.toolCalls).toBeUndefined()
  })
})

describe('round budget accounting [F:agents.turnRunner.runKarbotTurn]', () => {
  const generous = { maxTurns: 10, maxToolCalls: 10, maxTokens: 1_000_000_000, maxCost: 1_000_000_000, maxWallMs: 60_000, maxStalledTurns: 5 }

  it('trips stalledTurns on an empty quiet round after progress', async () => {
    const budgets = new BudgetTracker({ ...generous, maxStalledTurns: 1 }, frozenClock(0))
    const provider = new FakeProvider([{ text: '', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }] }, { text: '' }])
    await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages: [{ role: 'user', text: 'TEST go' }], harness: { budgets } })
    expect(budgets.tripped()).toEqual(['stalledTurns'])
  })

  it('counts tool and text rounds as progress against stalledTurns', async () => {
    const budgets = new BudgetTracker({ ...generous, maxStalledTurns: 1 }, frozenClock(0))
    const provider = new FakeProvider([{ text: '', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }] }, { text: 'TEST done' }])
    await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages: [{ role: 'user', text: 'TEST go' }], harness: { budgets } })
    expect(budgets.tripped()).toEqual([])
  })

  it('halts at the loop top when the tool-call budget trips', async () => {
    const budgets = new BudgetTracker({ ...generous, maxToolCalls: 1 }, frozenClock(0))
    const provider = new FakeProvider([{ text: '', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }] }, { text: 'TEST never' }])
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages: [{ role: 'user', text: 'TEST go' }], harness: { budgets } })
    expect(result.budgetTripped).toEqual(['toolCalls'])
    expect(provider.calls).toHaveLength(1)
    expect(result.text).toBe('')
    expect(result.turns).toBe(2)
  })

  it('notes exactly one budget call per tool call', async () => {
    const budgets = new BudgetTracker({ ...generous, maxToolCalls: 3 }, frozenClock(0))
    const provider = new FakeProvider([{ text: '', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }, { id: 'c2', name: 'db.list_sessions', args: {} }] }, { text: 'TEST done' }])
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages: [{ role: 'user', text: 'TEST go' }], harness: { budgets } })
    expect(result.text).toBe('TEST done')
    expect(provider.calls).toHaveLength(2)
  })

  it('trips the token budget on the exact input+output sum', async () => {
    const budgets = new BudgetTracker({ ...generous, maxTokens: 42 }, frozenClock(0))
    const provider = new FakeProvider([{ text: '', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }], usage: { inputTokens: 40, outputTokens: 2 } }, { text: 'TEST never' }])
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages: [{ role: 'user', text: 'TEST go' }], harness: { budgets } })
    expect(result.budgetTripped).toEqual(['tokens'])
    expect(provider.calls).toHaveLength(1)
  })

  it('trips the cost budget on exact per-million pricing', async () => {
    const budgets = new BudgetTracker({ ...generous, maxCost: 40 }, frozenClock(0))
    const provider = new FakeProvider([{ text: '', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }], usage: { inputTokens: 2_000_000, outputTokens: 1_000_000 } }, { text: 'TEST never' }])
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages: [{ role: 'user', text: 'TEST go' }],
      harness: { budgets, prices: { inputPricePerMTok: 10, outputPricePerMTok: 20 } } })
    expect(result.budgetTripped).toEqual(['cost'])
    expect(provider.calls).toHaveLength(1)
  })

  it('does not inflate cost beyond exact per-million pricing', async () => {
    const budgets = new BudgetTracker({ ...generous, maxCost: 1_000_000 }, frozenClock(0))
    const provider = new FakeProvider([{ text: '', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }], usage: { inputTokens: 2000, outputTokens: 1000 } }, { text: 'TEST done' }])
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages: [{ role: 'user', text: 'TEST go' }],
      harness: { budgets, prices: { inputPricePerMTok: 10, outputPricePerMTok: 20 } } })
    expect(result.text).toBe('TEST done')
    expect(budgets.tripped()).toEqual([])
  })
})

describe('round snapshots and request options [F:agents.turnRunner.runKarbotTurn]', () => {
  it('snapshots the exact round request bytes under the hash chain', async () => {
    const call = { id: 'c1', name: 'db.list_sessions', args: {} }
    const provider = new FakeProvider([{ text: '', toolCalls: [call] }, { text: 'TEST done' }])
    const snapshots: ContextSnapshot[] = []
    const versions = { tools: { 'db.list_sessions': 'v3' }, prompt: 'p1', policy: 'pol2' }
    await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages: [{ role: 'user', text: 'hi' }],
      harness: { versions, onSnapshot: (snapshot) => void snapshots.push(snapshot) } })
    expect(snapshots).toHaveLength(2)
    const expectedFirst = createSnapshot(assembleContext({ system: ['sys'], tools: [sessionTool()], references: [], history: [{ role: 'user', text: 'hi' }], tail: [] }), versions, undefined)
    expect(snapshots[0]).toEqual(expectedFirst)
    expect(snapshots[1]?.parentHash).toBe(snapshots[0]?.hash)
    expect(snapshots[1]?.messageCount).toBe(3)
  })

  it('forwards optional request fields only when set', async () => {
    const provider = new FakeProvider([{ text: 'TEST done' }])
    await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages: [], maxOutputTokens: 128, reasoningEffort: 'high', temperature: 0.5 })
    expect(provider.calls[0]?.maxOutputTokens).toBe(128)
    expect(provider.calls[0]?.reasoningEffort).toBe('high')
    expect(provider.calls[0]?.temperature).toBe(0.5)
  })

  it('omits optional request fields when unset', async () => {
    const provider = new FakeProvider([{ text: 'TEST done' }])
    await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages: [] })
    const call = provider.calls[0]
    expect(call && 'maxOutputTokens' in call).toBe(false)
    expect(call && 'reasoningEffort' in call).toBe(false)
    expect(call && 'temperature' in call).toBe(false)
  })
})

describe('round checkpoints and halt precedence [F:agents.turnRunner.runKarbotTurn]', () => {
  it('checkpoints provider, dispatch, and post-round totals in order', async () => {
    const provider = new FakeProvider([
      { text: '', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }] },
      { text: '', toolCalls: [{ id: 'c2', name: 'db.list_sessions', args: {} }] },
      { text: 'TEST done' },
    ])
    const points: Array<{ round: number; total: number; ops: unknown; pending: unknown }> = []
    await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages: [{ role: 'user', text: 'TEST go' }],
      operationKey: 'TEST checkpoints', onProviderResponse: async () => undefined,
      onCheckpoint: async (_history, round, _usage, total, ops, pending) => void points.push({ round, total, ops, pending }) })
    expect(points.filter((p) => p.pending !== undefined).map((p) => [p.round, p.total])).toEqual([[1, 1], [2, 2], [3, 2]])
    expect(points.filter((p) => p.pending === undefined && Array.isArray(p.ops) && p.ops.length > 0).map((p) => [p.round, p.total])).toEqual([[1, 1], [2, 2]])
    expect(points.filter((p) => p.pending === undefined && Array.isArray(p.ops) && p.ops.length === 0).map((p) => [p.round, p.total])).toEqual([[1, 1], [2, 2]])
  })

  it('completes distinct tool rounds under a repetition screen', async () => {
    const provider = new FakeProvider([
      { text: 'a', toolCalls: [{ id: 'c1', name: 't.one', args: {} }] },
      { text: 'b', toolCalls: [{ id: 'c2', name: 't.two', args: {} }] },
      { text: 'TEST done' },
    ])
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys',
      messages: [{ role: 'user', text: 'hi' }], harness: { repetition: new RepetitionTracker() } })
    expect(result.text).toBe('TEST done')
    expect(provider.calls).toHaveLength(3)
    expect(result.repetitionHalt).toBeUndefined()
  })

  it('halts a replan verdict with the exact fingerprint and no budget trip', async () => {
    const repeat = { id: 'c1', name: 'db.list_sessions', args: {} }
    const provider = new FakeProvider([
      { text: 'a', toolCalls: [repeat] },
      { text: 'b', toolCalls: [{ ...repeat, id: 'c2' }] },
      { text: 'c', toolCalls: [{ ...repeat, id: 'c3' }] },
      { text: 'unreached' },
    ])
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys',
      messages: [{ role: 'user', text: 'hi' }], harness: { repetition: new RepetitionTracker() } })
    expect(result.repetitionHalt).toEqual({ verdict: 'replan', fingerprint: fingerprintAction('db.list_sessions', {}) })
    expect(result.budgetTripped).toBeUndefined()
    expect(provider.remaining).toBe(1)
  })

  it('halts a blocked verdict with the exact fingerprint and no budget trip', async () => {
    // The stock tracker escalates through replan (which halts) before any
    // count reaches blocked, so the blocked arm is pinned with a stub.
    const provider = new FakeProvider([
      { text: 'a', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }] },
      { text: 'unreached' },
    ])
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys',
      messages: [{ role: 'user', text: 'hi' }], harness: { repetition: { note: () => 'blocked' } as never } })
    expect(result.repetitionHalt).toEqual({ verdict: 'blocked', fingerprint: fingerprintAction('db.list_sessions', {}) })
    expect(result.budgetTripped).toBeUndefined()
    expect(provider.remaining).toBe(1)
  })

  it('reports turns exhaustion as the budget trip', async () => {
    const provider = new FakeProvider([
      { text: 'a', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }] },
      { text: 'b', toolCalls: [{ id: 'c2', name: 'db.list_sessions', args: {} }] },
      { text: 'c' },
    ])
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys',
      messages: [{ role: 'user', text: 'hi' }], maxTurns: 2 })
    expect(result.budgetTripped).toEqual(['turns'])
    expect(result.turns).toBe(2)
    expect(provider.remaining).toBe(1)
  })

  it('leaves the budget untripped when recovery halts the turn', async () => {
    const call = { id: 'b1', name: 'db.list_sessions', args: {} }
    const operation = { authorityId: 'TEST authority', operationId: 'TEST op', call, serializedCall: JSON.stringify(call), reason: 'TEST blocked' }
    const result = await runKarbotTurn({ provider: new FakeProvider([{ text: 'TEST never' }]), systemPrompt: 'TEST', messages: [],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] },
      sink: { onDelta: () => undefined },
      mcp: { authorityId: 'TEST authority', listTools: async () => [sessionTool()], callTool: async () => ({ content: 'TEST lost', isError: true, recovery: { operationId: 'TEST op', reason: 'TEST uncertain' } }) } })
    expect(result.recoveryHalt).toHaveLength(1)
    expect(result.budgetTripped).toBeUndefined()
  })

  it('aborts the round scope after a successful turn', async () => {
    let signal: AbortSignal | undefined
    const provider: ProviderAdapter = {
      providerName: 'scope-test', chat: async () => { throw new Error('unused') },
      async *chatStream(request) { signal = request.signal; yield { kind: 'text_delta', text: 'TEST done' }; yield { kind: 'done', usage: emptyUsage() } },
    }
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages: [] })
    expect(result.text).toBe('TEST done')
    expect(signal?.aborted).toBe(true)
  })

  it('omits unset halt and condensed keys from the result', async () => {
    const provider = new FakeProvider([{ text: 'TEST done' }])
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages: [] })
    expect('budgetTripped' in result).toBe(false)
    expect('repetitionHalt' in result).toBe(false)
    expect('condensed' in result).toBe(false)
  })
})

describe('resume round reporting [F:agents.turnRunner.runKarbotTurn]', () => {
  it('restores resumed rounds as progress, never as stalled turns', async () => {
    const budgets = new BudgetTracker({ maxTurns: 10, maxToolCalls: 10, maxTokens: 1_000_000_000, maxCost: 1_000_000_000, maxWallMs: 60_000, maxStalledTurns: 2 }, frozenClock(0))
    const provider = new FakeProvider([{ text: 'TEST done' }])
    const result = await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'TEST', messages: [],
      resume: { round: 3, usage: emptyUsage(), toolCalls: 0 }, harness: { budgets } })
    expect(result.budgetTripped).toBeUndefined()
    expect(result.text).toBe('TEST done')
    expect(provider.calls).toHaveLength(1)
  })

  it('announces a blocked retry with its exact identity, state, and resume round', async () => {
    const heard: Array<{ id: string; name: string; state: string; round: number }> = []
    const call = { id: 'b1', name: 'db.create_session', args: {} }
    const operation = { operationId: 'TEST op', call, reason: 'TEST lost' }
    await runKarbotTurn({ provider: new FakeProvider([{ text: 'TEST done' }]), systemPrompt: 'TEST', messages: [],
      resume: { round: 3, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] },
      sink: { onDelta: () => undefined, onTool: (id, name, state, round) => void heard.push({ id, name, state, round }) },
      mcp: { listTools: async () => [sessionTool()], callTool: async () => ({ content: 'TEST ok' }) } })
    expect(heard[0]).toEqual({ id: 'b1', name: 'db.create_session', state: 'running', round: 3 })
  })

  it('redispatches a blocked retry at its resume round', async () => {
    const rounds: number[] = []
    const call = { id: 'b1', name: 'db.create_session', args: {} }
    const operation = { operationId: 'TEST op', call, reason: 'TEST lost' }
    await runKarbotTurn({ provider: new FakeProvider([{ text: 'TEST done' }]), systemPrompt: 'TEST', messages: [],
      resume: { round: 3, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] },
      sink: memorySink().sink, onToolResult: async (round) => void rounds.push(round),
      mcp: { listTools: async () => [sessionTool()], callTool: async () => ({ content: 'TEST ok' }) } })
    expect(rounds).toEqual([3])
  })

  it('reports round zero on every hook when pending tools resume without resume state', async () => {
    const call = { id: 'p1', name: 'db.create_session', args: {} }
    const provider = new FakeProvider([{ text: 'TEST after' }])
    const sinkRounds: number[] = []
    const checkpointRounds: number[] = []
    const result = await runKarbotTurn({ provider, systemPrompt: 'TEST',
      messages: [{ role: 'assistant', toolCalls: [call] }],
      sink: { onDelta: () => undefined, onTool: (_id, _name, _state, round) => void sinkRounds.push(round) },
      onCheckpoint: async (_history, round) => void checkpointRounds.push(round),
      mcp: memoryMcp() })
    expect(result.toolCalls).toEqual([call])
    expect(sinkRounds).toEqual([0, 0])
    expect(checkpointRounds).toEqual([0, 0])
  })
})

describe('pending-response dedup guards [F:agents.turnRunner.runKarbotTurn]', () => {
  it('does not let a user message with matching text and calls suppress the pending record', async () => {
    const call = { id: 'c1', name: 'db.create_session', args: {} }
    const provider = new FakeProvider([{ text: 'TEST after' }])
    await runKarbotTurn({ provider, systemPrompt: 'TEST',
      messages: [{ role: 'user', text: 'TEST pending', toolCalls: [call] }],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 0, pendingResponse: { round: 1, response: { text: 'TEST pending', reasoning: '', toolCalls: [call], usage: emptyUsage() } } },
      sink: memorySink().sink, mcp: memoryMcp() })
    const assistants = provider.calls[0]?.messages.filter((m) => m.role === 'assistant') ?? []
    expect(assistants).toHaveLength(1)
    expect(assistants[0]).toMatchObject({ text: 'TEST pending', toolCalls: [call] })
  })

  it('pushes a pending response whose text differs even when its calls match', async () => {
    const call = { id: 'c1', name: 'db.create_session', args: {} }
    const provider = new FakeProvider([{ text: 'TEST after' }])
    await runKarbotTurn({ provider, systemPrompt: 'TEST',
      messages: [{ role: 'assistant', text: 'TEST other', toolCalls: [call] }],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 0, pendingResponse: { round: 1, response: { text: 'TEST pending', reasoning: '', toolCalls: [call], usage: emptyUsage() } } },
      sink: memorySink().sink, mcp: memoryMcp() })
    const assistants = provider.calls[0]?.messages.filter((m) => m.role === 'assistant') ?? []
    expect(assistants.map((m) => m.text)).toEqual(['TEST other', 'TEST pending'])
  })

  it('pushes a pending response whose calls differ even when its text matches', async () => {
    const other = { id: 'c0', name: 'db.list_sessions', args: {} }
    const call = { id: 'c1', name: 'db.create_session', args: {} }
    const provider = new FakeProvider([{ text: 'TEST after' }])
    await runKarbotTurn({ provider, systemPrompt: 'TEST',
      messages: [{ role: 'assistant', text: 'TEST pending', toolCalls: [other] }],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 0, pendingResponse: { round: 1, response: { text: 'TEST pending', reasoning: '', toolCalls: [call], usage: emptyUsage() } } },
      sink: memorySink().sink, mcp: memoryMcp() })
    const assistants = provider.calls[0]?.messages.filter((m) => m.role === 'assistant') ?? []
    expect(assistants).toHaveLength(2)
    expect(assistants[1]).toMatchObject({ text: 'TEST pending', toolCalls: [call] })
  })
})

describe('blocked retry splice guards [F:agents.turnRunner.runKarbotTurn]', () => {
  const retryCall = { id: 'mutation-1', name: 'db.create_session', args: { title: 'TEST intent' } }

  it('halts with the invalid-serialization reason when the preserved call is not JSON', async () => {
    const operation: RecoveryOperation = { operationId: 'TEST op', call: retryCall, serializedCall: '{TEST not json', reason: 'TEST lost' }
    const provider = new FakeProvider([{ text: 'Must not run' }])
    const result = await runKarbotTurn({ provider, systemPrompt: 'TEST', messages: [],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] },
      sink: memorySink().sink, mcp: memoryMcp() })
    expect(result.recoveryHalt).toEqual([{ ...operation, reason: 'The original serialized tool call is invalid. Owner review is required.' }])
    expect(provider.calls).toHaveLength(0)
  })

  it('retries without an authority check when the tool client reports none', async () => {
    const mcp = memoryMcp()
    const operation = { authorityId: 'TEST stale', operationId: 'TEST op', call: retryCall, reason: 'TEST lost' }
    const provider = new FakeProvider([{ text: 'TEST done' }])
    const result = await runKarbotTurn({ provider, systemPrompt: 'TEST', messages: [],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] },
      sink: memorySink().sink, mcp })
    expect(result.recoveryHalt).toBeUndefined()
    expect(mcp.calls).toEqual([{ name: 'db.create_session', args: { title: 'TEST intent' } }])
    expect(result.text).toBe('TEST done')
  })

  it('does not match a tool result carried by a non-tool message', async () => {
    const call = { id: 'b1', name: 'db.create_session', args: {} }
    const operation = { operationId: 'TEST op', call, reason: 'TEST lost' }
    const provider = new FakeProvider([{ text: 'TEST done' }])
    await runKarbotTurn({ provider, systemPrompt: 'TEST',
      messages: [{ role: 'user', text: 'TEST hi', toolResult: { toolCallId: 'b1', toolName: 'db.create_session', content: 'TEST decoy', isError: false } }],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] },
      sink: memorySink().sink, mcp: { listTools: async () => [sessionTool()], callTool: async () => ({ content: 'TEST ok' }) } })
    expect(provider.calls[0]?.messages).toEqual([
      { role: 'user', text: 'TEST hi', toolResult: { toolCallId: 'b1', toolName: 'db.create_session', content: 'TEST decoy', isError: false } },
      { role: 'assistant', toolCalls: [call] },
      { role: 'tool', toolResult: { toolCallId: 'b1', toolName: 'db.create_session', content: 'TEST ok', isError: false } },
    ])
  })

  it('tolerates a tool message without a result payload while splicing a retry', async () => {
    const call = { id: 'b1', name: 'db.create_session', args: {} }
    const operation = { operationId: 'TEST op', call, reason: 'TEST lost' }
    const provider = new FakeProvider([{ text: 'TEST done' }])
    await runKarbotTurn({ provider, systemPrompt: 'TEST',
      messages: [{ role: 'tool' }],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] },
      sink: memorySink().sink, mcp: { listTools: async () => [sessionTool()], callTool: async () => ({ content: 'TEST ok' }) } })
    expect(provider.calls[0]?.messages).toEqual([
      { role: 'tool' },
      { role: 'assistant', toolCalls: [call] },
      { role: 'tool', toolResult: { toolCallId: 'b1', toolName: 'db.create_session', content: 'TEST ok', isError: false } },
    ])
  })

  it('replaces a matching tool message at the head of history in place', async () => {
    const call = { id: 'b1', name: 'db.create_session', args: {} }
    const operation = { operationId: 'TEST op', call, reason: 'TEST lost' }
    const provider = new FakeProvider([{ text: 'TEST done' }])
    await runKarbotTurn({ provider, systemPrompt: 'TEST',
      messages: [{ role: 'tool', toolResult: { toolCallId: 'b1', toolName: 'db.create_session', content: 'TEST stale', isError: true } }],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] },
      sink: memorySink().sink, mcp: { listTools: async () => [sessionTool()], callTool: async () => ({ content: 'TEST fresh' }) } })
    expect(provider.calls[0]?.messages).toEqual([
      { role: 'tool', toolResult: { toolCallId: 'b1', toolName: 'db.create_session', content: 'TEST fresh', isError: false } },
    ])
  })

  it('appends the pair when the assistant calls name a different tool', async () => {
    const other = { id: 'c0', name: 'db.list_sessions', args: {} }
    const call = { id: 'b1', name: 'db.create_session', args: {} }
    const operation = { operationId: 'TEST op', call, reason: 'TEST lost' }
    const provider = new FakeProvider([{ text: 'TEST done' }])
    await runKarbotTurn({ provider, systemPrompt: 'TEST',
      messages: [{ role: 'assistant', toolCalls: [other] }],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] },
      sink: memorySink().sink, mcp: { listTools: async () => [sessionTool()], callTool: async () => ({ content: 'TEST ok' }) } })
    expect(provider.calls[0]?.messages).toEqual([
      { role: 'assistant', toolCalls: [other] },
      { role: 'assistant', toolCalls: [call] },
      { role: 'tool', toolResult: { toolCallId: 'b1', toolName: 'db.create_session', content: 'TEST ok', isError: false } },
    ])
  })

  it('does not match assistant calls carried by a user message', async () => {
    const call = { id: 'b1', name: 'db.create_session', args: {} }
    const operation = { operationId: 'TEST op', call, reason: 'TEST lost' }
    const provider = new FakeProvider([{ text: 'TEST done' }])
    await runKarbotTurn({ provider, systemPrompt: 'TEST',
      messages: [{ role: 'user', text: 'TEST hi', toolCalls: [call] }],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 1, blockedOperations: [operation] },
      sink: memorySink().sink, mcp: { listTools: async () => [sessionTool()], callTool: async () => ({ content: 'TEST ok' }) } })
    expect(provider.calls[0]?.messages).toEqual([
      { role: 'user', text: 'TEST hi', toolCalls: [call] },
      { role: 'assistant', toolCalls: [call] },
      { role: 'tool', toolResult: { toolCallId: 'b1', toolName: 'db.create_session', content: 'TEST ok', isError: false } },
    ])
  })
})

describe('stream abort edges [F:agents.turnRunner.runKarbotTurn]', () => {
  it('stops consuming the moment an abort lands, even mid-iteration', async () => {
    const abort = new AbortController()
    let release: () => void = () => undefined
    let finish: () => void = () => undefined
    let firstSeen: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const ended = new Promise<void>((resolve) => { finish = resolve })
    const first = new Promise<void>((resolve) => { firstSeen = resolve })
    const provider: ProviderAdapter = {
      providerName: 'abort-race-test', chat: async () => { throw new Error('unused') },
      async *chatStream() {
        yield { kind: 'text_delta', text: 'TEST one' }
        firstSeen()
        await gate
        try {
          yield { kind: 'text_delta', text: 'TEST two' }
          yield { kind: 'done', usage: emptyUsage() }
        } finally { finish() }
      },
    }
    const { sink, deltas } = memorySink()
    const pending = runKarbotTurn({ provider, mcp: memoryMcp(), sink, systemPrompt: 'sys', messages: [], signal: abort.signal })
    await first
    // Release then abort with no await between: the queued event hits
    // the aborted check before the race settlement lands, so the loop
    // must break on the signal alone.
    release()
    abort.abort(new Error('TEST owner stopped'))
    await ended
    await expect(pending).rejects.toThrow('TEST owner stopped')
    expect(deltas).toEqual(['TEST one'])
  })

  it('omits the completion key from the pending checkpoint when the provider sends none', async () => {
    const seen: unknown[] = []
    const provider: ProviderAdapter = {
      providerName: 'completion-test', chat: async () => { throw new Error('unused') },
      async *chatStream() { yield { kind: 'text_delta', text: 'TEST hi' }; yield { kind: 'done', usage: emptyUsage() } },
    }
    await runKarbotTurn({ provider, mcp: memoryMcp(), sink: memorySink().sink, systemPrompt: 'sys', messages: [],
      onProviderResponse: async () => undefined,
      onCheckpoint: async (_history, _round, _usage, _tools, _ops, pending) => void seen.push(structuredClone(pending)) })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ response: { text: 'TEST hi' } })
    expect('completion' in (seen[0] as { response: Record<string, unknown> }).response).toBe(false)
  })

  it('checkpoints the original blocked list when a pending response carries calls', async () => {
    const call = { id: 'c1', name: 'db.create_session', args: {} }
    const blocked = [{ operationId: 'TEST op', call, reason: 'TEST lost' }]
    const provider = new FakeProvider([{ text: 'TEST after' }])
    const blockeds: unknown[] = []
    await runKarbotTurn({ provider, systemPrompt: 'TEST', messages: [{ role: 'user', text: 'TEST hi' }],
      resume: { round: 1, usage: emptyUsage(), toolCalls: 0, blockedOperations: blocked, pendingResponse: { round: 1, response: { text: 'TEST pending', reasoning: '', toolCalls: [call], usage: emptyUsage() } } },
      sink: memorySink().sink, mcp: memoryMcp(),
      onCheckpoint: async (_history, _round, _usage, _tools, ops) => void blockeds.push(structuredClone(ops)) })
    expect(blockeds).toContainEqual(blocked)
  })
})
