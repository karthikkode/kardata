// Plan update + approval (P4): brainstorm edits version the artifact,
// owner approval pins a version, edits after approval re-open review.
// Stub-Db tests: no database, no Temporal. Proves state gating
// (planned-only updates, approved-reset on edit, unknown-version
// rejection) and fail-closed paths.
import { describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import type { TransactableDb } from '../../backend/src/db/index.js'
import { approveSectorPlan, updateSectorPlan } from '../../backend/src/db/sector-plan.js'
import { SectorTransitionError } from '../../backend/src/db/sectors.js'

interface Captured {
  text: string
  params: unknown[]
}

function stubDb(
  state: { name: string; topic: string; state: string; plans: string[] },
  captured: Captured[],
): TransactableDb {
  const db: TransactableDb = {
    connect: async () => ({ query: (text: string, params?: unknown[]) => db.query(text, params), release: () => undefined }) as unknown as PoolClient,
    async query<TRow>(text: string, params: unknown[] = []): Promise<{ rowCount: number | null; rows: TRow[] }> {
      captured.push({ text, params })
      if (text.includes('INSERT INTO events')) {
        const payload = JSON.parse(String(params[3])) as { state?: string; markdown?: string; version?: number }
        if (payload.state) state.state = payload.state
        if (typeof payload.markdown === 'string') state.plans.push(payload.markdown)
        return { rowCount: 1, rows: [{ seq: captured.length }] as unknown as TRow[] }
      }
      if (text.startsWith('SELECT payload FROM events')) return { rowCount: 1, rows: [{ payload: { sectorId: 'sec-1', state: state.state } }] as unknown as TRow[] }
      if (text.includes('FROM events WHERE partition')) {
        return {
          rowCount: state.plans.length,
          rows: state.plans.map((markdown, index) => ({
            seq: index + 1,
            idempotency_key: `k${index}`,
            partition: 'sector:sec-1',
            type: 'sector.plan_written',
            payload: { sectorId: 'sec-1', markdown },
            redacted: false,
            at: new Date('2026-01-01T00:00:00.000Z'),
          })) as unknown as TRow[],
        }
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
      return { rowCount: 0, rows: [] }
    },
  }
  return db
}

const SCOPE = { tenantId: 't', projectId: null }

describe('updateSectorPlan', () => {
  it('versions edits on planned sectors', async () => {
    const state = { name: 'n', topic: 't', state: 'planned', plans: ['## scope\nv1'] }
    const outcome = await updateSectorPlan(stubDb(state, []), 'sec-1', '## scope\nv2', SCOPE)
    expect(outcome).toMatchObject({ version: 2 })
    expect(state.plans).toEqual(['## scope\nv1', '## scope\nv2'])
    expect(state.state).toBe('planned')
  })

  it('re-opens review when an approved plan is edited', async () => {
    const state = { name: 'n', topic: 't', state: 'approved', plans: ['## scope\nv1'] }
    const outcome = await updateSectorPlan(stubDb(state, []), 'sec-1', '## scope\nv2', SCOPE)
    expect(outcome).toMatchObject({ version: 2 })
    expect(state.state).toBe('planned')
  })

  it('rejects updates without a plan and outside planned/approved', async () => {
    const empty = { name: 'n', topic: 't', state: 'planned', plans: [] as string[] }
    await expect(updateSectorPlan(stubDb(empty, []), 'sec-1', '## scope\nv1', SCOPE)).rejects.toThrow(/no plan/)
    const running = { name: 'n', topic: 't', state: 'running', plans: ['## scope\nv1'] }
    await expect(updateSectorPlan(stubDb(running, []), 'sec-1', '## scope\nv2', SCOPE)).rejects.toBeInstanceOf(
      SectorTransitionError,
    )
    expect(running.state).toBe('running')
  })
})

describe('approveSectorPlan', () => {
  it('pins an existing version and moves planned to approved', async () => {
    const state = { name: 'n', topic: 't', state: 'planned', plans: ['## scope\nv1'] }
    const outcome = await approveSectorPlan(stubDb(state, []), 'sec-1', 1, SCOPE)
    expect(outcome).toMatchObject({ version: 1, state: 'approved' })
    expect(state.state).toBe('approved')
  })

  it('rejects unknown versions and non-planned states', async () => {
    const state = { name: 'n', topic: 't', state: 'planned', plans: ['## scope\nv1'] }
    await expect(approveSectorPlan(stubDb(state, []), 'sec-1', 7, SCOPE)).rejects.toThrow(/unknown plan version/)
    expect(state.state).toBe('planned')
    const draft = { name: 'n', topic: 't', state: 'draft', plans: [] as string[] }
    await expect(approveSectorPlan(stubDb(draft, []), 'sec-1', 1, SCOPE)).rejects.toBeInstanceOf(
      SectorTransitionError,
    )
  })
})
