// Server-side file pipeline: uploads never reach a provider. Every file is
// classified by content (magic bytes beat the extension), extracted to
// text units by type, and indexed per file. Images and image-only PDFs go
// through a configured OCR endpoint; without one they degrade to an
// explicit needs-ocr status, never silent loss. Pure except for the OCR
// HTTP call, which rides an injected adapter (scripted fake in tests).
import { extractRawText } from 'mammoth'
import { extractImages, extractText, getDocumentProxy } from 'unpdf'
import { createHash } from 'node:crypto'
import { DbContractError } from './errors.js'
import { createLogger, logOp } from '../observability/logging.js'

const ocrLogger = createLogger({ op: 'file.ocr' })
class OcrFailure extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
async function recognizeOcr(ocr: OcrAdapter, image: Uint8Array, mediaType: string): Promise<OcrResult> {
  return logOp(ocrLogger, 'file.ocr', async () => {
    try { return validateOcrResult(await ocr.recognize(image, mediaType)) }
    catch (error) { throw error instanceof OcrFailure ? error : new OcrFailure('ocr_failed', 'OCR could not finish. Retry after the service recovers.') }
  })
}
function validateOcrResult(result: OcrResult): OcrResult {
  if (!result || typeof result.text !== 'string' || !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) throw new OcrFailure('ocr_invalid_response', 'OCR returned invalid text or confidence.')
  if (Buffer.byteLength(result.text, 'utf8') > SECTOR_DOCUMENT_MAX_BYTES) throw new OcrFailure('ocr_limit', 'OCR transcript exceeds the document byte limit.')
  return result
}
function discardOcrBody(response: Response): void {
  void response.body?.cancel().catch(() => ocrLogger.warn({ event: 'file.ocr.cleanup.error', code: 'ocr_body_cancel_failed' }))
}
async function readOcrJson(response: Response, aborted: Promise<never>): Promise<unknown> {
  if (Number(response.headers.get('content-length') ?? 0) > SECTOR_DOCUMENT_MAX_BYTES) {
    discardOcrBody(response)
    throw new OcrFailure('ocr_limit', 'OCR response exceeds the document byte limit.')
  }
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  if (reader) {
    try {
      for (;;) {
        const chunk = await Promise.race([reader.read(), aborted])
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > SECTOR_DOCUMENT_MAX_BYTES) throw new OcrFailure('ocr_limit', 'OCR response exceeds the document byte limit.')
        chunks.push(chunk.value)
      }
    } catch (error) {
      void reader.cancel().catch(() => ocrLogger.warn({ event: 'file.ocr.cleanup.error', code: 'ocr_body_cancel_failed' }))
      throw error
    } finally { reader.releaseLock() }
  }
  try { return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')) as unknown }
  catch { throw new OcrFailure('ocr_invalid_response', 'OCR endpoint returned malformed JSON.') }
}

export function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

/** Largest accepted upload: a sector document is context, not an archive. */
export const SECTOR_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024

/** OCR confidence below this marks the unit uncertain, never drops it. */
export const OCR_CONFIDENCE_MIN = 0.5

/** Largest unit: paragraph-boundary chunks at roughly half a thousand tokens. */
export const UNIT_MAX_CHARS = 2000

/** At most this many embedded images OCR per document: bounded spend. */
const MAX_OCR_IMAGES = 10

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.csv', '.json', '.text'])

const SUPPORTED_LIST = 'attach .md, .txt, .csv, .json, .pdf, .docx, .png, .jpg, or .webp'

function documentExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) return ''
  return filename.slice(dot).toLowerCase()
}

type FileKind = 'text' | 'pdf' | 'docx' | 'image' | 'unsupported'

export interface ClassifiedFile {
  kind: FileKind
  mediaType: string
  reason?: string
}

function sniffKind(bytes: Buffer): FileKind | undefined {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf'
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return 'image'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image'
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image'
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image'
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)
    return 'docx'
  return undefined
}

function imageMediaType(bytes: Buffer): string {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf'
  if (bytes.length >= 8 && bytes[0] === 0x89) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF') return 'image/webp'
  return 'image/gif'
}

/** Classify by magic bytes first; the extension only breaks ties (a
 * claimed .pdf with unknown magic still parses as PDF so corrupt files
 * fail with a precise error instead of "unsupported"). */
