// Pure unit tests for the file-processing factory: prepare cursor/image
// extraction, image claim/process/recovery, finalize/fail, and the
// production exports. No database, no provider network.
import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { MockActivityEnvironment } from '@temporalio/testing'
import { sha256Hex } from '../../backend/src/db/file-pipeline.js'
import { DOCUMENT_IMAGE_PROMPT_VERSION } from '../../backend/src/ocr.js'
import {
  createFileProcessingActivities,
  failFileProcessingActivity,
  finalizeFileProcessingActivity,
  nextFileImageActivity,
  prepareFileProcessingActivity,
  processFileImageActivity,
  type FileProcessingDependencies,
} from '../../backend/src/temporal/activities/file-processing.js'

const db = vi.hoisted(() => ({
  pool: {},
  job: vi.fn(),
  register: vi.fn(),
  claim: vi.fn(),
  image: vi.fn(),
  attempt: vi.fn(),
  current: vi.fn(),
  next: vi.fn(),
  boundary: vi.fn(),
  pause: vi.fn(),
  begin: vi.fn(),
  markStarted: vi.fn(),
  stage: vi.fn(),
  complete: vi.fn(),
  failImage: vi.fn(),
  failJob: vi.fn(),
  stagePublish: vi.fn(),
  reject: vi.fn(),
  restore: vi.fn(),
  plan: vi.fn(),
  rounds: vi.fn(),
}))
vi.mock('../../backend/src/db/file-jobs.js', async (original) => {
  const mod = await original<typeof import('../../backend/src/db/file-jobs.js')>()
  return {
    ...mod,
    readFileProcessingJob: db.job,
    registerFileImages: db.register,
    claimFileImage: db.claim,
    readFileImage: db.image,
    readFileImageAttempt: db.attempt,
    readCurrentFileImageAttempt: db.current,
    readNextFileImage: db.next,
    readFileJobBoundary: db.boundary,
    pauseFileProcessingJob: db.pause,
    beginFileProcessingJob: db.begin,
    markFileImageRequestStarted: db.markStarted,
    stageFileImageResponse: db.stage,
    completeFileImage: db.complete,
    failFileImage: db.failImage,
    failFileProcessingJob: db.failJob,
    stageAndPublishFileProcessingJob: db.stagePublish,
    rejectFileImageResponse: db.reject,
    restoreFileImageArchive: db.restore,
  }
})
vi.mock('../../backend/src/db/pdf-extraction.js', () => ({ planPdfExtraction: db.plan }))
vi.mock('../../backend/src/db/execution-rounds.js', () => ({ appendProviderRoundEvent: db.rounds }))
vi.mock('../../backend/src/db/index.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/db/index.js')>()),
  workerPoolFromEnv: () => db.pool,
}))
const archiveStore = vi.hoisted(() => ({ files: new Map<string, string>() }))
vi.mock('../../backend/src/archive/targets.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/archive/targets.js')>()),
  resolveArchiveTarget: () => memoryArchive(archiveStore.files),
}))

function memoryArchive(files = new Map<string, string>()) {
  return {
    files,
    read: async (key: string) => files.get(key) ?? null,
    write: async (key: string, body: string) => { files.set(key, body) },
    list: async (directory: string) => [...files.keys()].filter((key) => key.startsWith(directory)),
  }
}

afterEach(() => { vi.clearAllMocks(); archiveStore.files.clear() })

