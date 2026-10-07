// Pure unit tests for karbotTurnActivity over MockActivityEnvironment:
// epoch ownership, continuation resume, chat-ref narrowing, sector context,
// preload, pause mapping, and frame publishing. No database, no Temporal
// server; the one MCP test stubs the transport on loopback.
import { createServer, type Server } from 'node:http'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ApplicationFailure } from '@temporalio/activity'
import { MockActivityEnvironment } from '@temporalio/testing'
import { emptyUsage } from '@kardata/agents'
import { WorkspaceError } from '../../backend/src/db/errors.js'
import { karbotTurnActivity } from '../../backend/src/temporal/activities/turn.js'

type TurnOutcome = Awaited<ReturnType<typeof karbotTurnActivity>>

const compaction = vi.hoisted(() => ({ neededOnce: false }))
vi.mock('@kardata/agents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@kardata/agents')>()
  return {
    ...mod,
    compactContext: (async (...args: unknown[]) => {
      if (compaction.neededOnce) {
        compaction.neededOnce = false
        return { needed: true, summary: { summaryText: 'condensed', coveredSeq: 9 }, view: [{ role: 'user', text: 'hi' }] }
      }
      return (mod.compactContext as (...a: unknown[]) => Promise<unknown>)(...args)
    }) as typeof mod.compactContext,
  }
})

const db = vi.hoisted(() => ({
  pool: {},
  begin: vi.fn(),
  identity: vi.fn(),
  project: vi.fn(),
  inherit: vi.fn(),
  assertFiles: vi.fn(),
  continuation: vi.fn(),
  chatRef: vi.fn(),
  sessionModel: vi.fn(),
  session: vi.fn(),
  sessionKind: vi.fn(),
  settings: vi.fn(),
  references: vi.fn(),
  snapshot: vi.fn(),
  sector: vi.fn(),
  inherited: vi.fn(),
  history: vi.fn(),
  threadContext: vi.fn(),
  saveContext: vi.fn(),
  paused: vi.fn(),
  steering: vi.fn(),
  pendingSteering: vi.fn(),
  finishSteering: vi.fn(),
  saveContinuation: vi.fn(),
  clearContinuation: vi.fn(),
  recordExecution: vi.fn(),
  measure: vi.fn(),
  kb: vi.fn(),
  frame: vi.fn(),
  beat: vi.fn(),
  append: vi.fn(),
  resolveArchive: vi.fn(),
  persistRecord: vi.fn(),
  hydrate: vi.fn(),
  persistSource: vi.fn(),
  archiveOutcome: vi.fn(),
  rounds: vi.fn(),
  toolCalls: vi.fn(),
}))
vi.mock('../../backend/src/db/index.js', async (original) => {
  const mod = await original<typeof import('../../backend/src/db/index.js')>()
  return {
    ...mod,
    workerPoolFromEnv: () => db.pool,
    beginThreadTurn: db.begin,
    readActiveExecutionIdentity: db.identity,
    getSessionModel: db.sessionModel,
    getSession: db.session,
    sessionKind: db.sessionKind,
    getSector: db.sector,
    publishOutboxFrame: db.frame,
    recordHeartbeat: db.beat,
    recordContextMeasurement: db.measure,
    searchKb: db.kb,
    appendEvent: db.append,
    consumeSteering: db.steering,
    hasPendingSteering: db.pendingSteering,
    finishSteering: db.finishSteering,
    readThreadContext: db.threadContext,
    saveThreadContext: db.saveContext,
    readTurnContinuation: db.continuation,
    saveTurnContinuation: db.saveContinuation,
    clearTurnContinuation: db.clearContinuation,
    recordTurnExecution: db.recordExecution,
    workspaceReferences: db.references,
    workspaceReferenceSnapshot: db.snapshot,
  }
})
vi.mock('../../backend/src/db/workspace.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/db/workspace.js')>()),
  readSessionSettings: db.settings,
}))
// Grace timing belongs to the runner unit tests and the F13 fault test;
// these ownership/frame tests shrink the window so quiet rounds settle
// in milliseconds while still polling hasPendingSteering.
vi.mock('../../backend/src/temporal/timeouts.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/temporal/timeouts.js')>()),
  STEER_FOLLOW_UP_GRACE_MS: 50,
}))
vi.mock('../../backend/src/db/workspace-threads.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/db/workspace-threads.js')>()),
  isThreadPaused: db.paused,
  readInheritedContext: db.inherited,
}))
vi.mock('../../backend/src/db/context-files.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/db/context-files.js')>()),
  inheritThreadFileRefs: db.inherit,
  assertThreadFileContext: db.assertFiles,
}))
vi.mock('../../backend/src/projector.js', () => ({ projectNewEvents: db.project }))
vi.mock('../../backend/src/context.js', () => ({ localContextMessages: db.history }))
vi.mock('../../backend/src/temporal/activities/turn-chatrefs.js', () => ({ resolveChatRefTurn: db.chatRef }))
vi.mock('../../backend/src/temporal/activities/turn-rounds.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/temporal/activities/turn-rounds.js')>()),
  createRoundRecorder: () => ({ refs: new Map(), recordRound: db.rounds, recordToolCall: db.toolCalls }),
}))
vi.mock('../../backend/src/archive/targets.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/archive/targets.js')>()),
  resolveArchiveTarget: db.resolveArchive,
  persistExecutionRecord: db.persistRecord,
  hydrateResearchSources: db.hydrate,
  persistResearchSource: db.persistSource,
  archiveResearchOutcome: db.archiveOutcome,
}))

