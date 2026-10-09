// Pure unit tests for executeKarbotTurn branches: recovery selection,
// resume replay, pause boundaries, compaction journaling, and web sources.
// No database, no Temporal server, no provider network.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { executeKarbotTurn, sleep } from '../../backend/src/temporal/activities/turn.js'
import type { KarbotTurnDeps, KarbotTurnInput } from '../../backend/src/temporal/activities/karbot-turn-input.js'
import { ResearchPausedError } from '../../backend/src/temporal/activities/turn.js'
import { ContextBudgetError, FakeProvider, emptyUsage, type ProviderAdapter } from '@kardata/agents'

const compaction = vi.hoisted(() => ({ mode: 'original' as 'original' | 'throw' | 'needed', calls: 0 }))
vi.mock('@kardata/agents', async (importOriginal) => {
  const original = await importOriginal<typeof import('@kardata/agents')>()
  return {
    ...original,
    compactContext: (async (...args: unknown[]) => {
      compaction.calls += 1
      if (compaction.mode === 'throw') throw new Error('summarizer down')
      if (compaction.mode === 'needed' && compaction.calls === 1) {
        return { needed: true, summary: { summaryText: 'condensed memory', coveredSeq: 5 }, view: [{ role: 'user', text: 'hi' }] }
      }
      return (original.compactContext as (...a: unknown[]) => Promise<unknown>)(...args)
    }) as typeof original.compactContext,
  }
})

const ENV_KEY = 'KARDATA_PROVIDER'
let savedEnv: string | undefined
beforeEach(() => {
  savedEnv = process.env[ENV_KEY]
  process.env[ENV_KEY] = 'fake'
  compaction.mode = 'original'
  compaction.calls = 0
})
afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = savedEnv
})

function memoryDeps(adapter: FakeProvider): { deps: KarbotTurnDeps; logs: unknown[]; adapter: FakeProvider } {
  const logs: unknown[] = []
  const deps: KarbotTurnDeps = {
    loadSessionModel: async () => undefined,
    loadHistory: async () => [],
    resolveTurnAdapter: () => adapter as unknown as ProviderAdapter,
    mcp: { listTools: async () => [], callTool: async () => ({ content: '' }) },
    publishDelta: async () => {},
    publishReasoning: async () => {},
    publishTool: async () => {},
    log: (fields) => { logs.push(fields) },
  }
  return { deps, logs, adapter }
}
function input(overrides: Partial<KarbotTurnInput> = {}): KarbotTurnInput {
  return { sessionId: 'sess-1', threadKey: 'sess-1', runKey: 'karbot:sess-1:0', text: 'hello', ...overrides }
}

describe('turn sleep and session-kind fallback [F:backend.activity.turn.executeKarbotTurn] [F:backend.activity.turn.sleep] [F:backend.activity.turn.ResearchPausedError]', () => {
  it('resolves immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(sleep(10_000, controller.signal)).resolves.toBeUndefined()
    await expect(sleep(5)).resolves.toBeUndefined()
  })
  it('falls back to the chat budget when the session kind is unreadable', async () => {
    const world = memoryDeps(new FakeProvider([{ text: 'ok' }]))
    world.deps.loadSessionKind = async () => { throw new Error('kind store down') }
    const outcome = await executeKarbotTurn(input({ fakeSteps: [{ text: 'ok' }] }), world.deps)
    expect(outcome.reply).toBe('ok')
  })
})

describe('turn recovery selection', () => {
  function recoveryInput(selection: { provider: 'meta' | 'fake'; model: string | null; reasoningEffort?: string }) {
    return input({
      recovery: {
        runKey: 'karbot:sess-1:0', text: 'hello', checkpointHash: 'ab'.repeat(32),
        allowedTools: [], originalInput: {},
        selection,
      },
    })
  }
  it('fails fast on an unknown original model profile', async () => {
    const world = memoryDeps(new FakeProvider([{ text: 'unused' }]))
    const error = await executeKarbotTurn(recoveryInput({ provider: 'meta', model: 'no-such-model' }), world.deps).then(() => null, (e: unknown) => e as Error)
    expect(error?.message).toContain('karbot turn unconfigured')
    expect(String((error?.cause as Error)?.message)).toBe('Original model profile is unavailable.')
    expect(world.adapter.remaining).toBe(1)
  })
  it('fails fast on an unknown original reasoning profile', async () => {
    const world = memoryDeps(new FakeProvider([{ text: 'unused' }]))
    const error = await executeKarbotTurn(recoveryInput({ provider: 'meta', model: 'muse-spark-1.3', reasoningEffort: 'bogus-effort' }), world.deps).then(() => null, (e: unknown) => e as Error)
    expect(error?.message).toContain('karbot turn unconfigured')
    expect(String((error?.cause as Error)?.message)).toBe('Original reasoning profile is unavailable.')
  })
})

