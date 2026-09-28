// File pipeline (Phase A of the sector context plan). Pure unit tests: no
// database, no network, no OCR endpoint. Covers content-sniffed
// classification, paragraph-boundary chunking, image/OCR routing, and the
// invariant that raw file bytes never reach provider-shaped output.
import { describe, expect, it } from 'vitest'
import {
  chunkTextUnits,
  classifyUpload,
  extractFileUnits,
  OCR_CONFIDENCE_MIN,
  ScriptedOcrAdapter,
} from '../../backend/src/db/file-pipeline.js'

const bytes = (text: string): Buffer => Buffer.from(text, 'utf8')
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

describe('classifyUpload', () => {
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