const LEASE = '00000000-0000-4000-8000-000000000001'
const ENV_KEY = 'KARDATA_PROVIDER'
let savedEnv: string | undefined
beforeEach(() => {
  savedEnv = process.env[ENV_KEY]
  process.env[ENV_KEY] = 'fake'
  compaction.neededOnce = false
})
afterEach(() => {
  vi.clearAllMocks()
  if (savedEnv === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = savedEnv
})

function ready() {
  db.begin.mockResolvedValue(LEASE)
  db.identity.mockResolvedValue({ workflowId: null, executionId: null, ownerEpoch: null })
  db.project.mockResolvedValue({ caughtUp: true })
  db.inherit.mockResolvedValue(undefined)
  db.assertFiles.mockResolvedValue(undefined)
  db.continuation.mockResolvedValue(null)
  db.chatRef.mockResolvedValue(null)
  db.sessionModel.mockResolvedValue(undefined)
  db.session.mockResolvedValue({ id: 'sess-1', sectorId: 'sec-1' })
  db.sessionKind.mockRejectedValue(new Error('kind store down'))
  db.settings.mockResolvedValue({ useGlobalContext: true, purpose: 'chat' })
  db.references.mockResolvedValue(['sector digest'])
  db.snapshot.mockResolvedValue({ references: ['r1'], contextVersion: 2, planVersion: null })
  db.sector.mockResolvedValue({ id: 'sec-1', name: 'Optics' })
  db.inherited.mockResolvedValue('')
  db.history.mockResolvedValue({ messages: [] })
  db.threadContext.mockResolvedValue({ version: 3, notes: '' })
  db.paused.mockResolvedValue(false)
  db.steering.mockResolvedValue([])
  db.pendingSteering.mockResolvedValue(false)
  db.saveContinuation.mockResolvedValue(undefined)
  db.clearContinuation.mockResolvedValue(undefined)
  db.recordExecution.mockResolvedValue(undefined)
  db.measure.mockResolvedValue(undefined)
  db.kb.mockResolvedValue([])
  db.frame.mockResolvedValue(undefined)
  db.beat.mockResolvedValue(undefined)
  db.append.mockResolvedValue({ seq: 1 })
  db.resolveArchive.mockReturnValue({})
  db.persistRecord.mockResolvedValue({ key: 'exec-key-1' })
  db.hydrate.mockImplementation(async (_archive: unknown, _session: string, outcome: unknown) => ({ ...(outcome as object), sources: [{ url: 'https://prior.test/', text: 'prior source text' }] }))
  db.archiveOutcome.mockImplementation(async (_archive: unknown, _session: string, outcome: unknown) => ({ ...(outcome as object), sourceRefs: [] }))
  db.rounds.mockResolvedValue(undefined)
  db.toolCalls.mockResolvedValue(undefined)
}
function input(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'sess-1', threadKey: 'sess-1', runKey: 'karbot:sess-1:0', text: 'hello karbot',
    fakeSteps: [{ text: 'hi there' }],
    ...overrides,
  }
}
function frames(kind: string) {
  return db.frame.mock.calls.filter((call) => call[2] === kind).map((call) => call[3])
}

