// Sector research start protocol (step 4). Stub-Db tests: no database, no
// Temporal. Proves draft -> queued -> sweep, conflict past draft,
// compensation to draft when the sweep never starts, and fail-closed MCP
// invocation without a sweep runner.
import { describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import type { Db, TransactableDb } from '../../backend/src/db/index.js'
import {
  SectorStartError,
  startSectorResearch,
} from '../../backend/src/db/sector-start.js'
import { invokeTool } from '../../backend/src/mcp/tools.js'

interface Captured {
  text: string
  params: unknown[]
}

function stubDb(
  state: { name: string; topic: string; state: string },
  captured: Captured[],
  session?: { id: string; sector: string | null },
): TransactableDb {
  return {
    connect: async () => ({}) as unknown as PoolClient,
    async query<TRow>(text: string, params: unknown[] = []): Promise<{ rowCount: number | null; rows: TRow[] }> {
      captured.push({ text, params })
      if (text.includes('INSERT INTO events')) {
        const payload = JSON.parse(String(params[3])) as { state?: string }
        if (payload.state) state.state = payload.state
        return { rowCount: 1, rows: [{ seq: captured.length }] as unknown as TRow[] }
      }
      if (text.includes('FROM sectors s')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'sec-1', name: state.name, topic: state.topic, state: state.state,
            companies_found: 0, research_session_id: null,
            created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
          }] as unknown as TRow[],
        }
      }
      if (text.includes('WHERE c.id = $1') && session) {
        return {
          rowCount: 1,
          rows: [{
            id: session.id, title: 'Sector chat', sector: session.sector,
            created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
          }] as unknown as TRow[],
        }
      }
      return { rowCount: 0, rows: [] }
    },
  }
}

const SCOPE = { tenantId: 't', projectId: null }

describe('startSectorResearch', () => {
  it('moves approved -> queued and starts the sweep', async () => {
    const state = { name: 'Optics', topic: 'Lenses', state: 'approved' }
    const captured: Captured[] = []
    let swept: string | undefined
    const outcome = await startSectorResearch(stubDb(state, captured), {
      startSectorSweep: async (sectorId: string) => { swept = sectorId; return { ok: true } }, cancelSectorSweep: async () => ({ ok: true }),
    }, 'sec-1', SCOPE, 'key-1')
    expect(outcome).toEqual({ sectorId: 'sec-1', state: 'queued', researchSessionId: null })
    expect(swept).toBe('sec-1')
    expect(state.state).toBe('queued')
  })

  it('records the calling session as the research pin', async () => {
    const state = { name: 'Optics', topic: 'Lenses', state: 'approved' }
    const captured: Captured[] = []
    const outcome = await startSectorResearch(
      stubDb(state, captured, { id: 'sess-1', sector: 'sec-1' }),
      { startSectorSweep: async () => ({ ok: true }), cancelSectorSweep: async () => ({ ok: true }) },
      'sec-1', SCOPE, 'key-1', 'sess-1',
    )
    expect(outcome).toEqual({ sectorId: 'sec-1', state: 'queued', researchSessionId: 'sess-1' })
    expect(captured.some((call) => JSON.stringify(call.params).includes('sector.research_started'))).toBe(true)
  })

  it('404s an unknown calling session without starting', async () => {
    const state = { name: 'Optics', topic: 'Lenses', state: 'approved' }
    const captured: Captured[] = []
    let swept = false
    await expect(startSectorResearch(
      stubDb(state, captured),
      { startSectorSweep: async () => { swept = true; return { ok: true } }, cancelSectorSweep: async () => ({ ok: true }) },
      'sec-1', SCOPE, 'key-1', 'sess-ghost',
    )).rejects.toMatchObject({ failure: 'not_found' })
    expect(swept).toBe(false)
    expect(state.state).toBe('approved')
  })

  it('conflicts a calling session from another sector', async () => {
    const state = { name: 'Optics', topic: 'Lenses', state: 'approved' }
    const captured: Captured[] = []
    let swept = false
    await expect(startSectorResearch(
      stubDb(state, captured, { id: 'sess-9', sector: 'sec-other' }),
      { startSectorSweep: async () => { swept = true; return { ok: true } }, cancelSectorSweep: async () => ({ ok: true }) },
      'sec-1', SCOPE, 'key-1', 'sess-9',
    )).rejects.toMatchObject({ failure: 'conflict' })
    expect(swept).toBe(false)
    expect(state.state).toBe('approved')
  })

  it('conflicts past approved without touching the sweep', async () => {
    const state = { name: 'Optics', topic: 'Lenses', state: 'running' }
    const captured: Captured[] = []
    let swept = false
    await expect(startSectorResearch(stubDb(state, captured), {
      startSectorSweep: async () => { swept = true; return { ok: true } }, cancelSectorSweep: async () => ({ ok: true }),
    }, 'sec-1', SCOPE)).rejects.toMatchObject({ failure: 'conflict' })
    expect(swept).toBe(false)
    expect(state.state).toBe('running')
  })

  it('compensates to approved when the sweep never starts', async () => {
    const state = { name: 'Optics', topic: 'Lenses', state: 'approved' }
    const captured: Captured[] = []
    await expect(startSectorResearch(stubDb(state, captured), {
      startSectorSweep: async () => { throw new Error('worker down') }, cancelSectorSweep: async () => ({ ok: true }),
    }, 'sec-1', SCOPE)).rejects.toMatchObject({ failure: 'overload' })
    expect(state.state).toBe('approved')
  })

  it('404s unknown sectors', async () => {
    const db: Db = {
      async query<TRow>(): Promise<{ rowCount: number | null; rows: TRow[] }> {
        return { rowCount: 0, rows: [] }
      },
    }
    await expect(startSectorResearch(db, {
      startSectorSweep: async () => ({ ok: true }), cancelSectorSweep: async () => ({ ok: true }),
    }, 'sec-nope', SCOPE)).rejects.toBeInstanceOf(SectorStartError)
  })
})

