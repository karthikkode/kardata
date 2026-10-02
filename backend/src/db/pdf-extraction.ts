// PDF parsing/encoding only. Provider work, receipts and publication belong to
// the file-processing owner. No image count cap and no guessed partial success.
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { getDocumentProxy, getResolvedPDFJS, renderPageAsImage } from 'unpdf'
import { WorkspaceError } from './errors.js'
import { createLogger, logOp } from '../observability/logging.js'

export const PDF_IMAGE_MAX_PIXELS = 8_000_000
export const PDF_IMAGE_MAX_BYTES = 8 * 1024 * 1024
export const PDF_PAGE_VISUAL_SCALE = 2
const OP_TIMEOUT_MS = 30_000
const logger = createLogger({ op: 'pdf.extract' })
export type PdfExtractionPart = { page: number; kind: 'text'; text: string } | { page: number; kind: 'image'; ordinal: number; png: Uint8Array; imageHash: string; width: number; height: number; role?: 'embedded' | 'page-visual' }
type Matrix = [number, number, number, number, number, number]
type Raster = { width: number; height: number; kind?: number; data: Uint8Array | Uint8ClampedArray | string }
type Page = Awaited<ReturnType<Awaited<ReturnType<typeof getDocumentProxy>>['getPage']>>
type ImageBlock = { kind: 'image'; x: number; y: number; order: number; raster(): Promise<Raster>; mask: boolean; color: number[]; crop?: { left: number; top: number; width: number; height: number } }
type TextBlock = { kind: 'text'; x: number; y: number; order: number; text: string }
const identity = (): Matrix => [1, 0, 0, 1, 0, 0]
const conflict = (message: string) => new WorkspaceError('conflict', message)

async function bounded<T>(work: () => Promise<T>, outer?: AbortSignal, cancel?: () => void, onLate?: (value: T) => Promise<void>): Promise<T> {
  const deadline = new AbortController()
  const signal = outer ? AbortSignal.any([outer, deadline.signal]) : deadline.signal
  const timer = setTimeout(() => deadline.abort(), OP_TIMEOUT_MS)
  let rejectAbort: (() => void) | undefined
  try {
    signal.throwIfAborted()
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => { cancel?.(); reject(conflict('PDF extraction operation was cancelled or exceeded its deadline.')) }
      signal.addEventListener('abort', rejectAbort, { once: true })
    })
    const pending = work().then(async (value) => { if (signal.aborted) await onLate?.(value); return value })
    return await Promise.race([pending, aborted])
  } finally {
    clearTimeout(timer)
    if (rejectAbort) signal.removeEventListener('abort', rejectAbort)
  }
}
function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]
}
function matrix(value: unknown): Matrix {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) throw conflict('PDF image placement has invalid coordinates.')
  const values = Array.from(value as ArrayLike<number>)
  if (values.length !== 6 || !values.every((number) => typeof number === 'number' && Number.isFinite(number))) throw conflict('PDF image placement has invalid coordinates.')
  return values as Matrix
}
async function object(page: Page, id: string, signal?: AbortSignal): Promise<unknown> {
  return bounded(() => new Promise((resolve) => (id.startsWith('g_') ? page.commonObjs : page.objs).get(id, resolve)), signal)
}
async function raster(page: Page, raw: unknown, signal?: AbortSignal): Promise<Raster> {
  const value = typeof raw === 'string' ? await object(page, raw, signal) : raw
  if (!value || typeof value !== 'object') throw conflict('PDF image pixels are unavailable. Retry extraction without publishing a partial index.')
  const image = value as Raster
  if (typeof image.data === 'string') return raster(page, await object(page, image.data, signal), signal)
  if (!(image.data instanceof Uint8Array) && !(image.data instanceof Uint8ClampedArray)) throw conflict('PDF image pixels use an unsupported representation.')
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1) throw conflict('PDF image dimensions are invalid.')
  return image
}
async function encodeImage(block: ImageBlock, signal?: AbortSignal): Promise<{ png: Uint8Array; width: number; height: number }> {
  const image = await block.raster()
  const pixels = image.width * image.height
  if (!Number.isSafeInteger(pixels) || pixels > PDF_IMAGE_MAX_PIXELS) throw conflict(`PDF image exceeds the pixel limit of ${PDF_IMAGE_MAX_PIXELS.toLocaleString('en-US')}. No partial index was published.`)
  let channels: 1 | 3 | 4
  let data = Buffer.from(image.data as Uint8Array)
  if (block.mask || image.kind === 1) {
    const stride = Math.ceil(image.width / 8)
    if (data.length < stride * image.height) throw conflict('PDF packed image pixels are incomplete.')
    const unpacked = Buffer.alloc(pixels * (block.mask ? 4 : 1))
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const set = (data[y * stride + Math.floor(x / 8)]! >> (7 - x % 8)) & 1
      const offset = y * image.width + x
      if (block.mask) { unpacked[offset * 4] = block.color[0]!; unpacked[offset * 4 + 1] = block.color[1]!; unpacked[offset * 4 + 2] = block.color[2]!; unpacked[offset * 4 + 3] = set ? 0 : 255 }
      else unpacked[offset] = set ? 255 : 0
    }
    data = unpacked; channels = block.mask ? 4 : 1
  } else {
    const inferred = data.length / pixels
    if (![1, 3, 4].includes(inferred)) throw conflict('PDF image channel layout is unsupported.')
    channels = inferred as 1 | 3 | 4
  }
  const encoder = sharp(data, { raw: { width: image.width, height: image.height, channels }, limitInputPixels: PDF_IMAGE_MAX_PIXELS }).timeout({ seconds: OP_TIMEOUT_MS / 1000 })
  if (block.crop) encoder.extract(block.crop)
  try {
    const png = await bounded(() => new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      let bytes = 0, settled = false
      encoder.once('error', (error) => { settled = true; reject(error) })
      encoder.once('close', () => { if (!settled) reject(conflict('PDF image encoding closed before completion.')) })
      encoder.once('end', () => { settled = true; resolve(Buffer.concat(chunks, bytes)) })
      encoder.on('data', (chunk: Buffer) => {
        bytes += chunk.byteLength
        if (bytes > PDF_IMAGE_MAX_BYTES) { settled = true; reject(conflict(`Encoded PDF image exceeds ${PDF_IMAGE_MAX_BYTES.toLocaleString('en-US')} bytes. No partial index was published.`)); encoder.destroy() }
        else chunks.push(chunk)
      })
      encoder.png()
    }), signal, () => { encoder.destroy() })
    return { png, width: block.crop?.width ?? image.width, height: block.crop?.height ?? image.height }
  } finally { encoder.destroy() }
}

