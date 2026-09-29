// Sector plan protocol (P2): draft/failed -> planning with a visible
// planning chat, then the plan workflow. Stub-Db tests: no database, no
// Temporal. Proves conflict past draft/failed, session pinning, fail-closed
// without a runner, and compensation back when the run never starts.
import { describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import type { TransactableDb } from '../../backend/src/db/index.js'
import { planSectorResearch, SectorPlanError } from '../../backend/src/db/sector-plan.js'

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
            id: session.id, title: 'Research plan', sector: session.sector,
            created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
          }] as unknown as TRow[],
        }
      }
      return { rowCount: 0, rows: [] }
    },
  }
}

const SCOPE = { tenantId: 't', projectId: null }
const SESSION = { id: 's-plan', sector: 'sec-1' }

describe('planSectorResearch', () => {
  it('moves draft -> planning and starts the plan run', async () => {
    const state = { name: 'Foods', topic: 'Packaged', state: 'draft' }
    let planned: string | undefined
    const outcome = await planSectorResearch(
      stubDb(state, [], SESSION),
      { startSectorPlan: async (sectorId: string) => { planned = sectorId; return { ok: true } } },
      'sec-1',
      SESSION.id,
      SCOPE,
    )
    expect(outcome).toMatchObject({ sectorId: 'sec-1', state: 'planning' })
    expect(planned).toBe('sec-1')
    expect(state.state).toBe('planning')
  })

  it('plans failed sectors too, conflicts past draft/failed', async () => {
    const failed = { name: 'Foods', topic: 'Packaged', state: 'failed' }
    const outcome = await planSectorResearch(
      stubDb(failed, [], SESSION),
      { startSectorPlan: async () => ({ ok: true }) },
      'sec-1',
      SESSION.id,
      SCOPE,
    )
    expect(outcome.state).toBe('planning')
    const running = { name: 'Foods', topic: 'Packaged', state: 'running' }
    await expect(
      planSectorResearch(stubDb(running, []), { startSectorPlan: async () => ({ ok: true }) }, 'sec-1', SESSION.id, SCOPE),
    ).rejects.toBeInstanceOf(SectorPlanError)
    expect(running.state).toBe('running')
  })

  it('pins the planning chat and compensates when the run never starts', async () => {
    const state = { name: 'Foods', topic: 'Packaged', state: 'draft' }
    const captured: Captured[] = []
    await expect(
      planSectorResearch(
        stubDb(state, captured, { id: 's-other', sector: 'sec-2' }),
        { startSectorPlan: async () => ({ ok: true }) },
        'sec-1',
        's-other',
        SCOPE,
      ),
    ).rejects.toThrow(/not a .* chat/)
    expect(state.state).toBe('draft')
    await expect(
      planSectorResearch(
        stubDb(state, captured, SESSION),
        { startSectorPlan: async () => { throw new Error('worker down') } },
        'sec-1',
        SESSION.id,
        SCOPE,
      ),
    ).rejects.toThrow(/unavailable/)
    expect(state.state).toBe('draft')
  })

  it('fails closed without a runner', async () => {
    const state = { name: 'Foods', topic: 'Packaged', state: 'draft' }
    await expect(planSectorResearch(stubDb(state, [], SESSION), undefined, 'sec-1', SESSION.id, SCOPE)).rejects.toThrow(
      /no plan runner/,
    )
    expect(state.state).toBe('draft')
  })
})
