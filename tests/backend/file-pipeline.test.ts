// File pipeline (Phase A of the sector context plan). Pure unit tests: no
// database, no network, no OCR endpoint. Covers content-sniffed
// classification, paragraph-boundary chunking, image/OCR routing, and the
// invariant that raw file bytes never reach provider-shaped output.
import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import * as pdf from 'unpdf'
vi.mock('unpdf', async (original) => {
  const actual = await original<typeof import('unpdf')>()
  return { ...actual, extractText: vi.fn(actual.extractText), getDocumentProxy: vi.fn(actual.getDocumentProxy), extractImages: vi.fn(actual.extractImages) }
})
import {
  chunkTextUnits,
  classifyUpload,
  createHttpOcrAdapter,
  extractFileUnits,
  OCR_CONFIDENCE_MIN,
  ScriptedOcrAdapter,
  UNIT_MAX_CHARS,
  SECTOR_DOCUMENT_MAX_BYTES,
} from '../../backend/src/db/file-pipeline.js'

const bytes = (text: string): Buffer => Buffer.from(text, 'utf8')
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

describe('classifyUpload [F:db.file_pipeline.extractFileUnits] [F:db.file_pipeline.chunkTextUnits] [F:db.file_pipeline.classifyUpload] [F:db.file_pipeline.createHttpOcrAdapter] [F:db.file_pipeline.OCR_CONFIDENCE_MIN] [F:db.file_pipeline.ScriptedOcrAdapter] [F:db.file_pipeline.UNIT_MAX_CHARS] [F:db.file_pipeline.SECTOR_DOCUMENT_MAX_BYTES] [F:db.index.classifyUpload]', () => {
  it('sniffs magic bytes ahead of the extension', () => {
    expect(classifyUpload('notes.txt', PNG_MAGIC).kind).toBe('image')
    expect(classifyUpload('photo.png', PNG_MAGIC).kind).toBe('image')
    expect(classifyUpload('photo.jpg', JPEG_MAGIC).kind).toBe('image')
    expect(classifyUpload('doc.pdf', Buffer.concat([Buffer.from('%PDF-1.7\n'), bytes('x')])).kind).toBe('pdf')
    expect(classifyUpload('notes.md', bytes('# hello')).kind).toBe('text')
  })

  it('rejects unsupported types naming what is supported', () => {
    const classified = classifyUpload('deck.pptx', bytes('junk'))
    expect(classified.kind).toBe('unsupported')
    expect(classified.reason).toContain('.md')
  })
})

describe('chunkTextUnits', () => {
  it.each([1998, 1999, 2000, 2001])('keeps supplementary codepoints intact at a hard-cut boundary after %s UTF16 units', (prefix) => {
    const text = 'A'.repeat(prefix) + '🙂' + 'B'.repeat(2200) + '𠮷'
    const units = chunkTextUnits(text)
    expect(units.map((unit) => unit.text).join('')).toBe(text)
    expect(units.every((unit) => unit.text.length <= UNIT_MAX_CHARS && !/[\uD800-\uDFFF]/u.test(unit.text))).toBe(true)
    expect(units.map((unit) => unit.ord)).toEqual(units.map((_, index) => index))
  })
  it('retains normal paragraph packing and small valid budgets', () => {
    expect(chunkTextUnits('TEST first\n\nTEST second').map((unit) => unit.text)).toEqual(['TEST first\n\nTEST second'])
    expect(chunkTextUnits('ABC', 1).map((unit) => unit.text)).toEqual(['A', 'B', 'C'])
    expect(() => chunkTextUnits('🙂', 1)).toThrow('cannot fit')
  })
  it('rejects nonpositive, noninteger and over-cap budgets in an isolated bounded process', () => {
    const root = join(import.meta.dirname, '../..')
    const text = readFileSync(join(root, 'backend/src/db/file-pipeline.ts'), 'utf8')
    const source = ts.createSourceFile('file-pipeline.ts', text, ts.ScriptTarget.Latest, true)
    const declarations = source.statements.filter((node) => ts.isFunctionDeclaration(node) && ['chunkTextUnits', 'unitKind'].includes(node.name?.text ?? '') || ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'UNIT_MAX_CHARS')).map((node) => node.getFullText(source)).join('\n')
    const errors = readFileSync(join(root, 'backend/src/db/errors.ts'), 'utf8')
    const js = ts.transpileModule(`${errors}\n${declarations}`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    const program = `${js}\nconst outcomes = [0,-1,0.5,NaN,Infinity,2001].map(cap => { try {chunkTextUnits('TEST',cap); return 'accepted';} catch(error) {return error.code;} }); console.log(JSON.stringify(outcomes));`
    const output = execFileSync(process.execPath, ['--max-old-space-size=64', '--input-type=module', '-e', program], { encoding: 'utf8', timeout: 2000, maxBuffer: 4096 })
    expect(JSON.parse(output)).toEqual(Array.from({ length: 6 }, () => 'db_contract'))
  })
  it('splits on paragraph boundaries within the char cap', () => {
    const text = ['para one is here', 'para two is here', 'para three is here'].join('\n\n')
    const units = chunkTextUnits(text, 30)
    expect(units.length).toBeGreaterThan(1)
    expect(units.every((unit) => unit.text.length <= 30)).toBe(true)
    expect(units.map((unit) => unit.ord)).toEqual(units.map((_, index) => index))
    expect(units.join(' ')).not.toContain('  ')
  })
})

