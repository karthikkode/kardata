// Fix 2 (sector-backend-v1.1): the per-round provider-call timeout is chosen
// per turn kind. Planning-grade turns (sectorPlan workflow runKeys and
// research-session turns) get 180 s; chat keeps 60 s.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const seenTimeouts: Array<number | undefined> = []
vi.mock('@kardata/agents', async (importOriginal) => {
  const original = await importOriginal<typeof import('@kardata/agents')>()
  return {
    ...original,
    runKarbotTurn: async (options: { timeoutMs?: number }) => {
      seenTimeouts.push(options.timeoutMs)
      return original.runKarbotTurn(options as never)
    },
  }
})

import { executeKarbotTurn } from '../../backend/src/temporal/activities/turn.js'
import { PLANNING_ROUND_TIMEOUT_MS, turnRoundTimeoutMs } from '../../backend/src/temporal/activities/turn-prompts.js'
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

describe('executeKarbotTurn timeout plumbing', () => {
  let savedEnv: string | undefined
  beforeEach(() => {
    seenTimeouts.length = 0
    savedEnv = process.env['KARDATA_PROVIDER']
    process.env['KARDATA_PROVIDER'] = 'fake'
  })
  afterEach(() => {
    if (savedEnv === undefined) delete process.env['KARDATA_PROVIDER']
    else process.env['KARDATA_PROVIDER'] = savedEnv
  })
  async function runTurn(input: { runKey: string; sessionKind?: string }): Promise<void> {
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
      { sessionId: 's1', threadKey: 's1', runKey: input.runKey, text: 'hi', fakeSteps: [{ text: 'ok' }] },
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
})
