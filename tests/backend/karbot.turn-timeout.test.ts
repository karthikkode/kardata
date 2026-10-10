// Fix 2 (sector-backend-v1.1): the per-round provider-call timeout is chosen
// per turn kind. Planning-grade turns (sectorPlan workflow runKeys and
// research-session turns) get 180 s; chat keeps 60 s.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const seenTimeouts: Array<number | undefined> = []
const seenPrompts: Array<string | undefined> = []
vi.mock('@kardata/agents', async (importOriginal) => {
  const original = await importOriginal<typeof import('@kardata/agents')>()
  return {
    ...original,
    runKarbotTurn: async (options: { timeoutMs?: number; systemPrompt?: string }) => {
      seenTimeouts.push(options.timeoutMs)
      seenPrompts.push(options.systemPrompt)
      return original.runKarbotTurn(options as never)
    },
  }
})

import { executeKarbotTurn } from '../../backend/src/temporal/activities/turn.js'
import { PLANNING_ROUND_TIMEOUT_MS, SUBAGENT_FINISH_PREAMBLE, subagentPreambleFor, turnRoundTimeoutMs } from '../../backend/src/temporal/activities/turn-prompts.js'
import { type KarbotTurnDeps } from '../../backend/src/temporal/activities/karbot-turn-input.js'
import { FakeProvider } from '@kardata/agents'

describe('turnRoundTimeoutMs [F:backend.activity.turn.executeKarbotTurn] [F:backend.activity.turn_prompts.PLANNING_ROUND_TIMEOUT_MS] [F:backend.activity.turn_prompts.turnRoundTimeoutMs] [F:backend.activity.turn_prompts.CONTEXT_PROPOSAL_NUDGE] [F:backend.activity.turn_prompts.CONTEXT_REWRITE_PREAMBLE] [F:backend.activity.turn.ResearchPausedError] [F:backend.activity.turn.sleep] [F:db.errors.WorkspaceError] [F:db.sessions.SessionModelSelection] [F:db.index.Db] [F:db.index.SessionModelSelection] [F:db.workspace.WorkspaceError] [F:db.sector_documents.assertFileVisible] [F:db.sessions.sessionKind] [F:db.errors.Id] [F:db.errors.checked] [F:db.file_jobs.visible]', () => {
  it('gives sectorPlan workflow runKeys the 180 s planning budget', () => {
    expect(turnRoundTimeoutMs({ runKey: 'plan:sector-1:v3' })).toBe(180_000)
    expect(PLANNING_ROUND_TIMEOUT_MS).toBe(180_000)
  })
  it('gives research-session turns the 180 s planning budget', () => {
    expect(turnRoundTimeoutMs({ runKey: 'chat:9', sessionKind: 'research' })).toBe(180_000)
  })
  it('keeps normal chat turns at 60 s', () => {
    expect(turnRoundTimeoutMs({ runKey: 'chat:9', sessionKind: 'normal' })).toBe(60_000)
    expect(turnRoundTimeoutMs({ runKey: 'chat:9' })).toBe(60_000)
  })
})

describe('subagentPreambleFor [F:backend.activity.turn_prompts.SUBAGENT_FINISH_PREAMBLE] [F:backend.activity.turn_prompts.subagentPreambleFor]', () => {
  it('gives subagent turns the finish-honestly preamble', () => {
    expect(subagentPreambleFor('subagent')).toEqual([SUBAGENT_FINISH_PREAMBLE])
    expect(SUBAGENT_FINISH_PREAMBLE).toContain('db.finish_subagent')
    expect(SUBAGENT_FINISH_PREAMBLE).toContain('0 findings')
  })
  it('gives chat, research, and plan turns no preamble', () => {
    for (const kind of ['chat', 'research', 'plan']) expect(subagentPreambleFor(kind)).toEqual([])
  })
})