export function classifyUpload(filename: string, bytes: Buffer): ClassifiedFile {
  const extension = documentExtension(filename)
  const sniffed = sniffKind(bytes)
  if (sniffed === 'pdf' || extension === '.pdf') return { kind: 'pdf', mediaType: 'application/pdf' }
  if (sniffed === 'image') return { kind: 'image', mediaType: imageMediaType(bytes) }
  if (sniffed === 'docx' && extension === '.docx') {
    return {
      kind: 'docx',
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }
  }
  if (TEXT_EXTENSIONS.has(extension)) return { kind: 'text', mediaType: 'text/plain' }
  return { kind: 'unsupported', mediaType: 'application/octet-stream', reason: `unsupported document type '${extension || '(none)'}'; ${SUPPORTED_LIST}` }
}

export interface OcrResult {
  text: string
  confidence: number
}

export interface OcrAdapter {
  recognize(image: Uint8Array, mediaType: string): Promise<OcrResult>
}

/** Scripted OCR double: queued transcripts consumed in order. Tests only. */
export class ScriptedOcrAdapter implements OcrAdapter {
  private readonly queue: OcrResult[]

  constructor(results: OcrResult[]) {
    this.queue = [...results]
  }

  async recognize(): Promise<OcrResult> {
    const next = this.queue.shift()
    if (!next) throw new DbContractError('scripted OCR ran out of transcripts')
    return next
  }
}

export interface HttpOcrConfig {
  endpoint: string
  apiKey?: string
  timeoutMs?: number
  fetchFn?: typeof fetch
}

/** OCR over HTTP: image bytes go to the operator-configured endpoint, never
 * to a model provider. Response shape { text, confidence? }; the key rides
 * a Bearer [REDACTED] and never appears in errors. */
export function createHttpOcrAdapter(config: HttpOcrConfig): OcrAdapter {
  const timeoutMs = config.timeoutMs ?? 30_000
  const fetchFn = config.fetchFn ?? fetch
  return {
    async recognize(image: Uint8Array, mediaType: string): Promise<OcrResult> {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const rejectAbort = () => rejectDeadline(new OcrFailure('ocr_timeout', 'OCR request timed out.'))
      let rejectDeadline: (reason: Error) => void = () => undefined
      const aborted = new Promise<never>((_resolve, reject) => { rejectDeadline = reject })
      controller.signal.addEventListener('abort', rejectAbort, { once: true })
      try {
        const headers = fetchFn(config.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({ imageBase64: Buffer.from(image).toString('base64'), mediaType }),
          signal: controller.signal,
        }).then((response) => { if (controller.signal.aborted) discardOcrBody(response); return response })
        const response = await Promise.race([headers, aborted])
        if (!response.ok) { discardOcrBody(response); throw new OcrFailure('ocr_http_failed', `OCR endpoint returned HTTP ${response.status}.`) }
        const payload = await readOcrJson(response, aborted)
        if (typeof payload !== 'object' || payload === null) throw new OcrFailure('ocr_invalid_response', 'OCR endpoint returned malformed JSON.')
        const record = payload as Record<string, unknown>
        if (typeof record['text'] !== 'string') throw new OcrFailure('ocr_invalid_response', 'OCR endpoint returned no text.')
        const confidence = record['confidence'] === undefined ? 1 : record['confidence']
        if (typeof confidence !== 'number') throw new OcrFailure('ocr_invalid_response', 'OCR returned invalid confidence.')
        return validateOcrResult({ text: record['text'], confidence })
      } catch (error) {
        if (error instanceof OcrFailure) throw error
        throw new OcrFailure(controller.signal.aborted ? 'ocr_timeout' : 'ocr_transport_failed', controller.signal.aborted ? 'OCR request timed out.' : 'OCR transport failed. Retry after the service recovers.')
      } finally {
        clearTimeout(timer)
        controller.signal.removeEventListener('abort', rejectAbort)
      }
    },
  }
}

type UnitKind = 'text' | 'ocr' | 'table' | 'heading'

export interface ExtractedUnit {
  ord: number
  kind: UnitKind
  text: string
  /** Set on OCR units; below OCR_CONFIDENCE_MIN also sets uncertain. */
  confidence?: number
  uncertain: boolean
}

