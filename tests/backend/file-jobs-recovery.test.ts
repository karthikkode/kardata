// Real isolated Postgres/filesystem and maintained PDF bytes. Provider replies
// are explicit TEST fixtures; these checks do not establish live Meta behavior.
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProvider, emptyUsage, TokenCountUnavailableError, ProviderError, type ProviderAdapter } from '@kardata/agents'
import { FilesystemTarget, withArchiveDeadline } from '../../backend/src/archive/targets.js'
import { createSector, setFileVisibility, querySectorDocument, readSectorDocument } from '../../backend/src/db/index.js'
import {
  assembleFileProcessingUnits, claimFileImage, completeFileImage, createFileProcessingJob, failFileImage,
  failFileProcessingJob, finalizeFileProcessingJob, markFileImageRequestStarted,
  readFileProcessingJob, registerFileImages, retryFileProcessingJob,
  stageFileImageResponse, fileImageResponseUnits, type FileArchiveRef, type FileImageIdentity,
  rejectFileImageResponse,
} from '../../backend/src/db/file-jobs.js'
import { planPdfExtraction } from '../../backend/src/db/pdf-extraction.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { createFileProcessingActivities } from '../../backend/src/temporal/activities/file-processing.js'
import * as fileJobsDb from '../../backend/src/db/file-jobs.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { testPdf } from './pdf-fixtures.js'

const scope = { tenantId: 'TEST file recovery owner', projectId: null }
const digest = (body: string | Uint8Array) => createHash('sha256').update(body).digest('hex')

describe('bounded file archive exchanges [F:backend.activity.file_processing.createFileProcessingActivities]', () => {
  it('rejects cancellation before the queued target dispatch without starting a write', async () => {
    const write = vi.fn(async () => undefined), abort = new AbortController()
    const bounded = withArchiveDeadline({ write, async read() { return undefined }, async list() { return [] } }, 10)
    const pending = bounded.write('TEST scoped receipt', 'TEST bytes', abort.signal)
    abort.abort()
    await expect(pending).rejects.toMatchObject({ code: 'source_timeout' })
    expect(write).not.toHaveBeenCalled()
  })

  it('retains timeout uncertainty after an abort-ignoring write acknowledges late', async () => {
    let release: () => void = () => undefined, signal: AbortSignal | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const target = { async write(_key: string, _body: string, received?: AbortSignal) { signal = received; await gate }, async read() { return undefined }, async list() { return [] } }
    const pending = withArchiveDeadline(target, 10).write('TEST scoped receipt', 'TEST bytes')
    await expect(pending).rejects.toMatchObject({ code: 'source_timeout' })
    expect(signal?.aborted).toBe(true)
    release(); await new Promise((done) => setTimeout(done, 0))
    await expect(pending).rejects.toMatchObject({ code: 'source_timeout' })
  })

  it('supervises an underlying late read rejection after its deadline', async () => {
    let rejectRead: (error: Error) => void = () => undefined
    const late = new Promise<string>((_resolve, reject) => { rejectRead = reject })
    const unhandled: unknown[] = [], onUnhandled = (error: unknown) => { unhandled.push(error) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const pending = withArchiveDeadline({ async write() {}, async read() { return late }, async list() { return [] } }, 10).read('TEST scoped receipt', 10)
      await expect(pending).rejects.toMatchObject({ code: 'source_timeout' })
      rejectRead(new Error('TEST late underlying storage failure'))
      await new Promise((done) => setTimeout(done, 0))
      expect(unhandled).toEqual([])
    } finally { process.off('unhandledRejection', onUnhandled) }
  })
})

