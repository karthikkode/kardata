// Actual HTTP/Temporal/Postgres/archive path with explicitly scripted provider
// responses. The only runner double directs file jobs to owned SDK queues.
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { Client, Connection, WorkflowNotFoundError } from '@temporalio/client'
import { NativeConnection, Runtime, Worker, bundleWorkflowCode } from '@temporalio/worker'
import { defaultPayloadConverter } from '@temporalio/common'
import { msToTs } from '@temporalio/common/lib/time.js'
import { FakeProvider, type FakeStep, type ProviderAdapter, type ProviderRequest } from '@kardata/agents'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { FilesystemTarget, type ArchiveTarget } from '../../backend/src/archive/targets.js'
import { createSector, readOriginalSectorDocument, registerApiKey } from '../../backend/src/db/index.js'
import { readFileProcessingJob } from '../../backend/src/db/file-jobs.js'
import { createFileProcessingActivities } from '../../backend/src/temporal/activities/file-processing.js'
import { Context } from '@temporalio/activity'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
import { createWorkerLogger, workerLoggingOptions } from '../../backend/src/observability/logging.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'
import { testPdf } from './pdf-fixtures.js'

const address = process.env['KARDATA_FILE_TEMPORAL_ADDRESS']
const enabled = process.env['KARDATA_TEMPORAL_TEST'] === '1' && !!TEST_DATABASE_URL && !!address
const workflowsPath = join(dirname(fileURLToPath(import.meta.url)), '../../backend/src/temporal/workflows/research-bundle.ts')
const workflowId = (jobId: string, revision: number) => `TEST-file-owner-${jobId}-r${revision}`
const replies: FakeStep[] = [{ text: 'TEST SDK first image description' }, { text: 'TEST SDK second image description' }]