const PDF = Buffer.from('%PDF-fake-bytes').toString('base64')
function job(overrides: Record<string, unknown> = {}) {
  return {
    jobId: 'job-1', revision: 0, state: 'queued', totalImages: null, manifestRef: null,
    archiveKey: 'orig-key', originalHash: sha256Hex(PDF), provider: 'meta', model: 'm1',
    promptVersion: DOCUMENT_IMAGE_PROMPT_VERSION, sectorId: 'sec-1', documentId: 'doc-1',
    ...overrides,
  }
}
const PNG = Buffer.from('fake-png-bytes')
const IMAGE_HASH = createHash('sha256').update(PNG).digest('hex')
function image() {
  return {
    imageId: 'img-1', page: 1, ordinal: 0, imageHash: IMAGE_HASH,
    inputRef: { key: 'file-processing/job-1/images/img-1.png.base64', hash: IMAGE_HASH, bytes: PNG.byteLength },
    width: 100, height: 100, role: 'embedded',
  }
}
function receipt(overrides: Record<string, unknown> = {}) {
  return {
    lease: 'lease-1', producerId: 'prod-1', requestStartedAt: '2026-01-01T00:00:00.000Z', state: 'claimed',
    job: { originalHash: sha256Hex(PDF), provider: 'meta', model: 'm1', promptVersion: DOCUMENT_IMAGE_PROMPT_VERSION },
    image: { imageHash: IMAGE_HASH }, resultRef: undefined, pendingResponseSerialized: null, ...overrides,
  }
}
function reply(text = 'seen text', overrides: Record<string, unknown> = {}) {
  return { text, toolCalls: [], usage: { inputTokens: 5, outputTokens: 5 }, completion: 'complete', ...overrides }
}
function pendingBody(input: { jobId: string; imageId: string; attempt: number }, lease: string, serialized: string, r: { job: { originalHash: string; provider: string; model: string; promptVersion: string }; image: { imageHash: string }; producerId: string }) {
  const binding = {
    jobId: input.jobId, imageId: input.imageId, attempt: input.attempt, sourceHash: r.job.originalHash,
    imageHash: r.image.imageHash, provider: r.job.provider, model: r.job.model,
    promptVersion: r.job.promptVersion, producerId: r.producerId,
    responseHash: createHash('sha256').update(serialized).digest('hex'),
  }
  return JSON.stringify({
    version: 1, ...binding,
    responseBase64: Buffer.from(serialized).toString('base64'),
    signature: createHmac('sha256', lease).update(`file-image-paid-reply-v1:${JSON.stringify(binding)}`).digest('hex'),
  })
}
function deps(overrides: Partial<FileProcessingDependencies> = {}) {
  const archive = memoryArchive()
  return {
    archive,
    activities: createFileProcessingActivities({
      db: db.pool as never,
      archive: archive as never,
      provider: () => { throw new Error('provider must not be constructed') },
      context: () => ({ producerId: 'prod-1', heartbeat: () => undefined }),
      ...overrides,
    }),
  }
}
function chatProvider(impl: () => Promise<unknown>) {
  return { providerName: 'fake', chat: impl }
}

