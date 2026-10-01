// Karbot turn activity (Phase 3). executeKarbotTurn over injected doubles —
// no Temporal worker, no database, no network: per-session model wins, env
// fallback resolves the fake, deltas reach the sink, logs stay key-free.
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  executeKarbotTurn,
  chatHistory,
  KARBOT_SYSTEM_PROMPT,
  productMcpClient,
  RESEARCH_TURN_WALL_MS,
  sectorMcpClient,
  SECTOR_TOOLS,
  type KarbotTurnDeps,
  type KarbotTurnInput,
  type KarbotTurnLogFields,
} from '../../backend/src/temporal/activities/turn.js'
import type { ProviderSelection } from '../../backend/src/providers/gateway.js'
import type { SessionModelSelection } from '../../backend/src/db/index.js'
import {
  FakeProvider,
  type ProviderAdapter,
  type TurnRunnerMcpClient,
  type ToolDefinition,
} from '@kardata/agents'

function tool(): ToolDefinition {
  return {
    name: 'db.list_sessions',
    description: 'List sessions.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  }
}

interface MemoryWorld {
  deps: KarbotTurnDeps
  deltas: Array<{ threadKey: string; runKey: string; text: string }>
  reasoningFrames: Array<{ threadKey: string; runKey: string; text: string }>
  toolFrames: Array<{ threadKey: string; runKey: string; id: string; name: string; state: string }>
  logs: KarbotTurnLogFields[]
  seenSelections: Array<{ selection: ProviderSelection; model?: string }>
  adapter: FakeProvider
}

function memoryWorld(adapter: FakeProvider, stored?: SessionModelSelection): MemoryWorld {
  const deltas: MemoryWorld['deltas'] = []
  const reasoningFrames: MemoryWorld['reasoningFrames'] = []
  const toolFrames: MemoryWorld['toolFrames'] = []
  const logs: KarbotTurnLogFields[] = []
  const seenSelections: MemoryWorld['seenSelections'] = []
  const mcp: TurnRunnerMcpClient = {
    async listTools(): Promise<ToolDefinition[]> {
      return [tool()]
    },
    async callTool(name: string): Promise<{ content: string; isError?: boolean }> {
      return { content: `rows for ${name}` }
    },
  }
  const deps: KarbotTurnDeps = {
    async loadSessionModel(): Promise<SessionModelSelection | undefined> {
      return stored
    },
    async loadHistory() {
      return []
    },
    resolveTurnAdapter(selection: ProviderSelection, options: { model?: string }): ProviderAdapter {
      seenSelections.push({ selection, model: options.model })
      return adapter
    },
    mcp,
    async publishDelta(delta: { threadKey: string; runKey: string; text: string }): Promise<void> {
      deltas.push(delta)
    },
    async publishReasoning(delta: { threadKey: string; runKey: string; text: string }): Promise<void> {
      reasoningFrames.push(delta)
    },
    async publishTool(frame) { toolFrames.push(frame) },
    log(fields: KarbotTurnLogFields): void {
      logs.push(fields)
    },
  }
  return { deps, deltas, reasoningFrames, toolFrames, logs, seenSelections, adapter }
}

function input(overrides: Partial<KarbotTurnInput> = {}): KarbotTurnInput {
  return {
    sessionId: 'sess-1',
    threadKey: 'sess-1',
    runKey: 'karbot:sess-1:0',
    text: 'hello karbot',
    ...overrides,
  }
}

const ENV_KEY = 'KARDATA_PROVIDER'
let savedEnv: string | undefined

beforeEach(() => {
  savedEnv = process.env[ENV_KEY]
  process.env[ENV_KEY] = 'fake'
})

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = savedEnv
})

