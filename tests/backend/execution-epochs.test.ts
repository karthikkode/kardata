import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { appendEvent,beginThreadTurn,confirmExecutionIntent,createSession,getThreadHeader,listReconciliationCandidates,markExecutionIntent,recordReconciliation,reserveExecutionIntent,type EpochOwnership } from '../../backend/src/db/index.js'
import { reconcileObservation } from '../../backend/src/observability/reconciliation.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb,TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('private execution epoch durability and recovery fences [F:db.index.appendEvent] [F:db.index.createSession] [F:db.workspace_threads.beginThreadTurn] [F:db.execution_epochs.confirmExecutionIntent] [F:db.index.getThreadHeader] [F:db.reconciliation.listReconciliationCandidates] [F:db.execution_epochs.markExecutionIntent] [F:db.execution_epochs.reserveExecutionIntent] [F:db.events.appendEvent] [F:db.sessions.createSession] [F:db.threads.getThreadHeader] [F:db.events.DURABLE_STREAM_LOCK_SQL] [F:db.execution_epochs.bindExecutionEpoch] [F:db.index.Db] [F:db.index.TransactableDb] [F:db.workspace.workspaceTransaction] [F:db.errors.Id] [F:db.errors.checked]',() => {
  async function fixture() {
    const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_execution_epoch') })
    const session = await createSession(pool,'TEST execution epoch')
    await projectNewEvents(pool)
    const input = { sessionId: session.id,threadKey: session.id,workflowId: `session-run-${session.id}`,requestKey: randomUUID() }
    const epoch = await reserveExecutionIntent(pool,input)
    const executionId = randomUUID()
    const owner: EpochOwnership = { ...input,epoch,executionId,firstExecutionId: executionId }
    await beginThreadTurn(pool,session.id,'TEST original turn',owner)
    return { pool,session,input,epoch,owner }
  }
  it('deduplicates preparation and validates exact private thread/workflow ownership',async () => {
    const { pool,input,epoch,owner } = await fixture()
    try {
      expect(await reserveExecutionIntent(pool,input)).toBe(epoch)
      expect((await pool.query('SELECT count(*)::int AS n FROM execution_intents')).rows[0]?.n).toBe(1)
      await expect(beginThreadTurn(pool,input.threadKey,'TEST forged workflow',{ ...owner,workflowId: 'TEST-other' })).rejects.toThrow('ownership conflicts')
      await expect(beginThreadTurn(pool,input.threadKey,'TEST unsupported late legacy')).rejects.toMatchObject({ code: 'conflict' })
      expect((await listReconciliationCandidates(pool))[0]?.activeExecutionId).toBe(owner.executionId)
    } finally { await pool.end() }
  }, 15_000)
  it('fails only exact confirmed terminal ownership as orphaned, then a validated successor supersedes recovery',async () => {
    const { pool,input,owner } = await fixture()
    try {
      const candidate = (await listReconciliationCandidates(pool))[0]!
      const closed = reconcileObservation(candidate,{ state: 'closed',executionId: owner.executionId },Date.now())[0]!
      expect(closed.response).toBe('fail')
      expect(await recordReconciliation(pool,candidate,closed,1)).toBe(true)
      await projectNewEvents(pool)
      expect((await getThreadHeader(pool,input.threadKey))?.status).toBe('ERROR')
      const epoch = await reserveExecutionIntent(pool,{ ...input,requestKey: 'TEST successor' })
      const executionId = randomUUID()
      await beginThreadTurn(pool,input.threadKey,'TEST successor turn',{ ...owner,epoch,executionId,firstExecutionId: executionId })
      await projectNewEvents(pool)
      expect((await getThreadHeader(pool,input.threadKey))?.status).toBe('RUNNING')
      await expect(beginThreadTurn(pool,input.threadKey,'TEST late old begin',owner)).rejects.toThrow('newer execution')
    } finally { await pool.end() }
  }, 15_000)
  it('projects the orphan reason code onto the thread and clears it on revival',async () => {
    const { pool,input,owner } = await fixture()
    try {
      const candidate = (await listReconciliationCandidates(pool))[0]!
      const closed = reconcileObservation(candidate,{ state: 'closed',executionId: owner.executionId },Date.now())[0]!
      expect(closed.kind).toBe('closed-owner')
      expect(await recordReconciliation(pool,candidate,closed,1)).toBe(true)
      await projectNewEvents(pool)
      const failed = await getThreadHeader(pool,input.threadKey)
      expect(failed?.status).toBe('ERROR')
      expect(failed?.stateReason).toBe('closed-owner')
      const epoch = await reserveExecutionIntent(pool,{ ...input,requestKey: 'TEST revived successor' })
      const executionId = randomUUID()
      await beginThreadTurn(pool,input.threadKey,'TEST revived turn',{ ...owner,epoch,executionId,firstExecutionId: executionId })
      await projectNewEvents(pool)
      const revived = await getThreadHeader(pool,input.threadKey)
      expect(revived?.status).toBe('RUNNING')
      expect(revived?.stateReason).toBeUndefined()
    } finally { await pool.end() }
  }, 15_000)
  it('blocks stale recovery at the committed pre-start boundary before any successor event or lease',async () => {
    const { pool,input,owner } = await fixture()
    try {
      const candidate = (await listReconciliationCandidates(pool))[0]!
      const closed = reconcileObservation(candidate,{ state: 'closed',executionId: owner.executionId },Date.now())[0]!
      await reserveExecutionIntent(pool,{ ...input,requestKey: 'TEST queued successor' })
      expect(await recordReconciliation(pool,candidate,closed,1)).toBe(false)
      const fresh = (await listReconciliationCandidates(pool))[0]!
      expect(fresh.unresolvedStart).toBe(true)
      expect(reconcileObservation(fresh,{ state: 'closed',executionId: owner.executionId },Date.now())[0]?.response).toBe('observe')
      expect(fresh.activeExecutionId).toBe(owner.executionId)
      expect((await getThreadHeader(pool,input.threadKey))?.status).not.toBe('PAUSED')
    } finally { await pool.end() }
  }, 15_000)
  it('retains expired/unknown outcomes; a proven before-dispatch failure can restore existing ownership',async () => {
    const { pool,input,owner } = await fixture()
    try {
      const failed = await reserveExecutionIntent(pool,{ ...input,requestKey: 'TEST before dispatch' })
      await markExecutionIntent(pool,failed,true)
      expect((await listReconciliationCandidates(pool))[0]?.currentEpoch).toBe(owner.epoch)
      const unknown = await reserveExecutionIntent(pool,{ ...input,requestKey: 'TEST lost receipt' })
      await markExecutionIntent(pool,unknown)
      await pool.query("UPDATE execution_intents SET deadline_at=now()-interval '1 hour' WHERE epoch=$1",[unknown])
      const candidate = (await listReconciliationCandidates(pool))[0]!
      expect(candidate.unresolvedStart).toBe(true)
      expect(reconcileObservation(candidate,{ state: 'unavailable' },Date.now())[0]?.response).toBe('observe')
      expect(reconcileObservation(candidate,{ state: 'closed',executionId: owner.executionId },Date.now())[0]?.response).toBe('observe')
    } finally { await pool.end() }
  }, 15_000)
  it('ordinary signals adopt canonical ownership while older concurrent unknown requests keep blocking recovery',async () => {
    const { pool,input,owner } = await fixture()
    try {
      const unknown = await reserveExecutionIntent(pool,{ ...input,requestKey: 'TEST older unknown' })
      const signal = await reserveExecutionIntent(pool,{ ...input,requestKey: 'TEST ordinary signal' })
      expect(await confirmExecutionIntent(pool,{ ...owner,epoch: signal })).toBe(owner.epoch)
      const current = (await listReconciliationCandidates(pool))[0]!
      expect(current.currentEpoch).toBe(owner.epoch)
      expect(current.unresolvedStart).toBe(true)
      const observed=reconcileObservation(current,{ state: 'closed',executionId: owner.executionId },Date.now())[0]!
      expect(observed.response).toBe('observe')
      expect(await recordReconciliation(pool,current,observed,1)).toBe(true)
      await projectNewEvents(pool)
      expect(await confirmExecutionIntent(pool,{ ...owner,epoch: unknown })).toBe(owner.epoch)
      const settled=(await listReconciliationCandidates(pool))[0]!
      expect(settled.unresolvedStart).toBe(false)
      const recovery=reconcileObservation(settled,{ state: 'closed',executionId: owner.executionId },Date.now())[0]!
      expect(recovery.response).toBe('fail')
      expect(await recordReconciliation(pool,settled,recovery,1)).toBe(true)
      const decisions=await pool.query("SELECT payload->>'response' AS response FROM events WHERE type='t.reconciliation.finding' ORDER BY seq")
      expect(decisions.rows.map((row) => row.response)).toEqual(['observe','fail'])
    } finally { await pool.end() }
  }, 15_000)
  it('advances a continuation only from its predecessor, rejecting old-run callbacks and observations',async () => {
    const { pool,input,owner } = await fixture()
    try {
      const old = (await listReconciliationCandidates(pool))[0]!
      const closed = reconcileObservation(old,{ state: 'closed',executionId: owner.executionId },Date.now())[0]!
      const nextExecution = randomUUID()
      const signal = await reserveExecutionIntent(pool,{ ...input,requestKey: 'TEST continuation signal' })
      await confirmExecutionIntent(pool,{ ...owner,epoch: signal,executionId: nextExecution })
      expect((await listReconciliationCandidates(pool))[0]?.unresolvedStart).toBe(true)
      await beginThreadTurn(pool,input.threadKey,'TEST continued turn',{ ...owner,executionId: nextExecution,continuedFromExecutionId: owner.executionId })
      const continued = (await listReconciliationCandidates(pool))[0]!
      expect(continued.currentEpoch).toBe(owner.epoch)
      expect(continued.activeExecutionId).toBe(nextExecution)
      expect(continued.unresolvedStart).toBe(false)
      expect(await recordReconciliation(pool,old,closed,1)).toBe(false)
      await expect(beginThreadTurn(pool,input.threadKey,'TEST stale continuation',owner)).rejects.toThrow('move backwards')
    } finally { await pool.end() }
  }, 15_000)
  it('does not override owner-controlled pause when acquiring an otherwise valid epoch',async () => {
    const { pool,input,owner } = await fixture()
    try {
      await appendEvent(pool,{ idempotencyKey: randomUUID(),partition: `session:${input.sessionId}`,type: 't.thread.state',payload: { threadKey: input.threadKey,status: 'PAUSED',acceptingSteer: false } })
      await projectNewEvents(pool)
      await beginThreadTurn(pool,input.threadKey,'TEST retry behind manual pause',owner)
      await projectNewEvents(pool)
      expect((await getThreadHeader(pool,input.threadKey))?.status).toBe('PAUSED')
    } finally { await pool.end() }
  }, 15_000)
})
