import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FilesystemTarget } from '../../backend/src/archive/targets.js'
import { createSector, ingestSectorDocument, readOriginalSectorDocument } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('document upload atomicity and retry recovery [F:db.index.createSector] [F:db.index.ingestSectorDocument] [F:db.index.readOriginalSectorDocument] [F:db.file_pipeline.extractFileUnits] [F:db.file_pipeline.sha256Hex] [F:db.sectors.createSector] [F:db.sector_documents.readOriginalSectorDocument] [F:db.workspace.WorkspaceError] [F:db.workspace.requireSector]', () => {
  let pool: Pool
  const archive = new FilesystemTarget(mkdtempSync(join(tmpdir(), 'kardata-ingest-recovery-')))
  const sectorId = `sec-${randomUUID()}`
  const content = `TEST retained first unit ${'a'.repeat(2100)}\n\nTEST index failure second unit ${'b'.repeat(2100)}`
  const contentBase64 = Buffer.from(content).toString('base64')
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_ingest_recovery') })
    await createSector(pool, { sectorId, name: 'TEST ingest recovery' }); await projectNewEvents(pool)
    await pool.query('CREATE TABLE test_ingest_fault (enabled boolean NOT NULL)')
    await pool.query('INSERT INTO test_ingest_fault VALUES (true)')
    await pool.query(`CREATE FUNCTION test_fail_document_unit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.text LIKE '%TEST index failure%' AND (SELECT enabled FROM test_ingest_fault) THEN
        RAISE EXCEPTION 'TEST index storage unavailable'; END IF; RETURN NEW; END $$`)
    await pool.query('CREATE TRIGGER test_document_unit_fault BEFORE INSERT ON sector_document_units FOR EACH ROW EXECUTE FUNCTION test_fail_document_unit()')
  })
  afterAll(async () => { await pool?.end() })

  it('does not publish a document or partial unit index when indexing fails, then retries completely', async () => {
    const input = { sectorId, filename: 'TEST recovery.md', contentBase64, archive }
    await expect(ingestSectorDocument(pool, input)).rejects.toThrow('TEST index storage unavailable')
    const partial = await pool.query('SELECT id,archive_key FROM sector_documents WHERE sector_id=$1', [sectorId])
    expect(partial.rows).toEqual([])
    await pool.query('UPDATE test_ingest_fault SET enabled=false')
    const stored = await ingestSectorDocument(pool, input)
    expect(stored.unitCount).toBeGreaterThan(1)
    const units = await pool.query('SELECT ord FROM sector_document_units WHERE document_id=$1', [stored.id])
    expect(units.rows).toHaveLength(stored.unitCount)
    expect(await readOriginalSectorDocument(pool, sectorId, stored.id, archive)).toMatchObject({ originalAvailable: true, contentBase64 })
    expect((await ingestSectorDocument(pool, input)).id).toBe(stored.id)
  })

  it('coalesces twenty concurrent identical uploads into one durable document and unit set', async () => {
    const contentBase64 = Buffer.from('TEST concurrent original body').toString('base64')
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => ingestSectorDocument(pool, { sectorId, filename: `TEST duplicate ${index}.md`, contentBase64, archive })))
    expect(new Set(results.map((result) => result.id)).size).toBe(1)
    const docs = await pool.query('SELECT id FROM sector_documents WHERE sector_id=$1 AND sha256=$2', [sectorId, results[0]!.sha256])
    expect(docs.rows).toHaveLength(1)
    const units = await pool.query('SELECT ord FROM sector_document_units WHERE document_id=$1', [results[0]!.id])
    expect(units.rows).toHaveLength(1)
    expect(await readOriginalSectorDocument(pool, sectorId, results[0]!.id, archive)).toMatchObject({ originalAvailable: true, contentBase64 })
  })

  it('adopts a legacy random ID and repairs its partial index and missing archive reference', async () => {
    const { extractFileUnits, sha256Hex } = await import('../../backend/src/db/file-pipeline.js')
    const bytes = Buffer.from(`TEST legacy unit ${'c'.repeat(2100)}\n\nTEST retained tail ${'d'.repeat(2100)}`)
    const extraction = await extractFileUnits('TEST legacy.md', bytes)
    const hash = sha256Hex(JSON.stringify({ v: 2, source: 'upload', original: bytes.toString('base64'), units: extraction.units }))
    const legacyId = `sdoc-${randomUUID()}`
    await pool.query(`INSERT INTO sector_documents(id,sector_id,filename,media_type,text,sha256,status)
      VALUES($1,$2,$3,$4,$5,$6,'indexed')`, [legacyId, sectorId, 'TEST legacy.md', extraction.mediaType, extraction.units.map((unit) => unit.text).join('\n\n'), hash])
    const first = extraction.units[0]!
    await pool.query(`INSERT INTO sector_document_units(document_id,ord,kind,text,uncertain,sha256) VALUES($1,$2,$3,$4,$5,$6)`, [legacyId, first.ord, first.kind, first.text, first.uncertain, sha256Hex(first.text)])
    const repaired = await ingestSectorDocument(pool, { sectorId, filename: 'TEST renamed legacy.md', contentBase64: bytes.toString('base64'), archive })
    expect(repaired.id).toBe(legacyId)
    expect(repaired.filename).toBe('TEST legacy.md')
    expect((await pool.query('SELECT ord FROM sector_document_units WHERE document_id=$1', [legacyId])).rows).toHaveLength(extraction.units.length)
    expect(await readOriginalSectorDocument(pool, sectorId, legacyId, archive)).toMatchObject({ originalAvailable: true, contentBase64: bytes.toString('base64') })
    expect((await pool.query('SELECT id FROM sector_documents WHERE sector_id=$1 AND sha256=$2', [sectorId, hash])).rows).toHaveLength(1)
  })

  it('does not publish a document when the archive cannot accept its original bytes', async () => {
    const failure = new Error('TEST archive offline')
    const before = await pool.query('SELECT id FROM sector_documents WHERE sector_id=$1', [sectorId])
    await expect(ingestSectorDocument(pool, { sectorId, filename: 'TEST archive failure.md', contentBase64: Buffer.from('TEST other bytes').toString('base64'), archive: { async read() { return undefined }, async write() { throw failure }, async list() { return [] } } })).rejects.toBe(failure)
    const after = await pool.query('SELECT id FROM sector_documents WHERE sector_id=$1', [sectorId])
    expect(after.rows).toEqual(before.rows)
  })
})