function unitKind(paragraph: string): UnitKind {
  if (/^#{1,6}\s/.test(paragraph)) return 'heading'
  if (paragraph.split('\n').some((line) => line.trim().startsWith('|'))) return 'table'
  return 'text'
}

/** Chunk on paragraph boundaries within maxChars; oversize paragraphs hard-split. */
export function chunkTextUnits(text: string, maxChars = UNIT_MAX_CHARS): ExtractedUnit[] {
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > UNIT_MAX_CHARS) throw new DbContractError(`chunk budget must be a positive integer no greater than ${UNIT_MAX_CHARS}`)
  const paragraphs = text.split(/\n\s*\n/).map((part) => part.trim()).filter((part) => part.length > 0)
  const chunks: string[] = []
  let current = ''
  const flush = (): void => {
    if (current) chunks.push(current)
    current = ''
  }
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      flush()
      for (let at = 0; at < paragraph.length;) {
        let end = Math.min(at + maxChars, paragraph.length)
        const previous = paragraph.charCodeAt(end - 1), next = paragraph.charCodeAt(end)
        if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1
        if (end === at) throw new DbContractError('chunk budget cannot fit a supplementary Unicode codepoint')
        chunks.push(paragraph.slice(at, end)); at = end
      }
      continue
    }
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (candidate.length > maxChars) flush()
    current = current ? `${current}\n\n${paragraph}` : paragraph
  }
  flush()
  return chunks.map((chunk, ord) => ({ ord, kind: unitKind(chunk), text: chunk, uncertain: false }))
}

export type ExtractionStatus = 'indexed' | 'needs-ocr' | 'failed'

export interface FileExtraction {
  status: ExtractionStatus
  detail?: string
  mediaType: string
  units: ExtractedUnit[]
}

function ocrUnits(ord: number, result: OcrResult): ExtractedUnit[] {
  return chunkTextUnits(result.text.trim()).map((unit, index) => ({
    ...unit,
    ord: ord + index,
    kind: 'ocr',
    confidence: result.confidence,
    uncertain: result.confidence < OCR_CONFIDENCE_MIN,
  }))
}

async function extractPdfUnits(bytes: Buffer, ocr?: OcrAdapter): Promise<FileExtraction> {
  let raw: string
  try {
    const { text } = await extractText(new Uint8Array(bytes), { mergePages: true })
    raw = Array.isArray(text) ? text.join('\n') : String(text)
  } catch {
    return { status: 'failed', detail: 'could not read this PDF (corrupt or encrypted)', mediaType: 'application/pdf', units: [] }
  }
  if (raw.trim()) {
    return { status: 'indexed', mediaType: 'application/pdf', units: chunkTextUnits(raw.trim()) }
  }
  // No text layer: an image-only (scanned) PDF. OCR its embedded images.
  let pages: number
  try {
    pages = (await getDocumentProxy(new Uint8Array(bytes))).numPages
  } catch {
    return { status: 'failed', detail: 'could not read this PDF (corrupt or encrypted)', mediaType: 'application/pdf', units: [] }
  }
  if (!ocr) {
    return { status: 'needs-ocr', detail: `image-only PDF (${pages} pages): configure an OCR endpoint to index it`, mediaType: 'application/pdf', units: [] }
  }
  const units: ExtractedUnit[] = []
  const incomplete = (code: string, message: string): FileExtraction => {
    ocrLogger.warn({ event: 'file.ocr.coverage.incomplete', code })
    return { status: 'needs-ocr', detail: `OCR unavailable: ${code}: ${message}`, mediaType: 'application/pdf', units: [] }
  }
  let attemptedImages = 0
  let transcriptBytes = 0
  for (let page = 1; page <= pages; page += 1) {
    let images: Uint8Array[]
    try {
      images = (await extractImages(new Uint8Array(bytes), page)).map(
        (entry) => new Uint8Array(entry.data.buffer as ArrayBuffer, entry.data.byteOffset, entry.data.byteLength),
      )
    } catch {
      return incomplete('ocr_coverage_incomplete', 'A PDF page could not be inspected. No partial transcript was indexed.')
    }
    if (!images.length) return incomplete('ocr_coverage_incomplete', 'A scanned PDF page has no OCR-readable images. No partial transcript was indexed.')
    for (const image of images) {
      if (attemptedImages >= MAX_OCR_IMAGES) return incomplete('ocr_limit', 'The PDF has more images than the OCR budget. No partial transcript was indexed.')
      attemptedImages += 1
      try {
        const result = await recognizeOcr(ocr, image, 'image/png')
        transcriptBytes += Buffer.byteLength(result.text, 'utf8')
        if (transcriptBytes > SECTOR_DOCUMENT_MAX_BYTES) return incomplete('ocr_limit', 'Aggregate OCR transcript exceeds the document byte limit.')
        if (!result.text.trim()) return incomplete('ocr_coverage_incomplete', 'OCR returned no transcript for a PDF image. No partial transcript was indexed.')
        units.push(...ocrUnits(units.length, result))
      } catch (error) {
        return incomplete(error instanceof OcrFailure ? error.code : 'ocr_failed', error instanceof OcrFailure ? error.message : 'OCR could not finish. No partial transcript was indexed.')
      }
    }
  }
  if (units.length === 0) {
    return { status: 'needs-ocr', detail: `image-only PDF (${pages} pages): no OCR-readable images found`, mediaType: 'application/pdf', units: [] }
  }
  return { status: 'indexed', mediaType: 'application/pdf', units }
}

