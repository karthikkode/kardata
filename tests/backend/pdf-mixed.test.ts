import { writeFileSync, mkdirSync } from 'node:fs'
import { cpus, totalmem, platform, arch } from 'node:os'
import { createHash } from 'node:crypto'
// Real maintained PDF bytes parsed by production unpdf. OCR alone is scripted;
// these TEST documents are not live company/provider evidence.
import { describe, expect, it, vi } from 'vitest'
import { FakeProvider } from '@kardata/agents'
import { createModelOcrAdapter } from '../../backend/src/ocr.js'
import { getDocumentProxy, getResolvedPDFJS, renderPageAsImage } from 'unpdf'
import sharp from 'sharp'
import { PDF_IMAGE_MAX_PIXELS, planPdfExtraction } from '../../backend/src/db/pdf-extraction.js'
import { stressImagePdf, testPdf } from './pdf-fixtures.js'
vi.mock('unpdf', async (original) => {
  const actual = await original<typeof import('unpdf')>()
  return { ...actual, getDocumentProxy: vi.fn(actual.getDocumentProxy), renderPageAsImage: vi.fn(actual.renderPageAsImage) }
})
function operatorDocument(operations: Array<[number, unknown[]]>, objects: Record<string, unknown> = {}, dimensions = { width: 1, height: 1 }) {
  const pool = { get: (id: string, resolve: (value: unknown) => void) => resolve(objects[id]) }
  const page = { objs: pool, commonObjs: pool, getViewport: ({ scale }: { scale: number }) => ({ width: dimensions.width * scale, height: dimensions.height * scale, convertToViewportPoint: (x: number, y: number) => [x, -y] }), getTextContent: async () => ({ items: [] }), getOperatorList: async () => ({ fnArray: operations.map(([op]) => op), argsArray: operations.map(([, args]) => args) }), cleanup: vi.fn() }
  return { numPages: 1, getPage: async () => page, destroy: vi.fn(async () => undefined) }
}