describe.skipIf(!TEST_DATABASE_URL)('file processing durable recovery contracts', () => {
  let pool: Pool
  let cleanupPool: Pool | undefined
  // Provider admission is deliberately database-wide. Separate databases avoid
  // a retained TEST attempt influencing another case's capacity oracle.
  beforeEach(async () => {
    cleanupPool = undefined
    const connectionString = await ensureTestDb('kardata_test_file_jobs_recovery')
    pool = new Pool({ connectionString, max: 3 })
    cleanupPool = pool
  })
  afterEach(async () => {
    const ownedPool = cleanupPool
    cleanupPool = undefined
    await ownedPool?.end()
  })

  async function fixture(withImages = true, register = true, provider = 'fake', format: Parameters<typeof testPdf>[1] = 'xobject') {
    const sectorId = `TEST-file-recovery-${randomUUID()}`
    await createSector(pool, { sectorId, name: 'TEST file recovery', scope })
    await projectNewEvents(pool)
    const archive = new FilesystemTarget(mkdtempSync(join(tmpdir(), 'kardata-test-file-recovery-')))
    const original = testPdf(withImages, format).toString('base64')
    const { job, document } = await createFileProcessingJob(pool, {
      sectorId, filename: 'TEST mixed recovery.pdf', contentBase64: original,
      provider, model: 'TEST frozen image model', parserVersion: 'pdf-v3',
      promptVersion: 'document-image-v2', scope, archive,
    })
    const images: FileImageIdentity[] = []
    const records: Array<Record<string, unknown>> = []
    for await (const part of planPdfExtraction(Buffer.from(original, 'base64'))) {
      if (part.kind === 'text') {
        records.push({ kind: 'text', page: part.page, text: part.text })
      } else {
        const inputRef = { key: `file-processing/${job.jobId}/inputs/${part.imageHash}.base64`, hash: part.imageHash, bytes: part.png.byteLength }
        await archive.write(inputRef.key, Buffer.from(part.png).toString('base64'))
        const image = { imageId: `TEST-page-${part.page}-image-${part.ordinal}`, page: part.page, ordinal: part.ordinal, imageHash: part.imageHash, inputRef, width: part.width, height: part.height }
        images.push(image); records.push({ kind: 'image', ...image })
      }
    }
    const body = JSON.stringify({ version: 1, records })
    const manifest = { key: `file-processing/${job.jobId}/manifest.json`, hash: digest(body), bytes: Buffer.byteLength(body) }
    await archive.write(manifest.key, body)
    if (register) await registerFileImages(pool, job.jobId, manifest, images, archive, job.revision, scope)
    return { job, document, sectorId, archive, original, images, manifest, revision: job.revision }
  }
  async function requesting(f: Awaited<ReturnType<typeof fixture>>, image = f.images[0]!, producer = 'TEST producer A') {
    const claim = await claimFileImage(pool, f.job.jobId, image.imageId, producer, f.revision, scope)
    expect(claim.state).toBe('claimed'); expect(claim.lease).toBeDefined()
    await markFileImageRequestStarted(pool, f.job.jobId, image.imageId, claim.attempt, claim.lease!, f.revision, scope)
    return { image, ...claim, lease: claim.lease!, revision: f.revision }
  }
  async function retry(f: Awaited<ReturnType<typeof fixture>>) {
    const current = await readFileProcessingJob(pool, f.job.jobId, scope)
    const next = await retryFileProcessingJob(pool, { sectorId: f.sectorId, fileId: f.document.id, jobId: f.job.jobId, revision: current.revision, allowDuplicatePaid: true, author: 'TEST owner', scope })
    f.revision = next.revision
    return next
  }
  const response = { z: 'TEST exact paid response', text: 'TEST visible image and chart description', a: { z: 9, first: 7 }, usage: { outputTokens: 11, inputTokens: 37, cacheReadTokens: 9 }, toolCalls: [], completion: 'complete' as const }
  async function storeResult(f: Awaited<ReturnType<typeof fixture>>, body = JSON.stringify(response)): Promise<FileArchiveRef> {
    const ref = { key: `file-processing/${f.job.jobId}/results/${digest(body)}.json`, hash: digest(body), bytes: Buffer.byteLength(body) }
    await f.archive.write(ref.key, body); return ref
  }
  async function completeAll(f: Awaited<ReturnType<typeof fixture>>, longText: boolean | number = false) {
    for (const image of f.images) {
      const claim = await requesting(f, image, `TEST producer ${image.page}.${image.ordinal}`)
      const paid = { ...response, text: `TEST image ${image.page}.${image.ordinal} description${longText ? ' ' + 'x'.repeat(typeof longText === 'number' ? longText : 2100) : ''}` }
      await stageFileImageResponse(pool, f.job.jobId, image.imageId, claim.attempt, claim.lease, paid, claim.revision, scope)
      const ref = await storeResult(f, JSON.stringify(paid))
      await completeFileImage(pool, f.job.jobId, image.imageId, claim.attempt, claim.lease, ref, fileImageResponseUnits(paid, image), f.archive, claim.revision, scope)
    }
    return assembleFileProcessingUnits(pool, f.job.jobId, f.archive, f.revision, scope)
  }
  function activityHarness(f: Awaited<ReturnType<typeof fixture>>, options: { db?: Pool; onReply?: () => void; completion?: (call: number) => 'complete' | 'incomplete' } = {}) {
    const scripted = new FakeProvider(Array.from({ length: f.images.length }, (_, index) => ({ text: `TEST actual image ${index + 1} description` })))
    const provider: ProviderAdapter = {
      providerName: scripted.providerName,
      async chat(request) { const response = await scripted.chat(request); options.onReply?.(); return { ...response, completion: options.completion?.(scripted.calls.length) ?? 'complete' } },
      chatStream: (request) => scripted.chatStream(request),
    }
    let producerId = 'TEST actual original activity'
    const activities = createFileProcessingActivities({
      db: options.db ?? pool, archive: f.archive,
      provider: (model) => { expect(model).toBe(f.job.model); return provider },
      context: () => ({ producerId, heartbeat: () => undefined }),
    })
    return { activities, scripted, restarted() { producerId = 'TEST actual restarted activity' } }
  }

  it('does not let an old failure repark the job after explicit owner retry', async () => {
    const f = await fixture(), first = await requesting(f)
    await failFileImage(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, 'provider_outcome_unknown', true, first.revision, scope)
    await retry(f)
    await failFileImage(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, 'late_old_failure', true, first.revision, scope).catch((error: unknown) => { expect(error).toMatchObject({ code: 'conflict' }) })
    expect(await readFileProcessingJob(pool, f.job.jobId, scope)).toMatchObject({ state: 'queued', revision: 1, uncertainImages: 0 })
    expect((await pool.query('SELECT state FROM file_processing_images WHERE job_id=$1 AND image_id=$2', [f.job.jobId, first.image.imageId])).rows[0]).toEqual({ state: 'pending' })
  })

  it('retains a late original paid reply without overwriting the replacement image attempt', async () => {
    const f = await fixture(), first = await requesting(f)
    await failFileImage(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, 'provider_outcome_unknown', true, first.revision, scope)
    await retry(f)
    const second = await claimFileImage(pool, f.job.jobId, first.image.imageId, 'TEST producer B', f.revision, scope)
    expect(second.attempt).toBe(first.attempt + 1)
    await stageFileImageResponse(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, response, first.revision, scope)
    const retained = await pool.query('SELECT pending_response FROM file_processing_attempts WHERE job_id=$1 AND image_id=$2 AND attempt=$3', [f.job.jobId, first.image.imageId, first.attempt])
    expect(retained.rows[0]?.pending_response).toEqual(response)
    expect((await pool.query('SELECT state,attempt FROM file_processing_images WHERE job_id=$1 AND image_id=$2', [f.job.jobId, first.image.imageId])).rows[0]).toEqual({ state: 'claimed', attempt: second.attempt })
  })

  it('retains the original serialized paid reply across JSONB key ordering', async () => {
    const f = await fixture(), first = await requesting(f)
    await stageFileImageResponse(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, response, first.revision, scope)
    const recovered = await claimFileImage(pool, f.job.jobId, first.image.imageId, 'TEST restarted producer', f.revision, scope)
    expect(recovered.state).toBe('response-staged')
    expect(recovered.pendingResponse).toEqual(response)
    expect(recovered.pendingResponseSerialized).toBe(JSON.stringify(response))
    const ref = await storeResult(f)
    await completeFileImage(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, ref, fileImageResponseUnits(response, first.image), f.archive, first.revision, scope)
    expect(await f.archive.read(ref.key)).toBe(JSON.stringify(response))
  })

  it('stores valid emoji transcriptions without splitting Unicode pairs into invalid JSONB units', async () => {
    const f = await fixture(), first = await requesting(f)
    const paid = { ...response, text: 'TEST ' + '😊'.repeat(2100) }
    await stageFileImageResponse(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, paid, first.revision, scope)
    const ref = await storeResult(f, JSON.stringify(paid)), units = fileImageResponseUnits(paid, first.image)
    expect(units.every((unit) => unit.text.length <= 2000)).toBe(true)
    await completeFileImage(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, ref, units, f.archive, first.revision, scope)
    expect((await claimFileImage(pool, f.job.jobId, first.image.imageId, 'TEST Unicode restart', f.revision, scope)).state).toBe('complete')
    expect(units.map((unit) => unit.text).join('')).toContain(paid.text)
    for (const unit of units) expect(Buffer.from(unit.text, 'utf8').toString('utf8')).toBe(unit.text)
  })

  it('requires explicit retry before publishing a failed native-only job', async () => {
    const f = await fixture(false)
    const nativeUnits = await assembleFileProcessingUnits(pool, f.job.jobId, f.archive, f.revision, scope)
    await failFileProcessingJob(pool, f.job.jobId, 'test_storage_failed', f.revision, scope)
    await expect(finalizeFileProcessingJob(pool, f.job.jobId, nativeUnits, f.archive, f.revision, scope)).rejects.toMatchObject({ code: 'conflict' })
    expect(await readFileProcessingJob(pool, f.job.jobId, scope)).toMatchObject({ state: 'failed' })
    expect((await pool.query('SELECT ord FROM sector_document_units WHERE document_id=$1', [f.document.id])).rows).toEqual([])
  })

  it('rejects a claimed zero-image manifest when the sealed PDF manifest contains images', async () => {
    const f = await fixture(true, false)
    expect(f.images).toHaveLength(2)
    await expect(registerFileImages(pool, f.job.jobId, f.manifest, [], f.archive, f.revision, scope)).rejects.toMatchObject({ code: 'conflict' })
    expect(await readFileProcessingJob(pool, f.job.jobId, scope)).toMatchObject({ totalImages: null, state: 'queued' })
  })

  it('keeps completed and staged paid receipts unchanged when failure callbacks arrive late', async () => {
    const f = await fixture(), first = await requesting(f)
    await stageFileImageResponse(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, response, first.revision, scope)
    await failFileImage(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, 'late_stage_failure', true, first.revision, scope)
    expect((await claimFileImage(pool, f.job.jobId, first.image.imageId, 'TEST reader', f.revision, scope)).state).toBe('response-staged')
    const ref = await storeResult(f)
    const units = fileImageResponseUnits(response, first.image)
    await completeFileImage(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, ref, units, f.archive, first.revision, scope)
    await failFileImage(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, 'late_complete_failure', true, first.revision, scope)
    expect(await claimFileImage(pool, f.job.jobId, first.image.imageId, 'TEST reader', f.revision, scope)).toMatchObject({ state: 'complete', resultRef: ref, units })
  })

  it.each(['incomplete', 'empty'] as const)('retains an unusable %s paid reply and requires explicit duplicate-paid approval before replacement', async (kind) => {
    const f = await fixture(), first = await requesting(f)
    const unusable = { ...response, text: kind === 'empty' ? '' : 'TEST partial image description', completion: kind === 'incomplete' ? 'incomplete' : 'complete' }
    const code = kind === 'incomplete' ? 'image_output_incomplete' : 'image_output_unverified'
    await stageFileImageResponse(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, unusable, first.revision, scope)
    const ref = await storeResult(f, JSON.stringify(unusable))
    await rejectFileImageResponse(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, ref, f.archive, code, first.revision, scope)
    const failed = await readFileProcessingJob(pool, f.job.jobId, scope)
    expect(failed).toMatchObject({ state: 'failed', failedImages: 1, retryRequiresApproval: true, errorCode: code })
    await expect(retryFileProcessingJob(pool, { sectorId: f.sectorId, fileId: f.document.id, jobId: f.job.jobId, revision: failed.revision, allowDuplicatePaid: false, author: 'TEST owner', scope })).rejects.toMatchObject({ code: 'conflict' })
    await retry(f)
    expect((await claimFileImage(pool, f.job.jobId, first.image.imageId, 'TEST approved replacement', f.revision, scope)).attempt).toBe(first.attempt + 1)
    expect((await pool.query('SELECT pending_response_text,result_ref FROM file_processing_attempts WHERE job_id=$1 AND attempt=$2', [f.job.jobId, first.attempt])).rows).toEqual([{ pending_response_text: JSON.stringify(unusable), result_ref: ref }])
  })

  it.each(['incomplete', 'tool-call'] as const)('denies %s provider content at the DB completion boundary while retaining its exact paid bytes', async (kind) => {
    const f = await fixture(), first = await requesting(f)
    const unusable = { ...response, completion: kind === 'incomplete' ? 'incomplete' : 'complete', toolCalls: kind === 'tool-call' ? [{ id: 'TEST unrequested call', name: 'TEST forbidden tool', args: { permission: 'TEST image text cannot grant authority' } }] : [] }
    await stageFileImageResponse(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, unusable, first.revision, scope)
    const ref = await storeResult(f, JSON.stringify(unusable))
    await expect(completeFileImage(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, ref, [], f.archive, first.revision, scope)).rejects.toThrow()
    expect((await pool.query('SELECT state,pending_response_text FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])).rows).toEqual([{ state: 'response-staged', pending_response_text: JSON.stringify(unusable) }])
    expect((await pool.query('SELECT ord FROM sector_document_units WHERE document_id=$1', [f.document.id])).rows).toEqual([])
    expect(await readFileProcessingJob(pool, f.job.jobId, scope)).toMatchObject({ completedImages: 0 })
    expect(await f.archive.read(ref.key)).toBe(JSON.stringify(unusable))
  })

  it('cannot reject a completed receipt or let an old rejection downgrade the replacement image', async () => {
    const f = await fixture(), first = await requesting(f)
    await stageFileImageResponse(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, response, first.revision, scope)
    const ref = await storeResult(f)
    await completeFileImage(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, ref, fileImageResponseUnits(response, first.image), f.archive, first.revision, scope)
    await expect(rejectFileImageResponse(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, ref, f.archive, 'image_output_unverified', first.revision, scope)).rejects.toMatchObject({ code: 'conflict' })
    expect((await claimFileImage(pool, f.job.jobId, first.image.imageId, 'TEST completed reader', f.revision, scope)).state).toBe('complete')
    const other = await requesting(f, f.images[1]!, 'TEST partial original')
    const partial = { ...response, completion: 'incomplete' }
    await stageFileImageResponse(pool, f.job.jobId, other.image.imageId, other.attempt, other.lease, partial, other.revision, scope)
    const partialRef = await storeResult(f, JSON.stringify(partial))
    await rejectFileImageResponse(pool, f.job.jobId, other.image.imageId, other.attempt, other.lease, partialRef, f.archive, 'image_output_incomplete', other.revision, scope)
    await retry(f)
    const replacement = await claimFileImage(pool, f.job.jobId, other.image.imageId, 'TEST partial replacement', f.revision, scope)
    await expect(rejectFileImageResponse(pool, f.job.jobId, other.image.imageId, other.attempt, other.lease, partialRef, f.archive, 'image_output_incomplete', other.revision, scope)).rejects.toMatchObject({ code: 'conflict' })
    expect((await pool.query('SELECT state,attempt FROM file_processing_images WHERE job_id=$1 AND image_id=$2', [f.job.jobId, other.image.imageId])).rows[0]).toEqual({ state: 'claimed', attempt: replacement.attempt })
  })

  it('preserves exact original bytes and stable hidden identity through rejected retry', async () => {
    const f = await fixture(false)
    expect(await f.archive.read(f.job.archiveKey)).toBe(f.original)
    await failFileProcessingJob(pool, f.job.jobId, 'test_storage_failed', f.revision, scope)
    await setFileVisibility(pool, f.sectorId, f.document.id, true, scope)
    await expect(retry(f)).rejects.toMatchObject({ code: 'permission_denied' })
    expect(await f.archive.read(f.job.archiveKey)).toBe(f.original)
    expect((await pool.query('SELECT id FROM sector_documents WHERE sector_id=$1', [f.sectorId])).rows).toEqual([{ id: f.document.id }])
  })

  it('parks expired provider requests without durable replies until an owner acknowledges duplicate paid work', async () => {
    const f = await fixture(), first = await requesting(f)
    await pool.query("UPDATE file_processing_attempts SET deadline_at=now()-interval '1 second' WHERE job_id=$1 AND image_id=$2 AND attempt=$3", [f.job.jobId, first.image.imageId, first.attempt])
    expect(await claimFileImage(pool, f.job.jobId, first.image.imageId, 'TEST replacement', f.revision, scope)).toMatchObject({ state: 'uncertain', attempt: first.attempt })
    const parked = await readFileProcessingJob(pool, f.job.jobId, scope)
    expect(parked).toMatchObject({ state: 'uncertain', retryRequiresApproval: true, uncertainImages: 1 })
    await expect(retryFileProcessingJob(pool, { sectorId: f.sectorId, fileId: f.document.id, jobId: f.job.jobId, revision: parked.revision, allowDuplicatePaid: false, author: 'TEST owner', scope })).rejects.toMatchObject({ code: 'conflict' })
    await expect(claimFileImage(pool, f.job.jobId, first.image.imageId, 'TEST automatic retry', f.revision, scope)).rejects.toMatchObject({ code: 'conflict' })
    expect((await pool.query('SELECT attempt,request_started_at FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])).rows).toHaveLength(1)
    await retry(f)
    expect((await claimFileImage(pool, f.job.jobId, first.image.imageId, 'TEST explicitly approved replacement', f.revision, scope)).attempt).toBe(first.attempt + 1)
    expect(await f.archive.read(f.job.archiveKey)).toBe(f.original)
  })

  it('denies provider dispatch when the job parks after claim but before the original request starts', async () => {
    const f = await fixture(), image = f.images[0]!
    const claim = await claimFileImage(pool, f.job.jobId, image.imageId, 'TEST pre-dispatch owner', f.revision, scope)
    expect(claim.state).toBe('claimed')
    await failFileProcessingJob(pool, f.job.jobId, 'dispatch_outcome_unknown', f.revision, scope)
    await expect(markFileImageRequestStarted(pool, f.job.jobId, image.imageId, claim.attempt, claim.lease!, f.revision, scope)).rejects.toMatchObject({ code: 'conflict' })
    expect((await pool.query('SELECT request_started_at,pending_response FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])).rows).toEqual([{ request_started_at: null, pending_response: null }])
    expect((await pool.query('SELECT ord FROM sector_document_units WHERE document_id=$1', [f.document.id])).rows).toEqual([])
  })

  it('enforces two global admissions across distinct file jobs and releases pre-effect capacity safely', async () => {
    const files = [await fixture(), await fixture(), await fixture()]
    const peers = [pool, new Pool({ connectionString: pool.options.connectionString, max: 1 }), new Pool({ connectionString: pool.options.connectionString, max: 1 })]
    try {
      const claims = await Promise.all(files.map((file, index) => claimFileImage(peers[index]!, file.job.jobId, file.images[0]!.imageId, `TEST independent admission ${index}`, file.revision, scope)))
      expect(claims.filter((claim) => claim.state === 'claimed')).toHaveLength(2)
      expect(claims.filter((claim) => claim.state === 'overload')).toHaveLength(1)
      expect((await pool.query('SELECT request_started_at,pending_response FROM file_processing_attempts')).rows).toEqual([{ request_started_at: null, pending_response: null }, { request_started_at: null, pending_response: null }])
      expect((await pool.query('SELECT ord FROM sector_document_units')).rows).toEqual([])
      const releaseIndex = claims.findIndex((claim) => claim.state === 'claimed'), rejectedIndex = claims.findIndex((claim) => claim.state === 'overload')
      const released = files[releaseIndex]!, owned = claims[releaseIndex]!
      await failFileImage(pool, released.job.jobId, released.images[0]!.imageId, owned.attempt, owned.lease!, 'image_pre_effect_failed', false, released.revision, scope)
      const rejected = files[rejectedIndex]!
      expect(await claimFileImage(peers[rejectedIndex]!, rejected.job.jobId, rejected.images[0]!.imageId, 'TEST admitted after safe release', rejected.revision, scope)).toMatchObject({ state: 'claimed', attempt: 1 })
      expect((await pool.query('SELECT request_started_at FROM file_processing_attempts WHERE request_started_at IS NOT NULL')).rows).toEqual([])
    } finally { await Promise.all(peers.slice(1).map((peer) => peer.end())) }
  })

  it('recovers a lost archive acknowledgement from the exact staged reply without a new image request', async () => {
    const f = await fixture(), first = await requesting(f)
    await stageFileImageResponse(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, response, first.revision, scope)
    const write = f.archive.write.bind(f.archive)
    const spy = vi.spyOn(f.archive, 'write').mockImplementationOnce(async (...args) => { await write(...args); throw new Error('TEST result bytes stored but acknowledgement lost') })
    try {
      await expect(storeResult(f)).rejects.toThrow('TEST result bytes stored but acknowledgement lost')
      const recovered = await claimFileImage(pool, f.job.jobId, first.image.imageId, 'TEST restarted activity', f.revision, scope)
      expect(recovered).toMatchObject({ state: 'response-staged', attempt: first.attempt, lease: first.lease, pendingResponseSerialized: JSON.stringify(response) })
      const body = recovered.pendingResponseSerialized!
      const ref = { key: `file-processing/${f.job.jobId}/results/${digest(body)}.json`, hash: digest(body), bytes: Buffer.byteLength(body) }
      await completeFileImage(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, ref, fileImageResponseUnits(response, first.image), f.archive, first.revision, scope)
      expect(spy).toHaveBeenCalledOnce()
      expect((await pool.query('SELECT attempt,pending_response_text FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])).rows).toEqual([{ attempt: first.attempt, pending_response_text: JSON.stringify(response) }])
    } finally { spy.mockRestore() }
  })

  it('publishes every ordered source only atomically and reuses complete image receipts after an index failure', async () => {
    const f = await fixture(), completeUnits = await completeAll(f, true)
    expect(completeUnits.every((unit) => unit.text.length <= 2000)).toBe(true)
    expect(completeUnits.filter((unit) => unit.imageId).length).toBeGreaterThan(2)
    await pool.query('CREATE TABLE test_file_index_fault (document_id text PRIMARY KEY,enabled boolean NOT NULL)')
    await pool.query('INSERT INTO test_file_index_fault VALUES($1,true)', [f.document.id])
    await pool.query(`CREATE FUNCTION test_file_index_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.ord>0 AND EXISTS(SELECT 1 FROM test_file_index_fault WHERE document_id=NEW.document_id AND enabled) THEN
        RAISE EXCEPTION 'TEST complete index storage unavailable'; END IF; RETURN NEW; END $$`)
    await pool.query('CREATE TRIGGER test_file_index_failure BEFORE INSERT ON sector_document_units FOR EACH ROW EXECUTE FUNCTION test_file_index_failure()')
    await expect(finalizeFileProcessingJob(pool, f.job.jobId, completeUnits, f.archive, f.revision, scope)).rejects.toThrow('TEST complete index storage unavailable')
    expect((await pool.query('SELECT ord FROM sector_document_units WHERE document_id=$1', [f.document.id])).rows).toEqual([])
    expect((await pool.query('SELECT status,text FROM sector_documents WHERE id=$1', [f.document.id])).rows[0]).toEqual({ status: 'processing', text: '' })
    await failFileProcessingJob(pool, f.job.jobId, 'test_index_failed', f.revision, scope)
    await pool.query('UPDATE test_file_index_fault SET enabled=false WHERE document_id=$1', [f.document.id])
    await retry(f)
    for (const image of f.images) expect((await claimFileImage(pool, f.job.jobId, image.imageId, 'TEST restarted finalizer', f.revision, scope)).state).toBe('complete')
    const recoveredUnits = await assembleFileProcessingUnits(pool, f.job.jobId, f.archive, f.revision, scope)
    await finalizeFileProcessingJob(pool, f.job.jobId, recoveredUnits, f.archive, f.revision, scope)
    await finalizeFileProcessingJob(pool, f.job.jobId, recoveredUnits, f.archive, f.revision, scope)
    expect(await readFileProcessingJob(pool, f.job.jobId, scope)).toMatchObject({ state: 'complete', totalImages: 2, completedImages: 2 })
    const stored = await pool.query('SELECT text,source_page,source_image_id FROM sector_document_units WHERE document_id=$1 ORDER BY ord', [f.document.id])
    const text = stored.rows.map((row) => row.text).join('\n')
    const expected = ['TEST page 1 before image', 'TEST image 1.0 description', 'TEST page 1 after image', 'TEST page 2 before image', 'TEST image 2.0 description', 'TEST page 2 after image']
    const positions = expected.map((part) => text.indexOf(part))
    expect(positions.every((at) => at >= 0)).toBe(true); expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(stored.rows.every((row) => row.source_page === 1 || row.source_page === 2)).toBe(true)
    expect((await pool.query('SELECT attempt FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])).rows).toHaveLength(2)
    expect((await pool.query("SELECT idempotency_key FROM events WHERE type='sector.file.processing.indexed' AND payload->>'jobId'=$1", [f.job.jobId])).rows).toHaveLength(1)
    expect(await f.archive.read(f.job.archiveKey)).toBe(f.original)
  })

  it('keeps committed staging batches invisible through every agent reader until complete publication', async () => {
    const f = await fixture(), completeUnits = await completeAll(f, 103_000)
    expect(completeUnits.length).toBeGreaterThan(100)
    await pool.query('CREATE TABLE test_staging_fault (document_id text PRIMARY KEY,enabled boolean NOT NULL)')
    await pool.query('INSERT INTO test_staging_fault VALUES($1,true)', [f.document.id])
    await pool.query(`CREATE FUNCTION test_staging_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.ord>=100 AND EXISTS(SELECT 1 FROM test_staging_fault WHERE document_id=NEW.document_id AND enabled) THEN
        RAISE EXCEPTION 'TEST second staging batch unavailable'; END IF; RETURN NEW; END $$`)
    await pool.query('CREATE TRIGGER test_staging_failure BEFORE INSERT ON sector_document_units FOR EACH ROW EXECUTE FUNCTION test_staging_failure()')
    await expect(finalizeFileProcessingJob(pool, f.job.jobId, completeUnits, f.archive, f.revision, scope)).rejects.toThrow('TEST second staging batch unavailable')
    expect(Number((await pool.query('SELECT count(*) AS n FROM sector_document_units WHERE document_id=$1', [f.document.id])).rows[0]!.n)).toBe(100)
    const query = { sectorId: f.sectorId, documentId: f.document.id, scope }
    expect(await readSectorDocument(pool, f.sectorId, f.document.id, scope)).toMatchObject({ status: 'processing', chars: 0, text: '' })
    expect(await querySectorDocument(pool, { ...query, mode: 'summary' })).toMatchObject({ status: 'processing', totalUnits: 0, toc: [] })
    expect(await querySectorDocument(pool, { ...query, mode: 'chunks' })).toMatchObject({ units: [] })
    expect(await querySectorDocument(pool, { ...query, mode: 'chunks', ords: [0, 99] })).toMatchObject({ units: [] })
    expect(await querySectorDocument(pool, { ...query, mode: 'chunks', query: 'TEST' })).toMatchObject({ units: [] })
    await failFileProcessingJob(pool, f.job.jobId, 'test_second_batch_failed', f.revision, scope)
    expect(await readSectorDocument(pool, f.sectorId, f.document.id, scope)).toMatchObject({ status: 'failed', text: '' })
    await pool.query('UPDATE test_staging_fault SET enabled=false WHERE document_id=$1', [f.document.id])
    await retry(f)
    const recovered = await assembleFileProcessingUnits(pool, f.job.jobId, f.archive, f.revision, scope)
    await finalizeFileProcessingJob(pool, f.job.jobId, recovered, f.archive, f.revision, scope)
    expect(await readFileProcessingJob(pool, f.job.jobId, scope)).toMatchObject({ state: 'complete', completedImages: 2 })
    expect(Number((await pool.query('SELECT count(*) AS n FROM sector_document_units WHERE document_id=$1', [f.document.id])).rows[0]!.n)).toBe(completeUnits.length)
    expect((await pool.query('SELECT attempt FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])).rows).toHaveLength(2)
    const last = completeUnits.length - 1
    expect(await querySectorDocument(pool, { ...query, mode: 'chunks', ords: [last] })).toMatchObject({ status: 'indexed', units: [{ ord: last, text: completeUnits[last]!.text }] })
    expect(await f.archive.read(f.job.archiveKey)).toBe(f.original)
  })

  it('rejects fabricated or incomplete publication units against the sealed native and image records', async () => {
    const f = await fixture(), completeUnits = await completeAll(f)
    const fabricated = completeUnits.map((unit, index) => index === 0 ? { ...unit, text: 'TEST fabricated replacement' } : unit)
    await expect(finalizeFileProcessingJob(pool, f.job.jobId, fabricated, f.archive, f.revision, scope)).rejects.toMatchObject({ code: 'conflict' })
    await expect(finalizeFileProcessingJob(pool, f.job.jobId, completeUnits.slice(0, -1), f.archive, f.revision, scope)).rejects.toMatchObject({ code: 'conflict' })
    expect((await pool.query('SELECT ord FROM sector_document_units WHERE document_id=$1', [f.document.id])).rows).toEqual([])
  })

  it('retains indexed counts and identity when a completed upload is repeated', async () => {
    const f = await fixture(), completeUnits = await completeAll(f)
    await finalizeFileProcessingJob(pool, f.job.jobId, completeUnits, f.archive, f.revision, scope)
    const replay = await createFileProcessingJob(pool, {
      sectorId: f.sectorId, filename: 'TEST replacement display name.pdf', contentBase64: f.original,
      provider: f.job.provider, model: f.job.model, parserVersion: f.job.parserVersion,
      promptVersion: f.job.promptVersion, scope, archive: f.archive,
    })
    expect(replay.document).toMatchObject({ id: f.document.id, filename: f.document.filename, status: 'indexed', unitCount: completeUnits.length })
    expect(replay.job).toMatchObject({ jobId: f.job.jobId, state: 'complete', revision: f.revision })
    expect((await pool.query('SELECT id FROM sector_documents WHERE sector_id=$1', [f.sectorId])).rows).toEqual([{ id: f.document.id }])
  })

  it.each(['missing', 'corrupt'] as const)('does not seal %s input images into a processing manifest', async (fault) => {
    const f = await fixture(true, false)
    const key = f.images[0]!.inputRef.key, read = f.archive.read.bind(f.archive)
    const spy = fault === 'missing' ? vi.spyOn(f.archive, 'read').mockImplementation(async (path, ...args) => path === key ? undefined : read(path, ...args)) : undefined
    try {
      if (fault === 'corrupt') await f.archive.write(key, Buffer.from('TEST corrupt PNG input').toString('base64'))
      await expect(registerFileImages(pool, f.job.jobId, f.manifest, f.images, f.archive, f.revision, scope)).rejects.toMatchObject({ code: 'conflict' })
      expect(await readFileProcessingJob(pool, f.job.jobId, scope)).toMatchObject({ totalImages: null, state: 'queued', manifestRef: null })
      expect((await pool.query('SELECT image_id FROM file_processing_images WHERE job_id=$1', [f.job.jobId])).rows).toEqual([])
      expect(await f.archive.read(f.job.archiveKey)).toBe(f.original)
    } finally { spy?.mockRestore() }
  })

  it.each(['missing', 'corrupt'] as const)('refuses %s paid bytes at final publication while preserving the original exact paid checkpoint', async (fault) => {
    const f = await fixture(), completeUnits = await completeAll(f)
    const originals = (await pool.query('SELECT result_ref,pending_response_text FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])).rows as Array<{ result_ref: FileArchiveRef; pending_response_text: string }>
    const read = f.archive.read.bind(f.archive)
    const spy = fault === 'missing' ? vi.spyOn(f.archive, 'read').mockImplementation(async (key, ...args) => key.includes('/results/') ? undefined : read(key, ...args)) : undefined
    try {
      if (fault === 'corrupt') for (const row of originals) await f.archive.write(row.result_ref.key, 'TEST corrupt paid bytes')
      await expect(finalizeFileProcessingJob(pool, f.job.jobId, completeUnits, f.archive, f.revision, scope)).rejects.toMatchObject({ code: 'conflict' })
      expect((await pool.query('SELECT ord FROM sector_document_units WHERE document_id=$1', [f.document.id])).rows).toEqual([])
      const paid = await pool.query('SELECT pending_response,pending_response_text,result_ref FROM file_processing_attempts WHERE job_id=$1 ORDER BY image_id', [f.job.jobId])
      expect(paid.rows).toHaveLength(2)
      for (const row of paid.rows) { expect(JSON.parse(row.pending_response_text)).toEqual(row.pending_response); expect(row.result_ref).toMatchObject({ hash: expect.any(String), bytes: expect.any(Number) }) }
      expect(await f.archive.read(f.job.archiveKey)).toBe(f.original)
    } finally {
      spy?.mockRestore()
      if (fault === 'corrupt') for (const row of originals) await f.archive.write(row.result_ref.key, row.pending_response_text)
    }
    await finalizeFileProcessingJob(pool, f.job.jobId, completeUnits, f.archive, f.revision, scope)
    expect(await readFileProcessingJob(pool, f.job.jobId, scope)).toMatchObject({ state: 'complete', completedImages: 2 })
  })

  it('retains a reply arriving while hidden and blocks further dispatch and publication until reveal', async () => {
    const f = await fixture(), first = await requesting(f)
    await setFileVisibility(pool, f.sectorId, f.document.id, true, scope)
    await stageFileImageResponse(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, response, first.revision, scope)
    expect((await pool.query('SELECT pending_response_text FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])).rows).toEqual([{ pending_response_text: JSON.stringify(response) }])
    await expect(claimFileImage(pool, f.job.jobId, f.images[1]!.imageId, 'TEST hidden new request', f.revision, scope)).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(assembleFileProcessingUnits(pool, f.job.jobId, f.archive, f.revision, scope)).rejects.toMatchObject({ code: 'permission_denied' })
    expect((await pool.query('SELECT ord FROM sector_document_units WHERE document_id=$1', [f.document.id])).rows).toEqual([])
    await setFileVisibility(pool, f.sectorId, f.document.id, false, scope)
    const retained = await claimFileImage(pool, f.job.jobId, first.image.imageId, 'TEST resumed producer', f.revision, scope)
    expect(retained).toMatchObject({ state: 'response-staged', attempt: first.attempt, lease: first.lease })
    const ref = await storeResult(f)
    await completeFileImage(pool, f.job.jobId, first.image.imageId, first.attempt, first.lease, ref, fileImageResponseUnits(response, first.image), f.archive, first.revision, scope)
    expect((await pool.query('SELECT attempt FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])).rows).toHaveLength(1)
    expect(await f.archive.read(f.job.archiveKey)).toBe(f.original)
  })

  it('denies foreign scope and cross-job archive references even when their bytes are otherwise valid', async () => {
    const f = await fixture(true, false), foreign = { tenantId: 'TEST foreign file owner', projectId: null }
    await expect(readFileProcessingJob(pool, f.job.jobId, foreign)).rejects.toMatchObject({ code: 'not_found' })
    await expect(registerFileImages(pool, f.job.jobId, f.manifest, f.images, f.archive, f.revision, foreign)).rejects.toMatchObject({ code: 'not_found' })
    const foreignRef = { ...f.manifest, key: 'file-processing/TEST-another-job/manifest.json' }
    await f.archive.write(foreignRef.key, (await f.archive.read(f.manifest.key))!)
    await expect(registerFileImages(pool, f.job.jobId, foreignRef, f.images, f.archive, f.revision, scope)).rejects.toMatchObject({ code: 'permission_denied' })
    expect(await readFileProcessingJob(pool, f.job.jobId, scope)).toMatchObject({ totalImages: null, manifestRef: null, state: 'queued' })
  })

  it('does not publish an original-byte pointer after storage times out, and adopts the exact late bytes on retry', async () => {
    const sectorId = `TEST-late-original-${randomUUID()}`
    await createSector(pool, { sectorId, name: 'TEST late original storage', scope }); await projectNewEvents(pool)
    const archive = new FilesystemTarget(mkdtempSync(join(tmpdir(), 'kardata-test-late-original-')))
    let release: () => void = () => undefined, settled: () => void = () => undefined, received: AbortSignal | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const written = new Promise<void>((resolve) => { settled = resolve })
    const target = {
      async write(key: string, body: string, signal?: AbortSignal) { received = signal; await gate; await archive.write(key, body); settled() },
      read: archive.read.bind(archive), list: archive.list.bind(archive),
    }
    const original = testPdf(true).toString('base64')
    const input = { sectorId, filename: 'TEST late original.pdf', contentBase64: original, provider: 'fake', model: 'TEST frozen model', parserVersion: 'pdf-v3', promptVersion: 'document-image-v2', scope }
    try {
      await expect(createFileProcessingJob(pool, { ...input, archive: withArchiveDeadline(target, 10) })).rejects.toMatchObject({ code: 'source_timeout' })
      expect(received?.aborted).toBe(true)
      expect((await pool.query('SELECT id FROM sector_documents WHERE sector_id=$1', [sectorId])).rows).toEqual([])
      expect((await pool.query('SELECT id FROM file_processing_jobs WHERE sector_id=$1', [sectorId])).rows).toEqual([])
    } finally { release(); await written }
    const recovered = await createFileProcessingJob(pool, { ...input, archive })
    expect(recovered.document).toMatchObject({ status: 'processing', unitCount: 0 })
    expect(recovered.job).toMatchObject({ state: 'queued', totalImages: null })
    expect(await archive.read(recovered.job.archiveKey)).toBe(original)
    expect((await pool.query('SELECT id FROM sector_documents WHERE sector_id=$1', [sectorId])).rows).toEqual([{ id: recovered.document.id }])
  })

  it('prepares real PDF image references and completes the actual activity path without repeating paid work', async () => {
    const f = await fixture(true, false, 'meta'), harness = activityHarness(f)
    const input = { jobId: f.job.jobId, revision: f.revision }
    expect(await harness.activities.prepareFileProcessingActivity(input)).toMatchObject({ state: 'processing', totalImages: 2 })
    const ids: string[] = []
    let cursor: { page: number; ordinal: number } | null = null
    for (;;) {
      const next = await harness.activities.nextFileImageActivity({ ...input, cursor })
      if (!next.imageId) break
      ids.push(next.imageId); cursor = next.nextCursor
      expect(await harness.activities.processFileImageActivity({ ...input, imageId: next.imageId })).toEqual({ state: 'complete' })
    }
    expect(ids).toHaveLength(2); expect(harness.scripted.calls).toHaveLength(2)
    harness.restarted()
    for (const imageId of ids) expect(await harness.activities.processFileImageActivity({ ...input, imageId })).toEqual({ state: 'complete' })
    expect(harness.scripted.calls).toHaveLength(2)
    await harness.activities.finalizeFileProcessingActivity(input)
    expect(await readFileProcessingJob(pool, f.job.jobId, scope)).toMatchObject({ state: 'complete', completedImages: 2 })
    expect(await f.archive.read(f.job.archiveKey)).toBe(f.original)
    const stored = (await pool.query('SELECT text FROM sector_documents WHERE id=$1', [f.document.id])).rows[0]!.text as string
    for (const part of ['TEST page 1 before image', 'TEST actual image 1 description', 'TEST page 2 after image']) expect(stored).toContain(part)
    for (const request of harness.scripted.calls) {
      expect(request.tools).toEqual([])
      expect(Buffer.from(request.messages[0]!.images![0]!.base64, 'base64').subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    }
  })

  it('repairs an oversized corrupt completed archive from its canonical paid checkpoint without a provider call', async () => {
    const f = await fixture(true, true, 'meta'), harness = activityHarness(f)
    const input = { jobId: f.job.jobId, revision: f.revision, imageId: f.images[0]!.imageId }
    expect(await harness.activities.processFileImageActivity(input)).toEqual({ state: 'complete' })
    const row = (await pool.query('SELECT result_ref,pending_response_text FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])).rows[0] as { result_ref: FileArchiveRef; pending_response_text: string }
    await f.archive.write(row.result_ref.key, 'TEST oversized corrupt object ' + 'x'.repeat(row.result_ref.bytes + 4096))
    const cached = createFileProcessingActivities({ db: pool, archive: f.archive, provider: () => { throw new Error('TEST recovery cannot construct a provider') }, context: () => ({ producerId: 'TEST canonical archive repair', heartbeat: () => undefined }) })
    expect(await cached.processFileImageActivity(input)).toEqual({ state: 'complete' })
    expect(harness.scripted.calls).toHaveLength(1)
    expect(await f.archive.read(row.result_ref.key)).toBe(row.pending_response_text)
    expect((await pool.query('SELECT result_ref,attempt FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])).rows).toEqual([{ result_ref: row.result_ref, attempt: 1 }])
  })

  it('releases a claimed image on provider construction failure before dispatch and permits a safe retry', async () => {
    const f = await fixture(true, true, 'meta')
    const activities = createFileProcessingActivities({ db: pool, archive: f.archive, provider: () => { throw new Error('TEST provider construction unavailable') }, context: () => ({ producerId: 'TEST failed provider setup', heartbeat: () => undefined }) })
    await expect(activities.processFileImageActivity({ jobId: f.job.jobId, revision: f.revision, imageId: f.images[0]!.imageId })).rejects.toMatchObject({ code: 'conflict' })
    expect(await readFileProcessingJob(pool, f.job.jobId, scope)).toMatchObject({ state: 'failed', failedImages: 1, retryRequiresApproval: false })
    expect((await pool.query('SELECT state,request_started_at FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])).rows).toEqual([{ state: 'failed', request_started_at: null }])
    const retrying = await retryFileProcessingJob(pool, { sectorId: f.sectorId, fileId: f.document.id, jobId: f.job.jobId, revision: f.revision, allowDuplicatePaid: false, author: 'TEST owner', scope })
    expect(retrying).toMatchObject({ state: 'queued', revision: f.revision + 1, retryRequiresApproval: false })
  })

  it('recovers the signed original paid reply after DB staging fails without advancing a new paid request', async () => {
    const f = await fixture(true, true, 'meta'), harness = activityHarness(f)
    const imageId = f.images[0]!.imageId, input = { jobId: f.job.jobId, revision: f.revision, imageId }
    const stage = vi.spyOn(fileJobsDb, 'stageFileImageResponse').mockImplementationOnce(async () => { throw new Error('TEST paid reply DB staging unavailable') })
    try { await expect(harness.activities.processFileImageActivity(input)).rejects.toMatchObject({ code: 'conflict' }) }
    finally { stage.mockRestore() }
    expect(harness.scripted.calls).toHaveLength(1)
    const retained = await f.archive.read(`file-processing/${f.job.jobId}/images/${imageId}/attempt-1.pending.json`)
    expect(retained).toBeDefined()
    expect((await pool.query('SELECT pending_response FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])).rows).toEqual([{ pending_response: null }])
    await retry(f); harness.restarted()
    expect(await harness.activities.processFileImageActivity({ ...input, revision: f.revision })).toEqual({ state: 'complete' })
    expect(harness.scripted.calls).toHaveLength(1)
    const attempts = await pool.query('SELECT attempt,producer_id,pending_response_text FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])
    expect(attempts.rows).toHaveLength(1)
    expect(attempts.rows[0]).toMatchObject({ attempt: 1, producer_id: 'TEST actual original activity', pending_response_text: expect.any(String) })
  })

  it('archives the paid reply when all DB access fails after provider completion and restores it without a second call', async () => {
    const f = await fixture(true, true, 'meta')
    let unavailable = false
    const interrupted = new Proxy(pool, {
      get(target, name) {
        const value = Reflect.get(target, name)
        if (name === 'query' || name === 'connect') return (...args: unknown[]) => unavailable ? Promise.reject(new Error('TEST all DB access failed after payment')) : Reflect.apply(value as (...args: unknown[]) => unknown, target, args)
        return value
      },
    })
    const harness = activityHarness(f, { db: interrupted, onReply: () => { unavailable = true } })
    const imageId = f.images[0]!.imageId, input = { jobId: f.job.jobId, revision: f.revision, imageId }
    await expect(harness.activities.processFileImageActivity(input)).rejects.toThrow()
    expect(harness.scripted.calls).toHaveLength(1)
    const retained = await f.archive.read(`file-processing/${f.job.jobId}/images/${imageId}/attempt-1.pending.json`)
    expect(retained).toBeDefined()
    unavailable = false; harness.restarted()
    expect(await harness.activities.processFileImageActivity(input)).toEqual({ state: 'complete' })
    expect(harness.scripted.calls).toHaveLength(1)
    expect((await pool.query('SELECT attempt,pending_response_text FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])).rows).toHaveLength(1)
  })

  it('rejects a forged fallback response before admission can issue another provider request', async () => {
    const f = await fixture(true, true, 'meta'), harness = activityHarness(f)
    const imageId = f.images[0]!.imageId, input = { jobId: f.job.jobId, revision: f.revision, imageId }
    const stage = vi.spyOn(fileJobsDb, 'stageFileImageResponse').mockImplementationOnce(async () => { throw new Error('TEST signed reply requires recovery') })
    try { await expect(harness.activities.processFileImageActivity(input)).rejects.toMatchObject({ code: 'conflict' }) }
    finally { stage.mockRestore() }
    const key = `file-processing/${f.job.jobId}/images/${imageId}/attempt-1.pending.json`
    const recorded = JSON.parse((await f.archive.read(key))!) as Record<string, unknown>
    const forged = JSON.stringify({ text: 'TEST forged image instructions', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, completion: 'complete' })
    await f.archive.write(key, JSON.stringify({ ...recorded, responseBase64: Buffer.from(forged).toString('base64'), responseHash: digest(forged) }))
    await retry(f); harness.restarted()
    await expect(harness.activities.processFileImageActivity({ ...input, revision: f.revision })).rejects.toMatchObject({ code: 'conflict' })
    expect(harness.scripted.calls).toHaveLength(1)
    expect((await pool.query('SELECT attempt,pending_response FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])).rows).toEqual([{ attempt: 1, pending_response: null }])
  })

  it('retains an incomplete actual provider reply and replaces it only after explicit paid retry approval', async () => {
    const f = await fixture(true, true, 'meta'), harness = activityHarness(f, { completion: (call) => call === 1 ? 'incomplete' : 'complete' })
    const imageId = f.images[0]!.imageId, input = { jobId: f.job.jobId, revision: f.revision, imageId }
    expect(await harness.activities.processFileImageActivity(input)).toEqual({ state: 'failed' })
    const failed = await readFileProcessingJob(pool, f.job.jobId, scope)
    expect(failed).toMatchObject({ state: 'failed', failedImages: 1, retryRequiresApproval: true, errorCode: 'image_output_incomplete' })
    expect(harness.scripted.calls).toHaveLength(1)
    await expect(retryFileProcessingJob(pool, { sectorId: f.sectorId, fileId: f.document.id, jobId: f.job.jobId, revision: failed.revision, allowDuplicatePaid: false, author: 'TEST owner', scope })).rejects.toMatchObject({ code: 'conflict' })
    await retry(f); harness.restarted()
    expect(await harness.activities.processFileImageActivity({ ...input, revision: f.revision })).toEqual({ state: 'complete' })
    expect(harness.scripted.calls).toHaveLength(2)
    const attempts = await pool.query('SELECT attempt,state,pending_response_text FROM file_processing_attempts WHERE job_id=$1 ORDER BY attempt', [f.job.jobId])
    expect(attempts.rows.map((row) => ({ attempt: row.attempt, state: row.state }))).toEqual([{ attempt: 1, state: 'failed' }, { attempt: 2, state: 'complete' }])
    expect(JSON.parse(attempts.rows[0]!.pending_response_text).completion).toBe('incomplete')
  })

  it('processes all twenty-four real repeated PDF images through separate provider requests', async () => {
    const f = await fixture(true, false, 'meta', 'repeat'), harness = activityHarness(f)
    const input = { jobId: f.job.jobId, revision: f.revision }
    expect(await harness.activities.prepareFileProcessingActivity(input)).toMatchObject({ totalImages: 24 })
    let cursor: { page: number; ordinal: number } | null = null, count = 0
    for (;;) {
      const next = await harness.activities.nextFileImageActivity({ ...input, cursor })
      if (!next.imageId) break
      expect(await harness.activities.processFileImageActivity({ ...input, imageId: next.imageId })).toEqual({ state: 'complete' })
      cursor = next.nextCursor; count++
    }
    expect(count).toBe(24); expect(harness.scripted.calls).toHaveLength(24)
    await harness.activities.finalizeFileProcessingActivity(input)
    expect(await readFileProcessingJob(pool, f.job.jobId, scope)).toMatchObject({ state: 'complete', totalImages: 24, completedImages: 24 })
    const provenance = await pool.query('SELECT DISTINCT source_image_id FROM sector_document_units WHERE document_id=$1 AND source_image_id IS NOT NULL', [f.document.id])
    expect(provenance.rows).toHaveLength(24)
  })

  it('bounds an abort-ignoring provider and retains its late paid reply for recovery', async () => {
    const f = await fixture(true, true, 'meta')
    let release: () => void = () => undefined, calls = 0, received: AbortSignal | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const provider: ProviderAdapter = {
      providerName: 'TEST late scripted provider',
      async chat(request) { calls++; received = request.signal; await gate; return { text: 'TEST original late paid reply', toolCalls: [], usage: emptyUsage(), completion: 'complete' as const } },
      chatStream: () => { throw new Error('TEST unexpected streaming call') },
    }
    const activities = createFileProcessingActivities({ db: pool, archive: f.archive, provider: () => provider, providerDeadlineMs: 200, context: () => ({ producerId: 'TEST late original producer', heartbeat: () => undefined }) })
    const input = { jobId: f.job.jobId, revision: f.revision, imageId: f.images[0]!.imageId }
    try {
      await expect(activities.processFileImageActivity(input)).rejects.toMatchObject({ code: 'conflict' })
      expect(calls).toBe(1); expect(received?.aborted).toBe(true)
      expect(await readFileProcessingJob(pool, f.job.jobId, scope)).toMatchObject({ state: 'uncertain', uncertainImages: 1, retryRequiresApproval: true })
    } finally { release() }
    await vi.waitFor(async () => {
      const saved = await pool.query('SELECT pending_response_text FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])
      expect(saved.rows[0]?.pending_response_text).toContain('TEST original late paid reply')
    }, { timeout: 2000, interval: 10 })
    // A verified late reply resolves this exact provider-outcome uncertainty.
    // It cannot acknowledge another unknown request or a manual owner pause.
    expect(await readFileProcessingJob(pool, f.job.jobId, scope)).toMatchObject({ state: 'processing', uncertainImages: 0, retryRequiresApproval: false })
    expect(await activities.processFileImageActivity(input)).toEqual({ state: 'complete' })
    expect(calls).toBe(1)
    expect((await pool.query('SELECT attempt,producer_id FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])).rows).toEqual([{ attempt: 1, producer_id: 'TEST late original producer' }])
  })

  it('processes an image with a labelled estimate when only token counting is unavailable', async () => {
    const f = await fixture(true, true, 'meta')
    const chat = vi.fn(async () => ({ text: 'TEST visible text and observed diagram', toolCalls: [], usage: emptyUsage(), completion: 'complete' as const }))
    const provider: ProviderAdapter = { providerName: 'TEST unavailable counter', countInputTokens: async () => { throw new TokenCountUnavailableError('billing_not_configured', 402) }, chat, chatStream: () => { throw new Error('TEST unexpected stream') } }
    const activities = createFileProcessingActivities({ db: pool, archive: f.archive, provider: () => provider, context: () => ({ producerId: 'TEST estimated image budget', heartbeat: () => undefined }) })
    await expect(activities.processFileImageActivity({ jobId: f.job.jobId, revision: f.revision, imageId: f.images[0]!.imageId })).resolves.toEqual({ state: 'complete' })
    expect(chat).toHaveBeenCalledTimes(1)
    expect((await pool.query('SELECT request_started_at FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])).rows[0]?.request_started_at).not.toBeNull()
  })

  it('rejects an estimated image request that exceeds the model window minus output reserve', async () => {
    const f = await fixture(true, true, 'meta')
    const chat = vi.fn(async () => ({ text: 'TEST must not be called', toolCalls: [], usage: emptyUsage(), completion: 'complete' as const }))
    const provider: ProviderAdapter = { providerName: 'TEST unavailable counter', countInputTokens: async () => { throw new TokenCountUnavailableError('billing_not_configured', 402) }, chat, chatStream: () => { throw new Error('TEST unexpected stream') } }
    const activities = createFileProcessingActivities({ db: pool, archive: f.archive, provider: () => provider, modelWindow: () => 16385, context: () => ({ producerId: 'TEST oversized estimate', heartbeat: () => undefined }) })
    await expect(activities.processFileImageActivity({ jobId: f.job.jobId, revision: f.revision, imageId: f.images[0]!.imageId })).rejects.toMatchObject({ code: 'conflict', message: 'Image processing could not start.', cause: { code: 'conflict', message: 'Image input exceeds the verified request budget.' } })
    expect(await readFileProcessingJob(pool, f.job.jobId, scope)).toMatchObject({ state: 'failed', failedImages: 1, uncertainImages: 0, retryRequiresApproval: false })
    expect(chat).not.toHaveBeenCalled()
    expect((await pool.query('SELECT request_started_at FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])).rows).toEqual([{ request_started_at: null }])
  })

  it('parks a genuine token-count transport failure before sending a paid image request', async () => {
    const f = await fixture(true, true, 'meta')
    const chat = vi.fn(async () => ({ text: 'TEST must not be called', toolCalls: [], usage: emptyUsage(), completion: 'complete' as const }))
    const provider: ProviderAdapter = { providerName: 'TEST failed counter', countInputTokens: async () => { throw new ProviderError('TEST unavailable upstream', true) }, chat, chatStream: () => { throw new Error('TEST unexpected stream') } }
    const activities = createFileProcessingActivities({ db: pool, archive: f.archive, provider: () => provider, context: () => ({ producerId: 'TEST failed image budget', heartbeat: () => undefined }) })
    await expect(activities.processFileImageActivity({ jobId: f.job.jobId, revision: f.revision, imageId: f.images[0]!.imageId })).rejects.toMatchObject({ code: 'conflict', message: 'Image processing could not start.', cause: { message: 'TEST unavailable upstream', retryable: true } })
    expect(await readFileProcessingJob(pool, f.job.jobId, scope)).toMatchObject({ state: 'failed', failedImages: 1, uncertainImages: 0, retryRequiresApproval: false })
    expect(chat).not.toHaveBeenCalled()
    expect((await pool.query('SELECT request_started_at FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])).rows).toEqual([{ request_started_at: null }])
  })

  it('bounds token-count setup without dispatching or marking a provider request', async () => {
    const f = await fixture(true, true, 'meta')
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const chat = vi.fn(async () => ({ text: 'TEST must not be called', toolCalls: [], usage: emptyUsage(), completion: 'complete' as const }))
    const provider: ProviderAdapter = { providerName: 'TEST blocked count provider', countInputTokens: async () => { await gate; return 10 }, chat, chatStream: () => { throw new Error('TEST unexpected streaming call') } }
    const activities = createFileProcessingActivities({ db: pool, archive: f.archive, provider: () => provider, providerDeadlineMs: 100, context: () => ({ producerId: 'TEST blocked token count', heartbeat: () => undefined }) })
    try {
      await expect(activities.processFileImageActivity({ jobId: f.job.jobId, revision: f.revision, imageId: f.images[0]!.imageId })).rejects.toMatchObject({ code: 'conflict' })
      expect(chat).not.toHaveBeenCalled()
      expect(await readFileProcessingJob(pool, f.job.jobId, scope)).toMatchObject({ state: 'failed', failedImages: 1, retryRequiresApproval: false })
      expect((await pool.query('SELECT request_started_at FROM file_processing_attempts WHERE job_id=$1', [f.job.jobId])).rows).toEqual([{ request_started_at: null }])
    } finally { release() }
  })

  it('keeps unrelated sector writes available while final publication waits for archived paid bytes', async () => {
    const f = await fixture(), completeUnits = await completeAll(f), other = await fixture(false)
    let entered: () => void = () => undefined, release: () => void = () => undefined
    const arrived = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const read = f.archive.read.bind(f.archive)
    let held = false
    const spy = vi.spyOn(f.archive, 'read').mockImplementation(async (key, ...args) => {
      if (key.includes('/results/') && !held) { held = true; entered(); await gate }
      return read(key, ...args)
    })
    const publishing = finalizeFileProcessingJob(pool, f.job.jobId, completeUnits, f.archive, f.revision, scope)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await arrived
      let completedBeforeRelease = false
      const unrelated = setFileVisibility(pool, other.sectorId, other.document.id, true, scope).then(() => { completedBeforeRelease = true })
      await Promise.race([unrelated, new Promise<void>((resolve) => { timer = setTimeout(resolve, 1000) })])
      const available = completedBeforeRelease
      release(); await Promise.all([publishing, unrelated])
      expect(available).toBe(true)
    } finally { if (timer) clearTimeout(timer); release(); spy.mockRestore(); await publishing }
  })
})