/** Full extraction for one upload. Never throws for file problems: corrupt
 * and unsupported files report failed with a detail string. Raw bytes are
 * consumed here and never leave this module toward any provider. */
export async function extractFileUnits(
  filename: string,
  bytes: Buffer,
  ocr?: OcrAdapter,
): Promise<FileExtraction> {
  if (!filename.trim() || bytes.length === 0) {
    return { status: 'failed', detail: 'document is empty or nameless', mediaType: 'application/octet-stream', units: [] }
  }
  if (bytes.length > SECTOR_DOCUMENT_MAX_BYTES) {
    return { status: 'failed', detail: `document exceeds ${SECTOR_DOCUMENT_MAX_BYTES} bytes`, mediaType: 'application/octet-stream', units: [] }
  }
  const classified = classifyUpload(filename, bytes)
  if (classified.kind === 'unsupported') {
    return { status: 'failed', detail: classified.reason ?? 'unsupported document type', mediaType: classified.mediaType, units: [] }
  }
  if (classified.kind === 'text') {
    const text = bytes.toString('utf8').trim()
    if (!text) return { status: 'failed', detail: 'document has no readable text', mediaType: 'text/plain', units: [] }
    return { status: 'indexed', mediaType: 'text/plain', units: chunkTextUnits(text) }
  }
  if (classified.kind === 'pdf') return extractPdfUnits(bytes, ocr)
  if (classified.kind === 'docx') {
    try {
      const value = (await extractRawText({ buffer: bytes })).value.trim()
      if (!value) return { status: 'failed', detail: 'document has no readable text', mediaType: classified.mediaType, units: [] }
      return { status: 'indexed', mediaType: classified.mediaType, units: chunkTextUnits(value) }
    } catch {
      return { status: 'failed', detail: 'could not read this .docx file (corrupt or wrong format)', mediaType: classified.mediaType, units: [] }
    }
  }
  if (!ocr) {
    return { status: 'needs-ocr', detail: 'image upload: configure an OCR endpoint to index it', mediaType: classified.mediaType, units: [] }
  }
  try {
    const result = await recognizeOcr(ocr, new Uint8Array(bytes), classified.mediaType)
    if (!result.text.trim()) {
      return { status: 'needs-ocr', detail: 'OCR returned no text for this image', mediaType: classified.mediaType, units: [] }
    }
    return { status: 'indexed', mediaType: classified.mediaType, units: ocrUnits(0, result) }
  } catch (error) {
    // A throwing OCR backend (endpoint down, vision rejected) degrades to
    // needs-ocr with the reason attached: the attach succeeds and the file
    // waits for OCR instead of failing the upload.
    const detail = error instanceof OcrFailure ? `${error.code}: ${error.message}` : 'ocr_failed: OCR could not finish.'
    return { status: 'needs-ocr', detail: `OCR unavailable: ${detail}`, mediaType: classified.mediaType, units: [] }
  }
}