async function pageBlocks(page: Page, signal?: AbortSignal): Promise<{ blocks: Array<TextBlock | ImageBlock>; needsVisual: boolean }> {
  const { OPS } = await getResolvedPDFJS()
  const viewport = page.getViewport({ scale: 1 })
  const content = await bounded(() => page.getTextContent(), signal)
  const operators = await bounded(() => page.getOperatorList(), signal)
  const blocks: Array<TextBlock | ImageBlock> = []
  let order = 0
  for (const item of content.items) if ('str' in item && item.str) {
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
    blocks.push({ kind: 'text', x, y: y - item.height, order: order++, text: item.str + (item.hasEOL ? '\n' : '') })
  }
  let transform = identity(), color = [0, 0, 0]
  const stack: Array<{ transform: Matrix; color: number[] }> = []
  const add = (raw: unknown, placed: Matrix, mask = false, crop?: ImageBlock['crop']) => {
    const points = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => viewport.convertToViewportPoint(placed[0] * x! + placed[2] * y! + placed[4], placed[1] * x! + placed[3] * y! + placed[5]))
    blocks.push({ kind: 'image', x: Math.min(...points.map((point) => point[0]!)), y: Math.min(...points.map((point) => point[1]!)), order: order++, raster: () => raster(page, raw, signal), mask, color: [...color], ...(crop ? { crop } : {}) })
  }
  const names = new Map(Object.entries(OPS).map(([name, op]) => [op, name]))
  const vectorPaint = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke, OPS.shadingFill])
  let needsVisual = false
  for (let index = 0; index < operators.fnArray.length; index++) {
    signal?.throwIfAborted()
    const op = operators.fnArray[index]!, args = operators.argsArray[index] as unknown[]
    if (vectorPaint.has(op) || op === OPS.constructPath && vectorPaint.has(args[0] as number)) needsVisual = true
    if (op === OPS.save) stack.push({ transform: [...transform], color: [...color] })
    else if (op === OPS.restore) { const saved = stack.pop(); if (saved) { transform = saved.transform; color = saved.color } }
    else if (op === OPS.paintFormXObjectBegin) { stack.push({ transform: [...transform], color: [...color] }); if (args[0]) transform = multiply(transform, matrix(args[0])) }
    else if (op === OPS.paintFormXObjectEnd) { const saved = stack.pop(); if (!saved) throw conflict('PDF form placement is invalid.'); transform = saved.transform; color = saved.color }
    else if (op === OPS.transform) transform = multiply(transform, matrix(Array.from(args)))
    else if (op === OPS.setFillRGBColor) {
      const values = Array.from(args)
      if (typeof values[0] === 'string' && /^#[a-f0-9]{6}$/i.test(values[0])) color = [1, 3, 5].map((at) => parseInt((values[0] as string).slice(at, at + 2), 16))
      else color = values.length === 1 && ArrayBuffer.isView(values[0]) ? Array.from(values[0] as unknown as ArrayLike<number>) : values as number[]
    }
    else if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) add(args[0], transform)
    else if (op === OPS.paintImageMaskXObject) add(args[0], transform, true)
    else if (op === OPS.paintImageXObjectRepeat) {
      const positions = args[3] as ArrayLike<number>
      if (!positions || positions.length % 2) throw conflict('PDF repeated image placement is invalid.')
      for (let at = 0; at < positions.length; at += 2) add(args[0], multiply(transform, matrix([args[1], 0, 0, args[2], positions[at], positions[at + 1]])))
    } else if (op === OPS.paintImageMaskXObjectRepeat) {
      const positions = args[5] as ArrayLike<number>
      if (!positions || positions.length % 2) throw conflict('PDF repeated mask placement is invalid.')
      for (let at = 0; at < positions.length; at += 2) add(args[0], multiply(transform, matrix([args[1], args[2], args[3], args[4], positions[at], positions[at + 1]])), true)
    } else if (op === OPS.paintImageMaskXObjectGroup) {
      for (const image of args[0] as Array<Raster & { transform: Matrix }>) add(image, multiply(transform, matrix(image.transform)), true)
    } else if (op === OPS.paintInlineImageXObjectGroup) {
      for (const item of args[1] as Array<{ transform: Matrix; x: number; y: number; w: number; h: number }>) add(args[0], multiply(transform, matrix(item.transform)), false, { left: item.x, top: item.y, width: item.w, height: item.h })
    } else if (op === OPS.paintSolidColorImageMask) add({ width: 1, height: 1, data: new Uint8Array([0]) }, transform, true)
    else if (/^paint.*Image/.test(names.get(op) ?? '')) throw conflict('PDF contains an unsupported image operation. No partial index was published.')
  }
  return { blocks: blocks.sort((a, b) => a.y - b.y || a.x - b.x || a.order - b.order), needsVisual }
}