describe('executeKarbotTurn', () => {
  it('uses Contributor at high effort for an unbound session', async () => {
    process.env[ENV_KEY] = 'meta'
    const world = memoryWorld(new FakeProvider([{ text: 'ready' }]))
    await executeKarbotTurn(input(), world.deps)
    expect(world.seenSelections).toEqual([{ selection: 'meta', model: 'muse-spark-1.3-contributor' }])
    expect(world.adapter.calls[0]?.reasoningEffort).toBe('high')
  })
  it('brainstorm mode adds posture, low effort, temperature, and KB preload', async () => {
    const world = memoryWorld(new FakeProvider([{ text: 'ideas' }]))
    let preloadCalls = 0
    world.deps.loadPreload = async () => {
      preloadCalls += 1
      return ['[pricing.md] band entry']
    }
    await executeKarbotTurn(input({ mode: 'brainstorm' }), world.deps)
    const call = world.adapter.calls[0]
    expect(call?.systemPrompt).toContain('thought partner')
    expect(call?.systemPrompt).toContain('[pricing.md] band entry')
    expect(call?.reasoningEffort).toBe('low')
    expect(call?.temperature).toBe(0.9)
    expect(preloadCalls).toBe(1)
  })

  it('default mode sends no posture, temperature, or preload', async () => {
    const world = memoryWorld(new FakeProvider([{ text: 'ready' }]))
    let preloadCalls = 0
    world.deps.loadPreload = async () => {
      preloadCalls += 1
      return ['chunk']
    }
    await executeKarbotTurn(input(), world.deps)
    const call = world.adapter.calls[0]
    expect(call?.systemPrompt).not.toContain('thought partner')
    expect(call?.temperature).toBeUndefined()
    expect(preloadCalls).toBe(0)
  })

  it('threads skill prepend and preloaded chunks through the prompt seam in order', async () => {
    const world = memoryWorld(new FakeProvider([{ text: 'ready' }]))
    await executeKarbotTurn(
      input({ systemPrepend: ['skill: brainstorm sectors'], preloadChunks: ['pricing band entry'] }),
      world.deps,
    )
    const prompt = world.adapter.calls[0]?.systemPrompt ?? ''
    expect(prompt.startsWith(KARBOT_SYSTEM_PROMPT)).toBe(true)
    const skill = prompt.indexOf('skill: brainstorm sectors')
    const refs = prompt.indexOf('Reference material')
    const chunk = prompt.indexOf('pricing band entry')
    expect(skill).toBeGreaterThan(KARBOT_SYSTEM_PROMPT.length)
    expect(refs).toBeGreaterThan(skill)
    expect(chunk).toBeGreaterThan(refs)
  })
  it('advertises web search, fetch, and browser tools to Karbot', async () => {
    const calls: string[] = []
    const names = [
      'web_search',
      'web_fetch',
      'browser_navigate',
      'browser_snapshot',
      'browser_act',
      'browser_close',
      'browser_screenshot',
      'db.find_key',
    ]
    const client = productMcpClient({
      async listTools() {
        return names.map((name) => ({ ...tool(), name }))
      },
      async callTool(name) { calls.push(name); return { content: 'ok' } },
    })
    const listed = (await client.listTools()).map((entry) => entry.name)
    for (const name of names.slice(0, 7)) expect(listed).toContain(name)
    expect(await client.callTool('web_search', { query: 'acme foods' })).toMatchObject({ content: 'ok' })
    expect(await client.callTool('browser_navigate', { url: 'https://example.com' })).toMatchObject({ content: 'ok' })
    expect(await client.callTool('db.find_key', {})).toMatchObject({ isError: true })
    expect(calls).toEqual(['web_search', 'browser_navigate'])
  })
  it('advertises product tools without operational database plumbing', async () => {
    const calls: string[] = []
    const client = productMcpClient({
      async listTools() { return [tool(), { ...tool(), name: 'db.find_key' }] },
      async callTool(name) { calls.push(name); return { content: 'ok' } },
    })
    expect((await client.listTools()).map((entry) => entry.name)).toEqual(['db.list_sessions'])
    expect(await client.callTool('db.find_key', {})).toMatchObject({ isError: true })
    expect(calls).toEqual([])
  })
  it('uses recent conversation context and keeps the current message once', async () => {
    const world = memoryWorld(new FakeProvider([{ text: 'The sector is paused.' }]))
    world.deps.loadHistory = async () => chatHistory([
      { kind: 'text', payload: { role: 'user', text: 'Tell me about sector A' } },
      { kind: 'tool', payload: { name: 'db.get_sector', detail: 'raw result' } },
      { kind: 'text', payload: { role: 'agent', text: 'Sector A is paused.' } },
      { kind: 'text', payload: { role: 'user', text: 'What did you say?' } },
    ], 'What did you say?').slice(0, -1)
    await executeKarbotTurn(input({ text: 'What did you say?' }), world.deps)
    expect(world.adapter.calls[0]?.messages).toEqual([
      { role: 'user', text: 'Tell me about sector A' },
      { role: 'assistant', text: 'Sector A is paused.' },
      { role: 'user', text: 'What did you say?' },
    ])
  })
  it('streams the fake reply, runs MCP tools, and publishes deltas', async () => {
    const world = memoryWorld(
      new FakeProvider([
        { text: 'checking ', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }] },
        { text: 'done' },
      ]),
    )
    const outcome = await executeKarbotTurn(input(), world.deps)
    expect(outcome.reply).toBe('done')
    expect(outcome.toolCalls).toEqual([{ name: 'db.list_sessions', detail: 'mcp:db.list_sessions', state: 'done' }])
    expect(world.deltas.map((delta) => delta.text).join('')).toBe('checking done')
    expect(world.deltas.map((delta) => delta.runKey)).toEqual(['karbot:sess-1:0:1', 'karbot:sess-1:0:2'])
    expect(world.toolFrames).toEqual([
      { threadKey: 'sess-1', runKey: 'karbot:sess-1:0:1', id: 'c1', name: 'Tool call', state: 'running' },
      { threadKey: 'sess-1', runKey: 'karbot:sess-1:0:1', id: 'c1', name: 'db.list_sessions', state: 'running' },
      { threadKey: 'sess-1', runKey: 'karbot:sess-1:0:1', id: 'c1', name: 'db.list_sessions', state: 'done' },
    ])
    expect(world.seenSelections).toEqual([{ selection: 'fake', model: undefined }])
    expect(world.logs).toEqual([
      expect.objectContaining({ op: 'karbot.turn', provider: 'fake', ok: true, turns: 2 }),
    ])
  })

  it('logs first-frame timings for tool, reasoning, and text', async () => {
    const world = memoryWorld(
      new FakeProvider([
        { text: 'checking ', reasoning: 'weighing', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }] },
        { text: 'done' },
      ]),
    )
    await executeKarbotTurn(input(), world.deps)
    expect(world.logs).toEqual([
      expect.objectContaining({
        op: 'karbot.turn',
        ok: true,
        firstToolMs: expect.any(Number),
        firstReasoningMs: expect.any(Number),
        firstDeltaMs: expect.any(Number),
      }),
    ])
    const entry = world.logs[0] as { firstToolMs: number; firstReasoningMs: number; firstDeltaMs: number }
    expect(entry.firstToolMs).toBeGreaterThanOrEqual(0)
    expect(entry.firstReasoningMs).toBeGreaterThanOrEqual(0)
    expect(entry.firstDeltaMs).toBeGreaterThanOrEqual(0)
  })

  it('prefers the stored per-session model over env', async () => {
    const world = memoryWorld(new FakeProvider([{ text: 'pinned' }]), {
      provider: 'meta',
      model: 'muse-spark-1.3',
      reasoning: true,
      effort: 'low',
    })
    const outcome = await executeKarbotTurn(input(), world.deps)
    expect(outcome.reply).toBe('pinned')
    expect(world.seenSelections).toEqual([{ selection: 'meta', model: 'muse-spark-1.3' }])
    expect(world.logs[0]).toMatchObject({ provider: 'meta', ok: true })
  })

  it('streams thinking trace to reasoning frames and the outcome', async () => {
    const adapter = new FakeProvider([{ text: 'done', reasoning: 'weighing options' }])
    const world = memoryWorld(adapter)
    const outcome = await executeKarbotTurn(input(), world.deps)
    expect(outcome.reply).toBe('done')
    expect(outcome.reasoning).toBe('weighing options')
    expect(world.reasoningFrames).toMatchObject([{ runKey: 'karbot:sess-1:0:1', text: 'weighing options' }])
    // Thinking never leaks into reply deltas.
    expect(world.deltas.map((delta) => delta.text).join('')).toBe('done')
  })

  it('carries the stored effort level into the provider request', async () => {
    const adapter = new FakeProvider([{ text: 'leveled' }])
    const world = memoryWorld(adapter, {
      provider: 'meta',
      model: 'muse-spark-1.3',
      reasoning: true,
      effort: 'high',
    })
    const outcome = await executeKarbotTurn(input(), world.deps)
    expect(outcome.reply).toBe('leveled')
    expect(adapter.calls.map((call) => call.reasoningEffort)).toEqual(['high'])
  })

  it('contracts house markdown output in the system prompt', () => {
    expect(KARBOT_SYSTEM_PROMPT).toContain('GitHub-flavored Markdown')
    expect(KARBOT_SYSTEM_PROMPT).toContain('No raw HTML')
  })

  it('contracts tool-failure honesty in the system prompt', () => {
    expect(KARBOT_SYSTEM_PROMPT).toContain('that failure is a source gap')
    expect(KARBOT_SYSTEM_PROMPT).toContain('never fill the gap from parametric knowledge')
  })

  it('contracts sector-evidence verification in the system prompt', () => {
    expect(KARBOT_SYSTEM_PROMPT).toContain('call db.get_sector or db.list_sector_documents first')
    expect(KARBOT_SYSTEM_PROMPT).toContain('call db.read_sector_document for that document id and quote its text')
    expect(KARBOT_SYSTEM_PROMPT).toContain('The list carries record metadata only, never file text')
    expect(KARBOT_SYSTEM_PROMPT).toContain('Never invent digest versions')
  })

  it('keeps logs key-free: no prompt, reply, or token material', async () => {
    const world = memoryWorld(new FakeProvider([{ text: 'secret reply text' }]))
    await executeKarbotTurn(input({ text: 'secret prompt text', mcpToken: 'scoped-token-xyz' }), world.deps)
    const dumped = JSON.stringify(world.logs)
    expect(dumped).not.toContain('secret reply text')
    expect(dumped).not.toContain('secret prompt text')
    expect(dumped).not.toContain('scoped-token-xyz')
  })

  it('maps resolution failure to a code-only error plus a typed log', async () => {
    const world = memoryWorld(new FakeProvider([]))
    world.deps.resolveTurnAdapter = () => {
      throw new Error('router selected but no provider key is set')
    }
    await expect(executeKarbotTurn(input(), world.deps)).rejects.toThrow('karbot turn unconfigured')
    expect(world.logs).toEqual([
      expect.objectContaining({ op: 'karbot.turn', ok: false, code: 'provider_unconfigured' }),
    ])
  })

  it('rejects invalid input before touching the provider', async () => {
    const adapter = new FakeProvider([{ text: 'x' }])
    const world = memoryWorld(adapter)
    await expect(executeKarbotTurn(input({ text: '' }), world.deps)).rejects.toThrow()
    expect(adapter.remaining).toBe(1)
    expect(world.logs).toEqual([])
  })

  it('rides sector digest and file units through the prompt seam', async () => {
    const adapter = new FakeProvider([{ text: 'grounded' }])
    const world = memoryWorld(adapter)
    world.deps.loadSessionSector = async () => 'sec-1'
    world.deps.loadSectorRefs = async (sectorId: string) => {
      expect(sectorId).toBe('sec-1')
      return ['Sector Optics (running): Lenses. Documents: lenses.md (indexed). Notes: 0.', '[lenses.md:0] Lens fact.']
    }
    const outcome = await executeKarbotTurn(input(), world.deps)
    expect(outcome.reply).toBe('grounded')
    const sent = world.adapter.calls[0]
    expect(sent?.systemPrompt).toContain('Sector Optics (running): Lenses.')
    expect(sent?.systemPrompt).toContain('[lenses.md:0] Lens fact.')
  })

  it('runs general sessions with no sector context', async () => {
    const adapter = new FakeProvider([{ text: 'hi' }])
    const world = memoryWorld(adapter)
    await executeKarbotTurn(input(), world.deps)
    expect(world.adapter.calls[0]?.systemPrompt).not.toContain('[digest:')
  })

  it('halts a repeating tool loop and reports a halt notice', async () => {
    const call = { id: 'c1', name: 'db.list_sessions', args: {} }
    const world = memoryWorld(
      new FakeProvider([
        { text: 'a', toolCalls: [call] },
        { text: 'b', toolCalls: [{ ...call, id: 'c2' }] },
        { text: 'c', toolCalls: [{ ...call, id: 'c3' }] },
        { text: 'unreached' },
      ]),
    )
    const outcome = await executeKarbotTurn(input(), world.deps)
    expect(outcome.haltNotice).toContain("repeated the 'db.list_sessions' call")
    expect(world.adapter.remaining).toBe(1)
    expect(world.logs).toEqual([
      expect.objectContaining({ op: 'karbot.turn', ok: true, code: 'repetition_halt' }),
    ])
  })

  it('condenses long histories through the adapter summarizer and logs lineage', async () => {
    const world = memoryWorld(
      new FakeProvider([{ text: 'earlier summary' }, { text: 'done' }]),
    )
    world.deps.loadHistory = async () =>
      Array.from({ length: 35 }, (_, index) => ({ role: 'user' as const, text: `m${index} ${'source evidence '.repeat(700)}` }))
    const outcome = await executeKarbotTurn(input(), world.deps)
    expect(outcome.reply).toBe('done')
    // One summarizer chat plus one condensed turn stream.
    expect(world.adapter.calls).toHaveLength(2)
    const sent = world.adapter.calls[1]?.messages ?? []
    expect(sent.length).toBeLessThan(36)
    expect(sent.some((message) => message.text?.includes('earlier summary'))).toBe(true)
    expect(world.logs).toEqual([
      expect.objectContaining({
        op: 'karbot.turn',
        ok: true,
        condensedCount: 1,
        snapshotRounds: 1,
        snapshotHead: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    ])
  })
})

