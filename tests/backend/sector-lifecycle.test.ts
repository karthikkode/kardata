// Sector sweep lifecycle: pause halts the run, resume and restart ensure
// one. Stub-Db tests: no database, no Temporal. Proves cancel-before-state
// ordering, start-before-state ordering, fail-closed without a runner, and
// worker-down mapping — so Pause truly halts instead of relabeling.
import { describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import type { TransactableDb } from '../../backend/src/db/index.js'
import {
  pauseSectorSweep,
  restartSectorSweep,
  resumeSectorSweep,
} from '../../backend/src/db/sector-lifecycle.js'
import { SectorTransitionError } from '../../backend/src/db/sectors.js'

interface Captured {
  text: string
  params: unknown[]
}

function stubDb(
  state: { name: string; topic: string; state: string },
  captured: Captured[],
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
      return { rowCount: 0, rows: [] }
    },
  }
}

const SCOPE = { tenantId: 't', projectId: null }

function runnerDouble(log: string[], behavior: { cancel?: 'ok' | 'gone' | 'down'; start?: 'ok' | 'down' } = {}) {
  return {
    async cancelSectorSweep(sectorId: string): Promise<{ cancelled: boolean }> {
      log.push(`cancel:${sectorId}`)
      if (behavior.cancel === 'down') throw new Error('temporal down')
      return { cancelled: behavior.cancel !== 'gone' }
    },
    async startSectorSweep(sectorId: string): Promise<{ started: boolean }> {
      log.push(`start:${sectorId}`)
      if (behavior.start === 'down') throw new Error('temporal down')
      return { started: true }
    },
  }
}

describe('pauseSectorSweep', () => {
  it('cancels the run before recording paused', async () => {
    const state = { name: 'n', topic: 't', state: 'running' }
    const captured: Captured[] = []
    const log: string[] = []
    const paused = await pauseSectorSweep(stubDb(state, captured), runnerDouble(log), 'sec-1', SCOPE)
    expect(paused.state).toBe('paused')
    expect(log).toEqual(['cancel:sec-1'])
  })

  it('treats an already-gone run as paused, never a conflict', async () => {
    const state = { name: 'n', topic: 't', state: 'running' }
    const captured: Captured[] = []
    const paused = await pauseSectorSweep(stubDb(state, captured), runnerDouble([], { cancel: 'gone' }), 'sec-1', SCOPE)
    expect(paused.state).toBe('paused')
  })

  it('fails closed without a runner and when the worker is down', async () => {
    const state = { name: 'n', topic: 't', state: 'running' }
    const captured: Captured[] = []
    await expect(pauseSectorSweep(stubDb(state, captured), undefined, 'sec-1', SCOPE)).rejects.toThrow(
      'no sweep runner',
    )
    expect(state.state).toBe('running')
    await expect(
      pauseSectorSweep(stubDb(state, captured), runnerDouble([], { cancel: 'down' }), 'sec-1', SCOPE),
    ).rejects.toThrow('sweep worker unavailable')
    expect(state.state).toBe('running')
  })

  it('conflicts past running without touching the runner', async () => {
    const state = { name: 'n', topic: 't', state: 'paused' }
    const captured: Captured[] = []
    const log: string[] = []
    await expect(pauseSectorSweep(stubDb(state, captured), runnerDouble(log), 'sec-1', SCOPE)).rejects.toBeInstanceOf(
      SectorTransitionError,
    )
    expect(log).toEqual([])
  })
})

describe('resumeSectorSweep', () => {
  it('starts the run before recording running', async () => {
    const state = { name: 'n', topic: 't', state: 'paused' }
    const captured: Captured[] = []
    const log: string[] = []
    const running = await resumeSectorSweep(stubDb(state, captured), runnerDouble(log), 'sec-1', SCOPE)
    expect(running.state).toBe('running')
    expect(log).toEqual(['start:sec-1'])
  })

  it('fails closed without a runner and when the worker is down', async () => {
    const state = { name: 'n', topic: 't', state: 'paused' }
    const captured: Captured[] = []
    await expect(resumeSectorSweep(stubDb(state, captured), undefined, 'sec-1', SCOPE)).rejects.toThrow(
      'no sweep runner',
    )
    expect(state.state).toBe('paused')
    await expect(
      resumeSectorSweep(stubDb(state, captured), runnerDouble([], { start: 'down' }), 'sec-1', SCOPE),
    ).rejects.toThrow('sweep worker unavailable')
    expect(state.state).toBe('paused')
  })
})

describe('restartSectorSweep', () => {
  it('starts a run for failed sectors instead of relabeling', async () => {
    const state = { name: 'n', topic: 't', state: 'failed' }
    const captured: Captured[] = []
    const log: string[] = []
    const running = await restartSectorSweep(stubDb(state, captured), runnerDouble(log), 'sec-1', SCOPE)
    expect(running.state).toBe('running')
    expect(log).toEqual(['start:sec-1'])
  })

  it('conflicts past failed without touching the runner', async () => {
    const state = { name: 'n', topic: 't', state: 'complete' }
    const captured: Captured[] = []
    const log: string[] = []
    await expect(restartSectorSweep(stubDb(state, captured), runnerDouble(log), 'sec-1', SCOPE)).rejects.toBeInstanceOf(
      SectorTransitionError,
    )
    expect(log).toEqual([])
  })
})
