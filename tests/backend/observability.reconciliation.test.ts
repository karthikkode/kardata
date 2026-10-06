import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { appendEvent, beginThreadTurn, createSector, createSession, finishSteering, getThreadHeader, listReconciliationCandidates, readTurnContinuation, recordReconciliation, researchHealth, saveTurnContinuation, type ReconciliationCandidate } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { reconcileObservation } from '../../backend/src/observability/reconciliation.js'
import { reconcilePage, type ReconciliationControl } from '../../backend/src/temporal/activities/reconciliation.js'
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
  it('does not nudge a young turn after a long idle gap', () => {
    expect(reconcileObservation(candidate({ progressAtMs: null,runStartedAtMs: now - 5 * 60_000,updatedAtMs: 0 }), { state: 'running' }, now)).toEqual([])
  })
  it('does not flag startup silence or fresh work', () => {
    expect(reconcileObservation(candidate({ heartbeatAtMs: null,progressAtMs: null }), { state: 'running' }, now)).toEqual([])
  })
  it('measures the turn wall clock from the current turn start, not the session workflow age', () => {
    expect(reconcileObservation(candidate({ intentState: 'bound',intentCreatedAtMs: 0,runStartedAtMs: now - 60_000 }), { state: 'running' }, now)).toEqual([])
    expect(reconcileObservation(candidate({ intentState: 'bound',intentCreatedAtMs: 0,runStartedAtMs: now - 25 * 60_000 }), { state: 'running' }, now)).toEqual([expect.objectContaining({ kind: 'turn-wall-exceeded',response: 'fail' })])
    expect(reconcileObservation(candidate({ intentState: 'bound',intentCreatedAtMs: 0,runStartedAtMs: null }), { state: 'running' }, now)).toEqual([])
  })
})

