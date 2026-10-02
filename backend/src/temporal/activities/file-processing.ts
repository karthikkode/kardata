// File-owned work on the existing worker. Workflow histories contain IDs only.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { Context } from '@temporalio/activity'
import type { ProviderAdapter, ProviderResponse } from '@kardata/agents'
import { assembledTokens, measureInputTokens } from '@kardata/agents'
import { z } from 'zod'
import { resolveArchiveTarget, withArchiveDeadline, type ArchiveTarget } from '../../archive/targets.js'
import { workerPoolFromEnv, type TransactableDb } from '../../db/index.js'
import {
  readFileProcessingJob, registerFileImages, claimFileImage,
  readFileImage, readFileImageAttempt, readCurrentFileImageAttempt, readNextFileImage, readFileJobBoundary, pauseFileProcessingJob, beginFileProcessingJob, markFileImageRequestStarted,
  stageFileImageResponse, completeFileImage, failFileImage, failFileProcessingJob,
  stageAndPublishFileProcessingJob, fileImageResponseUnits, rejectFileImageResponse, restoreFileImageArchive,
  FileProcessingManifest, type FileArchiveRef, type FileImageIdentity,
} from '../../db/file-jobs.js'
import { planPdfExtraction } from '../../db/pdf-extraction.js'
import { sha256Hex, chunkTextUnits } from '../../db/file-pipeline.js'
import { WorkspaceError } from '../../db/errors.js'
import { documentImageRequest, DOCUMENT_IMAGE_PROMPT_VERSION } from '../../ocr.js'
import { resolveAdapter } from '../../providers/gateway.js'
import { findModel } from '../../providers/registry.js'
import { createLogger, logOp } from '../../observability/logging.js'

export interface FileProcessingInput { jobId: string; revision: number }
interface WorkContext { producerId: string; signal?: AbortSignal; heartbeat(phase: string): void }
export interface FileProcessingDependencies {
  db: TransactableDb
  archive: ArchiveTarget
  provider(model: string): ProviderAdapter
  context(): WorkContext
  providerDeadlineMs?: number
  modelWindow?(model: string): number
}
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024
const MAX_REPLY_BYTES = 8 * 1024 * 1024
const logger = createLogger({ op: 'file.processing.activity' })
const digest = (body: string) => createHash('sha256').update(body).digest('hex')
const prefix = (jobId: string) => `file-processing/${jobId}/`
const ref = (key: string, body: string): FileArchiveRef => ({ key, hash: digest(body), bytes: Buffer.byteLength(body) })
const Reply = z.object({ text: z.string(), toolCalls: z.array(z.unknown()), usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).passthrough(), completion: z.enum(['complete', 'incomplete']).optional() }).passthrough()
const Pending = z.object({ version: z.literal(1), jobId: z.string(), imageId: z.string(), attempt: z.number().int(), sourceHash: z.string(), imageHash: z.string(), provider: z.string(), model: z.string(), promptVersion: z.string(), producerId: z.string(), responseHash: z.string(), responseBase64: z.string(), signature: z.string() }).strict()

async function abortableFileWork<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let rejectAbort: () => void = () => undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(new WorkspaceError('conflict', 'Image provider deadline or cancellation requires receipt review.'))
    signal.addEventListener('abort', rejectAbort, { once: true })
  })
  try {
    return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return work() }), aborted])
  } finally { signal.removeEventListener('abort', rejectAbort) }
}

