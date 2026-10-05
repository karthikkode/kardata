import { randomUUID } from 'node:crypto'
import { dirname,join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client,WorkflowClient } from '@temporalio/client'
import { Context } from '@temporalio/activity'
import { Runtime,Worker } from '@temporalio/worker'
import { msToTs } from '@temporalio/common/lib/time.js'
import { Pool } from 'pg'
import { beforeAll,describe,expect,it,vi } from 'vitest'
import { appendEvent,beginThreadTurn,createSession,listReconciliationCandidates,markExecutionIntent,recordReconciliation,reserveExecutionIntent } from '../../backend/src/db/index.js'
import { TemporalRunsGateway } from '../../backend/src/temporal/runs-gateway.js'
import { connectClient,connectWorker } from '../../backend/src/temporal/connection.js'
import { inspectWorkflowOwner,reconcilePage } from '../../backend/src/temporal/activities/reconciliation.js'
import { reconcileObservation } from '../../backend/src/observability/reconciliation.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { createWorkerLogger } from '../../backend/src/observability/logging.js'
import { ensureTestDb,TEST_DATABASE_URL } from './db-helper.js'

const enabled = process.env['KARDATA_TEMPORAL_TEST'] === '1' && !!TEST_DATABASE_URL
const base = dirname(fileURLToPath(import.meta.url))
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done }); return { promise,resolve } }
async function waitFor(check: () => boolean | Promise<boolean>) { const until = Date.now()+10_000; while (!(await check())) { if (Date.now()>until) throw new Error('TEST owned execution did not reach its boundary'); await new Promise((done) => setTimeout(done,50)) } }