describe('sectorMcpClient', () => {
  function wideClient(seen: string[]): TurnRunnerMcpClient {
    return {
      async listTools() {
        return ['db.get_sector', 'db.create_sector', 'db.ledger_record_problem', 'db.kb_search', 'db.list_sessions'].map(
          (name): ToolDefinition => ({
            name,
            description: name,
            parameters: { type: 'object', properties: {}, additionalProperties: false },
          }),
        )
      },
      async callTool(name: string) {
        seen.push(name)
        return { content: `rows for ${name}` }
      },
    }
  }

  it('lists only sector tools and blocks the rest without calling through', async () => {
    const seen: string[] = []
    const client = sectorMcpClient(wideClient(seen))
    const listed = (await client.listTools()).map((tool) => tool.name).sort()
    expect(listed).toEqual(['db.get_sector', 'db.kb_search'])
    expect(await client.callTool('db.get_sector', {})).toMatchObject({ content: 'rows for db.get_sector' })
    for (const blocked of ['db.create_sector', 'db.ledger_record_problem', 'db.list_sessions']) {
      const result = await client.callTool(blocked, {})
      expect(result.isError).toBe(true)
      expect(result.content).toContain('unavailable in sector chats')
    }
    expect(seen).toEqual(['db.get_sector'])
  })

  it('every sector tool survives the production stacking order', async () => {
    // Production stacks sectorMcpClient(productMcpClient(transport)): a
    // sector tool missing from the Karbot palette would list but never run.
    const seen: string[] = []
    const transport: TurnRunnerMcpClient = {
      async listTools() {
        return [...SECTOR_TOOLS].map(
          (name): ToolDefinition => ({
            name,
            description: name,
            parameters: { type: 'object', properties: {}, additionalProperties: false },
          }),
        )
      },
      async callTool(name: string) {
        seen.push(name)
        return { content: `rows for ${name}` }
      },
    }
    const stacked = sectorMcpClient(productMcpClient(transport))
    const listed = (await stacked.listTools()).map((tool) => tool.name).sort()
    expect(listed).toEqual([...SECTOR_TOOLS].sort())
    for (const name of SECTOR_TOOLS) {
      const result = await stacked.callTool(name, {})
      expect(result.isError !== true, name).toBe(true)
    }
    expect(seen.sort()).toEqual([...SECTOR_TOOLS].sort())
  })
})