export function createFileProcessingActivities(deps: FileProcessingDependencies) {
  const archive = withArchiveDeadline(deps.archive)
  const providerDeadlineMs = deps.providerDeadlineMs ?? 110_000
  if (!Number.isInteger(providerDeadlineMs) || providerDeadlineMs < 1 || providerDeadlineMs > 110_000) throw new TypeError('Invalid image provider deadline.')
  async function pulsed<T>(phase: string, work: (context: WorkContext) => Promise<T>): Promise<T> {
    const original = deps.context(), controller = new AbortController()
    const context = { ...original, signal: original.signal ? AbortSignal.any([original.signal, controller.signal]) : controller.signal }
    const pulse = setInterval(() => { try { context.heartbeat(phase) } catch (error) { controller.abort(error) } }, 5_000)
    try { context.signal.throwIfAborted(); return await work(context) }
    finally { clearInterval(pulse) }
  }
  async function job(input: FileProcessingInput) {
    const found = await readFileProcessingJob(deps.db, input.jobId)
    if (found.revision !== input.revision) throw new WorkspaceError('conflict', 'A newer file revision owns this work.')
    return found
  }
  async function readPending(input: FileProcessingInput, imageId: string, attempt: number): Promise<string | null> {
    const receipt = await readFileImageAttempt(deps.db, input.jobId, imageId, attempt)
    if (receipt.pendingResponseSerialized) return receipt.pendingResponseSerialized
    const body = await archive.read(`${prefix(input.jobId)}images/${imageId}/attempt-${attempt}.pending.json`, MAX_ARCHIVE_BYTES)
    if (!body) return null
    const parsed = Pending.safeParse(JSON.parse(body))
    if (!parsed.success) throw new WorkspaceError('conflict', 'Pending paid response receipt is invalid.')
    const { signature, responseBase64, version: _version, ...binding } = parsed.data
    void _version
    if (binding.jobId !== input.jobId || binding.imageId !== imageId || binding.attempt !== attempt || binding.sourceHash !== receipt.job.originalHash || binding.imageHash !== receipt.image.imageHash || binding.provider !== receipt.job.provider || binding.model !== receipt.job.model || binding.promptVersion !== receipt.job.promptVersion || binding.producerId !== receipt.producerId || !receipt.requestStartedAt) throw new WorkspaceError('conflict', 'Pending paid response belongs to different work.')
    const expected = createHmac('sha256', receipt.lease).update(`file-image-paid-reply-v1:${JSON.stringify(binding)}`).digest('hex')
    if (!/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))) throw new WorkspaceError('conflict', 'Pending paid response producer could not be verified.')
    const serialized = Buffer.from(responseBase64, 'base64').toString('utf8')
    if (Buffer.byteLength(serialized) > MAX_REPLY_BYTES || digest(serialized) !== binding.responseHash) throw new WorkspaceError('conflict', 'Pending paid response bytes changed.')
    await stageFileImageResponse(deps.db, input.jobId, imageId, attempt, receipt.lease, JSON.parse(serialized), input.revision)
    return serialized
  }
  async function preservePending(input: FileProcessingInput, image: FileImageIdentity, attempt: number, lease: string, serialized: string, receipt: Awaited<ReturnType<typeof readFileImageAttempt>>) {
    const binding = { jobId: input.jobId, imageId: image.imageId, attempt, sourceHash: receipt.job.originalHash, imageHash: image.imageHash, provider: receipt.job.provider, model: receipt.job.model, promptVersion: receipt.job.promptVersion, producerId: receipt.producerId, responseHash: digest(serialized) }
    const body = JSON.stringify({ version: 1, ...binding, responseBase64: Buffer.from(serialized).toString('base64'), signature: createHmac('sha256', lease).update(`file-image-paid-reply-v1:${JSON.stringify(binding)}`).digest('hex') })
    await archive.write(`${prefix(input.jobId)}images/${image.imageId}/attempt-${attempt}.pending.json`, body)
  }
  async function finish(input: FileProcessingInput, image: FileImageIdentity, attempt: number, serialized: string) {
    const receipt = await readFileImageAttempt(deps.db, input.jobId, image.imageId, attempt)
    const parsed = Reply.parse(JSON.parse(serialized))
    const result = receipt.resultRef ?? ref(`${prefix(input.jobId)}images/${image.imageId}/attempt-${attempt}.json`, serialized)
    if (result.hash !== digest(serialized) || result.bytes !== Buffer.byteLength(serialized)) throw new WorkspaceError('conflict', 'Stored paid response reference changed.')
    if (receipt.state === 'complete') await restoreFileImageArchive(deps.db, input.jobId, image.imageId, attempt, archive)
    else {
      let existing: string | undefined
      try { existing = await archive.read(result.key, result.bytes + 1) } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'source_limit')) throw error
      }
      if (existing !== serialized) await archive.write(result.key, serialized)
    }
    if (parsed.completion !== 'complete' || !parsed.text.trim() || parsed.toolCalls.length) {
      await rejectFileImageResponse(deps.db, input.jobId, image.imageId, attempt, receipt.lease, result, archive, parsed.completion === 'incomplete' ? 'image_output_incomplete' : 'image_output_unverified', input.revision)
      return { state: 'failed' as const }
    }
    await completeFileImage(deps.db, input.jobId, image.imageId, attempt, receipt.lease, result, fileImageResponseUnits(parsed, image), archive, input.revision)
    return { state: 'complete' as const }
  }
  return {
    async prepareFileProcessingActivity(input: FileProcessingInput): Promise<{ state: string; totalImages: number | null }> {
      return logOp(logger, 'file.processing.prepare', async () => {
        const boundary = await readFileJobBoundary(deps.db, input.jobId, input.revision), current = boundary.job, rawContext = deps.context()
        const heartbeatAbort = new AbortController()
        const context = { ...rawContext, signal: rawContext.signal ? AbortSignal.any([rawContext.signal, heartbeatAbort.signal]) : heartbeatAbort.signal }
        if (boundary.hidden) { await pauseFileProcessingJob(deps.db, input.jobId, 'file_hidden', input.revision); return { state: 'paused', totalImages: current.totalImages } }
        const pulse = setInterval(() => { try { context.heartbeat('prepare') } catch (error) { heartbeatAbort.abort(error) } }, 5_000)
        try {
        if (!['queued', 'processing'].includes(current.state)) return { state: current.state, totalImages: current.totalImages }
        await beginFileProcessingJob(deps.db, input.jobId, input.revision)
        if (current.manifestRef) return { state: 'processing', totalImages: current.totalImages }
        const original = await archive.read(current.archiveKey, 12 * 1024 * 1024, context.signal)
        if (!original || sha256Hex(original) !== current.originalHash) throw new WorkspaceError('conflict', 'Original PDF archive is missing or corrupt.')
        let records: FileProcessingManifest['records'] = []
        let recordBytes = 0
        const parts: FileArchiveRef[] = [], images: FileImageIdentity[] = []
        async function flushPart() {
          if (!records.length) return
          const body = JSON.stringify({ version: 1, records })
          const reference = ref(`${prefix(input.jobId)}manifest-parts/${parts.length}.json`, body)
          await archive.write(reference.key, body, context.signal)
          parts.push(reference); records = []; recordBytes = 0
        }
        async function appendRecord(record: FileProcessingManifest['records'][number]) {
          const bytes = Buffer.byteLength(JSON.stringify(record))
          if (recordBytes + bytes > 512 * 1024) await flushPart()
          records.push(record); recordBytes += bytes
        }
        for await (const part of planPdfExtraction(Buffer.from(original, 'base64'), { signal: context.signal })) {
          context.signal?.throwIfAborted(); context.heartbeat('parse')
          const boundary = await readFileJobBoundary(deps.db, input.jobId, input.revision)
          if (boundary.hidden) { await pauseFileProcessingJob(deps.db, input.jobId, 'file_hidden', input.revision); return { state: 'paused', totalImages: null } }
          if (part.kind === 'text') {
            if (Buffer.byteLength(part.text) <= 256 * 1024) await appendRecord(part)
            else for (const unit of chunkTextUnits(part.text)) await appendRecord({ kind: 'text', page: part.page, text: unit.text })
          }
          else {
            const imageId = `img-${sha256Hex(JSON.stringify({ page: part.page, ordinal: part.ordinal, imageHash: part.imageHash, role: part.role ?? 'embedded' }))}`
            const body = Buffer.from(part.png).toString('base64')
            const inputRef: FileArchiveRef = { key: `${prefix(input.jobId)}images/${imageId}.png.base64`, hash: part.imageHash, bytes: part.png.byteLength }
            await archive.write(inputRef.key, body, context.signal)
            const image = { imageId, page: part.page, ordinal: part.ordinal, imageHash: part.imageHash, inputRef, width: part.width, height: part.height, role: part.role ?? 'embedded' }
            images.push(image); await appendRecord({ kind: 'image', ...image })
          }
        }
        await flushPart()
        const body = JSON.stringify({ version: 2, parts }), reference = ref(`${prefix(input.jobId)}manifest.json`, body)
        if (reference.bytes >= MAX_ARCHIVE_BYTES) throw new WorkspaceError('conflict', 'PDF manifest exceeds the supported storage operation limit.')
        await archive.write(reference.key, body, context.signal)
        await registerFileImages(deps.db, input.jobId, reference, images, archive, input.revision)
        return { state: 'processing', totalImages: images.length }
        } finally { clearInterval(pulse) }
      }, { jobId: input.jobId, revision: input.revision })
    },
    async nextFileImageActivity(input: FileProcessingInput & { cursor: { page: number; ordinal: number } | null }): Promise<{ imageId: string | null; nextCursor: { page: number; ordinal: number } | null; state?: 'paused' }> {
      return logOp(logger, 'file.processing.cursor', async () => {
      const boundary = await readFileJobBoundary(deps.db, input.jobId, input.revision)
      if (boundary.hidden) {
        await pauseFileProcessingJob(deps.db, input.jobId, 'file_hidden', input.revision)
        return { imageId: null, nextCursor: input.cursor, state: 'paused' }
      }
      let next
      try { next = await readNextFileImage(deps.db, input.jobId, input.cursor, input.revision) } catch (error) {
        const afterRead = await readFileJobBoundary(deps.db, input.jobId, input.revision)
        if (!afterRead.hidden) throw error
        await pauseFileProcessingJob(deps.db, input.jobId, 'file_hidden', input.revision)
        return { imageId: null, nextCursor: input.cursor, state: 'paused' }
      }
      return { imageId: next?.imageId ?? null, nextCursor: next ? { page: next.page, ordinal: next.ordinal } : input.cursor }
      }, { jobId: input.jobId, revision: input.revision, cursor: input.cursor })
    },
    async processFileImageActivity(input: FileProcessingInput & { imageId: string }): Promise<{ state: string }> {
      return logOp(logger, 'file.processing.image', () => pulsed('image', async (context) => {
        const boundary = await readFileJobBoundary(deps.db, input.jobId, input.revision), current = boundary.job
        if (boundary.hidden) { await pauseFileProcessingJob(deps.db, input.jobId, 'file_hidden', input.revision); return { state: 'paused' } }
        const image = await readFileImage(deps.db, input.jobId, input.imageId)
        const original = await readCurrentFileImageAttempt(deps.db, input.jobId, input.imageId)
        if (original && original.state !== 'failed') {
          const pending = await readPending(input, input.imageId, original.attempt)
          if (pending) return finish(input, image, original.attempt, pending)
        }
        const claim = await claimFileImage(deps.db, input.jobId, input.imageId, context.producerId, input.revision)
        if (claim.attempt > 0) {
          const pending = await readPending(input, input.imageId, claim.attempt)
          if (pending) return finish(input, image, claim.attempt, pending)
        }
        if (claim.state !== 'claimed') return { state: claim.state }
        const lease = claim.lease!
        let dispatched = false
        let timeout: ReturnType<typeof setTimeout> | undefined
        let heartbeat: ReturnType<typeof setInterval> | undefined
        try {
          const originalReceipt = await readFileImageAttempt(deps.db, input.jobId, input.imageId, claim.attempt)
          const body = await archive.read(image.inputRef.key, 12 * 1024 * 1024, context.signal)
          const png = Buffer.from(body ?? '', 'base64')
          if (png.byteLength !== image.inputRef.bytes || createHash('sha256').update(png).digest('hex') !== image.imageHash || image.inputRef.hash !== image.imageHash) throw new WorkspaceError('conflict', 'Image input bytes changed.')
          if (current.promptVersion !== DOCUMENT_IMAGE_PROMPT_VERSION || current.provider !== 'meta') throw new WorkspaceError('conflict', 'File image processing contract is unavailable.')
          const adapter = deps.provider(current.model)
          const controller = new AbortController(), signal = context.signal ? AbortSignal.any([controller.signal, context.signal]) : controller.signal
          timeout = setTimeout(() => controller.abort(), providerDeadlineMs)
          heartbeat = setInterval(() => { try { context.heartbeat('image') } catch (error) { controller.abort(error) } }, 5_000)
          const request = documentImageRequest(png, signal, image.role ?? 'embedded')
          const inputBudget = Math.min(80_000, Math.min(100_000, deps.modelWindow?.(current.model) ?? 100_000) - 16384)
          if (!Number.isFinite(inputBudget) || inputBudget <= 0) throw new WorkspaceError('conflict', 'The image model has no verified fitting request budget.')
          const measurement = await logOp(logger, 'file.processing.input-budget', () => abortableFileWork(() => measureInputTokens(adapter, request, () => assembledTokens(request.systemPrompt, request.messages, request.tools) + Math.ceil(image.width * image.height / 256) * 2 + 512), signal), { jobId: input.jobId, imageId: input.imageId })
          const { inputTokens } = measurement
          if (!Number.isFinite(inputTokens) || inputTokens < 0 || inputTokens > inputBudget) throw new WorkspaceError('conflict', 'Image input exceeds the verified request budget.')
          logger.info({ event: 'file.processing.input-budget.reading', jobId: input.jobId, imageId: input.imageId, basis: measurement.method, inputTokens, inputBudget, outputReserve: 16384 }, 'File image request budget')
          signal.throwIfAborted()
          await markFileImageRequestStarted(deps.db, input.jobId, input.imageId, claim.attempt, lease, input.revision)
          dispatched = true
          const serialized = await abortableFileWork(async () => {
            const response: ProviderResponse = await adapter.chat(request)
            const serialized = JSON.stringify(response)
            if (Buffer.byteLength(serialized) > MAX_REPLY_BYTES) throw new WorkspaceError('conflict', 'Image provider reply exceeds its storage budget.')
            // Independent durable stores: failure in one must not prevent trying
            // the other after paying. Neither operation holds an archive IO lock.
            const saved = await Promise.allSettled([
              preservePending(input, image, claim.attempt, lease, serialized, originalReceipt),
              stageFileImageResponse(deps.db, input.jobId, input.imageId, claim.attempt, lease, response, input.revision),
            ])
            if (saved[1].status === 'rejected') throw saved[1].reason
            return serialized
          }, signal)
          return await finish(input, image, claim.attempt, serialized)
        } catch (error) {
          await failFileImage(deps.db, input.jobId, input.imageId, claim.attempt, lease, dispatched ? 'provider_outcome_unknown' : 'image_pre_effect_failed', dispatched, input.revision)
          throw new WorkspaceError('conflict', dispatched ? 'Paid image work needs receipt recovery before retry.' : 'Image processing could not start.', { cause: error })
        } finally {
          if (timeout) clearTimeout(timeout)
          if (heartbeat) clearInterval(heartbeat)
        }
      }), { jobId: input.jobId, imageId: input.imageId, revision: input.revision })
    },
    async finalizeFileProcessingActivity(input: FileProcessingInput): Promise<void> {
      await logOp(logger, 'file.processing.finalize', () => pulsed('finalize', async (context) => {
        await job(input)
        const cancellable: ArchiveTarget = { read: (key, maxBytes) => archive.read(key, maxBytes, context.signal), write: (key, body) => archive.write(key, body, context.signal), list: (directory) => archive.list(directory) }
        await stageAndPublishFileProcessingJob(deps.db, input.jobId, cancellable, input.revision)
      }), { jobId: input.jobId, revision: input.revision })
    },
    async failFileProcessingActivity(input: FileProcessingInput & { code: string }): Promise<void> {
      await failFileProcessingJob(deps.db, input.jobId, input.code, input.revision)
    },
  }
}