describe('real mixed native-text/image PDF pipeline [F:db.pdf_extraction.planPdfExtraction] [F:db.pdf_extraction.PDF_IMAGE_MAX_PIXELS]', () => {
  it('destroys a proxy acquired after abort instead of leaking an abort-ignoring acquisition', async () => {
    let resolve: (document: unknown) => void = () => undefined
    const destroy = vi.fn(async () => undefined)
    const pending = new Promise((done) => { resolve = done })
    vi.mocked(getDocumentProxy).mockReturnValueOnce(pending as never)
    const abort = new AbortController(), iterator = planPdfExtraction(testPdf(false), { signal: abort.signal })
    const first = iterator.next()
    abort.abort()
    await expect(first).rejects.toMatchObject({ code: 'conflict' })
    resolve({ destroy })
    await new Promise((done) => setTimeout(done, 0))
    expect(destroy).toHaveBeenCalledOnce()
  })
  it('destroys an owned real proxy when the consumer closes after one native-text record', async () => {
    const document = await getDocumentProxy(new Uint8Array(testPdf(true)))
    const destroy = vi.spyOn(document, 'destroy')
    vi.mocked(getDocumentProxy).mockResolvedValueOnce(document)
    const iterator = planPdfExtraction(testPdf(true))
    expect((await iterator.next()).value).toMatchObject({ kind: 'text' })
    await iterator.return(undefined)
    expect(destroy).toHaveBeenCalledOnce()
  })
  it('destroys an owned real proxy when cancellation follows a yielded native-text record', async () => {
    const document = await getDocumentProxy(new Uint8Array(testPdf(true)))
    const destroy = vi.spyOn(document, 'destroy')
    vi.mocked(getDocumentProxy).mockResolvedValueOnce(document)
    const abort = new AbortController(), iterator = planPdfExtraction(testPdf(true), { signal: abort.signal })
    await iterator.next(); abort.abort()
    await expect(iterator.next()).rejects.toMatchObject({ code: 'conflict' })
    expect(destroy).toHaveBeenCalledOnce()
  })
  it.each(['xobject', 'inline', 'mask', 'repeat', 'alpha'] as const)('maintains a real %s fixture exposing PDFJS image operators', async (format) => {
    const document = await getDocumentProxy(new Uint8Array(testPdf(true, format)))
    try {
      const { OPS } = await getResolvedPDFJS()
      const page = await document.getPage(1)
      const operators = await page.getOperatorList()
      const imageOps = Object.entries(OPS).filter(([name]) => /^paint.*Image/.test(name)).map(([, value]) => value)
      expect(operators.fnArray.some((op) => imageOps.includes(op))).toBe(true)
      const native = await page.getTextContent()
      expect(native.items.some((item) => 'str' in item && item.str === 'TEST page 1 before image')).toBe(true)
    } finally { await document.destroy() }
  })
  it('preserves both pages and sends each embedded image once as a real PNG in reading order', async () => {
    const provider = new FakeProvider([{ text: 'TEST first image transcription' }, { text: 'TEST second image transcription' }])
    const adapter = createModelOcrAdapter(provider), parts: string[] = []
    for await (const part of planPdfExtraction(testPdf(true))) {
      if (part.kind === 'text') parts.push(part.text)
      else parts.push((await adapter.recognize(part.png, 'image/png')).text)
    }
    expect(provider.calls).toHaveLength(2)
    const images = provider.calls.map((call) => call.messages[0]?.images?.[0])
    expect(images.every((image) => image?.mediaType === 'image/png')).toBe(true)
    for (const image of images) expect(Buffer.from(image!.base64, 'base64').subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(images[0]?.base64).not.toBe(images[1]?.base64)
    const text = parts.join('\n')
    const expected = ['TEST page 1 before image', 'TEST first image transcription', 'TEST page 1 after image', 'TEST page 2 before image', 'TEST second image transcription', 'TEST page 2 after image']
    const positions = expected.map((part) => text.indexOf(part))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })
  it.each(['xobject', 'inline', 'mask', 'colored-mask', 'alpha'] as const)('encodes actual %s decoded pixels as valid PNG without dropping transparency', async (format) => {
    const images = []
    for await (const part of planPdfExtraction(testPdf(true, format))) if (part.kind === 'image') images.push(part)
    expect(images).toHaveLength(2)
    for (const [index, image] of images.entries()) {
      expect(image.width).toBe(2); expect(image.height).toBe(2)
      const { data, info } = await sharp(image.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      expect(info.channels).toBe(4)
      if (format === 'mask' || format === 'colored-mask') {
        const rgb = format === 'colored-mask' ? [51, 102, 153] : [0, 0, 0]
        expect([...data]).toEqual([0, 255, 255, 0].flatMap((alpha) => [...rgb, alpha]))
      }
      else {
        const rgb = index === 0 ? [255, 0, 0] : [0, 0, 255]
        const alpha = format === 'alpha' ? [0, 64, 128, 255] : [255, 255, 255, 255]
        expect([...data]).toEqual(alpha.flatMap((value) => [...rgb, value]))
      }
    }
  })
  it('retains every one of twelve image placements on each page without count truncation', async () => {
    const images = []
    for await (const part of planPdfExtraction(testPdf(true, 'repeat'))) if (part.kind === 'image') images.push(part)
    expect(images).toHaveLength(24)
    expect(images.filter((image) => image.page === 1).map((image) => image.ordinal)).toEqual(Array.from({ length: 12 }, (_, index) => index))
    expect(new Set(images.filter((image) => image.page === 1).map((image) => image.imageHash)).size).toBe(1)
  })
  it('places translated Form XObject images between their surrounding native text', async () => {
    const parts = []
    for await (const part of planPdfExtraction(testPdf(true, 'form'))) parts.push(part)
    expect(parts.filter((part) => part.page === 1).map((part) => part.kind === 'image' ? 'image' : part.text.trim())).toEqual(['TEST page 1 before image', 'image', 'TEST page 1 after image'])
  })
  it('renders vector-only chart pages as supplemental valid PNGs after their native text', async () => {
    const parts = []
    for await (const part of planPdfExtraction(testPdf(false, 'vector'))) parts.push(part)
    const images = parts.filter((part) => part.kind === 'image')
    expect(images).toHaveLength(2)
    for (const page of [1, 2]) expect(parts.filter((part) => part.page === page).at(-1)).toMatchObject({ kind: 'image', ordinal: 0, role: 'page-visual' })
    for (const image of images) {
      const { data, info } = await sharp(image.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      expect(info.width).toBe(1224); expect(info.height).toBe(1584)
      const offset = 4 * (244 * info.width + 140)
      expect(data[offset]).toBe(0); expect(data[offset + 1]).toBeGreaterThan(170); expect(data[offset + 1]).toBeLessThan(190); expect(data[offset + 2]).toBe(0); expect(data[offset + 3]).toBe(255)
    }
  })
  it.each(['vector-alpha', 'vector-repeat', 'vector-crop'] as const)('retains embedded analyses and renders %s inside full-page boundaries', async (format) => {
    const parts = []
    for await (const part of planPdfExtraction(testPdf(true, format))) parts.push(part)
    const embedded = parts.filter((part) => part.kind === 'image' && part.role === 'embedded')
    expect(embedded).toHaveLength(format === 'vector-repeat' ? 24 : 2)
    for (const page of [1, 2]) {
      const visual = parts.find((part) => part.page === page && part.kind === 'image' && part.role === 'page-visual')
      expect(visual).toMatchObject({ width: 1224, height: 1584, ordinal: format === 'vector-repeat' ? 12 : 1 })
      if (!visual || visual.kind !== 'image') throw new Error('TEST missing page visual')
      const { data, info } = await sharp(visual.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const pixel = (x: number, y: number) => [...data.subarray(4 * (y * info.width + x), 4 * (y * info.width + x) + 4)]
      if (format === 'vector-alpha') {
        expect(pixel(90, 194)).toEqual([255, 255, 255, 255])
        const right = pixel(190, 194), foreground = page === 1 ? 0 : 2
        expect(right[foreground]).toBe(255)
        for (const channel of [0, 1, 2].filter((index) => index !== foreground)) expect(right[channel]).toBeGreaterThanOrEqual(190)
      } else {
        expect(pixel(90, 194)).toEqual(page === 1 ? [255, 0, 0, 255] : [0, 0, 255, 255])
        if (format === 'vector-crop') expect(pixel(190, 194)).toEqual([255, 255, 255, 255])
      }
      expect(pixel(550, 244)).toEqual([0, 178, 0, 255])
    }
  })
  it('indexes a zero-image two-page native PDF without any provider calls', async () => {
    const provider = new FakeProvider([])
    const adapter = createModelOcrAdapter(provider), native: string[] = []
    for await (const part of planPdfExtraction(testPdf(false))) {
      if (part.kind === 'text') native.push(part.text)
      else await adapter.recognize(part.png, 'image/png')
    }
    expect(provider.calls).toEqual([])
    const text = native.join('\n')
    for (const page of [1, 2]) expect(text).toContain(`TEST page ${page} before image`)
  })
})

describe('PDFJS optimized-operator doubles (encoding proof, not real parser optimization)', () => {
  it('rejects an oversized vector page before renderer allocation', async () => {
    const { OPS } = await getResolvedPDFJS()
    const document = operatorDocument([[OPS.fill, []]], {}, { width: 10000, height: 10000 })
    const before = vi.mocked(renderPageAsImage).mock.calls.length
    vi.mocked(getDocumentProxy).mockResolvedValueOnce(document as never)
    const consume = async () => { for await (const _part of planPdfExtraction(testPdf(false))) { /* consume */ } }
    await expect(consume()).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('8,000,000 pixels') })
    expect(vi.mocked(renderPageAsImage).mock.calls.length).toBe(before)
    expect(document.destroy).toHaveBeenCalledOnce()
  })
  it('cancels a hung vector render without yielding a phantom page visual and destroys its proxy', async () => {
    const { OPS } = await getResolvedPDFJS()
    const document = operatorDocument([[OPS.fill, []]])
    let started: () => void = () => undefined
    const rendering = new Promise<void>((resolve) => { started = resolve })
    vi.mocked(getDocumentProxy).mockResolvedValueOnce(document as never)
    vi.mocked(renderPageAsImage).mockImplementationOnce(async () => { started(); return new Promise<never>(() => undefined) })
    const abort = new AbortController(), iterator = planPdfExtraction(testPdf(false), { signal: abort.signal })
    const next = iterator.next()
    await rendering; abort.abort()
    await expect(next).rejects.toMatchObject({ code: 'conflict' })
    expect(document.destroy).toHaveBeenCalledOnce()
  })
  it('expands repeat operators into each stable placement with valid encoded pixels', async () => {
    const { OPS } = await getResolvedPDFJS()
    const document = operatorDocument([[OPS.paintImageXObjectRepeat, ['TEST-image', 1, 1, new Float32Array([0, 0, 1, 0])]]], { 'TEST-image': { width: 1, height: 1, kind: 2, data: new Uint8Array([255, 0, 0]) } })
    vi.mocked(getDocumentProxy).mockResolvedValueOnce(document as never)
    const images = []
    for await (const part of planPdfExtraction(testPdf(false))) if (part.kind === 'image') images.push(part)
    expect(images.map((image) => image.ordinal)).toEqual([0, 1])
    expect(images[0]!.imageHash).toBe(images[1]!.imageHash)
    expect(await sharp(images[0]!.png).raw().toBuffer()).toEqual(Buffer.from([255, 0, 0]))
    expect(document.destroy).toHaveBeenCalledOnce()
  })
  it.each(['repeat', 'group'] as const)('encodes packed-bit image-mask %s placements with their fill color and alpha', async (kind) => {
    const { OPS } = await getResolvedPDFJS()
    const mask = { width: 1, height: 1, data: new Uint8Array([0]) }
    const image = { width: 1, height: 1, data: 'TEST-mask' }
    const operation: [number, unknown[]] = kind === 'repeat' ? [OPS.paintImageMaskXObjectRepeat, [image, 1, 0, 0, 1, new Float32Array([0, 0, 1, 0])]] : [OPS.paintImageMaskXObjectGroup, [[{ ...image, transform: [1, 0, 0, 1, 0, 0] }, { ...image, transform: [1, 0, 0, 1, 1, 0] }]]]
    const document = operatorDocument([[OPS.setFillRGBColor, [20, 30, 40]], operation], { 'TEST-mask': mask })
    vi.mocked(getDocumentProxy).mockResolvedValueOnce(document as never)
    const images = []
    for await (const part of planPdfExtraction(testPdf(false))) if (part.kind === 'image') images.push(part)
    expect(images).toHaveLength(2)
    for (const image of images) expect(await sharp(image.png).raw().toBuffer()).toEqual(Buffer.from([20, 30, 40, 255]))
  })
  it('extracts each inline atlas member separately with the correct source pixels', async () => {
    const { OPS } = await getResolvedPDFJS()
    const atlas = { width: 2, height: 1, kind: 2, data: new Uint8Array([255, 0, 0, 0, 0, 255]) }
    const members = [{ transform: [1, 0, 0, 1, 0, 0], x: 0, y: 0, w: 1, h: 1 }, { transform: [1, 0, 0, 1, 1, 0], x: 1, y: 0, w: 1, h: 1 }]
    const document = operatorDocument([[OPS.paintInlineImageXObjectGroup, [atlas, members]]])
    vi.mocked(getDocumentProxy).mockResolvedValueOnce(document as never)
    const images = []
    for await (const part of planPdfExtraction(testPdf(false))) if (part.kind === 'image') images.push(part)
    expect(images).toHaveLength(2)
    expect(await sharp(images[0]!.png).raw().toBuffer()).toEqual(Buffer.from([255, 0, 0]))
    expect(await sharp(images[1]!.png).raw().toBuffer()).toEqual(Buffer.from([0, 0, 255]))
  })
  it('fails declared oversized raster dimensions before Sharp encoding and cleans up its owned proxy', async () => {
    const { OPS } = await getResolvedPDFJS()
    const document = operatorDocument([[OPS.paintInlineImageXObject, [{ width: PDF_IMAGE_MAX_PIXELS + 1, height: 1, kind: 2, data: new Uint8Array() }]]])
    vi.mocked(getDocumentProxy).mockResolvedValueOnce(document as never)
    const consume = async () => { for await (const _part of planPdfExtraction(testPdf(false))) { /* consume */ } }
    await expect(consume()).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('pixel limit') })
    expect(document.destroy).toHaveBeenCalledOnce()
  })
  it('rejects a valid raster whose encoded PNG exceeds the byte budget', async () => {
    const { OPS } = await getResolvedPDFJS()
    const data = new Uint8Array(2000 * 1600 * 3)
    let seed = 123456789
    for (let index = 0; index < data.length; index++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; data[index] = seed & 255 }
    const document = operatorDocument([[OPS.paintInlineImageXObject, [{ width: 2000, height: 1600, kind: 2, data }]]])
    vi.mocked(getDocumentProxy).mockResolvedValueOnce(document as never)
    const consume = async () => { for await (const _part of planPdfExtraction(testPdf(false))) { /* consume */ } }
    await expect(consume()).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('8,388,608 bytes') })
    expect(document.destroy).toHaveBeenCalledOnce()
  })
  it('rejects an unavailable/unsupported raster instead of silently skipping image content', async () => {
    const { OPS } = await getResolvedPDFJS()
    const document = operatorDocument([[OPS.paintImageXObject, ['TEST unavailable image']]])
    vi.mocked(getDocumentProxy).mockResolvedValueOnce(document as never)
    const consume = async () => { for await (const _part of planPdfExtraction(testPdf(false))) { /* consume */ } }
    await expect(consume()).rejects.toMatchObject({ code: 'conflict' })
    expect(document.destroy).toHaveBeenCalledOnce()
  })
})