describe('db.start_sector_research MCP tool', () => {
  it('fails closed without a sweep runner', async () => {
    const state = { name: 'Optics', topic: 'Lenses', state: 'approved' }
    const captured: Captured[] = []
    const failure = await invokeTool(
      'db.start_sector_research',
      { pool: stubDb(state, captured), scope: SCOPE, role: 'operator', keyId: 'k' },
      { sectorId: 'sec-1' },
    ).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(Error)
    expect(String((failure as Error).message)).toContain('no sweep runner')
    expect(state.state).toBe('approved')
  })

  it('starts through the shared sequence when a runner is attached', async () => {
    const state = { name: 'Optics', topic: 'Lenses', state: 'approved' }
    const captured: Captured[] = []
    const outcome = await invokeTool(
      'db.start_sector_research',
      {
        pool: stubDb(state, captured),
        scope: SCOPE,
        role: 'operator',
        keyId: 'k',
        runs: { startSectorSweep: async () => ({ ok: true }), cancelSectorSweep: async () => ({ ok: true }) },
      },
      { sectorId: 'sec-1' },
    ) as { sectorId: string; state: string; researchSessionId: string | null }
    expect(outcome).toEqual({ sectorId: 'sec-1', state: 'queued', researchSessionId: null })
    expect(state.state).toBe('queued')
  })
})

describe('pauseSectorResearch / resumeSectorResearch', () => {
  it('pauses running and resumes paused through MCP tools, driving the run', async () => {
    const state = { name: 'Optics', topic: 'Lenses', state: 'running' }
    const captured: Captured[] = []
    const log: string[] = []
    const runs = {
      async cancelSectorSweep(sectorId: string): Promise<{ cancelled: boolean }> {
        log.push(`cancel:${sectorId}`)
        return { cancelled: true }
      },
      async startSectorSweep(sectorId: string): Promise<{ started: boolean }> {
        log.push(`start:${sectorId}`)
        return { started: true }
      },
    }
    const ctx = { pool: stubDb(state, captured), scope: SCOPE, role: 'operator' as const, keyId: 'k', runs }
    const paused = (await invokeTool('db.pause_sector_research', ctx, { sectorId: 'sec-1' })) as { state: string }
    expect(paused.state).toBe('paused')
    expect(state.state).toBe('paused')
    const resumed = (await invokeTool('db.resume_sector_research', ctx, { sectorId: 'sec-1' })) as { state: string }
    expect(resumed.state).toBe('running')
    expect(state.state).toBe('running')
    expect(log).toEqual(['cancel:sec-1', 'start:sec-1'])
  })

  it('fails closed without a sweep runner instead of relabeling', async () => {
    const state = { name: 'Optics', topic: 'Lenses', state: 'running' }
    const ctx = { pool: stubDb(state, []), scope: SCOPE, role: 'operator' as const, keyId: 'k' }
    await expect(invokeTool('db.pause_sector_research', ctx, { sectorId: 'sec-1' })).rejects.toThrow(
      /no sweep runner/,
    )
    expect(state.state).toBe('running')
  })

  it('conflicts pause past running and resume past paused', async () => {
    const draft = { name: 'Optics', topic: 'Lenses', state: 'draft' }
    const runs = {
      async cancelSectorSweep(): Promise<{ cancelled: boolean }> {
        return { cancelled: true }
      },
      async startSectorSweep(): Promise<{ started: boolean }> {
        return { started: true }
      },
    }
    const ctx = { pool: stubDb(draft, []), scope: SCOPE, role: 'operator' as const, keyId: 'k', runs }
    await expect(invokeTool('db.pause_sector_research', ctx, { sectorId: 'sec-1' })).rejects.toThrow(/conflict/)
    expect(draft.state).toBe('draft')
    const running = { name: 'Optics', topic: 'Lenses', state: 'running' }
    const ctx2 = { pool: stubDb(running, []), scope: SCOPE, role: 'operator' as const, keyId: 'k', runs }
    await expect(invokeTool('db.resume_sector_research', ctx2, { sectorId: 'sec-1' })).rejects.toThrow(/conflict/)
    expect(running.state).toBe('running')
  })

  it('404s pause on unknown sectors', async () => {
    const db: Db = {
      async query<TRow>(): Promise<{ rowCount: number | null; rows: TRow[] }> {
        return { rowCount: 0, rows: [] }
      },
    }
    const runs = {
      async cancelSectorSweep(): Promise<{ cancelled: boolean }> {
        return { cancelled: true }
      },
      async startSectorSweep(): Promise<{ started: boolean }> {
        return { started: true }
      },
    }
    const ctx = { pool: db as TransactableDb, scope: SCOPE, role: 'operator' as const, keyId: 'k', runs }
    await expect(invokeTool('db.pause_sector_research', ctx, { sectorId: 'sec-nope' })).rejects.toThrow(/not_found/)
  })
})