describe('prepareFileProcessingActivity [F:backend.activity.file_processing.createFileProcessingActivities] [F:backend.activity.file_processing.prepareFileProcessingActivity] [F:backend.activity.file_processing.nextFileImageActivity] [F:backend.activity.file_processing.processFileImageActivity] [F:backend.activity.file_processing.finalizeFileProcessingActivity] [F:backend.activity.file_processing.failFileProcessingActivity]', () => {
  it('pauses hidden work and passes terminal states through', async () => {
    db.boundary.mockResolvedValue({ job: job(), hidden: true })
    const a = deps()
    await expect(a.activities.prepareFileProcessingActivity({ jobId: 'job-1', revision: 0 })).resolves.toEqual({ state: 'paused', totalImages: null })
    expect(db.pause).toHaveBeenCalledWith(db.pool, 'job-1', 'file_hidden', 0)
    db.boundary.mockResolvedValue({ job: job({ state: 'complete', totalImages: 2 }), hidden: false })
    await expect(a.activities.prepareFileProcessingActivity({ jobId: 'job-1', revision: 0 })).resolves.toEqual({ state: 'complete', totalImages: 2 })
    expect(db.begin).not.toHaveBeenCalled()
  })
  it('skips re-extraction when the manifest already exists', async () => {
    db.boundary.mockResolvedValue({ job: job({ state: 'processing', manifestRef: { key: 'm', hash: 'h', bytes: 3 } }), hidden: false })
    const a = deps()
    await expect(a.activities.prepareFileProcessingActivity({ jobId: 'job-1', revision: 0 })).resolves.toEqual({ state: 'processing', totalImages: null })
    expect(db.begin).toHaveBeenCalledWith(db.pool, 'job-1', 0)
    expect(db.plan).not.toHaveBeenCalled()
  })
  it('rejects a missing or corrupt original', async () => {
    db.boundary.mockResolvedValue({ job: job(), hidden: false })
    const a = deps()
    a.archive.files.set('orig-key', Buffer.from('tampered').toString('base64'))
    await expect(a.activities.prepareFileProcessingActivity({ jobId: 'job-1', revision: 0 })).rejects.toThrow('Original PDF archive is missing or corrupt.')
  })
  it('extracts text parts into a manifest with no images', async () => {
    db.boundary.mockResolvedValue({ job: job(), hidden: false })
    const a = deps()
    a.archive.files.set('orig-key', PDF)
    db.plan.mockImplementation(async function* () { yield { kind: 'text', page: 1, text: 'hello world' } })
    db.boundary.mockResolvedValue({ job: job(), hidden: false })
    const result = await a.activities.prepareFileProcessingActivity({ jobId: 'job-1', revision: 0 })
    expect(result).toEqual({ state: 'processing', totalImages: 0 })
    expect(db.register).toHaveBeenCalledWith(db.pool, 'job-1', expect.objectContaining({ key: 'file-processing/job-1/manifest.json' }), [], expect.anything(), 0)
    expect(a.archive.files.get('file-processing/job-1/manifest.json')).toContain('manifest-parts/0.json')
  })
  it('chunks oversized text and fans manifest parts past 512 KiB', async () => {
    db.boundary.mockResolvedValue({ job: job(), hidden: false })
    const a = deps()
    a.archive.files.set('orig-key', PDF)
    const big = 'word '.repeat(60000)
    db.plan.mockImplementation(async function* () {
      yield { kind: 'text', page: 1, text: big }
      for (let i = 0; i < 60; i += 1) yield { kind: 'text', page: 2, text: 'x'.repeat(10240) }
    })
    const result = await a.activities.prepareFileProcessingActivity({ jobId: 'job-1', revision: 0 })
    expect(result).toEqual({ state: 'processing', totalImages: 0 })
    expect(a.archive.files.has('file-processing/job-1/manifest-parts/0.json')).toBe(true)
    expect(a.archive.files.has('file-processing/job-1/manifest-parts/1.json')).toBe(true)
  })
  it('stores image inputs and registers their identities', async () => {
    db.boundary.mockResolvedValue({ job: job(), hidden: false })
    const a = deps()
    a.archive.files.set('orig-key', PDF)
    db.plan.mockImplementation(async function* () { yield { kind: 'image', page: 3, ordinal: 0, imageHash: IMAGE_HASH, png: PNG, width: 100, height: 100, role: 'embedded' } })
    const result = await a.activities.prepareFileProcessingActivity({ jobId: 'job-1', revision: 0 })
    expect(result).toEqual({ state: 'processing', totalImages: 1 })
    const images = db.register.mock.calls[0]?.[3] as Array<{ imageId: string; inputRef: { key: string } }>
    expect(images[0]?.imageId).toMatch(/^img-/)
    expect(a.archive.files.get(images[0]!.inputRef.key)).toBe(PNG.toString('base64'))
  })
  it('pauses when the file hides mid-parse', async () => {
    const j = job()
    db.boundary.mockResolvedValueOnce({ job: j, hidden: false }).mockResolvedValue({ job: j, hidden: true })
    const a = deps()
    a.archive.files.set('orig-key', PDF)
    db.plan.mockImplementation(async function* () { yield { kind: 'text', page: 1, text: 'late' } })
    await expect(a.activities.prepareFileProcessingActivity({ jobId: 'job-1', revision: 0 })).resolves.toEqual({ state: 'paused', totalImages: null })
    expect(db.register).not.toHaveBeenCalled()
  })
})

