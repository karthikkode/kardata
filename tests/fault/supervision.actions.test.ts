// Supervision drills (P3.4, fault tier). One test per supervision row:
// detection within the threshold plus the action happening, over a real
// database with stubbed Temporal inspect/control (no worker needed).
// Coverage proves 1000 threads scan inside 60 s.
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import {
  appendEvent,
  beginThreadTurn,
  createSession,
  getThreadHeader,
  HEARTBEAT_FAIL_FLOOR_MS,
  listSupervisionAlerts,
  recordHeartbeat,
  reserveExecutionIntent,
} from '../../backend/src/db/index.js'
import {
  reconcilePage,
  SUPERVISION_NUDGE,
  type ReconciliationControl,
} from '../../backend/src/temporal/activities/reconciliation.js'
import { SUPERVISION_THRESHOLDS } from '../../backend/src/temporal/timeouts.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from '../backend/db-helper.js'

const scope = { tenantId: 'TEST supervision', projectId: null }

async function poolFor(name: string): Promise<Pool> {
  return new Pool({ connectionString: await ensureTestDb(name) })
}

async function leaseOn(pool: Pool, sessionId: string, threadKey: string, workflowId: string): Promise<{ epoch: string; executionId: string }> {
  const input = { sessionId, threadKey, workflowId, requestKey: randomUUID() }
  const epoch = await reserveExecutionIntent(pool, input)
  const executionId = randomUUID()
  await beginThreadTurn(pool, threadKey, 'TEST turn', { ...input, epoch, executionId, firstExecutionId: executionId })
  return { epoch, executionId }
}

function runningControl(captured: { signals: Array<{ workflowId: string; signal: string; payload?: string }>; cancels: string[] }): ReconciliationControl {
  return {
    describe: async () => ({ state: 'running' as const }),
    signal: async (workflowId, signalName, payload) => {
      captured.signals.push({ workflowId, signal: signalName, ...(payload === undefined ? {} : { payload }) })
    },
    cancel: async (workflowId) => {
      captured.cancels.push(workflowId)
    },
  }
}