describe('research turn wall budget', () => {
  it('allows deep research turns past the old 5-minute cut', () => {
    // Pilot evidence: successful research turns ran 160–327 s; the 300 s
    // wall cut the tail. Ten minutes covers measured research with
    // headroom; interactive turns rarely approach either bound.
    expect(RESEARCH_TURN_WALL_MS).toBe(600_000)
  })
})


describe('durable normalized execution records', () => {
  it('records the exact refreshed input and source context versions each round', async () => {
    const world = memoryWorld(new FakeProvider([{ text: 'TEST stored answer' }]))
    const records: Array<{ round: number; kind: string; record: Record<string, unknown> }> = []
    world.deps.refreshContext = async () => ({ references: ['TEST reviewed findings'], notes: 'TEST local notes', steering: ['TEST steer'], contextVersion: 7, planVersion: 3, localVersion: 11 })
    world.deps.persistExecution = async (round, kind, record) => { records.push({ round, kind, record }) }
    await executeKarbotTurn(input(), world.deps)
    expect(records.map((entry) => entry.kind)).toEqual(['request','response'])
    expect(records[0]?.record).toMatchObject({ version: 1, provider: 'fake', model: null, round: 1, boundary: { contextVersion: 7, planVersion: 3, localVersion: 11 } })
    const { signal: _signal, ...request } = world.adapter.calls[0]!
    expect(records[0]?.record['data']).toEqual(request)
    expect(JSON.stringify(records)).not.toContain('mcpToken')
  })
  it('parks storage failure before provider execution with a recoverable context error', async () => {
    const world = memoryWorld(new FakeProvider([{ text: 'TEST must not run' }]))
    world.deps.persistExecution = async () => { throw new Error('TEST archive failed') }
    await expect(executeKarbotTurn(input(), world.deps)).rejects.toThrow('Execution content could not be durably recorded')
    expect(world.adapter.calls).toHaveLength(0)
  })
})