describe.skipIf(!enabled)('actual file-processing SDK owner lifecycle [F:backend.activity.file_processing.createFileProcessingActivities] [F:backend.workflow.file_processing.fileProcessing] [F:backend.activity.file_processing.failFileProcessingActivity] [F:backend.activity.file_processing.finalizeFileProcessingActivity] [F:backend.activity.file_processing.nextFileImageActivity] [F:backend.activity.file_processing.prepareFileProcessingActivity] [F:backend.activity.file_processing.processFileImageActivity] [F:backend.activity.turn.sleep] [F:db.index.createSector] [F:db.index.registerApiKey] [F:db.index.readOriginalSectorDocument] [F:db.keys.registerApiKey] [F:db.file_jobs.readFileProcessingJob] [F:db.sectors.createSector] [F:db.sector_documents.readOriginalSectorDocument] [F:db.errors.WorkspaceError] [F:db.file_jobs.beginFileProcessingJob] [F:db.file_jobs.pauseFileProcessingJob] [F:db.file_jobs.readCurrentFileImageAttempt] [F:db.file_jobs.readFileImage] [F:db.file_jobs.readFileImageAttempt] [F:db.file_jobs.readFileJobBoundary] [F:db.file_jobs.readNextFileImage] [F:db.index.Db] [F:db.index.TransactableDb] [F:db.workspace.WorkspaceError] [F:db.workspace.requireSector] [F:db.file_jobs.restoreFileImageArchive]', () => {
  beforeAll(() => Runtime.install({ logger: createWorkerLogger(), telemetryOptions: { logging: workerLoggingOptions() } }))

  async function fixture(steps: FakeStep[] = replies, options: { holdFirst?: boolean; lostArchiveAck?: boolean; slowReadMs?: number; slowReadActivity?: 'prepareFileProcessingActivity' | 'finalizeFileProcessingActivity' } = {}) {
    const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_file_processing_sdk'), max: 5 })
    const connection = await Connection.connect({ address: address! }), native = await NativeConnection.connect({ address: address! })
    const namespace = `test-file-processing-${randomUUID()}`, queue = `TEST-file-queue-${randomUUID()}`
    await connection.workflowService.registerNamespace({ namespace, workflowExecutionRetentionPeriod: msToTs(86400000) })
    const client = new Client({ connection, namespace })
    const scope = { tenantId: `TEST SDK file owner ${randomUUID()}`, projectId: null }
    const sectorId = `TEST-SDK-file-${randomUUID()}`
    await createSector(pool, { sectorId, name: 'TEST SDK file processing', scope }); await projectNewEvents(pool)
    for (const [key, role, tenantId] of [['owner', 'approver', scope.tenantId], ['operator', 'operator', scope.tenantId], ['foreign', 'approver', 'TEST foreign SDK files']] as const) {
      await registerApiKey(pool, { keyId: `TEST-${key}`, keyHash: hashKey(`TEST SDK ${key}`), scope: { tenantId, projectId: null }, role })
    }
    const archive = new FilesystemTarget(mkdtempSync(join(tmpdir(), 'kardata-test-sdk-file-')))
    const scripted = new FakeProvider([...steps])
    let startFirst: () => void = () => undefined, releaseFirst: () => void = () => undefined, acknowledgeLost: () => void = () => undefined
    const firstStarted = new Promise<void>((resolve) => { startFirst = resolve })
    const held = new Promise<void>((resolve) => { releaseFirst = resolve })
    const lostAck = new Promise<void>((resolve) => { acknowledgeLost = resolve })
    let lost = false, calls = 0, activeActivity = '', delayed = false
    const prepareAttempts: number[] = [], finalizeAttempts: number[] = []
    const target: ArchiveTarget = {
      async read(key, maxBytes, signal) {
        const phase = options.slowReadActivity ?? 'prepareFileProcessingActivity'
        const ownedKey = phase === 'prepareFileProcessingActivity' ? key.startsWith('sector-uploads/') : key.startsWith('file-processing/')
        if (options.slowReadMs && activeActivity === phase && !delayed && ownedKey) { delayed = true; await new Promise((done) => setTimeout(done, options.slowReadMs)) }
        return archive.read(key, maxBytes, signal)
      },
      list: archive.list.bind(archive),
      async write(key, body, signal) {
        await archive.write(key, body, signal)
        if (options.lostArchiveAck && !lost && /\/attempt-1\.json$/.test(key)) { lost = true; acknowledgeLost(); throw new Error('TEST SDK archive accepted result but lost acknowledgement') }
      },
    }
    const provider: ProviderAdapter = {
      providerName: scripted.providerName,
      async chat(request: ProviderRequest) {
        calls++; if (calls === 1) { startFirst(); if (options.holdFirst) await held }
        return { ...await scripted.chat(request), completion: 'complete' as const }
      },
      chatStream: (request) => scripted.chatStream(request),
    }
    const activities = createFileProcessingActivities({
      db: pool, archive: target, provider: () => provider,
      context: () => {
        const context = Context.current(), info = context.info
        if (!info.workflowExecution) throw new Error('TEST SDK workflow identity missing')
        activeActivity = info.activityType
        if (info.activityType === 'prepareFileProcessingActivity') prepareAttempts.push(info.attempt)
        if (info.activityType === 'finalizeFileProcessingActivity') finalizeAttempts.push(info.attempt)
        return {
          producerId: `${info.workflowExecution.runId}:${info.activityId}:${info.attempt}`, signal: context.cancellationSignal,
          heartbeat: (phase) => {
            // Explicit control run: reproduce the missing finalize pulse without
            // swapping production source while another gate is running.
            if (info.activityType === 'finalizeFileProcessingActivity' && process.env['KARDATA_FILE_TEST_DISABLE_FINALIZE_HEARTBEAT'] === '1') return
            context.heartbeat({ phase })
          },
        }
      },
    })
    const started: Array<{ jobId: string; revision: number }> = []
    const runs = Object.assign(new FakeRunsGateway(pool), {
      async startFileProcessing(jobId: string, revision: number) {
        started.push({ jobId, revision })
        await client.workflow.start('fileProcessing', { workflowId: workflowId(jobId, revision), taskQueue: queue, args: [{ jobId, revision }] })
      },
    })
    const app = buildApp({ pool, runs, auth: true, archiveTarget: target }), origin = await app.listen({ host: '127.0.0.1', port: 0 })
    const workers: Array<{ worker: Worker; running: Promise<void> }> = []
    async function worker() {
      const created = await createLaneWorker({ lane: 'research', connection: native, namespace, taskQueue: queue, workflowsPath, activities })
      const running = created.run(); workers.push({ worker: created, running })
      return created
    }
    async function request(path: string, method: string, body?: unknown, key = 'owner') {
      return fetch(`${origin}${path}`, { method, headers: { authorization: `Bearer TEST SDK ${key}`, 'content-type': 'application/json', 'idempotency-key': randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    }
    const original = testPdf(true).toString('base64')
    async function upload() {
      const response = await request(`/v1/sectors/${sectorId}/documents`, 'POST', { filename: 'TEST SDK mixed.pdf', contentBase64: original })
      expect(response.status).toBe(201)
      const data = (await response.json() as { data: { id: string; processing: { jobId: string; revision: number } } }).data
      expect(data.processing.jobId).toBeDefined()
      return { fileId: data.id, jobId: data.processing.jobId, revision: data.processing.revision }
    }
    async function close() {
      releaseFirst()
      for (const { jobId, revision } of started) {
        const handle = client.workflow.getHandle(workflowId(jobId, revision))
        try { if ((await handle.describe()).status.name === 'RUNNING') await handle.cancel() } catch (error) { if (!(error instanceof WorkflowNotFoundError)) throw error }
      }
      for (const { worker: instance, running } of workers) { if (instance.getState() === 'RUNNING') instance.shutdown(); await running }
      await app.close(); await pool.end(); await connection.close(); await native.close()
    }
    return { pool, archive, scripted, client, namespace, queue, scope, sectorId, original, activities, started, request, worker, upload, close, firstStarted, releaseFirst, lostAck, prepareAttempts, finalizeAttempts, get calls() { return calls } }
  }

  it('restarts the owned SDK worker after archive acknowledgement loss without another image payment and replays its ID-only history', async () => {
    const f = await fixture(replies, { lostArchiveAck: true })
    try {
      const firstWorker = await f.worker(), uploaded = await f.upload()
      await f.lostAck
      firstWorker.shutdown()
      // Await the actual stop receipt before the replacement starts polling.
      while (firstWorker.getState() !== 'STOPPED') await new Promise((done) => setTimeout(done, 20))
      expect(f.calls).toBe(1)
      await f.worker()
      const handle = f.client.workflow.getHandle(workflowId(uploaded.jobId, uploaded.revision))
      expect(await handle.result()).toEqual({ state: 'complete' })
      expect(f.calls).toBe(2)
      expect(await readFileProcessingJob(f.pool, uploaded.jobId, f.scope)).toMatchObject({ state: 'complete', totalImages: 2, completedImages: 2 })
      expect(await readOriginalSectorDocument(f.pool, f.sectorId, uploaded.fileId, f.archive, f.scope)).toMatchObject({ contentBase64: f.original, originalAvailable: true })
      const attempts = await f.pool.query('SELECT producer_id,attempt,pending_response_text FROM file_processing_attempts WHERE job_id=$1 ORDER BY image_id', [uploaded.jobId])
      expect(attempts.rows).toHaveLength(2)
      expect(attempts.rows.every((row) => row.attempt === 1 && /^[a-f0-9-]{36}:\d+:1$/.test(row.producer_id))).toBe(true)
      const history = await handle.fetchHistory()
      for (const event of history.events ?? []) {
        const scheduled = event.activityTaskScheduledEventAttributes
        for (const payload of scheduled?.input?.payloads ?? []) {
          const decoded = defaultPayloadConverter.fromPayload(payload) as Record<string, unknown>
          expect(Object.keys(decoded).every((key) => ['jobId', 'revision', 'cursor', 'imageId', 'code'].includes(key))).toBe(true)
          expect(JSON.stringify(decoded)).not.toContain('TEST SDK first image description')
          expect(JSON.stringify(decoded)).not.toContain(f.original)
        }
      }
      await Worker.runReplayHistory({ workflowBundle: await bundleWorkflowCode({ workflowsPath }) }, history, workflowId(uploaded.jobId, uploaded.revision))
    } finally { await f.close() }
  }, 60_000)

  it('pauses hidden file work and reuses the settled image after reveal and owner HTTP retry', async () => {
    const f = await fixture(replies, { holdFirst: true })
    try {
      await f.worker(); const uploaded = await f.upload()
      await f.firstStarted
      expect((await f.request(`/v1/sectors/${f.sectorId}/files/${uploaded.fileId}`, 'PATCH', { hidden: true })).status).toBe(200)
      f.releaseFirst()
      const handle = f.client.workflow.getHandle(workflowId(uploaded.jobId, uploaded.revision))
      expect(await handle.result()).toEqual({ state: 'paused' })
      expect(f.calls).toBe(1)
      expect(await readFileProcessingJob(f.pool, uploaded.jobId, f.scope)).toMatchObject({ state: 'paused', completedImages: 1 })
      const path = `/v1/sectors/${f.sectorId}/files/${uploaded.fileId}/retry`
      expect((await f.request(path, 'POST', { jobId: uploaded.jobId, revision: uploaded.revision, allowDuplicatePaid: false })).status).toBe(403)
      expect((await f.request(`/v1/sectors/${f.sectorId}/files/${uploaded.fileId}`, 'PATCH', { hidden: false })).status).toBe(200)
      const resumed = await f.request(path, 'POST', { jobId: uploaded.jobId, revision: uploaded.revision, allowDuplicatePaid: false })
      expect(resumed.status).toBe(200)
      const revision = (await resumed.json() as { data: { revision: number } }).data.revision
      expect(await f.client.workflow.getHandle(workflowId(uploaded.jobId, revision)).result()).toEqual({ state: 'complete' })
      expect(f.calls).toBe(2)
      expect(await readOriginalSectorDocument(f.pool, f.sectorId, uploaded.fileId, f.archive, f.scope)).toMatchObject({ contentBase64: f.original })
    } finally { await f.close() }
  }, 60_000)

  it('parks an actual unknown provider attempt until scoped approver HTTP retry acknowledges possible duplicate payment', async () => {
    const f = await fixture([{ error: 'TEST provider disconnected without response', retryable: false }, ...replies])
    try {
      await f.worker(); const uploaded = await f.upload()
      await expect(f.client.workflow.getHandle(workflowId(uploaded.jobId, uploaded.revision)).result()).rejects.toThrow()
      expect(f.calls).toBe(1)
      expect(await readFileProcessingJob(f.pool, uploaded.jobId, f.scope)).toMatchObject({ uncertainImages: 1, retryRequiresApproval: true })
      const path = `/v1/sectors/${f.sectorId}/files/${uploaded.fileId}/retry`, body = { jobId: uploaded.jobId, revision: uploaded.revision, allowDuplicatePaid: false }
      expect((await f.request(path, 'POST', body)).status).toBe(409)
      expect((await f.request(path, 'POST', { ...body, allowDuplicatePaid: true }, 'operator')).status).toBe(403)
      expect((await f.request(path, 'POST', { ...body, allowDuplicatePaid: true }, 'foreign')).status).toBe(404)
      const permitted = await f.request(path, 'POST', { ...body, allowDuplicatePaid: true })
      expect(permitted.status).toBe(200)
      const revision = (await permitted.json() as { data: { revision: number } }).data.revision
      expect(await f.client.workflow.getHandle(workflowId(uploaded.jobId, revision)).result()).toEqual({ state: 'complete' })
      expect(f.calls).toBe(3)
      const old = await f.pool.query('SELECT state,pending_response FROM file_processing_attempts WHERE job_id=$1 AND state=$2', [uploaded.jobId, 'uncertain'])
      expect(old.rows).toHaveLength(1); expect(old.rows[0]?.pending_response).toBeNull()
      expect(await readOriginalSectorDocument(f.pool, f.sectorId, uploaded.fileId, f.archive, f.scope)).toMatchObject({ contentBase64: f.original })
    } finally { await f.close() }
  }, 60_000)

  it('keeps one healthy prepare attempt alive through a real 25-second archive read', async () => {
    const f = await fixture(replies, { slowReadMs: 25_000 })
    try {
      await f.worker(); const uploaded = await f.upload()
      const handle = f.client.workflow.getHandle(workflowId(uploaded.jobId, uploaded.revision))
      expect(await handle.result()).toEqual({ state: 'complete' })
      expect(f.prepareAttempts).toEqual([1])
      expect(f.calls).toBe(2)
      const history = await handle.fetchHistory()
      expect((history.events ?? []).filter((event) => event.activityTaskTimedOutEventAttributes)).toEqual([])
      expect(await readOriginalSectorDocument(f.pool, f.sectorId, uploaded.fileId, f.archive, f.scope)).toMatchObject({ contentBase64: f.original })
    } finally { await f.close() }
  }, 60_000)

  it('keeps one healthy finalize attempt alive through a real 25-second manifest read', async () => {
    const f = await fixture(replies, { slowReadMs: 25_000, slowReadActivity: 'finalizeFileProcessingActivity' })
    try {
      await f.worker(); const uploaded = await f.upload()
      const handle = f.client.workflow.getHandle(workflowId(uploaded.jobId, uploaded.revision))
      expect(await handle.result()).toEqual({ state: 'complete' })
      expect(f.finalizeAttempts).toEqual([1])
      expect(f.calls).toBe(2)
      const history = await handle.fetchHistory()
      expect((history.events ?? []).filter((event) => event.activityTaskTimedOutEventAttributes)).toEqual([])
      expect(await readOriginalSectorDocument(f.pool, f.sectorId, uploaded.fileId, f.archive, f.scope)).toMatchObject({ contentBase64: f.original })
    } finally { await f.close() }
  }, 60_000)
})