describe.skipIf(!enabled)('private epoch authority through real gateway/Temporal/isolated DB',() => {
  beforeAll(() => { Runtime.install({ logger: createWorkerLogger() }) })
  it('fences a same-ID restart after reserve but before its first event/lease, then safely parks its exact terminal successor',async () => {
    const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_epoch_gateway') })
    const connection = await connectClient()
    const native = await connectWorker()
    const namespace = `test-epochs-${randomUUID()}`
    await connection.workflowService.registerNamespace({ namespace,workflowExecutionRetentionPeriod: msToTs(86400000) })
    const previous = process.env['TEMPORAL_NAMESPACE']; process.env['TEMPORAL_NAMESPACE']=namespace
    const client = new Client({ connection,namespace })
    const gates = [deferred(),deferred()]
    let calls = 0
    const worker = await Worker.create({ connection: native,namespace,taskQueue: 'kardata-turn-v1',workflowsPath: join(base,'../../backend/src/temporal/workflows/run.ts'),activities: {
      appendEventActivity: async (input: unknown) => { await appendEvent(pool,input); await projectNewEvents(pool) },
      karbotTurnActivity: async (input: { sessionId: string; threadKey: string; runKey: string; ownerEpoch: string; ownerFirstExecutionId: string; ownerContinuedFromExecutionId?: string }) => {
        const actual = Context.current().info.workflowExecution!
        await beginThreadTurn(pool,input.threadKey,input.runKey,{ epoch: input.ownerEpoch,workflowId: actual.workflowId,executionId: actual.runId,firstExecutionId: input.ownerFirstExecutionId,continuedFromExecutionId: input.ownerContinuedFromExecutionId,sessionId: input.sessionId,threadKey: input.threadKey })
        const call = calls++
        await gates[call]!.promise
        // Deliberate lost-finalizer fault: retain lease as a crashed worker
        // would. Provider content is scripted, never Meta/pilot evidence.
        return { reply: 'TEST controlled reply',toolCalls: [] }
      },
    } })
    const rpcGate = deferred(); let heldRpc = false; let holdNext = false
    const original = WorkflowClient.prototype.signalWithStart
    const intercept = vi.spyOn(WorkflowClient.prototype,'signalWithStart').mockImplementation(async function(this: WorkflowClient,...args: Parameters<typeof original>) {
      if (holdNext) { holdNext=false; heldRpc=true; await rpcGate.promise }
      return original.apply(this,args)
    })
    try {
      const session = await createSession(pool,'TEST gateway start fence'); await projectNewEvents(pool)
      const gateway = new TemporalRunsGateway(pool,connection)
      await worker.runUntil(async () => {
        await gateway.send(session.id,'TEST first run'); await waitFor(() => calls===1)
        const old = (await listReconciliationCandidates(pool))[0]!
        await client.workflow.getHandle(old.workflowId!,old.activeExecutionId!).terminate('TEST isolated lost worker finalizer')
        const observed = await inspectWorkflowOwner(connection,client,old)
        expect(observed.state).toBe('closed')
        const finding = reconcileObservation(old,observed,Date.now())[0]!
        expect(finding.response).toBe('park')
        holdNext=true
        const sending = gateway.send(session.id,'TEST successor'); await waitFor(() => heldRpc)
        expect(await recordReconciliation(pool,old,finding,1)).toBe(false)
        expect((await listReconciliationCandidates(pool))[0]?.unresolvedStart).toBe(true)
        rpcGate.resolve(); await sending; await waitFor(() => calls===2)
        const fresh = (await listReconciliationCandidates(pool))[0]!
        expect(fresh.activeExecutionId).not.toBe(old.activeExecutionId)
        expect((await inspectWorkflowOwner(connection,client,fresh)).state).toBe('running')
        expect(await recordReconciliation(pool,old,finding,1)).toBe(false)
        await client.workflow.getHandle(fresh.workflowId!,fresh.activeExecutionId!).terminate('TEST isolated exact terminal successor')
        expect(await reconcilePage(pool,'',(row) => inspectWorkflowOwner(connection,client,row))).toMatchObject({ findings: 1 })
        const state = await pool.query('SELECT status FROM threads WHERE key=$1',[session.id]); expect(state.rows[0]?.status).toBe('PAUSED')
        gates.forEach((gate) => gate.resolve())
      })
    } finally { intercept.mockRestore(); rpcGate.resolve(); gates.forEach((gate) => gate.resolve()); if (previous===undefined) delete process.env['TEMPORAL_NAMESPACE']; else process.env['TEMPORAL_NAMESPACE']=previous; await connection.close(); await native.close(); await pool.end() }
  },60_000)

  it('retains canonical epoch across an actual ContinueAsNew chain and denies an older closed-run observation',async () => {
    const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_epoch_chain') })
    const connection = await connectClient(); const native = await connectWorker(); const namespace = `test-epoch-chain-${randomUUID()}`
    await connection.workflowService.registerNamespace({ namespace,workflowExecutionRetentionPeriod: msToTs(86400000) })
    const client = new Client({ connection,namespace }); const queue = `epoch-chain-${randomUUID()}`
    const gates = [deferred(),deferred()]; let calls=0
    const worker = await Worker.create({ connection: native,namespace,taskQueue: queue,workflowsPath: join(base,'temporal/epoch-workflows.ts'),activities: {
      epochLease: async (input: { sessionId: string; epoch: string; firstExecutionId: string; continuedFromExecutionId?: string; stage: number }) => {
        const actual=Context.current().info.workflowExecution!
        await beginThreadTurn(pool,input.sessionId,`TEST stage ${input.stage}`,{ epoch: input.epoch,workflowId: actual.workflowId,executionId: actual.runId,firstExecutionId: input.firstExecutionId,continuedFromExecutionId: input.continuedFromExecutionId,threadKey: input.sessionId,sessionId: input.sessionId })
        calls++; await gates[input.stage]!.promise
      },
    } })
    try {
      const session=await createSession(pool,'TEST continuation ownership'); await projectNewEvents(pool)
      const workflowId=`session-run-${session.id}`; const epoch=await reserveExecutionIntent(pool,{ workflowId,threadKey: session.id,sessionId: session.id,requestKey: randomUUID() })
      await worker.runUntil(async () => {
        const handle=await client.workflow.start('epochContinuation',{ workflowId,taskQueue: queue,args: [{ sessionId: session.id,epoch }] })
        await waitFor(() => calls===1); const old=(await listReconciliationCandidates(pool))[0]!
        gates[0]!.resolve(); await waitFor(() => calls===2)
        const current=(await listReconciliationCandidates(pool))[0]!
        expect(current.activeEpoch).toBe(epoch); expect(current.activeExecutionId).not.toBe(old.activeExecutionId)
        const oldStatus=await inspectWorkflowOwner(connection,client,old); expect(oldStatus.state).toBe('closed')
        expect(await recordReconciliation(pool,old,reconcileObservation(old,oldStatus,Date.now())[0]!,1)).toBe(false)
        expect((await inspectWorkflowOwner(connection,client,current)).state).toBe('running')
        gates[1]!.resolve(); await handle.result()
      })
    } finally { gates.forEach((gate) => gate.resolve()); await connection.close(); await native.close(); await pool.end() }
  },60_000)

  it('settles a server-rejected duplicate child as no-effect while unknown launch stays guarded and visible',async () => {
    const pool=new Pool({ connectionString: await ensureTestDb('kardata_test_epoch_rejection') })
    const connection=await connectClient(); const native=await connectWorker(); const namespace=`test-epoch-reject-${randomUUID()}`
    await connection.workflowService.registerNamespace({ namespace,workflowExecutionRetentionPeriod: msToTs(86400000) })
    const client=new Client({ connection,namespace }); const queue='kardata-turn-v1'
    const worker=await Worker.create({ connection: native,namespace,taskQueue: queue,workflowsPath: join(base,'temporal/epoch-workflows.ts'),activities: {
      prepareExecutionIntentActivity: async (input: { workflowId: string; threadKey: string; sessionId: string; requestKey: string }) => reserveExecutionIntent(pool,{ ...input,requestKey: `${Context.current().info.workflowExecution!.runId}:${input.requestKey}` }),
      settlePreparedExecutionIntentActivity: async (input: { epoch: string; beforeDispatch: boolean }) => markExecutionIntent(pool,input.epoch,input.beforeDispatch,Context.current().info.workflowExecution!.runId),
    } })
    try {
      const session=await createSession(pool,'TEST SDK child rejection'); await projectNewEvents(pool)
      await worker.runUntil(async () => {
        const childId=`TEST-existing-${randomUUID()}`
        const existing=await client.workflow.start('epochHeldChild',{ workflowId: childId,taskQueue: queue,args: [] })
        try {
          await expect(client.workflow.execute('epochRejectedChild',{ workflowId: `TEST-rejected-parent-${randomUUID()}`,taskQueue: queue,args: [{ sessionId: session.id,childId }] })).rejects.toThrow()
          expect((await pool.query('SELECT state FROM execution_intents WHERE workflow_id=$1',[childId])).rows[0]?.state).toBe('failed')
          expect((await existing.describe()).status.name).toBe('RUNNING')
          const unknownId=`TEST-unknown-${randomUUID()}`
          await expect(client.workflow.execute('epochRejectedChild',{ workflowId: `TEST-unknown-parent-${randomUUID()}`,taskQueue: queue,args: [{ sessionId: session.id,childId: unknownId,unknown: true }] })).rejects.toThrow()
          expect((await pool.query('SELECT state FROM execution_intents WHERE workflow_id=$1',[unknownId])).rows[0]?.state).toBe('uncertain')
          await projectNewEvents(pool)
          const notices=await pool.query("SELECT payload FROM thread_messages WHERE thread_key=$1 AND kind='tool' AND payload->>'name'='execution.start'",[session.id])
          expect(notices.rows).toHaveLength(2)
        } finally { await existing.terminate('TEST isolated fixture cleanup') }
      })
    } finally { await connection.close(); await native.close(); await pool.end() }
  },60_000)
})