describe('turn resume replay', () => {
  it('re-records a carried pending response without re-calling the provider', async () => {
    const world = memoryDeps(new FakeProvider([]))
    const records: Array<{ round: number; kind: string; record: Record<string, unknown> }> = []
    world.deps.persistExecution = async (round, kind, record) => { records.push({ round, kind, record }) }
    world.deps.loadContinuation = async () => ({
      messages: [{ role: 'assistant', text: 'prior work' }],
      runKey: 'karbot:sess-1:0',
      sources: [],
      meta: {
        round: 1, usage: emptyUsage(), toolCalls: 0, elapsedMs: 0,
        pendingResponse: {
          round: 1,
          response: { text: 'paid answer', reasoning: '', toolCalls: [], usage: emptyUsage(), completion: 'complete' },
          metadata: { version: 1, provider: 'fake', model: null, round: 1, boundary: {} },
        },
      },
    })
    const outcome = await executeKarbotTurn(input(), world.deps)
    expect(outcome.reply).toBe('paid answer')
    expect(world.adapter.calls).toHaveLength(0)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ round: 1, kind: 'response' })
    expect(records[0]?.record).toMatchObject({ version: 1, provider: 'fake', round: 1, roundKind: 'turn', data: expect.objectContaining({ text: 'paid answer' }) })
  })
})

describe('turn pause and compaction boundaries', () => {
  it('stops at a safe provider boundary when research pauses', async () => {
    const world = memoryDeps(new FakeProvider([{ text: 'unused' }]))
    world.deps.refreshContext = async () => ({ references: [], notes: '', steering: [], paused: true, localVersion: 0 })
    await expect(executeKarbotTurn(input({ fakeSteps: [{ text: 'unused' }] }), world.deps)).rejects.toBeInstanceOf(ResearchPausedError)
  })
  it('journals a compaction failure as an error round before aborting', async () => {
    compaction.mode = 'throw'
    const world = memoryDeps(new FakeProvider([{ text: 'unused' }]))
    const rounds: unknown[] = []
    world.deps.recordRound = async (round) => { rounds.push(round) }
    await expect(executeKarbotTurn(input({ fakeSteps: [{ text: 'unused' }] }), world.deps)).rejects.toThrow('karbot turn failed')
    expect(rounds).toHaveLength(1)
    expect(rounds[0]).toMatchObject({ turnKind: 'compaction', outcome: 'error', errorCode: 'provider_failed' })
  })
  it('persists, journals, and saves a needed compaction', async () => {
    compaction.mode = 'needed'
    const world = memoryDeps(new FakeProvider([{ text: 'done' }]))
    const records: Array<{ round: number; kind: string; record: Record<string, unknown> }> = []
    const rounds: unknown[] = []
    const summaries: Array<[string, number]> = []
    world.deps.persistExecution = async (round, kind, record) => { records.push({ round, kind, record }) }
    world.deps.recordRound = async (round) => { rounds.push(round) }
    world.deps.persistSummary = async (summary, coveredSeq) => { summaries.push([summary, coveredSeq]) }
    const outcome = await executeKarbotTurn(input({ fakeSteps: [{ text: 'done' }] }), world.deps)
    expect(outcome.reply).toBe('done')
    expect(records.filter((r) => r.record['roundKind'] === 'compaction').map((r) => r.kind)).toEqual(['request', 'response'])
    expect(rounds).toHaveLength(2)
    expect(rounds[0]).toMatchObject({ turnKind: 'compaction', outcome: 'ok' })
    expect(summaries).toEqual([['condensed memory', 5]])
    expect(world.logs).toContainEqual(expect.objectContaining({ op: 'karbot.turn', ok: true, condensedCount: 1 }))
  })
  it('keeps budget refusal out of the round journal', async () => {
    const world = memoryDeps(new FakeProvider([{ text: 'unused' }]))
    const rounds: unknown[] = []
    world.deps.recordRound = async (round) => { rounds.push(round) }
    world.deps.measureContext = async () => { throw new ContextBudgetError('cannot measure') }
    await expect(executeKarbotTurn(input({ fakeSteps: [{ text: 'unused' }] }), world.deps)).rejects.toThrow(ContextBudgetError)
    expect(rounds).toEqual([])
  })
})

describe('turn web sources', () => {
  it('keeps fetched web content as turn sources and skips unparsable results', async () => {
    const world = memoryDeps(
      new FakeProvider([
        { text: 'checking ', toolCalls: [{ id: 'c1', name: 'web_fetch', args: { url: 'https://x.test/a' } }] },
        { text: 'more ', toolCalls: [{ id: 'c2', name: 'web_fetch', args: { url: 'https://x.test/b' } }] },
        { text: 'done' },
      ]),
    )
    world.deps.mcp = {
      listTools: async () => [{ name: 'web_fetch', description: 'fetch', parameters: { type: 'object', properties: {} } }],
      callTool: async (_name, args) => {
        if ((args as { url: string }).url.endsWith('/a')) return { content: JSON.stringify({ url: 'https://x.test/a', text: 'page text here' }) }
        return { content: 'not json' }
      },
    }
    const toolCalls: unknown[] = []
    world.deps.recordToolCall = async (call) => { toolCalls.push(call) }
    const outcome = await executeKarbotTurn(input({ fakeSteps: [{ text: 'x' }, { text: 'x' }, { text: 'x' }] }), world.deps)
    expect(outcome.reply).toBe('done')
    expect(outcome.sources).toEqual([{ url: 'https://x.test/a', text: 'page text here' }])
    expect(toolCalls).toHaveLength(2)
  })
})
