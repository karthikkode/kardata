// Document units index (Phase A). Live-database suite, skipped explicitly
// without TEST_DATABASE_URL. Proves ingest stores per-file units, images
// degrade to needs-ocr without an adapter, OCR fills them with one, and
// identical re-uploads alias the existing document.
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  countDocumentUnits,
  createSector,
  ingestSectorDocument,
  listDocumentUnits,
  listSectorDocuments,
  ScriptedOcrAdapter,
} from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''
const SCOPE = { tenantId: 'tenant-docunits', projectId: null }
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-image-bytes'),
])

describe.skipIf(!ENABLED)('sector document units [F:db.index.createSector] [F:db.index.ingestSectorDocument] [F:db.index.listDocumentUnits] [F:db.index.listSectorDocuments] [F:db.index.countDocumentUnits] [F:db.index.ScriptedOcrAdapter] [F:db.file_pipeline.ScriptedOcrAdapter] [F:db.sectors.createSector] [F:db.sector_documents.listSectorDocuments] [F:db.document_units.listDocumentUnits] [F:db.document_units.countDocumentUnits] [F:db.index.Db] [F:db.index.SECTOR_DOCUMENT_MAX_BYTES] [F:db.workspace.WorkspaceError] [F:db.sector_documents.hiddenFileIds] [F:db.workspace.requireSector]', () => {
  let pool: Pool | undefined
  let sectorId = ''

  beforeAll(async () => {
    if (!ENABLED) return
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_docunits') })
    sectorId = (await createSector(pool, { name: 'units-sector', scope: SCOPE })).sectorId
    // Reads go to the projection: catch up exactly like the attach route
    // does, or the fresh sector is invisible and every ingest 404s.
    await projectNewEvents(pool)
  })

  afterAll(async () => {
    await pool?.end()
  })

  it('indexes markdown into ordered units', async () => {
    if (!ENABLED || !pool) return
    // The chunker packs paragraphs to the 2000-char cap, so multi-unit
    // content must overflow it: heading + ~1500-char para pack into unit 0,
    // the second ~1500-char para spills into unit 1.
    const body = `# Title\n\n${'First para. '.repeat(125)}\n\n${'Second para. '.repeat(115)}`
    const doc = await ingestSectorDocument(pool, {
      sectorId,
      filename: 'notes.md',
      contentBase64: Buffer.from(body).toString('base64'),
      scope: SCOPE,
    })
    expect(doc.status).toBe('indexed')
    expect(doc.unitCount).toBeGreaterThan(1)
    const units = await listDocumentUnits(pool, doc.id)
    expect(units.map((unit) => unit.ord)).toEqual(units.map((_, index) => index))
    expect(units[0]?.kind).toBe('heading')
    expect(await countDocumentUnits(pool, doc.id)).toBe(doc.unitCount)
  })
  it('publishes valid JSONB units with exact supplementary Unicode text across the two-thousand-unit boundary', async () => {
    if (!pool) throw new Error('TEST database was not initialized')
    const body = 'TEST ' + 'A'.repeat(1994) + '🙂' + '𠮷'.repeat(1100)
    const document = await ingestSectorDocument(pool, { sectorId, filename: 'TEST unicode boundary.md', contentBase64: Buffer.from(body).toString('base64'), scope: SCOPE })
    const units = await listDocumentUnits(pool, document.id)
    expect(document.status).toBe('indexed')
    expect(units.map((unit) => unit.text).join('')).toBe(body)
    expect(units.every((unit) => unit.text.length <= 2000 && !/[\uD800-\uDFFF]/u.test(unit.text))).toBe(true)
    expect(units.map((unit) => unit.ord)).toEqual(units.map((_, index) => index))
  })

  it('stores images as needs-ocr without an adapter', async () => {
    if (!ENABLED || !pool) return
    const doc = await ingestSectorDocument(pool, {
      sectorId,
      filename: 'scan.png',
      contentBase64: PNG.toString('base64'),
      scope: SCOPE,
    })
    expect(doc.status).toBe('needs-ocr')
    expect(doc.detail).toBeTruthy()
    expect(await countDocumentUnits(pool, doc.id)).toBe(0)
    const listed = await listSectorDocuments(pool, sectorId, SCOPE)
    expect(listed.find((entry) => entry.id === doc.id)?.status).toBe('needs-ocr')
  })

  it('indexes images through the OCR adapter', async () => {
    if (!ENABLED || !pool) return
    const doc = await ingestSectorDocument(pool, {
      sectorId,
      filename: 'ocr.png',
      contentBase64: PNG.toString('base64'),
      scope: SCOPE,
      ocr: new ScriptedOcrAdapter([{ text: 'printed words', confidence: 0.9 }]),
    })
    expect(doc.status).toBe('indexed')
    const units = await listDocumentUnits(pool, doc.id)
    expect(units).toHaveLength(1)
    expect(units[0]?.kind).toBe('ocr')
    expect(units[0]?.text).toBe('printed words')
  })

  it('aliases identical re-uploads to the existing document', async () => {
    if (!ENABLED || !pool) return
    const body = Buffer.from('same content here').toString('base64')
    const first = await ingestSectorDocument(pool, { sectorId, filename: 'a.md', contentBase64: body, scope: SCOPE })
    const second = await ingestSectorDocument(pool, { sectorId, filename: 'b.md', contentBase64: body, scope: SCOPE })
    expect(second.id).toBe(first.id)
    expect(second.unitCount).toBe(first.unitCount)
  })
})