function production() {
  return createFileProcessingActivities({
    db: workerPoolFromEnv(), archive: resolveArchiveTarget(), provider: (model) => {
      if (process.env['KARDATA_OCR_DISABLED']?.trim() === '1') throw new WorkspaceError('permission_denied', 'AI image processing is disabled by the owner.')
      return resolveAdapter('meta', { model })
    },
    modelWindow: (model) => {
      const window = findModel('meta', model)?.contextWindow
      if (!window) throw new WorkspaceError('conflict', 'The image model context window is unverified.')
      return window
    },
    context: () => {
      const context = Context.current(), info = context.info
      if (!info.workflowExecution) throw new WorkspaceError('permission_denied', 'File work requires validated Temporal execution identity.')
      return { producerId: `${info.workflowExecution.runId}:${info.activityId}:${info.attempt}`, signal: context.cancellationSignal, heartbeat: (phase) => context.heartbeat({ phase }) }
    },
  })
}
export const prepareFileProcessingActivity = (input: FileProcessingInput) => production().prepareFileProcessingActivity(input)
export const nextFileImageActivity = (input: FileProcessingInput & { cursor: { page: number; ordinal: number } | null }) => production().nextFileImageActivity(input)
export const processFileImageActivity = (input: FileProcessingInput & { imageId: string }) => production().processFileImageActivity(input)
export const finalizeFileProcessingActivity = (input: FileProcessingInput) => production().finalizeFileProcessingActivity(input)
export const failFileProcessingActivity = (input: FileProcessingInput & { code: string }) => production().failFileProcessingActivity(input)
