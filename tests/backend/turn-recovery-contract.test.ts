import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { defaultPayloadConverter } from '@temporalio/common'
import type { Client } from '@temporalio/client'
import { describe,expect,it } from 'vitest'
import { beginThreadTurn,createSession,recordTurnExecution,reserveExecutionIntent,recoveryCheckpointHash,readTurnContinuation,saveTurnContinuation,type TurnContinuation } from '../../backend/src/db/index.js'
import { loadOriginalTurnRecovery } from '../../backend/src/temporal/turn-recovery.js'
import { FilesystemTarget,persistExecutionRecord } from '../../backend/src/archive/targets.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb,TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('owner recovery rejects false original contracts and changed checkpoints',() => {
  async function fixture() {
    const pool=new Pool({ connectionString: await ensureTestDb('kardata_test_recovery_contract') })
    const session=await createSession(pool,'TEST protected original'); await projectNewEvents(pool)
    const workflowId=`session-run-${session.id}`; const epoch=await reserveExecutionIntent(pool,{ workflowId,threadKey: session.id,sessionId: session.id,requestKey: randomUUID() }); const executionId=randomUUID()
    const owner={ epoch,workflowId,executionId,firstExecutionId: executionId,threadKey: session.id,sessionId: session.id }
    const lease=await beginThreadTurn(pool,session.id,'TEST logical original',owner)
    const saved: TurnContinuation={ user: 'TEST exact original user',runKey: 'TEST logical original',messages: [{ role: 'user',text: 'TEST exact original user' }],sources: [],meta: { round: 1,toolCalls: 0,elapsedMs: 10,usage: { inputTokens: 1,outputTokens: 2,cacheReadTokens: 0,cacheWriteTokens: 0,cacheHitTokens: 0,cacheMissTokens: 0 } } }
    await saveTurnContinuation(pool,session.id,saved,lease)
    const archive=new FilesystemTarget(mkdtempSync(join(tmpdir(),'kardata-contract-')))
    const ref=await persistExecutionRecord(archive,session.id,{ provider: 'fake',model: null,boundary: {},data: { tools: [{ name: 'db.list_sessions' }],reasoningEffort: 'low' } })
    await recordTurnExecution(pool,{ sessionId: session.id,threadKey: session.id,runKey: saved.runKey,lease,round: 1,kind: 'request',ref })
    const args={ sessionId: session.id,threadKey: session.id,runKey: saved.runKey,text: saved.user,ownerEpoch: epoch,ownerFirstExecutionId: executionId,mode: 'brainstorm',toolAllow: ['db.list_sessions'] }
    let pages=0
    const client=(input: unknown,forever=false) => ({ options: { namespace: 'TEST' },connection: { withDeadline: async (_deadline: unknown,fn: () => Promise<unknown>) => fn(),workflowService: { getWorkflowExecutionHistoryReverse: async () => { pages++; return { history: { events: [{ activityTaskScheduledEventAttributes: { activityType: { name: 'karbotTurnActivity' },input: { payloads: [defaultPayloadConverter.toPayload(input)] } } }] },nextPageToken: forever ? new Uint8Array([1]) : new Uint8Array() } } } } } as unknown as Client)
    return { pool,session,owner,args,saved,lease,archive,client,get pages() { return pages } }
  }
  it('rejects a foreign scheduled input even when prompt and logical key match',async () => {
    const f=await fixture()
    try { await expect(loadOriginalTurnRecovery(f.pool,f.client({ ...f.args,threadKey: 'TEST foreign thread' }),f.session.id,f.archive)).rejects.toMatchObject({ code: 'conflict' }) }
    finally { await f.pool.end() }
  })
  it('preserves nested original grant/mode on repeated recovery and uses verified request manifest',async () => {
    const f=await fixture()
    try {
      const recovered=await loadOriginalTurnRecovery(f.pool,f.client({ ...f.args,toolAllow: ['TEST expanded outer grant'],mode: 'plan',recovery: { originalInput: { toolAllow: ['db.list_sessions'],mode: 'brainstorm' } } }),f.session.id,f.archive)
      expect(recovered.originalInput).toEqual({ toolAllow: ['db.list_sessions'],mode: 'brainstorm' })
      expect(recovered.allowedTools).toEqual(['db.list_sessions'])
      expect(recovered.selection).toEqual({ provider: 'fake',model: null,reasoningEffort: 'low' })
    } finally { await f.pool.end() }
  })
  it('bounds history pages and rejects changed checkpoint before ownership replacement',async () => {
    const f=await fixture()
    try {
      await expect(loadOriginalTurnRecovery(f.pool,f.client({ ...f.args,runKey: 'TEST unrelated' },true),f.session.id,f.archive)).rejects.toMatchObject({ code: 'conflict' })
      expect(f.pages).toBe(10)
      const hash=recoveryCheckpointHash((await readTurnContinuation(f.pool,f.session.id))!)
      await saveTurnContinuation(f.pool,f.session.id,{ ...f.saved,meta: { ...f.saved.meta,round: 2 } },f.lease)
      await expect(beginThreadTurn(f.pool,f.session.id,f.saved.runKey,f.owner,{ runKey: f.saved.runKey,user: f.saved.user,checkpointHash: hash })).rejects.toMatchObject({ code: 'conflict' })
      expect((await f.pool.query('SELECT active_lease FROM thread_context WHERE thread_key=$1',[f.session.id])).rows[0]?.active_lease).toBe(f.lease)
    } finally { await f.pool.end() }
  })
})
