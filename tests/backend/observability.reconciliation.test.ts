import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { appendEvent, beginThreadTurn, createSector, createSession, getThreadHeader, listReconciliationCandidates, readTurnContinuation, recordReconciliation, researchHealth, saveTurnContinuation, type ReconciliationCandidate } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { reconcileObservation } from '../../backend/src/observability/reconciliation.js'
import { reconcilePage } from '../../backend/src/temporal/activities/reconciliation.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const now = 2_000_000
const candidate = (overrides: Partial<ReconciliationCandidate> = {}): ReconciliationCandidate => ({ threadKey: 's',sessionId: 's',workflowId: 'session-run-s',status: 'RUNNING',queueDepth: 0,updatedAtMs: now - 1_000,heartbeatAtMs: now - 1_000,progressAtMs: now - 1_000,activeRun: 'r',lease: 'lease',sessionDeleted: false,...overrides })

describe('bounded execution reconciliation policy', () => {
  it('nudges once on stale semantic progress; the page escalates a repeated nudge to pause', () => {
    const findings = reconcileObservation(candidate({ progressAtMs: now - 1_000_000 }), { state: 'running' }, now)
    expect(findings).toEqual([expect.objectContaining({ kind: 'stalled-progress', response: 'nudge' })])
  })
  it('does not turn missing heartbeats or an unavailable owner into death', () => {
    expect(reconcileObservation(candidate({ heartbeatAtMs: now - 200_000 }), { state: 'running' }, now)).toEqual([expect.objectContaining({ kind: 'missing-heartbeat',response: 'observe' })])
    expect(reconcileObservation(candidate(), { state: 'unavailable' }, now)).toEqual([expect.objectContaining({ kind: 'owner-unavailable',response: 'observe' })])
  })
  it('alerts the owner on starved queues without claiming the work executes', () => {
    expect(reconcileObservation(candidate({ lease: null,queueDepth: 1000,updatedAtMs: now - 400_000 }), { state: 'running' }, now)).toEqual([expect.objectContaining({ kind: 'queue-starvation',response: 'alert' })])
  })
  it('keeps confirmed terminal ownership advisory until restart intents can be fenced', () => {
    expect(reconcileObservation(candidate(), { state: 'closed' }, now)).toEqual([expect.objectContaining({ kind: 'closed-owner',response: 'observe' })])
  })
  it('does not flag startup silence or fresh work', () => {
    expect(reconcileObservation(candidate({ heartbeatAtMs: null,progressAtMs: null }), { state: 'running' }, now)).toEqual([])
  })
})

