// Context-file workflows against a real worker: thin proxies, so one pass per
// workflow proves the dispatch plus the activity result. Temporal suite,
// skipped explicitly without KARDATA_TEMPORAL_TEST, TEST_DATABASE_URL and
// KARDATA_FILE_TEMPORAL_ADDRESS.
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { Client, Connection } from '@temporalio/client'
import { NativeConnection, Runtime } from '@temporalio/worker'
import { msToTs } from '@temporalio/common/lib/time.js'
import { FakeProvider, type FakeStep } from '@kardata/agents'
import { beforeAll, describe, expect, it } from 'vitest'
import { createSector } from '../../backend/src/db/index.js'
import { insertContextFileBlock, listContextFileBlocks } from '../../backend/src/db/context-files.js'
import { ingestSectorDocument } from '../../backend/src/db/sector-documents.js'
import { createContextFileActivities } from '../../backend/src/temporal/activities/context-files.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
import { createWorkerLogger, workerLoggingOptions } from '../../backend/src/observability/logging.js'
import { decideContextChange, proposeGlobalContext, readGlobalContext } from '../../backend/src/db/workspace-global-context.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const address = process.env['KARDATA_FILE_TEMPORAL_ADDRESS']
const enabled = process.env['KARDATA_TEMPORAL_TEST'] === '1' && !!TEST_DATABASE_URL && !!address
const workflowsPath = join(dirname(fileURLToPath(import.meta.url)), '../../backend/src/temporal/workflows/research-bundle.ts')
const STAMP = randomUUID()

describe.skipIf(!enabled)('context-file workflows over real Temporal [F:backend.workflow.context_files.contextFileSummary] [F:backend.workflow.context_files.globalContextCompaction]', () => {
  beforeAll(() => Runtime.install({ logger: createWorkerLogger(), telemetryOptions: { logging: workerLoggingOptions() } }))

  async function fixture(steps: FakeStep[]) {
    const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_context_file_workflows'), max: 5 })
    const connection = await Connection.connect({ address: address! })
    const native = await NativeConnection.connect({ address: address! })
    const namespace = `test-context-file-${randomUUID()}`
    const queue = `TEST-context-file-queue-${randomUUID()}`
    await connection.workflowService.registerNamespace({ namespace, workflowExecutionRetentionPeriod: msToTs(86400000) })
    const client = new Client({ connection, namespace })
    const scope = { tenantId: `TEST context-file workflows ${STAMP}`, projectId: null }
    const sectorId = `TEST-CF-wf-${randomUUID()}`
    await createSector(pool, { sectorId, name: 'TEST context-file workflows', scope })
    await projectNewEvents(pool)
    const scripted = new FakeProvider([...steps])
    const activities = createContextFileActivities({ db: pool, provider: () => scripted })
    const worker = await createLaneWorker({ lane: 'research', connection: native, namespace, taskQueue: queue, workflowsPath, activities })
    const running = worker.run()
    return {
      pool, client, queue, scope, sectorId, worker,
      async close() {
        if (worker.getState() === 'RUNNING') worker.shutdown()
        await running
        await pool.end()
        await connection.close()
        await native.close()
      },
    }
  }

  async function indexedBlock(pool: Pool, sectorId: string, scope: { tenantId: string; projectId: null }, mark: string): Promise<{ fileId: string; hash: string }> {
    const doc = await ingestSectorDocument(pool, {
      sectorId,
      filename: `test-wf-${mark}.md`,
      contentBase64: Buffer.from(`# TEST workflow ${mark}\nA synthetic unit for workflow dispatch.`).toString('base64'),
      scope,
    })
    const fileId = `TEST-wf-${mark}`
    const hash = `TEST-wf-hash-${mark}`
    await insertContextFileBlock(pool, { sectorId, fileId, documentId: doc.id, hash, filename: doc.filename, requestedBy: 'TEST' })
    return { fileId, hash }
  }

  it('runs file summarization through the workflow', async () => {
    const reply = '### TEST file (MD)\n**Overview.** TEST workflow summary.'
    const f = await fixture([{ text: reply }, { text: reply }, { text: reply }, { text: reply }, { text: reply }])
    try {
      const { fileId, hash } = await indexedBlock(f.pool, f.sectorId, f.scope, `sum-${randomUUID()}`)
      const handle = await f.client.workflow.start('contextFileSummary', {
        workflowId: `TEST-context-summary-${randomUUID()}`, taskQueue: f.queue, args: [{ sectorId: f.sectorId, fileId, hash }],
      })
      expect(await handle.result()).toEqual({ applied: true })
      const blocks = await listContextFileBlocks(f.pool, f.sectorId)
      expect(blocks.find((entry) => entry.fileId === fileId)?.state).toBe('ready')
    } finally { await f.close() }
  })

  it('runs global compaction through the workflow', async () => {
    const reply = JSON.stringify({ decisions: 'TEST short decisions.', findings: 'TEST short findings.', questions: 'TEST short questions.' })
    const f = await fixture([{ text: reply }, { text: reply }, { text: reply }, { text: reply }, { text: reply }])
    try {
      const long = `TEST long section body without digits. ${'Lorem ipsum dolor sit amet consectetur adipiscing elit. '.repeat(120)}`
      const current = await readGlobalContext(f.pool, f.sectorId, f.scope)
      const proposal = await proposeGlobalContext(f.pool, {
        sectorId: f.sectorId, baseVersion: current.version, sourceThread: 'TEST-compact-thread', owner: true, scope: f.scope,
        sections: { decisions: long, findings: long, questions: long },
      })
      await decideContextChange(f.pool, { sectorId: f.sectorId, id: proposal.id, approve: true, scope: f.scope })
      const handle = await f.client.workflow.start('globalContextCompaction', {
        workflowId: `TEST-context-compaction-${randomUUID()}`, taskQueue: f.queue, args: [{ sectorId: f.sectorId, reason: 'manual' }],
      })
      const result = await handle.result()
      expect(result.compacted).toBe(true)
      const reread = await readGlobalContext(f.pool, f.sectorId, f.scope)
      expect(reread.sections.decisions).toBe('TEST short decisions.')
    } finally { await f.close() }
  })
})
