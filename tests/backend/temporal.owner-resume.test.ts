// Real owner HTTP command → gateway → Temporal → activity → Postgres/archive.
// Provider is explicitly scripted; no live company/pilot claim.
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname,join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { Client } from '@temporalio/client'
import { Runtime,Worker } from '@temporalio/worker'
import { msToTs } from '@temporalio/common/lib/time.js'
import { ContextBudgetError,FakeProvider,emptyUsage,type ProviderRequest } from '@kardata/agents'
import { beforeAll,describe,expect,it,vi } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { createSession,readPartition,readTurnContinuation,registerApiKey,workerPoolFromEnv } from '../../backend/src/db/index.js'
import * as dbLayer from '../../backend/src/db/index.js'
import { TemporalRunsGateway } from '../../backend/src/temporal/runs-gateway.js'
import { appendEventActivity, karbotTurnActivity } from '../../backend/src/temporal/activities/turn.js'
import * as epochs from '../../backend/src/temporal/activities/execution-epochs.js'
import { connectClient,connectWorker } from '../../backend/src/temporal/connection.js'
import { createWorkerLogger,workerLoggingOptions } from '../../backend/src/observability/logging.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb,TEST_DATABASE_URL } from './db-helper.js'

const enabled=process.env['KARDATA_TEMPORAL_TEST']==='1' && !!TEST_DATABASE_URL
async function waitFor(check: () => Promise<boolean>) { const limit=Date.now()+15_000; while (!(await check())) { if (Date.now()>limit) throw new Error('TEST owner recovery did not reach its durable boundary'); await new Promise((done) => setTimeout(done,50)) } }
describe.skipIf(!enabled)('owner Resume of a confirmed terminal original turn [F:backend.activity.turn.appendEventActivity] [F:backend.activity.turn.karbotTurnActivity] [F:db.index.createSession] [F:db.index.registerApiKey] [F:db.index.readPartition] [F:db.workspace_threads.readTurnContinuation] [F:db.keys.registerApiKey] [F:db.index.workerPoolFromEnv] [F:db.events.readPartition] [F:db.sessions.createSession] [F:db.pool.workerPoolFromEnv] [F:db.context_files.assertThreadFileContext] [F:db.context_files.validateFileRefs] [F:db.document_units.listDocumentUnitOrdinals] [F:db.execution_epochs.readActiveExecutionIdentity] [F:db.index.Db] [F:db.workspace_threads.recordContextMeasurement]',() => {
  beforeAll(() => Runtime.install({ logger: createWorkerLogger(),telemetryOptions: { logging: workerLoggingOptions() } }))
  it.each(['session','child'] as const)('owner Resume restores a terminal %s paid response without duplicate user/provider work',async (kind) => {
    const url=await ensureTestDb('kardata_test_owner_resume'); const pool=new Pool({ connectionString: url })
    const connection=await connectClient(); const native=await connectWorker(); const namespace=`test-owner-resume-${randomUUID()}`
    await connection.workflowService.registerNamespace({ namespace,workflowExecutionRetentionPeriod: msToTs(86400000) })
    vi.stubEnv('TEMPORAL_NAMESPACE',namespace); vi.stubEnv('DATABASE_URL',url); vi.stubEnv('KARDATA_PROVIDER','fake'); vi.stubEnv('KARDATA_GCS_BUCKET','')
    vi.stubEnv('KARDATA_ARCHIVE_DIR',mkdtempSync(join(tmpdir(),'kardata-owner-resume-')))
    const scope={ tenantId: 'TEST owner resume',projectId: null }; const owner='TEST owner resume approver'; const agent='TEST owner resume operator'
    await registerApiKey(pool,{ keyId: 'TEST owner',keyHash: hashKey(owner),scope,role: 'approver' })
    await registerApiKey(pool,{ keyId: 'TEST operator',keyHash: hashKey(agent),scope,role: 'operator' })
    vi.stubEnv('KARDATA_MCP_TOKEN',agent)
    const app=buildApp({ pool,auth: true,runs: new TemporalRunsGateway(pool,connection) })
    const endpoint=await app.listen({ host: '127.0.0.1',port: 0 }); vi.stubEnv('KARDATA_MCP_URL',`${endpoint}/mcp`)
    let calls=0; const answer='TEST original paid answer retained across terminal owner resume'; const usage={ ...emptyUsage(),inputTokens: 37,outputTokens: 11,cacheReadTokens: 9 }
    const provider=vi.spyOn(FakeProvider.prototype,'chatStream').mockImplementation(async function*(_request: ProviderRequest) { calls++; yield { kind: 'text_delta' as const,text: answer }; yield { kind: 'done' as const,usage } })
    const clear=vi.spyOn(dbLayer,'clearTurnContinuation').mockImplementationOnce(async () => { throw new ContextBudgetError('TEST finalizer storage interruption') })
    const worker=await Worker.create({ connection: native,namespace,taskQueue: 'kardata-turn-v1',workflowsPath: join(dirname(fileURLToPath(import.meta.url)),'../../backend/src/temporal/workflows/turn-bundle.ts'),activities: { appendEventActivity,karbotTurnActivity,...epochs } })
    const client=new Client({ connection,namespace })
    const session=await createSession(pool,'TEST original owner turn',scope); await projectNewEvents(pool)
    let workflowId=`session-run-${session.id}`; let threadKey=session.id; let partition=`session:${session.id}`
    const originalText='TEST complete this original request once'
    const post=(path: string,body: unknown,key=owner) => fetch(`${endpoint}${path}`,{ method: 'POST',headers: { authorization: `Bearer ${key}`,'content-type':'application/json','idempotency-key':randomUUID() },body:JSON.stringify(body) })
    try {
      await worker.runUntil(async () => {
        if (kind==='session') expect((await post('/v1/commands/send',{ threadKey: session.id,text: originalText })).status).toBe(202)
        else {
          const delegated=await post('/mcp',{ jsonrpc:'2.0',id: 1,method:'tools/call',params: { name:'db.delegate_subagent',arguments: { sessionId: session.id,goal: originalText } } })
          expect(delegated.status).toBe(200)
          const body=await delegated.json() as { result: { content: Array<{ text: string }> } }
          const output=JSON.parse(body.result.content[0]!.text) as { childId: string }
          workflowId=output.childId; threadKey=`agent:${workflowId}`; partition=`child:${workflowId}`
        }
        await waitFor(async () => !!(await readTurnContinuation(pool,threadKey))?.meta.pendingResponse && (await pool.query('SELECT status FROM threads WHERE key=$1',[threadKey])).rows[0]?.status==='PAUSED')
        const saved=(await readTurnContinuation(pool,threadKey))!
        expect(saved.meta.pendingResponse?.response).toMatchObject({ text: answer,usage }); expect(calls).toBe(1)
        await client.workflow.getHandle(workflowId).terminate('TEST isolated confirmed terminal owner')
        expect((await post('/v1/commands/resume',{ runId: workflowId },agent)).status).toBe(403)
        const resumed=await post('/v1/commands/resume',{ runId: workflowId })
        expect(await resumed.text()).toContain('"ok":true'); expect(resumed.status).toBe(202)
        await waitFor(async () => (await readPartition(pool,partition)).some((event) => event.type==='t.message.appended' && (event.payload as { message?: { text?: string } }).message?.text===answer))
        expect(calls).toBe(1); expect(await readTurnContinuation(pool,threadKey)).toBeUndefined()
        const messages=(await readPartition(pool,partition)).filter((event) => event.type==='t.message.appended').map((event) => event.payload as { message: { role?: string; text?: string } })
        expect(messages.filter((entry) => entry.message.role==='user' && entry.message.text===originalText)).toHaveLength(1)
        expect(messages.filter((entry) => entry.message.role==='agent' && entry.message.text===answer)).toHaveLength(1)
        if (kind==='session') { await client.workflow.getHandle(workflowId).signal('runCancel'); await client.workflow.getHandle(workflowId).result() }
        else { await client.workflow.getHandle(`delegation-${session.id}`).signal('parentFinish'); await client.workflow.getHandle(`delegation-${session.id}`).result() }
      })
    } finally { clear.mockRestore(); provider.mockRestore(); await app.close(); await workerPoolFromEnv().end(); await pool.end(); await connection.close(); await native.close(); vi.unstubAllEnvs() }
  },60_000)
})