describe.skipIf(!TEST_DATABASE_URL)('reconciliation production DB/projector path [F:backend.activity.reconciliation.reconcilePage] [F:db.reconciliation.recordReconciliation]', () => {
  it('records an unfenced closed owner as observe-only, retaining lease/continuation with no UI notice', async () => {
    const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_reconcile') })
    try {
      const session = await createSession(pool,'TEST isolated reconciliation')
      await projectNewEvents(pool)
      const lease = await beginThreadTurn(pool,session.id,'turn-one')
      await saveTurnContinuation(pool,session.id,{ user: 'TEST pending original',runKey: 'turn-one',messages: [],sources: [],meta: { round: 0,usage: { inputTokens: 0,outputTokens: 0,cacheReadTokens: 0,cacheWriteTokens: 0,cacheHitTokens: 0,cacheMissTokens: 0 },toolCalls: 0,elapsedMs: 0 } },lease)
      const first = await reconcilePage(pool,'',async () => ({ state: 'closed' }))
      expect(first).toMatchObject({ inspected: 1,findings: 1 })
      expect((await getThreadHeader(pool,session.id))?.status).not.toBe('PAUSED')
      expect(await readTurnContinuation(pool,session.id)).toMatchObject({ runKey: 'turn-one',user: 'TEST pending original' })
      const rows = await pool.query('SELECT active_lease,active_run FROM thread_context WHERE thread_key=$1',[session.id])
      expect(rows.rows[0]).toEqual({ active_lease: lease,active_run: 'turn-one' })
      expect(await reconcilePage(pool,'',async () => ({ state: 'closed' }))).toMatchObject({ inspected: 1,findings: 0 })
      const notices = await pool.query("SELECT payload FROM events WHERE type='t.reconciliation.finding'")
      expect(notices.rows).toHaveLength(1)
      const messages = await pool.query('SELECT payload FROM thread_messages WHERE thread_key=$1',[session.id])
      expect(messages.rows).toHaveLength(0)
    } finally { await pool.end() }
  })
  it('cannot clear a new attempt or turn a DB/owner outage into terminal state', async () => {
    const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_reconcile_fence') })
    try {
      const session = await createSession(pool,'TEST newer owner')
      await projectNewEvents(pool)
      await beginThreadTurn(pool,session.id,'old-run')
      const old = (await listReconciliationCandidates(pool))[0]!
      const freshLease = await beginThreadTurn(pool,session.id,'new-run')
      const finding = reconcileObservation(old,{ state: 'closed' },Date.now())[0]!
      expect(await recordReconciliation(pool,old,finding,1)).toBe(false)
      await reconcilePage(pool,'',async () => ({ state: 'unavailable' }))
      const rows = await pool.query('SELECT active_lease FROM thread_context WHERE thread_key=$1',[session.id])
      expect(rows.rows[0]?.active_lease).toBe(freshLease)
      expect((await getThreadHeader(pool,session.id))?.status).not.toBe('PAUSED')
      await expect(reconcilePage(pool,'',async () => { throw new Error('TEST adapter failed') })).rejects.toThrow('TEST adapter failed')
      expect((await getThreadHeader(pool,session.id))?.status).not.toBe('PAUSED')
    } finally { await pool.end() }
  })
  it('separates user messages and unrelated fleet heartbeats from durable agent progress', async () => {
    const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_reconcile_scope') })
    try {
      const session = await createSession(pool,'TEST scoped observation')
      await projectNewEvents(pool)
      await beginThreadTurn(pool,session.id,'run')
      await appendEvent(pool,{ idempotencyKey: randomUUID(),partition: `session:${session.id}`,type: 't.message.appended',payload: { threadKey: session.id,kind: 'text',message: { role: 'user',text: 'TEST user is not agent progress' } } })
      await pool.query("INSERT INTO heartbeats(run_id,op,at,busy) VALUES('unrelated','turn',now(),true)")
      await projectNewEvents(pool)
      const observation = (await listReconciliationCandidates(pool))[0]!
      expect(observation.heartbeatAtMs).toBeNull()
      expect(observation.progressAtMs).toBeNull()
      await appendEvent(pool,{ idempotencyKey: randomUUID(),partition: `session:${session.id}`,type: 't.message.appended',payload: { threadKey: session.id,kind: 'text',message: { role: 'agent',text: 'TEST durable completion' } } })
      await projectNewEvents(pool)
      expect((await listReconciliationCandidates(pool))[0]?.progressAtMs).not.toBeNull()
      await expect(listReconciliationCandidates(pool,'',101)).rejects.toThrow('limit')
    } finally { await pool.end() }
  })
  it('returns only the queried sector session/thread supervision history', async () => {
    const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_reconcile_health') })
    try {
      const scope = { tenantId: 'TEST-owner',projectId: null }
      const sector = await createSector(pool,{ name: 'TEST scoped health',scope,initialState: 'running' })
      await projectNewEvents(pool)
      const session = await createSession(pool,'TEST scoped thread',scope,sector.sectorId)
      await projectNewEvents(pool)
      for (const partition of [`session:${session.id}`,'session:TEST-unrelated']) await appendEvent(pool,{ idempotencyKey: randomUUID(),partition,type: 't.reconciliation.finding',payload: { threadKey: session.id,kind: 'missing-heartbeat',response: 'observe',reason: 'TEST safe observation' } })
      const health = await researchHealth(pool,sector.sectorId,scope)
      expect(health.recentSupervision).toEqual([expect.objectContaining({ threadKey: session.id,kind: 'missing-heartbeat',response: 'observe' })])
      await expect(researchHealth(pool,sector.sectorId,{ tenantId: 'TEST-outsider',projectId: null })).rejects.toThrow('unknown sector')
      await appendEvent(pool,{ idempotencyKey: randomUUID(),partition: `session:${session.id}`,type: 't.thread.state',payload: { threadKey: session.id,status: 'PAUSED',acceptingSteer: false } })
      await projectNewEvents(pool)
      expect(await researchHealth(pool,sector.sectorId,scope)).toMatchObject({ liveThreads: 0,stale: true })
    } finally { await pool.end() }
  })
  it('attributes planning leases to the sector-plan owner and its beats, never the normal chat owner', async () => {
    const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_reconcile_plan') })
    try {
      const scope = { tenantId: 'TEST-owner',projectId: null }
      const sector = await createSector(pool,{ name: 'TEST planning ownership',scope })
      await projectNewEvents(pool)
      const session = await createSession(pool,'TEST persistent planning thread',scope,sector.sectorId)
      await projectNewEvents(pool)
      await beginThreadTurn(pool,session.id,`plan:${sector.sectorId}:${randomUUID()}`)
      await pool.query("INSERT INTO heartbeats(run_id,op,at,busy) VALUES($1,'karbot.turn',now(),true)",[`sector-plan-${sector.sectorId}`])
      const planning = (await listReconciliationCandidates(pool))[0]!
      expect(planning.workflowId).toBe(`sector-plan-${sector.sectorId}`)
      expect(planning.heartbeatAtMs).not.toBeNull()
      expect(reconcileObservation(planning,{ state: 'running' },Date.now())).toEqual([])
      await beginThreadTurn(pool,session.id,'plan:TEST-wrong-sector')
      expect((await listReconciliationCandidates(pool))[0]?.workflowId).toBeNull()
    } finally { await pool.end() }
  })
})