// Opt-in operating measurement; never provider/archive/database work.
describe.skipIf(process.env['KARDATA_PDF_MEMORY_TEST'] !== '1')('real decoded-memory operating envelope', () => {
  it('visits near-cap repeated images with at most two concurrent parsers and cleans up cancellation', async () => {
    const actual = await vi.importActual<typeof import('unpdf')>('unpdf')
    const results: Record<string, unknown>[] = []
    const memory = () => ({ ...process.memoryUsage() })
    const consume = async (bytes: Buffer, placements: number, cancel: boolean) => {
      const document = await actual.getDocumentProxy(new Uint8Array(bytes))
      const destroy = vi.spyOn(document, 'destroy')
      const page = await document.getPage(1)
      const cleanup = vi.spyOn(page, 'cleanup')
      vi.mocked(getDocumentProxy).mockResolvedValueOnce(document)
      const abort = new AbortController()
      let images = 0, hash: string | undefined
      const iterator = planPdfExtraction(bytes, { signal: abort.signal })
      try {
        for await (const part of iterator) {
          if (part.kind !== 'image') continue
          expect(part).toMatchObject({ page: 1, ordinal: images, width: 3000, height: 2666 })
          expect(part.png.byteLength).toBeLessThanOrEqual(8 * 1024 * 1024)
          if (images === 0) {
            hash = part.imageHash
            expect(await sharp(part.png).resize(1, 1).removeAlpha().raw().toBuffer()).toEqual(Buffer.from([17, 34, 51]))
          } else expect(part.imageHash).toBe(hash)
          images++
          if (cancel) abort.abort()
        }
        expect(cancel).toBe(false)
      } catch (error) {
        if (!cancel) throw error
        expect(error).toMatchObject({ code: 'conflict' })
      }
      expect(images).toBe(cancel ? 1 : placements)
      expect(destroy).toHaveBeenCalledOnce()
      if (!cancel) expect(cleanup).toHaveBeenCalledOnce()
      return { images, imageHash: hash, destroyCalls: destroy.mock.calls.length, pageCleanupCalls: cleanup.mock.calls.length }
    }
    for (const placements of [1, 10, 100]) for (const concurrent of [1, 2]) {
      const bytes = stressImagePdf(placements)
      expect(bytes.length).toBeLessThan(8 * 1024 * 1024)
      const baseline = memory(), peak = { ...baseline }, start = performance.now()
      const sample = () => {
        const now = memory()
        for (const key of Object.keys(peak) as Array<keyof typeof peak>) peak[key] = Math.max(peak[key], now[key])
      }
      const timer = setInterval(sample, 10)
      try {
        const jobs = await Promise.all(Array.from({ length: concurrent }, () => consume(bytes, placements, false)))
        sample()
        results.push({ placements, concurrent, originalBytes: bytes.length, originalHash: createHash('sha256').update(bytes).digest('hex'), elapsedMs: performance.now() - start, baseline, observedPeak: peak, processLifetimeMaxRssKiB: process.resourceUsage().maxRSS, postCleanup: memory(), jobs })
      } finally { clearInterval(timer) }
    }
    const cancellation = await consume(stressImagePdf(100), 100, true)
    mkdirSync(new URL('../../backend/test-results/', import.meta.url), { recursive: true })
    writeFileSync(new URL('../../backend/test-results/pdf-decoded-memory.json', import.meta.url), JSON.stringify({ schema: 1, measuredAt: new Date().toISOString(), node: process.version, platform: platform(), arch: arch(), cpuModel: cpus()[0]?.model, cpuCount: cpus().length, totalMemoryBytes: totalmem(), sampleIntervalMs: 10, pixelsPerImage: 3000 * 2666, limits: 'Observed process memory; includes runtime and native buffers. external/arrayBuffers report Node-tracked native allocations, not all Sharp/PDFJS native memory. Sampling can miss transients; no hard RSS guarantee.', results, cancellation }, null, 2))
  }, 120_000)
})