describe('nextFileImageActivity', () => {
  it('pauses hidden work and tolerates a hide racing the cursor read', async () => {
    db.boundary.mockResolvedValue({ job: job(), hidden: true })
    const a = deps()
    await expect(a.activities.nextFileImageActivity({ jobId: 'job-1', revision: 0, cursor: null })).resolves.toEqual({ imageId: null, nextCursor: null, state: 'paused' })
    const j = job()
    db.boundary.mockResolvedValueOnce({ job: j, hidden: false }).mockResolvedValue({ job: j, hidden: true })
    db.next.mockRejectedValueOnce(new Error('cursor moved'))
    await expect(a.activities.nextFileImageActivity({ jobId: 'job-1', revision: 0, cursor: null })).resolves.toEqual({ imageId: null, nextCursor: null, state: 'paused' })
  })
  it('rethrows cursor failures on visible work and advances the cursor', async () => {
    db.boundary.mockResolvedValue({ job: job(), hidden: false })
    db.next.mockRejectedValueOnce(new Error('store down'))
    const a = deps()
    await expect(a.activities.nextFileImageActivity({ jobId: 'job-1', revision: 0, cursor: null })).rejects.toThrow('store down')
    db.next.mockResolvedValueOnce({ imageId: 'img-1', page: 2, ordinal: 4 })
    await expect(a.activities.nextFileImageActivity({ jobId: 'job-1', revision: 0, cursor: null })).resolves.toEqual({ imageId: 'img-1', nextCursor: { page: 2, ordinal: 4 } })
    db.next.mockResolvedValueOnce(null)
    await expect(a.activities.nextFileImageActivity({ jobId: 'job-1', revision: 0, cursor: { page: 2, ordinal: 4 } })).resolves.toEqual({ imageId: null, nextCursor: { page: 2, ordinal: 4 } })
  })
})