/** Consume one part before requesting the next: encoded images are not retained
 * across pages or provider work. Closing/aborting the iterator destroys its proxy.
 * PDFJS may allocate decoded rasters before our pixel check; this is not a parser
 * process-memory guarantee or proof of arbitrary-document reading semantics. */
export async function* planPdfExtraction(bytes: Uint8Array, options: { signal?: AbortSignal } = {}): AsyncGenerator<PdfExtractionPart> {
  const started = Date.now(), sourceHash = createHash('sha256').update(bytes).digest('hex')
  logger.info({ event: 'pdf.extract.start', sourceHash })
  let document: Awaited<ReturnType<typeof getDocumentProxy>> | undefined
  let completed = false, failed = false
  try {
    try {
      if (!bytes.byteLength || bytes.byteLength > PDF_IMAGE_MAX_BYTES) throw conflict('PDF original bytes exceed the supported upload limit.')
      document = await bounded(() => getDocumentProxy(new Uint8Array(bytes)), options.signal, undefined,
        async (late) => { await logOp(logger, 'pdf.extract.late-cleanup', () => bounded(() => late.destroy()), { sourceHash }) })
      for (let number = 1; number <= document.numPages; number++) {
        const page = await bounded(() => document!.getPage(number), options.signal)
        let ordinal = 0
        const planned = await pageBlocks(page, options.signal)
        for (const block of planned.blocks) {
          options.signal?.throwIfAborted()
          if (block.kind === 'text') yield { page: number, kind: 'text', text: block.text }
          else {
            const image = await encodeImage(block, options.signal)
            yield { page: number, kind: 'image', ordinal: ordinal++, ...image, imageHash: createHash('sha256').update(image.png).digest('hex'), role: 'embedded' }
          }
        }
        if (planned.needsVisual) {
          const viewport = page.getViewport({ scale: PDF_PAGE_VISUAL_SCALE })
          const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height)
          if (!Number.isSafeInteger(width * height) || width * height > PDF_IMAGE_MAX_PIXELS) throw conflict(`PDF page visual exceeds ${PDF_IMAGE_MAX_PIXELS.toLocaleString('en-US')} pixels at ${PDF_PAGE_VISUAL_SCALE}x resolution. No partial index was published.`)
          const rendered = await logOp(logger, 'pdf.page.render', () => bounded(() => renderPageAsImage(document!, number, { scale: PDF_PAGE_VISUAL_SCALE, canvasImport: () => import('@napi-rs/canvas') }), options.signal), { sourceHash, page: number, width, height, reason: 'vector-graphics' })
          const png = new Uint8Array(rendered)
          if (png.byteLength > PDF_IMAGE_MAX_BYTES) throw conflict(`PDF page visual exceeds ${PDF_IMAGE_MAX_BYTES.toLocaleString('en-US')} PNG bytes. No partial index was published.`)
          yield { page: number, kind: 'image', ordinal: ordinal++, png, imageHash: createHash('sha256').update(png).digest('hex'), width, height, role: 'page-visual' }
        }
        page.cleanup()
      }
      completed = true
    } catch (error) { failed = true; throw error }
    finally {
      if (document) await logOp(logger, 'pdf.extract.cleanup', () => bounded(() => document!.destroy()), { sourceHash })
      if (!failed) logger.info({ event: 'pdf.extract.done', outcome: completed ? 'ok' : 'closed', latencyMs: Date.now() - started, sourceHash })
    }
  } catch (error) {
    logger.error({ event: 'pdf.extract.error', outcome: 'error', code: error instanceof WorkspaceError ? error.code : 'pdf_parse_failed', latencyMs: Date.now() - started, sourceHash })
    throw error instanceof WorkspaceError ? error : conflict('PDF extraction failed. Retain the original and retry without a partial index.')
  }
}