describe('extractFileUnits', () => {
  it('times out a hung OCR response body and cancels its reader', async () => {
    let cancelled = false
    const response = new Response(new ReadableStream({ cancel() { cancelled = true } }))
    const adapter = createHttpOcrAdapter({ endpoint: 'https://TEST.example/ocr', timeoutMs: 10, fetchFn: vi.fn(async () => response) })
    const extraction = await extractFileUnits('TEST.png', PNG_MAGIC, adapter)
    expect(extraction.detail).toContain('ocr_timeout')
    expect(cancelled).toBe(true)
    expect(extraction.units).toEqual([])
  })
  it('bounds a transport ignoring abort and disposes its late response', async () => {
    let resolveResponse: (response: Response) => void = () => undefined
    let cancelled = false
    const pending = new Promise<Response>((resolve) => { resolveResponse = resolve })
    const adapter = createHttpOcrAdapter({ endpoint: 'https://TEST.example/ocr', timeoutMs: 10, fetchFn: vi.fn(() => pending) })
    const extraction = await extractFileUnits('TEST.png', PNG_MAGIC, adapter)
    expect(extraction.detail).toContain('ocr_timeout')
    resolveResponse(new Response(new ReadableStream({ cancel() { cancelled = true } })))
    await Promise.resolve()
    expect(cancelled).toBe(true)
  })
  it('cancels an oversized streaming OCR response before reading all its bytes', async () => {
    let chunks = 0, cancelled = false
    const response = new Response(new ReadableStream({
      pull(controller) {
        chunks += 1
        controller.enqueue(new TextEncoder().encode(chunks === 1 ? '{"text":"TEST","padding":"' : chunks <= 12 ? 'A'.repeat(1024 * 1024) : '"}'))
        if (chunks === 13) controller.close()
      },
      cancel() { cancelled = true },
    }))
    const extraction = await extractFileUnits('TEST.png', PNG_MAGIC, createHttpOcrAdapter({ endpoint: 'https://TEST.example/ocr', fetchFn: vi.fn(async () => response) }))
    expect(extraction.status).toBe('needs-ocr')
    expect(extraction.detail).toContain('ocr_limit')
    expect(cancelled).toBe(true)
    expect(chunks).toBeLessThan(13)
  })
  it.each([NaN, Infinity, -0.1, 1.1])('rejects invalid OCR confidence %s instead of losing provenance during JSON serialization', async (confidence) => {
    const extraction = await extractFileUnits('TEST.png', PNG_MAGIC, { recognize: async () => ({ text: 'TEST transcript', confidence }) })
    expect(extraction.status).toBe('needs-ocr')
    expect(extraction.detail).toContain('ocr_invalid_response')
    expect(extraction.units).toEqual([])
  })
  it.each([null, 'TEST invalid', -1, 2])('rejects malformed HTTP OCR confidence %s', async (confidence) => {
    const adapter = createHttpOcrAdapter({ endpoint: 'https://TEST.example/ocr', fetchFn: vi.fn(async () => new Response(JSON.stringify({ text: 'TEST transcript', confidence }))) })
    const extraction = await extractFileUnits('TEST.png', PNG_MAGIC, adapter)
    expect(extraction.status).toBe('needs-ocr')
    expect(extraction.detail).toContain('ocr_invalid_response')
  })
  it('retains the documented default confidence when the HTTP response omits it', async () => {
    const adapter = createHttpOcrAdapter({ endpoint: 'https://TEST.example/ocr', fetchFn: vi.fn(async () => new Response(JSON.stringify({ text: 'TEST transcript' }))) })
    expect(await adapter.recognize(PNG_MAGIC, 'image/png')).toEqual({ text: 'TEST transcript', confidence: 1 })
  })
  it('bounds aggregate scanned-PDF OCR text without publishing a partial transcript', async () => {
    vi.mocked(pdf.extractText).mockResolvedValueOnce({ text: '', totalPages: 1 } as never)
    vi.mocked(pdf.getDocumentProxy).mockResolvedValueOnce({ numPages: 1 } as never)
    vi.mocked(pdf.extractImages).mockResolvedValueOnce(Array.from({ length: 2 }, () => ({ data: new Uint8Array([1]) })) as never)
    const recognize = vi.fn(async () => ({ text: 'A'.repeat(SECTOR_DOCUMENT_MAX_BYTES / 2 + 1), confidence: 0.9 }))
    const extraction = await extractFileUnits('TEST.pdf', Buffer.from('%PDF-TEST'), { recognize })
    expect(extraction.status).toBe('needs-ocr')
    expect(extraction.units).toEqual([])
    expect(extraction.detail).toContain('ocr_limit')
  })
  it('keeps OCR transport secrets and response bodies out of returned failure details', async () => {
    const secret = 'TEST private OCR token and response body'
    const adapter = createHttpOcrAdapter({ endpoint: 'https://TEST-private.example/ocr', apiKey: secret, fetchFn: vi.fn(async () => { throw new Error(secret + ' https://TEST-private.example/ocr') }) })
    const extraction = await extractFileUnits('TEST.png', PNG_MAGIC, adapter)
    expect(extraction.status).toBe('needs-ocr')
    expect(extraction.detail).not.toContain(secret)
    expect(extraction.detail).not.toContain('TEST-private.example')
    expect(extraction.detail).toContain('ocr_transport_failed')
    const providerFailure = await extractFileUnits('TEST.png', PNG_MAGIC, { recognize: async () => { throw new Error(secret) } })
    expect(providerFailure.detail).not.toContain(secret)
    expect(providerFailure.detail).toContain('ocr_failed')
  })
  it('retains safe OCR HTTP failure status without exposing arbitrary error text', async () => {
    const adapter = createHttpOcrAdapter({ endpoint: 'https://TEST.example/ocr', fetchFn: vi.fn(async () => new Response('TEST private body', { status: 502 })) })
    const extraction = await extractFileUnits('TEST.png', PNG_MAGIC, adapter)
    expect(extraction.detail).toContain('ocr_http_failed')
    expect(extraction.detail).toContain('502')
    expect(extraction.detail).not.toContain('TEST private body')
  })
  it('chunks long image OCR in reading order with confidence and uncertainty on every unit', async () => {
    const text = 'A'.repeat(UNIT_MAX_CHARS) + 'B'.repeat(UNIT_MAX_CHARS) + 'C'
    const extraction = await extractFileUnits('TEST.png', PNG_MAGIC, new ScriptedOcrAdapter([{ text, confidence: 0.1 }]))
    expect(extraction.units).toHaveLength(3)
    expect(extraction.units.map((unit) => unit.text).join('')).toBe(text)
    expect(extraction.units.every((unit) => unit.text.length <= UNIT_MAX_CHARS && unit.kind === 'ocr' && unit.confidence === 0.1 && unit.uncertain)).toBe(true)
    expect(extraction.units.map((unit) => unit.ord)).toEqual([0, 1, 2])
  })
  it('caps OCR image attempts independently of PDF transcript chunks and keeps global unit order', async () => {
    vi.mocked(pdf.extractText).mockResolvedValueOnce({ text: '', totalPages: 1 } as never)
    vi.mocked(pdf.getDocumentProxy).mockResolvedValueOnce({ numPages: 1 } as never)
    vi.mocked(pdf.extractImages).mockResolvedValueOnce(Array.from({ length: 10 }, () => ({ data: new Uint8Array([1]) })) as never)
    let image = 0
    const recognize = vi.fn(async () => ({ text: String(image++).repeat(UNIT_MAX_CHARS + 1), confidence: 0.9 }))
    try {
      const extraction = await extractFileUnits('TEST.pdf', Buffer.from('%PDF-TEST'), { recognize })
      expect(recognize).toHaveBeenCalledTimes(10)
      expect(extraction.status).toBe('indexed')
      expect(extraction.units).toHaveLength(20)
      expect(extraction.units.every((unit) => unit.text.length <= UNIT_MAX_CHARS && unit.confidence === 0.9)).toBe(true)
      expect(extraction.units.map((unit) => unit.ord)).toEqual(Array.from({ length: 20 }, (_, index) => index))
      expect(extraction.units.map((unit) => unit.text).join('')).toBe(Array.from({ length: 10 }, (_, index) => String(index).repeat(UNIT_MAX_CHARS + 1)).join(''))
    } finally { vi.restoreAllMocks() }
  })
  it('does not exceed the scanned-PDF OCR budget when every attempted image fails', async () => {
    vi.mocked(pdf.extractText).mockResolvedValueOnce({ text: '', totalPages: 1 } as never)
    vi.mocked(pdf.getDocumentProxy).mockResolvedValueOnce({ numPages: 1 } as never)
    vi.mocked(pdf.extractImages).mockResolvedValueOnce(Array.from({ length: 12 }, () => ({ data: new Uint8Array([1]) })) as never)
    const recognize = vi.fn(async () => { throw new Error('TEST private OCR body') })
    const extraction = await extractFileUnits('TEST.pdf', Buffer.from('%PDF-TEST'), { recognize })
    expect(recognize.mock.calls.length).toBeLessThanOrEqual(10)
    expect(extraction.status).toBe('needs-ocr')
    expect(extraction.units).toEqual([])
    expect(extraction.detail).not.toContain('TEST private OCR body')
  })
  it('keeps a twelve-image scanned PDF Needs OCR instead of certifying the first ten images', async () => {
    vi.mocked(pdf.extractText).mockResolvedValueOnce({ text: '', totalPages: 1 } as never)
    vi.mocked(pdf.getDocumentProxy).mockResolvedValueOnce({ numPages: 1 } as never)
    vi.mocked(pdf.extractImages).mockResolvedValueOnce(Array.from({ length: 12 }, () => ({ data: new Uint8Array([1]) })) as never)
    const recognize = vi.fn(async () => ({ text: 'TEST partial transcript', confidence: 0.9 }))
    const extraction = await extractFileUnits('TEST.pdf', Buffer.from('%PDF-TEST'), { recognize })
    expect(extraction.status).toBe('needs-ocr')
    expect(extraction.units).toEqual([])
    expect(extraction.detail).toContain('ocr_limit')
    expect(recognize.mock.calls.length).toBeLessThanOrEqual(10)
  })
  it('does not publish partial PDF units when another image OCR fails', async () => {
    vi.mocked(pdf.extractText).mockResolvedValueOnce({ text: '', totalPages: 1 } as never)
    vi.mocked(pdf.getDocumentProxy).mockResolvedValueOnce({ numPages: 1 } as never)
    vi.mocked(pdf.extractImages).mockResolvedValueOnce(Array.from({ length: 2 }, () => ({ data: new Uint8Array([1]) })) as never)
    const recognize = vi.fn().mockResolvedValueOnce({ text: 'TEST first image', confidence: 0.9 }).mockRejectedValueOnce(new Error('TEST private second image error'))
    const extraction = await extractFileUnits('TEST.pdf', Buffer.from('%PDF-TEST'), { recognize })
    expect(extraction.status).toBe('needs-ocr')
    expect(extraction.units).toEqual([])
    expect(extraction.detail).toContain('ocr_failed')
    expect(extraction.detail).not.toContain('TEST private')
  })
  it('does not certify scanned-PDF coverage after a page image extraction error', async () => {
    vi.mocked(pdf.extractText).mockResolvedValueOnce({ text: '', totalPages: 2 } as never)
    vi.mocked(pdf.getDocumentProxy).mockResolvedValueOnce({ numPages: 2 } as never)
    vi.mocked(pdf.extractImages).mockResolvedValueOnce([{ data: new Uint8Array([1]) }] as never).mockRejectedValueOnce(new Error('TEST private PDF page error'))
    const extraction = await extractFileUnits('TEST.pdf', Buffer.from('%PDF-TEST'), new ScriptedOcrAdapter([{ text: 'TEST first page', confidence: 0.9 }]))
    expect(extraction.status).toBe('needs-ocr')
    expect(extraction.units).toEqual([])
    expect(extraction.detail).toContain('ocr_coverage_incomplete')
    expect(extraction.detail).not.toContain('TEST private')
  })
  it('does not ignore nonempty later pages after the ten-image budget is reached', async () => {
    vi.mocked(pdf.extractText).mockResolvedValueOnce({ text: '', totalPages: 2 } as never)
    vi.mocked(pdf.getDocumentProxy).mockResolvedValueOnce({ numPages: 2 } as never)
    vi.mocked(pdf.extractImages).mockResolvedValueOnce(Array.from({ length: 10 }, () => ({ data: new Uint8Array([1]) })) as never).mockResolvedValueOnce([{ data: new Uint8Array([1]) }] as never)
    const recognize = vi.fn(async () => ({ text: 'TEST first page image', confidence: 0.9 }))
    const extraction = await extractFileUnits('TEST.pdf', Buffer.from('%PDF-TEST'), { recognize })
    expect(extraction.status).toBe('needs-ocr')
    expect(extraction.units).toEqual([])
    expect(extraction.detail).toContain('ocr_limit')
    expect(recognize.mock.calls.length).toBeLessThanOrEqual(10)
  })
  it.each(['empty-image', 'empty-page'])('does not certify an incomplete scanned PDF with %s coverage', async (missing) => {
    vi.mocked(pdf.extractText).mockResolvedValueOnce({ text: '', totalPages: 2 } as never)
    vi.mocked(pdf.getDocumentProxy).mockResolvedValueOnce({ numPages: 2 } as never)
    vi.mocked(pdf.extractImages).mockResolvedValueOnce([{ data: new Uint8Array([1]) }] as never).mockResolvedValueOnce(missing === 'empty-page' ? [] : [{ data: new Uint8Array([1]) }] as never)
    const extraction = await extractFileUnits('TEST.pdf', Buffer.from('%PDF-TEST'), new ScriptedOcrAdapter([{ text: 'TEST first page', confidence: 0.9 }, { text: '', confidence: 0.9 }]))
    expect(extraction.status).toBe('needs-ocr')
    expect(extraction.units).toEqual([])
    expect(extraction.detail).toContain('ocr_coverage_incomplete')
  })
  it('reads markdown directly into text units', async () => {
    const extraction = await extractFileUnits('notes.md', bytes('# Title\n\nBody text here.'))
    expect(extraction.status).toBe('indexed')
    expect(extraction.units.length).toBeGreaterThan(0)
    expect(extraction.units.every((unit) => unit.kind === 'text' || unit.kind === 'heading')).toBe(true)
    expect(extraction.units[0]?.kind).toBe('heading')
  })

  it('routes images through the OCR adapter and marks low confidence uncertain', async () => {
    const ocr = new ScriptedOcrAdapter([
      { text: 'printed hello', confidence: 0.9 },
      { text: 'faded words', confidence: 0.1 },
    ])
    const sharp = await extractFileUnits('a.png', PNG_MAGIC, ocr)
    expect(sharp.status).toBe('indexed')
    expect(sharp.units[0]?.text).toBe('printed hello')
    expect(sharp.units[0]?.uncertain).toBe(false)
    const faint = await extractFileUnits('b.png', PNG_MAGIC, ocr)
    expect(faint.units[0]?.uncertain).toBe(true)
    expect(OCR_CONFIDENCE_MIN).toBeGreaterThan(0.1)
  })

  it('marks images needs-ocr when no adapter is configured', async () => {
    const extraction = await extractFileUnits('scan.png', PNG_MAGIC)
    expect(extraction.status).toBe('needs-ocr')
    expect(extraction.units).toEqual([])
  })

  it('never echoes raw file bytes into extracted units', async () => {
    const secret = `raw-bytes-${Date.now()}`
    const ocr = new ScriptedOcrAdapter([{ text: 'ocr transcript only', confidence: 0.95 }])
    const extraction = await extractFileUnits(
      'secret.png',
      Buffer.concat([PNG_MAGIC, bytes(secret)]),
      ocr,
    )
    expect(extraction.status).toBe('indexed')
    for (const unit of extraction.units) {
      expect(unit.text).not.toContain(secret)
    }
  })

  it('fails corrupt binaries as failed, not as exceptions', async () => {
    const extraction = await extractFileUnits('broken.pdf', bytes('not a pdf at all'))
    expect(extraction.status).toBe('failed')
    expect(extraction.detail).toBeTruthy()
  })
})
