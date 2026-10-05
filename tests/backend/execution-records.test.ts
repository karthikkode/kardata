import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { beginThreadTurn, createSector, createSession,finishSteering,listThreadExecutionRecords, proposeGlobalContext, readPartition, readRecoveryRequestReference, recordTurnExecution,reserveExecutionIntent, workspaceReferenceSnapshot, type Db } from '../../backend/src/db/index.js'
import { FilesystemTarget, persistExecutionRecord, readExecutionRecord } from '../../backend/src/archive/targets.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('execution record durable ownership [F:db.execution_records.recordTurnExecution] [F:db.execution_records.listThreadExecutionRecords] [F:db.execution_records.readRecoveryRequestReference] [F:db.index.createSector] [F:db.index.createSession] [F:db.index.readPartition] [F:db.workspace_threads.beginThreadTurn] [F:db.workspace_threads.finishSteering] [F:db.execution_epochs.reserveExecutionIntent] [F:db.index.listThreadExecutionRecords] [F:db.workspace_global_context.proposeGlobalContext] [F:db.index.readRecoveryRequestReference] [F:db.index.recordTurnExecution] [F:db.index.workspaceReferenceSnapshot] [F:db.sectors.createSector] [F:db.events.readPartition] [F:db.sessions.createSession] [F:db.workspace_research.workspaceReferenceSnapshot] [F:db.events.DURABLE_STREAM_LOCK_SQL] [F:db.context_files.assertThreadFileContext] [F:db.context_files.validateFileRefs] [F:db.document_units.listDocumentUnitOrdinals] [F:db.errors.WorkspaceError] [F:db.execution_epochs.bindExecutionEpoch] [F:db.index.Db] [F:db.index.TransactableDb] [F:db.workspace.PartialContextSections] [F:db.workspace.WorkspaceError] [F:db.workspace_global_context.notifyWorkspace] [F:db.workspace.requireSector] [F:db.workspace.requireThread] [F:db.workspace.workspaceTransaction] [F:db.errors.Id] [F:db.errors.checked]', () => {
  async function fixture() {
    const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_execution_record') })
    const session = await createSession(pool, 'TEST execution records')
    await projectNewEvents(pool)
    const lease = await beginThreadTurn(pool, session.id, 'TEST original run')
    const archive = new FilesystemTarget(mkdtempSync(join(tmpdir(), 'kardata-test-execution-record-')))
    const record = { version: 1, provider: 'TEST', model: 'TEST model', round: 1, boundary: { contextVersion: 3 }, data: { text: 'TEST exact response', usage: { cacheReadTokens: 31 } } }
    const ref = await persistExecutionRecord(archive, session.id, record)
    const input = { sessionId: session.id, threadKey: session.id, runKey: 'TEST original run', lease, round: 1, kind: 'response' as const, ref }
    return { pool, session, lease, archive, record, input }
  }
  it('deduplicates immutable exact records, retains attempt identity and stores only verified references in DB', async () => {
    const { pool, session, archive, record, input } = await fixture()
    try {
      await recordTurnExecution(pool, input)
      await recordTurnExecution(pool, input)
      const events = (await readPartition(pool, `session:${session.id}`)).filter((event) => event.type === 't.execution.recorded')
      expect(events).toHaveLength(1)
      expect(events[0]?.payload).toEqual(input)
      expect(events[0]?.payload).not.toHaveProperty('data')
      expect(await readExecutionRecord(archive, session.id, input.ref)).toEqual(record)
    } finally { await pool.end() }
  })
  it('rejects stale attempts after replacement without discarding previous records', async () => {
    const { pool, session, input } = await fixture()
    try {
      await recordTurnExecution(pool, input)
      const nextLease = await beginThreadTurn(pool, session.id, 'TEST replacement run')
      await expect(recordTurnExecution(pool, { ...input, kind: 'request' })).rejects.toMatchObject({ code: 'conflict' })
      await recordTurnExecution(pool, { ...input, lease: nextLease, runKey: 'TEST replacement run', kind: 'request' })
      expect((await readPartition(pool, `session:${session.id}`)).filter((event) => event.type === 't.execution.recorded')).toHaveLength(2)
    } finally { await pool.end() }
  })
  it('derives canonical execution lineage from its lease, rejects forged fields and retains lineage after completion',async () => {
    const { pool,session,input }=await fixture()
    try {
      const workflowId=`session-run-${session.id}`
      const ownerEpoch=await reserveExecutionIntent(pool,{ workflowId,threadKey: session.id,sessionId: session.id,requestKey: 'TEST record owner' })
      const executionId=randomUUID()
      const lease=await beginThreadTurn(pool,session.id,input.runKey,{ epoch: ownerEpoch,workflowId,executionId,firstExecutionId: executionId,threadKey: session.id,sessionId: session.id })
      await expect(recordTurnExecution(pool,{ ...input,lease,workflowId: 'TEST forged workflow' })).rejects.toMatchObject({ code: 'conflict' })
      await recordTurnExecution(pool,{ ...input,lease })
      await finishSteering(pool,session.id,input.runKey,lease)
      const records=await listThreadExecutionRecords(pool,session.id)
      expect(records.records).toHaveLength(1)
      expect(records.records[0]).toMatchObject({ workflowId,executionId,ownerEpoch,attemptLease: lease })
      expect((await pool.query('SELECT active_epoch,active_workflow_id,active_execution_id FROM thread_context WHERE thread_key=$1',[session.id])).rows[0]).toEqual({ active_epoch: null,active_workflow_id: null,active_execution_id: null })
    } finally { await pool.end() }
  })
  it('journals compaction rounds beside turn rounds while recovery replays only turn requests', async () => {
    const { pool, session, archive, input } = await fixture()
    try {
      const turnRef = await persistExecutionRecord(archive, session.id, { version: 1, provider: 'TEST', model: 'TEST model', round: 1, boundary: {}, roundKind: 'turn', data: { text: 'TEST turn request' } })
      await recordTurnExecution(pool, { ...input, kind: 'request', roundKind: 'turn', ref: turnRef })
      const compactRef = await persistExecutionRecord(archive, session.id, { version: 1, provider: 'TEST', model: 'TEST model', round: 2, boundary: {}, roundKind: 'compaction', data: { text: 'TEST compaction summary' } })
      await recordTurnExecution(pool, { ...input, round: 2, kind: 'request', roundKind: 'compaction', ref: compactRef })
      const records = await listThreadExecutionRecords(pool, session.id)
      expect(records.records.map((entry) => [entry.round, entry.kind, entry.roundKind])).toEqual([[1, 'request', 'turn'], [2, 'request', 'compaction']])
      const recovery = await readRecoveryRequestReference(pool, session.id, 'TEST original run')
      expect(recovery?.metadata).toMatchObject({ round: 1, roundKind: 'turn' })
    } finally { await pool.end() }
  })
  it('rejects cross-session attribution even with a valid current lease', async () => {
    const { pool, session, input } = await fixture()
    try {
      const other = await createSession(pool, 'TEST unrelated execution')
      await projectNewEvents(pool)
      await expect(recordTurnExecution(pool, { ...input, sessionId: other.id })).rejects.toMatchObject({ code: 'permission_denied' })
      await expect(recordTurnExecution(pool, { ...input, runKey: 'TEST forged attribution' })).rejects.toMatchObject({ code: 'conflict' })
      expect((await readPartition(pool, `session:${session.id}`)).some((event) => event.type === 't.execution.recorded')).toBe(false)
    } finally { await pool.end() }
  })
  it('retries a mid-assembly owner edit instead of stamping new content with an old version', async () => {
    const { pool } = await fixture()
    try {
      const { sectorId } = await createSector(pool, { name: 'TEST round context', initialState: 'draft' })
      await projectNewEvents(pool)
      const session = await createSession(pool, 'TEST scoped context', undefined, sectorId)
      await projectNewEvents(pool)
      let edited = false
      const interrupted: Db = { query: async <R>(sql: string, values?: unknown[]) => {
        const result = await pool.query(sql, values)
        // Fault at the actual DB read boundary, after old rows are captured.
        if (sql === 'SELECT * FROM sector_workspace WHERE sector_id=$1' && !edited) {
          edited = true
          await proposeGlobalContext(pool, { sectorId, sourceThread: session.id, owner: true, baseVersion: 0, sections: { scope: 'TEST scope', instructions: '', decisions: '', findings: 'TEST fresh owner finding', questions: '' } })
        }
        return { rows: result.rows as R[], rowCount: result.rowCount }
      } }
      const snapshot = await workspaceReferenceSnapshot(interrupted, sectorId, session.id)
      expect(snapshot.contextVersion).toBe(1)
      expect(snapshot.references.join('\n')).toContain('TEST fresh owner finding')
      expect(snapshot.planVersion).toBeNull()
    } finally { await pool.end() }
  })
})
