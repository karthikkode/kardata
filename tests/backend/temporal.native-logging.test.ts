import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import { dirname,join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@temporalio/client'
import { Runtime,Worker } from '@temporalio/worker'
import { msToTs } from '@temporalio/common/lib/time.js'
import { describe,expect,it } from 'vitest'
import { connectClient,connectWorker } from '../../backend/src/temporal/connection.js'
import { createWorkerLogger,workerLoggingOptions } from '../../backend/src/observability/logging.js'

describe.skipIf(process.env['KARDATA_TEMPORAL_TEST']!=='1')('actual native SDK log privacy',() => {
  it('forwards Core failure diagnostics through the owned serializer without raw execution bodies',async () => {
    const lines: string[]=[]
    const stream=new Writable({ write(chunk,_encoding,done) { lines.push(String(chunk)); done() } })
    Runtime.install({ logger: createWorkerLogger('INFO',stream),telemetryOptions: { logging: workerLoggingOptions() } })
    const connection=await connectClient(); const native=await connectWorker(); const namespace=`test-native-privacy-${randomUUID()}`
    await connection.workflowService.registerNamespace({ namespace,workflowExecutionRetentionPeriod: msToTs(86400000) })
    const client=new Client({ connection,namespace }); const queue=`native-privacy-${randomUUID()}`
    const worker=await Worker.create({ connection: native,namespace,taskQueue: queue,workflowsPath: join(dirname(fileURLToPath(import.meta.url)),'temporal/epoch-workflows.ts') })
    try {
      await worker.runUntil(async () => {
        const handle=await client.workflow.start('nativePrivateFailure',{ workflowId: `TEST-native-private-${randomUUID()}`,taskQueue: queue,args: [] })
        try {
          const deadline=Date.now()+10_000
          while (!lines.some((line) => line.includes('"event":"temporal.native"')) && Date.now()<deadline) await new Promise((done) => setTimeout(done,50))
          const records=lines.flatMap((line) => line.trim().split('\n')).map((line) => JSON.parse(line) as Record<string,unknown>)
          const diagnostics=records.filter((line) => line['event']==='temporal.native')
          expect(diagnostics.length).toBeGreaterThan(0)
          expect(diagnostics.some((line) => line['target']==='temporalio_sdk_core::worker::workflow')).toBe(true)
          expect(lines.join('')).not.toContain('TEST_PRIVATE_NATIVE_EXECUTION_BODY')
          expect((await handle.describe()).status.name).toBe('RUNNING')
        } finally { await handle.terminate('TEST owned native failure fixture cleanup') }
      })
    } finally { await connection.close(); await native.close() }
  },30_000)
})