describe('executeKarbotTurn timeout plumbing', () => {
  let savedEnv: string | undefined
  beforeEach(() => {
    seenTimeouts.length = 0
    seenPrompts.length = 0
    savedEnv = process.env['KARDATA_PROVIDER']
    process.env['KARDATA_PROVIDER'] = 'fake'
  })
  afterEach(() => {
    if (savedEnv === undefined) delete process.env['KARDATA_PROVIDER']
    else process.env['KARDATA_PROVIDER'] = savedEnv
  })
  async function runTurn(input: { runKey: string; sessionKind?: string; threadKey?: string }): Promise<void> {
    const deps: KarbotTurnDeps = {
      loadSessionModel: async () => undefined,
      ...(input.sessionKind === undefined ? {} : { loadSessionKind: async () => input.sessionKind }),
      loadHistory: async () => [],
      resolveTurnAdapter: () => new FakeProvider([{ text: 'ok' }]),
      mcp: { listTools: async () => [], callTool: async () => ({ content: '' }) },
      publishDelta: async () => {},
      publishReasoning: async () => {},
      publishTool: async () => {},
      log: () => {},
    }
    await executeKarbotTurn(
      { sessionId: 's1', threadKey: input.threadKey ?? 's1', runKey: input.runKey, text: 'hi', fakeSteps: [{ text: 'ok' }] },
      deps,
    )
  }
  it('passes 180 s for plan workflow runKeys', async () => {
    await runTurn({ runKey: 'plan:sector-1' })
    expect(seenTimeouts).toEqual([180_000])
  })
  it('passes 180 s for research-session turns', async () => {
    await runTurn({ runKey: 'chat:9', sessionKind: 'research' })
    expect(seenTimeouts).toEqual([180_000])
  })
  it('passes 60 s for normal chat turns', async () => {
    await runTurn({ runKey: 'chat:9', sessionKind: 'normal' })
    expect(seenTimeouts).toEqual([60_000])
  })
  it('passes 60 s when the kind is unknown', async () => {
    await runTurn({ runKey: 'chat:9' })
    expect(seenTimeouts).toEqual([60_000])
  })
  it('carries the finish preamble on subagent threads only', async () => {
    await runTurn({ runKey: 'karbot:child:c1:0', threadKey: 'agent:c1' })
    expect(seenPrompts).toHaveLength(1)
    expect(seenPrompts[0]).toContain('db.finish_subagent')
    await runTurn({ runKey: 'chat:9', threadKey: 's1' })
    expect(seenPrompts).toHaveLength(2)
    expect(seenPrompts[1]).not.toContain('db.finish_subagent')
  })
})

describe('provider retry inside the activity (F5)', () => {
  let savedEnv: string | undefined
  beforeEach(() => {
    savedEnv = process.env['KARDATA_PROVIDER']
    process.env['KARDATA_PROVIDER'] = 'fake'
  })
  afterEach(() => {
    if (savedEnv === undefined) delete process.env['KARDATA_PROVIDER']
    else process.env['KARDATA_PROVIDER'] = savedEnv
  })
  type Step = { text?: string; error?: string; retryable?: boolean }
  async function runScripted(scripts: Step[][]): Promise<{ adapters: FakeProvider[]; outcome: unknown }> {
    const adapters: FakeProvider[] = []
    let attempt = 0
    const deps: KarbotTurnDeps = {
      loadSessionModel: async () => undefined,
      loadHistory: async () => [],
      resolveTurnAdapter: () => {
        const adapter = new FakeProvider([...(scripts[Math.min(attempt, scripts.length - 1)] ?? [])] as never)
        attempt += 1
        adapters.push(adapter)
        return adapter
      },
      mcp: { listTools: async () => [], callTool: async () => ({ content: '' }) },
      publishDelta: async () => {},
      publishReasoning: async () => {},
      publishTool: async () => {},
      log: () => {},
    }
    const outcome = await executeKarbotTurn(
      { sessionId: 's1', threadKey: 's1', runKey: 'chat:9', text: 'hi', fakeSteps: [{ text: 'ok' }] },
      deps,
    )
    return { adapters, outcome }
  }
  it('retries retryable provider failures with backoff, then succeeds', async () => {
    const { adapters, outcome } = await runScripted([[{ error: 'blip', retryable: true }], [{ error: 'blip', retryable: true }], [{ text: 'ok' }]])
    expect((outcome as { reply: string }).reply).toBe('ok')
    expect(adapters).toHaveLength(3)
    expect(adapters.map((adapter) => adapter.calls.length)).toEqual([1, 1, 1])
  }, 30000)
  it('parks with a visible reason after the retries are exhausted', async () => {
    const scripts = [[{ error: 'down', retryable: true }], [{ error: 'down', retryable: true }], [{ error: 'down', retryable: true }]]
    await expect(runScripted(scripts)).rejects.toThrow(/failed after 3 attempts.*down/)
  }, 30000)
  it('does not retry non-retryable provider failures', async () => {
    const adapters: FakeProvider[] = []
    const deps: KarbotTurnDeps = {
      loadSessionModel: async () => undefined,
      loadHistory: async () => [],
      resolveTurnAdapter: () => {
        const adapter = new FakeProvider([{ error: 'bad key', retryable: false }] as never)
        adapters.push(adapter)
        return adapter
      },
      mcp: { listTools: async () => [], callTool: async () => ({ content: '' }) },
      publishDelta: async () => {},
      publishReasoning: async () => {},
      publishTool: async () => {},
      log: () => {},
    }
    await expect(
      executeKarbotTurn({ sessionId: 's1', threadKey: 's1', runKey: 'chat:9', text: 'hi', fakeSteps: [{ text: 'ok' }] }, deps),
    ).rejects.toThrow('bad key')
    expect(adapters).toHaveLength(1)
  })
})
