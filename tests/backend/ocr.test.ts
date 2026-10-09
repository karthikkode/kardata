// Model-backed OCR over the existing provider credential: no new key, no
// new endpoint. FakeProvider stands in for the vision model; the wire test
// in agents proves the image part shape.
import { describe, expect, it } from 'vitest'
import { FakeProvider } from '@kardata/agents'
import { createModelOcrAdapter, MODEL_OCR_CONFIDENCE } from '../../backend/src/ocr.js'
import { extractFileUnits } from '../../backend/src/db/file-pipeline.js'

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-image-bytes'),
])

describe('createModelOcrAdapter [F:db.file_pipeline.extractFileUnits]', () => {
  it('transcribes through a vision chat call carrying the image', async () => {
    const provider = new FakeProvider([{ text: 'printed words' }])
    const adapter = createModelOcrAdapter(provider)
    const result = await adapter.recognize(new Uint8Array(PNG), 'image/png')
    expect(result.text).toBe('printed words')
    expect(result.confidence).toBe(MODEL_OCR_CONFIDENCE)
    const sent = provider.calls[0]
    expect(sent?.tools).toEqual([])
    expect(sent?.messages[0]?.images).toEqual([
      { mediaType: 'image/png', base64: PNG.toString('base64') },
    ])
  })

  it('rejects an empty transcript so the pipeline degrades', async () => {
    const adapter = createModelOcrAdapter(new FakeProvider([{ text: '   ' }]))
    await expect(adapter.recognize(new Uint8Array(PNG), 'image/png')).rejects.toThrow('no transcript')
  })

  it('degrades a throwing vision backend to needs-ocr', async () => {
    const adapter = createModelOcrAdapter(new FakeProvider([{ error: 'vision rejected', retryable: false }]))
    const extraction = await extractFileUnits('scan.png', PNG, adapter)
    expect(extraction.status).toBe('needs-ocr')
    expect(extraction.detail).toContain('OCR unavailable')
  })
})
