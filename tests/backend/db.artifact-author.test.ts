// Artifact auto-registration attributes the authoring thread: an
// artifact created in a sector session lands as an indexed sector
// document carrying authorThread, visible in Files and readable; plain
// uploads stay unattributed; re-registration keeps the first author.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createArtifact } from '../../backend/src/db/event-artifacts.js'
import { createSector, createSession, ensureResearchSession, ingestSectorDocument, listSectorDocuments, readSectorDocument, listSectorLibrary } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('artifact author-thread attribution', () => {
  let pool: Pool
  const scope = { tenantId: 'TEST artifact author tenant', projectId: null }
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_artifact_author'), max: 5 })
    vi.stubEnv('KARDATA_GCS_BUCKET', '')
    vi.stubEnv('KARDATA_ARCHIVE_DIR', mkdtempSync(join(tmpdir(), 'kardata-artifact-author-')))
  })
  afterAll(async () => { await pool?.end(); vi.unstubAllEnvs() })

  it('registers the author thread on the indexed document and surfaces it in Files', async () => {
    const sectorId = (await createSector(pool, { name: 'TEST author sector', topic: 'author attribution', scope })).sectorId
    await projectNewEvents(pool)
    const sessionId = (await ensureResearchSession(pool, sectorId, scope)).id
    await projectNewEvents(pool)
    const body = '# agent findings\n\nTEST attributed file fact, indexed and readable.'
    const summary = await createArtifact(pool, { sessionId, name: 'agent findings.md', content: body, producedBy: `agent:TEST child`, authorThread: `agent:TEST child`, scope })
    expect(summary.indexed).toBe(true)
    const docs = await listSectorDocuments(pool, sectorId, scope, true)
    const doc = docs.find((entry) => entry.filename === 'agent findings.md')
    expect(doc?.authorThread).toBe('agent:TEST child')
    const stored = await pool.query<{ author_thread: string | null }>('SELECT author_thread FROM sector_documents WHERE id = $1', [doc!.id])
    expect(stored.rows[0]?.author_thread).toBe('agent:TEST child')
    const read = await readSectorDocument(pool, sectorId, doc!.id, scope)
    expect(read.authorThread).toBe('agent:TEST child')
    expect(read.text).toContain('TEST attributed file fact')
    const files = await listSectorLibrary(pool, sectorId, scope)
    expect(files.find((file) => file.id === doc!.id)?.authorThread).toBe('agent:TEST child')
  })

  it('defaults attribution to producedBy and leaves uploads unattributed', async () => {
    const sectorId = (await createSector(pool, { name: 'TEST author default sector', topic: 'author defaults', scope })).sectorId
    await projectNewEvents(pool)
    const sessionId = (await ensureResearchSession(pool, sectorId, scope)).id
    await projectNewEvents(pool)
    await createArtifact(pool, { sessionId, name: 'child note.md', content: 'TEST default attribution fact.', producedBy: 'agent:TEST default', scope })
    const docs = await listSectorDocuments(pool, sectorId, scope, true)
    expect(docs.find((entry) => entry.filename === 'child note.md')?.authorThread).toBe('agent:TEST default')
    const upload = await ingestSectorDocument(pool, { sectorId, filename: 'owner upload.md', contentBase64: Buffer.from('TEST owner upload fact.').toString('base64'), scope })
    expect(upload.authorThread).toBeUndefined()
  })

  it('keeps the first author when identical bytes re-register', async () => {
    const sectorId = (await createSector(pool, { name: 'TEST author keep-first sector', topic: 'author keep first', scope })).sectorId
    await projectNewEvents(pool)
    const first = await createSession(pool, 'TEST first author', scope, sectorId)
    const second = await createSession(pool, 'TEST second author', scope, sectorId)
    await projectNewEvents(pool)
    const body = 'TEST shared bytes, single author.'
    await createArtifact(pool, { sessionId: first.id, name: 'shared.md', content: body, authorThread: 'agent:TEST first', scope })
    const retry = await createArtifact(pool, { sessionId: second.id, name: 'shared.md', content: body, authorThread: 'agent:TEST second', scope })
    expect(retry.indexed).toBe(true)
    const docs = await listSectorDocuments(pool, sectorId, scope, true)
    expect(docs.filter((entry) => entry.filename === 'shared.md')).toHaveLength(1)
    expect(docs.find((entry) => entry.filename === 'shared.md')?.authorThread).toBe('agent:TEST first')
  })
})
