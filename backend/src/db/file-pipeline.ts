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
export const MAX_OCR_IMAGES = 10

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.csv', '.json', '.text'])

const SUPPORTED_LIST = 'attach .md, .txt, .csv, .json, .pdf, .docx, .png, .jpg, or .webp'

export function documentExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) return ''
  return filename.slice(dot).toLowerCase()
}

export type FileKind = 'text' | 'pdf' | 'docx' | 'image' | 'unsupported'

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
      try {
        const response = await fetchFn(config.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({ imageBase64: Buffer.from(image).toString('base64'), mediaType }),
          signal: controller.signal,
        })
        if (!response.ok) throw new DbContractError(`ocr endpoint failed with HTTP ${response.status}`)
        const payload: unknown = await response.json()
        if (typeof payload !== 'object' || payload === null) throw new DbContractError('ocr endpoint returned malformed JSON')
        const record = payload as Record<string, unknown>
        if (typeof record['text'] !== 'string') throw new DbContractError('ocr endpoint returned no text')
        const confidence = typeof record['confidence'] === 'number' ? record['confidence'] : 1
        return { text: record['text'], confidence }
      } catch (error) {
        if (error instanceof DbContractError) throw error
        throw new DbContractError(`ocr request failed: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown error'}`)
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

export type UnitKind = 'text' | 'ocr' | 'table' | 'heading'

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
      for (let at = 0; at < paragraph.length; at += maxChars) {
        chunks.push(paragraph.slice(at, at + maxChars))
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

function ocrUnit(ord: number, result: OcrResult): ExtractedUnit {
  const text = result.text.trim()
  return {
    ord,
    kind: 'ocr',
    text,
    confidence: result.confidence,
    uncertain: result.confidence < OCR_CONFIDENCE_MIN,
  }
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
  for (let page = 1; page <= pages && units.length < MAX_OCR_IMAGES; page += 1) {
    let images: Uint8Array[]
    try {
      images = (await extractImages(new Uint8Array(bytes), page)).map(
        (entry) => new Uint8Array(entry.data.buffer as ArrayBuffer, entry.data.byteOffset, entry.data.byteLength),
      )
    } catch {
      continue
    }
    for (const image of images) {
      if (units.length >= MAX_OCR_IMAGES) break
      try {
        const result = await ocr.recognize(image, 'image/png')
        if (result.text.trim()) units.push(ocrUnit(units.length, result))
      } catch {
        continue
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
    const result = await ocr.recognize(new Uint8Array(bytes), classified.mediaType)
    if (!result.text.trim()) {
      return { status: 'needs-ocr', detail: 'OCR returned no text for this image', mediaType: classified.mediaType, units: [] }
    }
    return { status: 'indexed', mediaType: classified.mediaType, units: [ocrUnit(0, result)] }
  } catch (error) {
    // A throwing OCR backend (endpoint down, vision rejected) degrades to
    // needs-ocr with the reason attached: the attach succeeds and the file
    // waits for OCR instead of failing the upload.
    const detail = error instanceof Error ? error.message.slice(0, 300) : 'OCR failed'
    return { status: 'needs-ocr', detail: `OCR unavailable: ${detail}`, mediaType: classified.mediaType, units: [] }
  }
}