describe.skipIf(!TEST_DATABASE_URL)('supervision acts (P3.4)', () => {
  it('pins every detection threshold and the coverage arithmetic', () => {
    expect(SUPERVISION_THRESHOLDS).toMatchObject({
      missingHeartbeatMs: 120_000,
      noProgressMs: 900_000,
      loopToolRepeats: 3,
      orphanMs: 60_000,
      queueStaleMs: 300_000,
      turnWallMs: 1_200_000,
    })
    expect(HEARTBEAT_FAIL_FLOOR_MS).toBe(SUPERVISION_THRESHOLDS.turnWallMs)
    expect((SUPERVISION_THRESHOLDS.reconcilePageSize / SUPERVISION_THRESHOLDS.reconcileCadenceMs) * 60_000).toBeGreaterThanOrEqual(1000)
  })

  it('observes a stale heartbeat, then fails past the wall when the owner is gone', async () => {
    const pool = await poolFor('kardata_test_supervision_heartbeat')
    try {
      const session = await createSession(pool, 'TEST heartbeat', scope)
      await projectNewEvents(pool)
      await leaseOn(pool, session.id, session.id, `session-run-${session.id}`)
      await recordHeartbeat(pool, `session-run-${session.id}`, 'TEST op', true, Date.now() - 121_000)
      const captured = { signals: [], cancels: [] as string[] }
      const observed = await reconcilePage(pool, '', async () => ({ state: 'running' }), Date.now(), () => undefined, runningControl(captured))
      expect(observed.findings).toBe(1)
      expect((await getThreadHeader(pool, session.id))?.status).not.toBe('ERROR')
      expect((await pool.query('SELECT count(*)::int AS n FROM alerts')).rows[0]?.n).toBe(0)
      await recordHeartbeat(pool, `session-run-${session.id}`, 'TEST op', true, Date.now() - 21 * 60_000)
      const failed = await reconcilePage(pool, '', async () => ({ state: 'unavailable' }), Date.now(), () => undefined, runningControl(captured))
      expect(failed.findings).toBe(1)
      await projectNewEvents(pool)
      expect((await getThreadHeader(pool, session.id))?.status).toBe('ERROR')
      expect((await listSupervisionAlerts(pool, scope)).items).toHaveLength(1)
    } finally {
      await pool.end()
    }
  })

  it('fails a flatlined subagent and notifies the parent thread', async () => {
    const pool = await poolFor('kardata_test_supervision_parent')
    try {
      const session = await createSession(pool, 'TEST parent', scope)
      const childId = randomUUID()
      await appendEvent(pool, { idempotencyKey: randomUUID(), partition: `session:${session.id}`, type: 't.subagent.launched', payload: { sessionId: session.id, childId, name: 'TEST child', goal: 'TEST goal', parentSessionId: session.id, parentWorkflowId: `session-run-${session.id}` } })
      await projectNewEvents(pool)
      await leaseOn(pool, session.id, `agent:${childId}`, childId)
      await recordHeartbeat(pool, childId, 'TEST op', true, Date.now() - 21 * 60_000)
      const captured = { signals: [], cancels: [] as string[] }
      await reconcilePage(pool, '', async () => ({ state: 'unavailable' }), Date.now(), () => undefined, runningControl(captured))
      await projectNewEvents(pool)
      expect((await getThreadHeader(pool, `agent:${childId}`))?.status).toBe('ERROR')
      const { rows } = await pool.query<{ payload: { text?: string } }>(
        `SELECT payload FROM thread_messages WHERE thread_key = $1 AND kind = 'text' ORDER BY seq DESC LIMIT 1`,
        [session.id],
      )
      expect(rows[0]?.payload.text).toContain('Supervisor: subagent')
    } finally {
      await pool.end()
    }
  })

  it('nudges once on stalled progress, then pauses with an owner alert', async () => {
    const pool = await poolFor('kardata_test_supervision_nudge')
    try {
      const session = await createSession(pool, 'TEST nudge', scope)
      await projectNewEvents(pool)
      await leaseOn(pool, session.id, session.id, `session-run-${session.id}`)
      await appendEvent(pool, { idempotencyKey: randomUUID(), partition: `session:${session.id}`, type: 't.message.appended', payload: { threadKey: session.id, kind: 'text', message: { role: 'agent', text: 'TEST old reply' } } })
      await projectNewEvents(pool)
      await pool.query(`UPDATE thread_messages SET at = now() - interval '16 minutes' WHERE thread_key = $1`, [session.id])
      await recordHeartbeat(pool, `session-run-${session.id}`, 'TEST op', true)
      const captured = { signals: [] as Array<{ workflowId: string; signal: string; payload?: string }>, cancels: [] as string[] }
      const control = runningControl(captured)
      await reconcilePage(pool, '', async () => ({ state: 'running' }), Date.now(), () => undefined, control)
      expect(captured.signals).toEqual([{ workflowId: `session-run-${session.id}`, signal: 'runSteer', payload: SUPERVISION_NUDGE }])
      expect((await getThreadHeader(pool, session.id))?.status).not.toBe('PAUSED')
      await reconcilePage(pool, '', async () => ({ state: 'running' }), Date.now(), () => undefined, control)
      expect(captured.signals[1]).toEqual({ workflowId: `session-run-${session.id}`, signal: 'runPause' })
      await projectNewEvents(pool)
      expect((await getThreadHeader(pool, session.id))?.status).toBe('PAUSED')
      const alerts = (await listSupervisionAlerts(pool, scope)).items
      expect(alerts.map((alert) => alert.severity).sort()).toEqual(['high', 'info'])
    } finally {
      await pool.end()
    }
  })

  it('stops a looping turn with a loop event and an honest reply', async () => {
    const pool = await poolFor('kardata_test_supervision_loop')
    try {
      const session = await createSession(pool, 'TEST loop', scope)
      await projectNewEvents(pool)
      await leaseOn(pool, session.id, session.id, `session-run-${session.id}`)
      for (let i = 0; i < 3; i++) {
        await appendEvent(pool, { idempotencyKey: randomUUID(), partition: `session:${session.id}`, type: 't.message.appended', payload: { threadKey: session.id, kind: 'tool', message: { name: 'db.list_sessions', args: { q: 1 } } } })
      }
      await projectNewEvents(pool)
      await recordHeartbeat(pool, `session-run-${session.id}`, 'TEST op', true)
      const captured = { signals: [] as Array<{ workflowId: string; signal: string; payload?: string }>, cancels: [] as string[] }
      await reconcilePage(pool, '', async () => ({ state: 'running' }), Date.now(), () => undefined, runningControl(captured))
      expect(captured.signals).toEqual([{ workflowId: `session-run-${session.id}`, signal: 'runCancel' }])
      expect(captured.cancels).toHaveLength(0)
      const loop = await pool.query('SELECT payload FROM events WHERE type = $1', ['t.loop.detected'])
      expect(loop.rows).toHaveLength(1)
      const reply = await pool.query<{ payload: { text?: string } }>(
        `SELECT payload FROM thread_messages WHERE thread_key = $1 AND kind = 'text' ORDER BY seq DESC LIMIT 1`,
        [session.id],
      )
      expect(reply.rows[0]?.payload.text).toContain('I stopped this turn because I detected a loop')
      expect((await listSupervisionAlerts(pool, scope)).items[0]).toMatchObject({ kind: 'loop-detected', severity: 'high' })
    } finally {
      await pool.end()
    }
  })

  it('fails an orphaned thread and leaves unfenced closes alone', async () => {
    const pool = await poolFor('kardata_test_supervision_orphan')
    try {
      const orphan = await createSession(pool, 'TEST orphan', scope)
      const loose = await createSession(pool, 'TEST loose', scope)
      await projectNewEvents(pool)
      const owned = await leaseOn(pool, orphan.id, orphan.id, `session-run-${orphan.id}`)
      await leaseOn(pool, loose.id, loose.id, `session-run-${loose.id}`)
      const captured = { signals: [], cancels: [] as string[] }
      const inspect = async (candidate: { threadKey: string }) =>
        candidate.threadKey === orphan.id ? { state: 'closed' as const, executionId: owned.executionId } : { state: 'closed' as const, executionId: randomUUID() }
      await reconcilePage(pool, '', inspect, Date.now(), () => undefined, runningControl(captured))
      await projectNewEvents(pool)
      expect((await getThreadHeader(pool, orphan.id))?.status).toBe('ERROR')
      expect((await getThreadHeader(pool, loose.id))?.status).not.toBe('ERROR')
      const alerts = await pool.query<{ thread_key: string }>('SELECT thread_key FROM alerts')
      expect(alerts.rows.map((row) => row.thread_key)).toEqual([orphan.id])
    } finally {
      await pool.end()
    }
  })

  it('cancels workflows whose thread is gone or session deleted', async () => {
    const pool = await poolFor('kardata_test_supervision_ghost')
    try {
      await pool.query(`INSERT INTO thread_context (thread_key, active_run, active_lease, active_workflow_id) VALUES ('TEST-ghost', 'run', 'lease', 'wf-ghost')`)
      const session = await createSession(pool, 'TEST deleted', scope)
      await projectNewEvents(pool)
      await leaseOn(pool, session.id, session.id, `session-run-${session.id}`)
      await appendEvent(pool, { idempotencyKey: randomUUID(), partition: `session:${session.id}`, type: 't.session.deleted', payload: { sessionId: session.id } })
      const captured = { signals: [], cancels: [] as string[] }
      const control = runningControl(captured)
      await reconcilePage(pool, '', async () => ({ state: 'running' }), Date.now(), () => undefined, control)
      expect(captured.cancels.sort()).toEqual([`session-run-${session.id}`, 'wf-ghost'].sort())
      const leases = await pool.query('SELECT thread_key FROM thread_context WHERE active_lease IS NOT NULL')
      expect(leases.rows).toHaveLength(0)
      expect((await pool.query('SELECT count(*)::int AS n FROM alerts')).rows[0]?.n).toBe(2)
    } finally {
      await pool.end()
    }
  })

  it('cancels a child whose parent closed and spares one whose parent runs', async () => {
    const pool = await poolFor('kardata_test_supervision_child')
    try {
      const parentA = await createSession(pool, 'TEST parent A', scope)
      const parentB = await createSession(pool, 'TEST parent B', scope)
      const childA = randomUUID()
      const childB = randomUUID()
      await appendEvent(pool, { idempotencyKey: randomUUID(), partition: `session:${parentA.id}`, type: 't.subagent.launched', payload: { sessionId: parentA.id, childId: childA, parentSessionId: parentA.id, parentWorkflowId: `session-run-${parentA.id}` } })
      await appendEvent(pool, { idempotencyKey: randomUUID(), partition: `session:${parentB.id}`, type: 't.subagent.launched', payload: { sessionId: parentB.id, childId: childB, parentSessionId: parentB.id, parentWorkflowId: `session-run-${parentB.id}` } })
      await projectNewEvents(pool)
      await leaseOn(pool, parentA.id, `agent:${childA}`, childA)
      await leaseOn(pool, parentB.id, `agent:${childB}`, childB)
      const captured = { signals: [], cancels: [] as string[] }
      const control = runningControl(captured)
      control.describe = async (workflowId: string) => ({ state: workflowId === `session-run-${parentA.id}` ? ('closed' as const) : ('running' as const) })
      await reconcilePage(pool, '', async () => ({ state: 'running' }), Date.now(), () => undefined, control)
      expect(captured.cancels).toEqual([childA])
      const alerts = await pool.query<{ thread_key: string }>('SELECT thread_key FROM alerts')
      expect(alerts.rows.map((row) => row.thread_key)).toEqual([`agent:${childA}`])
    } finally {
      await pool.end()
    }
  })

  it('alerts on starved queues and fails wall-exceeded turns', async () => {
    const pool = await poolFor('kardata_test_supervision_queue_wall')
    try {
      const queued = await createSession(pool, 'TEST queued', scope)
      const walled = await createSession(pool, 'TEST walled', scope)
      await projectNewEvents(pool)
      await appendEvent(pool, { idempotencyKey: randomUUID(), partition: `session:${queued.id}`, type: 't.queue.enqueued', payload: { threadKey: queued.id, text: 'TEST wait' } })
      await projectNewEvents(pool)
      await pool.query(`UPDATE threads SET updated_at = now() - interval '6 minutes' WHERE key = $1`, [queued.id])
      const walledLease = await leaseOn(pool, walled.id, walled.id, `session-run-${walled.id}`)
      await pool.query(`UPDATE execution_intents SET created_at = now() - interval '21 minutes' WHERE epoch = $1`, [walledLease.epoch])
      await recordHeartbeat(pool, `session-run-${walled.id}`, 'TEST op', true)
      const captured = { signals: [], cancels: [] as string[] }
      await reconcilePage(pool, '', async () => ({ state: 'running' }), Date.now(), () => undefined, runningControl(captured))
      await projectNewEvents(pool)
      const alerts = (await listSupervisionAlerts(pool, scope)).items
      expect(alerts.find((alert) => alert.threadKey === queued.id)).toMatchObject({ kind: 'queue-starvation', severity: 'warning' })
      expect(captured.cancels).toEqual([`session-run-${walled.id}`])
      expect((await getThreadHeader(pool, walled.id))?.status).toBe('ERROR')
    } finally {
      await pool.end()
    }
  })

  it('covers 1000 threads inside 60 seconds', async () => {
    const pool = await poolFor('kardata_test_supervision_coverage')
    try {
      await pool.query(`INSERT INTO threads (key, session_id, kind, status, updated_at) SELECT 'TEST-cov-' || g, 'TEST-cov-session', 'session', 'IDLE', now() FROM generate_series(1, 1000) g`)
      await pool.query(`INSERT INTO thread_context (thread_key, active_run, active_lease) SELECT 'TEST-cov-' || g, 'run', 'lease-' || g FROM generate_series(1, 1000) g`)
      let cursor = ''
      let inspected = 0
      const start = Date.now()
      for (;;) {
        const page = await reconcilePage(pool, cursor, async () => ({ state: 'running' }), Date.now(), () => undefined)
        inspected += page.inspected
        cursor = page.cursor
        if (!cursor) break
      }
      expect(inspected).toBe(1000)
      expect(Date.now() - start).toBeLessThan(60_000)
    } finally {
      await pool.end()
    }
  })
})