describe.skipIf(!TEST_DATABASE_URL)('reconciliation production DB/projector path [F:backend.activity.reconciliation.reconcilePage] [F:db.reconciliation.recordReconciliation] [F:db.index.appendEvent] [F:db.index.createSector] [F:db.index.createSession] [F:db.workspace_threads.beginThreadTurn] [F:db.workspace_threads.readTurnContinuation] [F:db.workspace_threads.saveTurnContinuation] [F:db.index.getThreadHeader] [F:db.reconciliation.listReconciliationCandidates] [F:db.sectors.createSector] [F:db.index.researchHealth] [F:db.events.appendEvent] [F:db.sessions.createSession] [F:db.threads.getThreadHeader] [F:db.research_health.researchHealth] [F:db.events.DURABLE_STREAM_LOCK_SQL] [F:db.execution_epochs.bindExecutionEpoch] [F:db.index.Db] [F:db.index.TransactableDb] [F:db.workspace.WorkspaceError] [F:db.workspace.requireSector] [F:db.workspace.workspaceTransaction] [F:db.errors.Id] [F:db.errors.checked]', () => {
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
  it('marks the thread CANCELLING when supervision cancels a run', async () => {
    const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_reconcile_cancel') })
    try {
      const session = await createSession(pool,'TEST supervision cancel')
      await projectNewEvents(pool)
      await beginThreadTurn(pool,session.id,'run-cancelled')
      const [found] = await listReconciliationCandidates(pool)
      const recorded = await recordReconciliation(pool,found!,{ kind: 'orphan-child',response: 'cancel',reason: 'TEST parent ended' },0)
      expect(recorded).toBe(true)
      await projectNewEvents(pool)
      expect((await getThreadHeader(pool,session.id))?.status).toBe('CANCELLING')
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
  it('stamps the turn start at lease claim and clears it when the turn ends', async () => {
    const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_reconcile_turnstart') })
    try {
      const session = await createSession(pool,'TEST turn start stamp')
      await projectNewEvents(pool)
      const before = Date.now()
      await beginThreadTurn(pool,session.id,'run-stamp')
      const stamped = (await listReconciliationCandidates(pool))[0]!
      expect(stamped.runStartedAtMs).not.toBeNull()
      expect(stamped.runStartedAtMs!).toBeGreaterThanOrEqual(before)
      expect(stamped.runStartedAtMs!).toBeLessThanOrEqual(Date.now())
      await finishSteering(pool,session.id,'run-stamp')
      expect(await listReconciliationCandidates(pool)).toEqual([])
    } finally { await pool.end() }
  })
  it('leaves a new turn alone after 30 idle minutes', async () => {
    const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_reconcile_idleturn') })
    try {
      const session = await createSession(pool,'TEST idle then new turn')
      await projectNewEvents(pool)
      await appendEvent(pool,{ idempotencyKey: randomUUID(),partition: `session:${session.id}`,type: 't.message.appended',payload: { threadKey: session.id,kind: 'text',message: { role: 'agent',text: 'TEST ancient reply' } } })
      await projectNewEvents(pool)
      await pool.query('UPDATE thread_messages SET at = now() - interval \'30 minutes\' WHERE thread_key=$1',[session.id])
      await pool.query('UPDATE threads SET updated_at = now() - interval \'30 minutes\' WHERE key=$1',[session.id])
      await beginThreadTurn(pool,session.id,'run-fresh')
      await pool.query('UPDATE thread_context SET active_run_started_at = now() - interval \'5 minutes\' WHERE thread_key=$1',[session.id])
      const signals: string[] = []
      const control: ReconciliationControl = {
        describe: async () => ({ state: 'running' as const }),
        signal: async (_workflowId, signalName) => { signals.push(signalName) },
        cancel: async () => { signals.push('cancel') },
      }
      await reconcilePage(pool,'',async () => ({ state: 'running' }),Date.now(),() => undefined,control)
      expect(signals).toEqual([])
      expect((await getThreadHeader(pool,session.id))?.status).not.toBe('PAUSED')
      expect((await getThreadHeader(pool,session.id))?.status).not.toBe('ERROR')
    } finally { await pool.end() }
  })
  it('nudges once then pauses only after a full window [F:db.reconciliation.controlRecordedAt]', async () => {
    const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_reconcile_nudgewait') })
    try {
      const session = await createSession(pool,'TEST nudge window')
      await projectNewEvents(pool)
      await beginThreadTurn(pool,session.id,'run-stuck')
      await pool.query('UPDATE thread_context SET active_run_started_at = now() - interval \'16 minutes\' WHERE thread_key=$1',[session.id])
      await pool.query('UPDATE threads SET updated_at = now() - interval \'16 minutes\' WHERE key=$1',[session.id])
      const signals: string[] = []
      const control: ReconciliationControl = {
        describe: async () => ({ state: 'running' as const }),
        signal: async (_workflowId, signalName) => { signals.push(signalName) },
        cancel: async () => { signals.push('cancel') },
      }
      const inspect = async () => ({ state: 'running' as const })
      await reconcilePage(pool,'',inspect,Date.now(),() => undefined,control)
      expect(signals).toEqual(['runSteer'])
      await reconcilePage(pool,'',inspect,Date.now(),() => undefined,control)
      expect(signals).toEqual(['runSteer'])
      expect((await getThreadHeader(pool,session.id))?.status).not.toBe('PAUSED')
      await pool.query('UPDATE events SET at = now() - interval \'16 minutes\' WHERE type=\'t.reconciliation.finding\' AND payload->>\'response\'=\'nudge\'')
      await reconcilePage(pool,'',inspect,Date.now(),() => undefined,control)
      expect(signals).toEqual(['runSteer','runPause'])
      expect((await getThreadHeader(pool,session.id))?.status).toBe('PAUSED')
    } finally { await pool.end() }
  })
  it('ignores loop evidence from older turns once a new turn begins', async () => {
    const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_reconcile_oldloop') })
    try {
      const session = await createSession(pool,'TEST old loop evidence')
      await projectNewEvents(pool)
      for (let i = 0; i < 2; i++) {
        await appendEvent(pool,{ idempotencyKey: randomUUID(),partition: `session:${session.id}`,type: 't.message.appended',payload: { threadKey: session.id,kind: 'text',message: { role: 'agent',text: 'TEST identical Done.' } } })
      }
      await projectNewEvents(pool)
      await pool.query('UPDATE thread_messages SET at = now() - interval \'30 minutes\' WHERE thread_key=$1',[session.id])
      await pool.query('UPDATE threads SET updated_at = now() - interval \'30 minutes\' WHERE key=$1',[session.id])
      const ancientRound = (await pool.query<{ id: number }>(
        `INSERT INTO execution_rounds (run_id, thread_key, kind, round, attempt, model, provider, started_at, outcome)
         VALUES ('run-ancient', $1, 'chat', 0, 0, 'TEST-model', 'fake', now() - interval '30 minutes', 'ok') RETURNING id`,
        [session.id],
      )).rows[0]!.id
      for (let i = 0; i < 3; i++) {
        await pool.query(
          `INSERT INTO tool_calls (round_id, thread_key, tool, args_hash, outcome, at)
           VALUES ($1, $2, 'db.list_sessions', $3, 'ok', now() - interval '30 minutes')`,
          [ancientRound, session.id, 'cd'.repeat(32)],
        )
      }
      await beginThreadTurn(pool,session.id,'run-fresh')
      const signals: string[] = []
      const control: ReconciliationControl = {
        describe: async () => ({ state: 'running' as const }),
        signal: async (_workflowId, signalName) => { signals.push(signalName) },
        cancel: async () => { signals.push('cancel') },
      }
      await reconcilePage(pool,'',async () => ({ state: 'running' }),Date.now(),() => undefined,control)
      expect(signals).toEqual([])
      expect((await getThreadHeader(pool,session.id))?.status).not.toBe('ERROR')
      const loops = await pool.query('SELECT payload FROM events WHERE type=\'t.loop.detected\'')
      expect(loops.rows).toHaveLength(0)
    } finally { await pool.end() }
  })
  it('stops a turn on identical in-lease assistant replies without cancelling the run', async () => {
    const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_reconcile_textloop') })
    try {
      const session = await createSession(pool,'TEST text loop')
      await projectNewEvents(pool)
      await beginThreadTurn(pool,session.id,'run-loopy')
      for (let i = 0; i < 2; i++) {
        await appendEvent(pool,{ idempotencyKey: randomUUID(),partition: `session:${session.id}`,type: 't.message.appended',payload: { threadKey: session.id,kind: 'text',message: { role: 'agent',text: 'TEST identical Done.' } } })
      }
      await projectNewEvents(pool)
      const signals: string[] = []
      const control: ReconciliationControl = {
        describe: async () => ({ state: 'running' as const }),
        signal: async (_workflowId, signalName) => { signals.push(signalName) },
        cancel: async () => { signals.push('cancel') },
      }
      await reconcilePage(pool,'',async () => ({ state: 'running' }),Date.now(),() => undefined,control)
      expect(signals).toEqual(['runStopTurn'])
      const loops = await pool.query('SELECT payload FROM events WHERE type=\'t.loop.detected\'')
      expect(loops.rows).toHaveLength(1)
      expect((await getThreadHeader(pool,session.id))?.status).not.toBe('ERROR')
      expect((await getThreadHeader(pool,session.id))?.status).not.toBe('PAUSED')
    } finally { await pool.end() }
  })
})