describe('processFileImageActivity', () => {
  function imageWorld() {
    const a = deps({ provider: () => chatProvider(async () => reply()) as never })
    a.archive.files.set('file-processing/job-1/images/img-1.png.base64', PNG.toString('base64'))
    db.boundary.mockResolvedValue({ job: job(), hidden: false })
    db.image.mockResolvedValue(image())
    db.current.mockResolvedValue(null)
    db.claim.mockResolvedValue({ attempt: 0, lease: 'lease-1', state: 'claimed' })
    db.attempt.mockResolvedValue(receipt())
    return a
  }
  it('processes one image end to end and journals the round', async () => {
    const a = imageWorld()
    const result = await a.activities.processFileImageActivity({ jobId: 'job-1', revision: 0, imageId: 'img-1' })
    expect(result).toEqual({ state: 'complete' })
    expect(db.markStarted).toHaveBeenCalledWith(db.pool, 'job-1', 'img-1', 0, 'lease-1', 0)
    expect(db.stage).toHaveBeenCalled()
    expect(db.complete).toHaveBeenCalledWith(db.pool, 'job-1', 'img-1', 0, 'lease-1', expect.anything(), expect.anything(), expect.anything(), 0)
    expect(db.rounds).toHaveBeenCalledWith(db.pool, 'sector:sec-1', 'provider-round:file-image:job-1:img-1:0', expect.objectContaining({ outcome: 'ok', round: 1, attempt: 0 }))
    const pending = JSON.parse(a.archive.files.get('file-processing/job-1/images/img-1/attempt-0.pending.json') ?? '{}') as Record<string, unknown>
    const { signature, responseBase64, version: _version, ...binding } = pending
    void _version
    void responseBase64
    expect(signature).toBe(createHmac('sha256', 'lease-1').update(`file-image-paid-reply-v1:${JSON.stringify(binding)}`).digest('hex'))
  })
  it('pauses hidden work before touching the image', async () => {
    db.boundary.mockResolvedValue({ job: job(), hidden: true })
    const a = deps()
    await expect(a.activities.processFileImageActivity({ jobId: 'job-1', revision: 0, imageId: 'img-1' })).resolves.toEqual({ state: 'paused' })
    expect(db.image).not.toHaveBeenCalled()
  })
  it('resumes a paid response instead of paying twice', async () => {
    const a = deps()
    db.boundary.mockResolvedValue({ job: job(), hidden: false })
    db.image.mockResolvedValue(image())
    db.current.mockResolvedValue({ attempt: 1, state: 'claimed' })
    db.attempt.mockResolvedValue(receipt({ pendingResponseSerialized: JSON.stringify(reply('already paid')) }))
    const result = await a.activities.processFileImageActivity({ jobId: 'job-1', revision: 0, imageId: 'img-1' })
    expect(result).toEqual({ state: 'complete' })
    expect(db.claim).not.toHaveBeenCalled()
  })
  it('finishes a fresh claim whose attempt already holds a receipt', async () => {
    const a = deps()
    db.boundary.mockResolvedValue({ job: job(), hidden: false })
    db.image.mockResolvedValue(image())
    db.current.mockResolvedValue(null)
    db.claim.mockResolvedValue({ attempt: 2, lease: 'lease-2', state: 'claimed' })
    db.attempt.mockResolvedValue(receipt({ pendingResponseSerialized: JSON.stringify(reply('late receipt')) }))
    const result = await a.activities.processFileImageActivity({ jobId: 'job-1', revision: 0, imageId: 'img-1' })
    expect(result).toEqual({ state: 'complete' })
  })
  it('reports an unclaimable image without provider work', async () => {
    const a = deps()
    db.boundary.mockResolvedValue({ job: job(), hidden: false })
    db.image.mockResolvedValue(image())
    db.current.mockResolvedValue(null)
    db.claim.mockResolvedValue({ attempt: 0, lease: null, state: 'failed' })
    await expect(a.activities.processFileImageActivity({ jobId: 'job-1', revision: 0, imageId: 'img-1' })).resolves.toEqual({ state: 'failed' })
  })
  it('fails pre-effect when the input bytes changed', async () => {
    const a = imageWorld()
    a.archive.files.set('file-processing/job-1/images/img-1.png.base64', Buffer.from('tampered').toString('base64'))
    await expect(a.activities.processFileImageActivity({ jobId: 'job-1', revision: 0, imageId: 'img-1' })).rejects.toThrow('Image processing could not start.')
    expect(db.failImage).toHaveBeenCalledWith(db.pool, 'job-1', 'img-1', 0, 'lease-1', 'image_pre_effect_failed', false, 0)
  })
  it('rejects an unknown image processing contract', async () => {
    const a = imageWorld()
    db.boundary.mockResolvedValue({ job: job({ promptVersion: 'ancient-v0' }), hidden: false })
    await expect(a.activities.processFileImageActivity({ jobId: 'job-1', revision: 0, imageId: 'img-1' })).rejects.toThrow('Image processing could not start.')
  })
  it('rejects a model with no fitting request budget', async () => {
    const a = deps({ provider: () => chatProvider(async () => reply()) as never, modelWindow: () => 100 })
    a.archive.files.set('file-processing/job-1/images/img-1.png.base64', PNG.toString('base64'))
    db.boundary.mockResolvedValue({ job: job(), hidden: false })
    db.image.mockResolvedValue(image())
    db.current.mockResolvedValue(null)
    db.claim.mockResolvedValue({ attempt: 0, lease: 'lease-1', state: 'claimed' })
    db.attempt.mockResolvedValue(receipt())
    await expect(a.activities.processFileImageActivity({ jobId: 'job-1', revision: 0, imageId: 'img-1' })).rejects.toThrow('Image processing could not start.')
  })
  it('journals a provider error and requires receipt recovery', async () => {
    const a = deps({ provider: () => chatProvider(async () => { throw Object.assign(new Error('vendor down'), { code: 'provider_overloaded' }) }) as never })
    a.archive.files.set('file-processing/job-1/images/img-1.png.base64', PNG.toString('base64'))
    db.boundary.mockResolvedValue({ job: job(), hidden: false })
    db.image.mockResolvedValue(image())
    db.current.mockResolvedValue(null)
    db.claim.mockResolvedValue({ attempt: 0, lease: 'lease-1', state: 'claimed' })
    db.attempt.mockResolvedValue(receipt())
    await expect(a.activities.processFileImageActivity({ jobId: 'job-1', revision: 0, imageId: 'img-1' })).rejects.toThrow('Paid image work needs receipt recovery before retry.')
    expect(db.rounds).toHaveBeenCalledWith(db.pool, 'sector:sec-1', expect.any(String), expect.objectContaining({ outcome: 'error', errorCode: 'provider_overloaded' }))
    expect(db.failImage).toHaveBeenCalledWith(db.pool, 'job-1', 'img-1', 0, 'lease-1', 'provider_outcome_unknown', true, 0)
  })
  it('rejects a provider reply past the storage budget', async () => {
    const a = deps({ provider: () => chatProvider(async () => reply('x'.repeat(8 * 1024 * 1024 + 1))) as never })
    a.archive.files.set('file-processing/job-1/images/img-1.png.base64', PNG.toString('base64'))
    db.boundary.mockResolvedValue({ job: job(), hidden: false })
    db.image.mockResolvedValue(image())
    db.current.mockResolvedValue(null)
    db.claim.mockResolvedValue({ attempt: 0, lease: 'lease-1', state: 'claimed' })
    db.attempt.mockResolvedValue(receipt())
    await expect(a.activities.processFileImageActivity({ jobId: 'job-1', revision: 0, imageId: 'img-1' })).rejects.toThrow('Paid image work needs receipt recovery before retry.')
  })
  it('fails an incomplete provider reply without completing', async () => {
    const a = deps({ provider: () => chatProvider(async () => reply('cut off', { completion: 'incomplete' })) as never })
    a.archive.files.set('file-processing/job-1/images/img-1.png.base64', PNG.toString('base64'))
    db.boundary.mockResolvedValue({ job: job(), hidden: false })
    db.image.mockResolvedValue(image())
    db.current.mockResolvedValue(null)
    db.claim.mockResolvedValue({ attempt: 0, lease: 'lease-1', state: 'claimed' })
    db.attempt.mockResolvedValue(receipt())
    await expect(a.activities.processFileImageActivity({ jobId: 'job-1', revision: 0, imageId: 'img-1' })).resolves.toEqual({ state: 'failed' })
    expect(db.reject).toHaveBeenCalledWith(db.pool, 'job-1', 'img-1', 0, 'lease-1', expect.anything(), expect.anything(), 'image_output_incomplete', 0)
    expect(db.complete).not.toHaveBeenCalled()
  })
  it('recovers a paid receipt from its archive binding', async () => {
    const a = deps()
    db.boundary.mockResolvedValue({ job: job(), hidden: false })
    db.image.mockResolvedValue(image())
    db.current.mockResolvedValue(null)
    db.claim.mockResolvedValue({ attempt: 1, lease: 'lease-1', state: 'claimed' })
    const r = receipt()
    db.attempt.mockResolvedValue(r)
    const serialized = JSON.stringify(reply('archived paid work'))
    a.archive.files.set('file-processing/job-1/images/img-1/attempt-1.pending.json', pendingBody({ jobId: 'job-1', imageId: 'img-1', attempt: 1 }, 'lease-1', serialized, r as never))
    const result = await a.activities.processFileImageActivity({ jobId: 'job-1', revision: 0, imageId: 'img-1' })
    expect(result).toEqual({ state: 'complete' })
    expect(db.stage).toHaveBeenCalled()
  })
  it('rejects invalid, foreign, and tampered archive bindings', async () => {
    const cases: Array<[string, (valid: string) => string, string]> = [
      ['invalid', () => '{"version":2,"x":1}', 'Pending paid response receipt is invalid.'],
      ['foreign', (valid) => valid.replace('"job-1"', '"job-2"'), 'Pending paid response belongs to different work.'],
      ['tampered', (valid) => valid.replace(/"signature":"[a-f0-9]{64}"/, `"signature":"${'0'.repeat(64)}"`), 'Pending paid response producer could not be verified.'],
      ['changed', (valid) => valid.replace(/"responseBase64":"[^"]*"/, `"responseBase64":"${Buffer.from('other bytes').toString('base64')}"`), 'Pending paid response bytes changed.'],
    ]
    for (const [label, mutate, cause] of cases) {
      vi.clearAllMocks()
      const a = deps()
      db.boundary.mockResolvedValue({ job: job(), hidden: false })
      db.image.mockResolvedValue(image())
      db.current.mockResolvedValue(null)
      db.claim.mockResolvedValue({ attempt: 1, lease: 'lease-1', state: 'claimed' })
      const r = receipt()
      db.attempt.mockResolvedValue(r)
      const serialized = JSON.stringify(reply('paid'))
      a.archive.files.set('file-processing/job-1/images/img-1/attempt-1.pending.json', mutate(pendingBody({ jobId: 'job-1', imageId: 'img-1', attempt: 1 }, 'lease-1', serialized, r as never)))
      const error = await a.activities.processFileImageActivity({ jobId: 'job-1', revision: 0, imageId: 'img-1' }).then(() => null, (e: unknown) => e as Error)
      expect(error?.message, label).toBe(cause)
    }
  })
  it('rejects a changed paid response reference', async () => {
    const a = deps()
    db.boundary.mockResolvedValue({ job: job(), hidden: false })
    db.image.mockResolvedValue(image())
    db.current.mockResolvedValue({ attempt: 0, state: 'claimed' })
    db.attempt.mockResolvedValue(receipt({ pendingResponseSerialized: JSON.stringify(reply('paid')), resultRef: { key: 'k', hash: '0'.repeat(64), bytes: 1 } }))
    await expect(a.activities.processFileImageActivity({ jobId: 'job-1', revision: 0, imageId: 'img-1' })).rejects.toThrow('Stored paid response reference changed.')
    expect(db.claim).not.toHaveBeenCalled()
  })
  it('aborts image work on the provider deadline', async () => {
    const a = deps({ provider: () => chatProvider(() => new Promise(() => undefined)) as never, providerDeadlineMs: 1 })
    a.archive.files.set('file-processing/job-1/images/img-1.png.base64', PNG.toString('base64'))
    db.boundary.mockResolvedValue({ job: job(), hidden: false })
    db.image.mockResolvedValue(image())
    db.current.mockResolvedValue(null)
    db.claim.mockResolvedValue({ attempt: 0, lease: 'lease-1', state: 'claimed' })
    db.attempt.mockResolvedValue(receipt())
    await expect(a.activities.processFileImageActivity({ jobId: 'job-1', revision: 0, imageId: 'img-1' })).rejects.toThrow('Paid image work needs receipt recovery before retry.')
    expect(db.failImage).toHaveBeenCalledWith(db.pool, 'job-1', 'img-1', 0, 'lease-1', 'provider_outcome_unknown', true, 0)
  })
  it('rejects an invalid image provider deadline', () => {
    expect(() => deps({ providerDeadlineMs: 0 })).toThrow('Invalid image provider deadline.')
    expect(() => deps({ providerDeadlineMs: 110_001 })).toThrow('Invalid image provider deadline.')
  })
})

describe('finalize and fail', () => {
  it('finalizes through a cancellable archive and fails by code', async () => {
    db.job.mockResolvedValue(job())
    const a = deps()
    await a.activities.finalizeFileProcessingActivity({ jobId: 'job-1', revision: 0 })
    expect(db.stagePublish).toHaveBeenCalledWith(db.pool, 'job-1', expect.objectContaining({ read: expect.any(Function), write: expect.any(Function), list: expect.any(Function) }), 0)
    await a.activities.failFileProcessingActivity({ jobId: 'job-1', revision: 0, code: 'owner_cancelled' })
    expect(db.failJob).toHaveBeenCalledWith(db.pool, 'job-1', 'owner_cancelled', 0)
  })
  it('refuses work for a superseded revision', async () => {
    db.job.mockResolvedValue(job({ revision: 1 }))
    const a = deps()
    await expect(a.activities.finalizeFileProcessingActivity({ jobId: 'job-1', revision: 0 })).rejects.toThrow('A newer file revision owns this work.')
  })
})

describe('production file-processing activities', () => {
  it('fails a job without execution identity', async () => {
    await failFileProcessingActivity({ jobId: 'job-1', revision: 0, code: 'owner_cancelled' })
    expect(db.failJob).toHaveBeenCalledWith(db.pool, 'job-1', 'owner_cancelled', 0)
  })
  it('requires an activity context for production work', async () => {
    db.boundary.mockResolvedValue({ job: job(), hidden: false })
    await expect(prepareFileProcessingActivity({ jobId: 'job-1', revision: 0 })).rejects.toThrow()
  })
  it('refuses production image work while OCR is disabled', async () => {
    const saved = process.env['KARDATA_OCR_DISABLED']
    process.env['KARDATA_OCR_DISABLED'] = '1'
    try {
      db.boundary.mockResolvedValue({ job: job(), hidden: false })
      db.image.mockResolvedValue(image())
      db.current.mockResolvedValue(null)
      db.claim.mockResolvedValue({ attempt: 0, lease: 'lease-1', state: 'claimed' })
      db.attempt.mockResolvedValue(receipt())
      archiveStore.files.set('file-processing/job-1/images/img-1.png.base64', PNG.toString('base64'))
      const env = new MockActivityEnvironment({ workflowExecution: { workflowId: 'w', runId: 'r' } } as never)
      await expect(env.run(processFileImageActivity, { jobId: 'job-1', revision: 0, imageId: 'img-1' })).rejects.toThrow('Image processing could not start.')
    } finally {
      if (saved === undefined) delete process.env['KARDATA_OCR_DISABLED']
      else process.env['KARDATA_OCR_DISABLED'] = saved
    }
  })
  it('requires a catalogued model window for production image work', async () => {
    const savedKey = process.env['KARDATA_META_KEY']
    const savedOcr = process.env['KARDATA_OCR_DISABLED']
    process.env['KARDATA_META_KEY'] = 'unit-test-key'
    delete process.env['KARDATA_OCR_DISABLED']
    try {
      db.boundary.mockResolvedValue({ job: job({ model: 'no-such-model' }), hidden: false })
      db.image.mockResolvedValue(image())
      db.current.mockResolvedValue(null)
      db.claim.mockResolvedValue({ attempt: 0, lease: 'lease-1', state: 'claimed' })
      db.attempt.mockResolvedValue(receipt({ job: { originalHash: sha256Hex(PDF), provider: 'meta', model: 'no-such-model', promptVersion: DOCUMENT_IMAGE_PROMPT_VERSION } }))
      archiveStore.files.set('file-processing/job-1/images/img-1.png.base64', PNG.toString('base64'))
      const env = new MockActivityEnvironment({ workflowExecution: { workflowId: 'w', runId: 'r' } } as never)
      const error = await env.run(processFileImageActivity, { jobId: 'job-1', revision: 0, imageId: 'img-1' }).then(() => null, (e: unknown) => e as Error)
      expect(error?.message).toBe('Image processing could not start.')
      expect(String((error?.cause as Error)?.message)).toBe('The image model context window is unverified.')
    } finally {
      if (savedKey === undefined) delete process.env['KARDATA_META_KEY']
      else process.env['KARDATA_META_KEY'] = savedKey
      if (savedOcr === undefined) delete process.env['KARDATA_OCR_DISABLED']
      else process.env['KARDATA_OCR_DISABLED'] = savedOcr
    }
  })
  it('runs production prepare/next/finalize over the worker pool', async () => {
    db.boundary.mockResolvedValue({ job: job({ state: 'complete', totalImages: 2 }), hidden: false })
    db.next.mockResolvedValue({ imageId: 'img-1', page: 1, ordinal: 0 })
    db.job.mockResolvedValue(job())
    const env = new MockActivityEnvironment({ workflowExecution: { workflowId: 'w', runId: 'r' } } as never)
    await expect(env.run(prepareFileProcessingActivity, { jobId: 'job-1', revision: 0 })).resolves.toEqual({ state: 'complete', totalImages: 2 })
    await expect(env.run(nextFileImageActivity, { jobId: 'job-1', revision: 0, cursor: null })).resolves.toEqual({ imageId: 'img-1', nextCursor: { page: 1, ordinal: 0 } })
    await env.run(finalizeFileProcessingActivity, { jobId: 'job-1', revision: 0 })
    expect(db.stagePublish).toHaveBeenCalled()
  })
})