describe('karbotTurnActivity ownership [F:backend.activity.turn.karbotTurnActivity] [F:backend.activity.turn.executeKarbotTurn] [F:backend.activity.turn.ResearchPausedError] [F:backend.activity.turn.sleep] [F:backend.activity.turn.turnSectorRefs] [F:backend.activity.turn.turnContextSnapshot] [F:backend.activity.turn.selectTurnContinuation]', () => {
  it('binds the epoch owner from actual workflow identity', async () => {
    ready()
    const outcome = (await new MockActivityEnvironment().run(karbotTurnActivity, input({ ownerEpoch: '00000000-0000-4000-8000-000000000009', ownerFirstExecutionId: 'exec-1' }))) as TurnOutcome
    expect(outcome.reply).toBe('hi there')
    expect(db.begin).toHaveBeenCalledWith(db.pool, 'sess-1', 'karbot:sess-1:0', {
      epoch: '00000000-0000-4000-8000-000000000009',
      firstExecutionId: 'exec-1',
      workflowId: 'test',
      executionId: '00000000-0000-0000-0000-000000000000',
      threadKey: 'sess-1',
      sessionId: 'sess-1',
    }, undefined)
  })
  it('fails fast when the turn session is gone', async () => {
    ready()
    db.session.mockResolvedValue(null)
    await expect(new MockActivityEnvironment().run(karbotTurnActivity, input())).rejects.toThrow('Turn session is unavailable')
    expect(db.finishSteering).toHaveBeenCalledWith(db.pool, 'sess-1', 'karbot:sess-1:0', LEASE)
  })
})

describe('karbotTurnActivity full turn', () => {
  it('resumes prior sources, narrows chat grants, and publishes every frame', async () => {
    ready()
    db.continuation.mockResolvedValue({
      user: 'hello karbot', runKey: 'karbot:sess-1:0',
      messages: [{ role: 'user', text: 'hello karbot' }],
      sources: [{ url: 'https://prior.test/', key: 'k', hash: 'h' }],
      meta: { round: 1, usage: emptyUsage(), toolCalls: 0, elapsedMs: 0 },
    })
    db.chatRef.mockResolvedValue({ toolAllow: ['db.list_sessions', 'db.other'], chunks: ['chat chunk'] })
    const outcome = (await new MockActivityEnvironment().run(
      karbotTurnActivity,
      input({
        toolAllow: ['db.list_sessions'],
        fakeSteps: [
          { text: 'checking ', toolCalls: [{ id: 'c1', name: 'db.list_sessions', args: {} }] },
          { text: 'final answer' },
        ],
      }),
    )) as TurnOutcome
    expect(outcome.reply).toContain('final')
    expect(outcome.toolCalls).toEqual([{ name: 'db.list_sessions', detail: 'mcp:db.list_sessions', state: 'failed' }])
    expect(frames('delta').length).toBeGreaterThan(0)
    expect(frames('tool').map((frame) => (frame as { name: string }).name)).toContain('db.list_sessions')
    expect(db.append).toHaveBeenCalledWith(db.pool, expect.objectContaining({ partition: 'session:sess-1', type: 't.turn.sources_archived' }))
    expect(db.clearContinuation).toHaveBeenCalledWith(db.pool, 'sess-1', LEASE)
    expect(db.finishSteering).toHaveBeenCalledWith(db.pool, 'sess-1', 'karbot:sess-1:0', LEASE)
    expect(db.rounds).toHaveBeenCalled()
  })
  it('preloads brainstorm turns from the knowledge corpus', async () => {
    ready()
    db.kb.mockResolvedValue([{ sourcePath: 'notes.md', text: 'corpus fact' }])
    const outcome = (await new MockActivityEnvironment().run(karbotTurnActivity, input({ mode: 'brainstorm' }))) as TurnOutcome
    expect(outcome.reply).toBe('hi there')
    expect(db.kb).toHaveBeenCalledWith(db.pool, 'hello karbot', 3)
  })
  it('runs brainstorm turns on without preload when search misses', async () => {
    ready()
    db.kb.mockRejectedValue(new Error('index down'))
    const outcome = (await new MockActivityEnvironment().run(karbotTurnActivity, input({ mode: 'brainstorm' }))) as TurnOutcome
    expect(outcome.reply).toBe('hi there')
  })
  it('maps an unsettled shared context to a blocked turn', async () => {
    ready()
    db.snapshot.mockRejectedValue(new WorkspaceError('conflict', 'version moved'))
    const error = await new MockActivityEnvironment().run(karbotTurnActivity, input()).then(() => null, (e: unknown) => e as InstanceType<typeof ApplicationFailure>)
    expect(error).toBeInstanceOf(ApplicationFailure)
    expect(error?.type).toBe('ContextBlocked')
    expect(error?.message).toContain('Shared context could not settle')
  })
  it('maps an owner pause to a non-retryable pause', async () => {
    ready()
    db.paused.mockResolvedValue(true)
    const error = await new MockActivityEnvironment().run(karbotTurnActivity, input()).then(() => null, (e: unknown) => e as InstanceType<typeof ApplicationFailure>)
    expect(error).toBeInstanceOf(ApplicationFailure)
    expect(error?.type).toBe('ResearchPaused')
  })
  it('persists the compaction summary across the activity seam', async () => {
    ready()
    compaction.neededOnce = true
    const outcome = (await new MockActivityEnvironment().run(karbotTurnActivity, input())) as TurnOutcome
    expect(outcome.reply).toBe('hi there')
    expect(db.saveContext).toHaveBeenCalledWith(db.pool, 'sess-1', { version: 3, summary: 'condensed', coveredSeq: 9 }, undefined, LEASE)
  })
  it('denies skill-grant-external tool calls before they reach the server', async () => {
    ready()
    const methods: string[] = []
    const tools = [
      { name: 'db.list_sessions', description: 'list', inputSchema: { type: 'object', properties: {}, required: [] } },
      { name: 'db.other', description: 'other', inputSchema: { type: 'object', properties: {}, required: [] } },
    ]
    const server: Server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
      req.on('end', () => {
        const rpc = JSON.parse(body) as { id: unknown; method: string }
        methods.push(rpc.method)
        const result = rpc.method === 'tools/list' ? { tools } : {}
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('stub did not bind')
      const outcome = (await new MockActivityEnvironment().run(
        karbotTurnActivity,
        input({
          mcpEndpoint: `http://127.0.0.1:${address.port}/mcp`,
          mcpToken: 'stub-token',
          toolAllow: ['db.list_sessions'],
          fakeSteps: [
            { text: 'trying ', toolCalls: [{ id: 'c1', name: 'db.other', args: {} }] },
            { text: 'done' },
          ],
        }),
      )) as TurnOutcome
      expect(outcome.reply).toBe('done')
      expect(outcome.toolCalls).toEqual([{ name: 'db.other', detail: 'mcp:db.other', state: 'failed' }])
      expect(methods).toContain('tools/list')
      expect(methods).not.toContain('tools/call')
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })
})
