// Actual isolated Postgres, archive and HTTP metadata; no provider or Temporal.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { FilesystemTarget } from '../../backend/src/archive/targets.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { createArtifact, createSector, createSession, listSectorLibrary, registerApiKey } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('mixed sector library arrival order [F:db.index.createSector] [F:db.index.createSession] [F:db.index.registerApiKey] [F:db.keys.registerApiKey] [F:db.index.createArtifact] [F:db.sectors.createSector] [F:db.sessions.createSession] [F:db.index.Db] [F:db.workspace.WorkspaceError] [F:db.workspace.requireSector]', () => {
  let pool: Pool
  const scope = { tenantId: 'TEST files arrival order', projectId: null }
  const credential = 'TEST isolated file ordering key'
  const archive = new FilesystemTarget(mkdtempSync(join(tmpdir(), 'kardata-file-order-')))
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_file_order') })
    await registerApiKey(pool, { keyId: 'TEST file ordering key', keyHash: hashKey(credential), role: 'operator', scope })
  })
  afterAll(async () => { await pool?.end() })
  async function prepared() {
    const { sectorId } = await createSector(pool, { name: 'TEST mixed library', scope })
    await projectNewEvents(pool)
    const session = await createSession(pool, 'TEST generated reports', scope, sectorId)
    await projectNewEvents(pool)
    return { sectorId, session }
  }
  it('shows a new generated report in the first fifty among two thousand older uploads over keyed HTTP', async () => {
    const { sectorId, session } = await prepared()
    await pool.query(`INSERT INTO sector_documents(id,sector_id,filename,media_type,text,sha256,tenant_id,created_at)
      SELECT $1||':upload:'||g,$1,'TEST old upload '||g||'.md','text/markdown','TEST indexed source',repeat('a',64),$2,'2025-01-01T00:00:00Z'::timestamptz FROM generate_series(1,2000) g`, [sectorId, scope.tenantId])
    const report = await createArtifact(pool, { sessionId: session.id, name: 'TEST newest generated report.md', content: '# TEST synthetic report\n\nRetained test evidence.', producedBy: 'TEST report agent', scope }, archive)
    await projectNewEvents(pool)
    const app = buildApp({ pool, auth: true, archiveTarget: archive })
    try {
      const response = await app.inject({ method: 'GET', url: `/v1/sectors/${sectorId}/files`, headers: { authorization: `Bearer ${credential}` } })
      expect(response.statusCode).toBe(200)
      const files = response.json().data as Array<{ id: string; kind: string; filename: string; status: string }>
      expect(files).toHaveLength(2001)
      expect(files[0]).toMatchObject({ id: report.artifactId, kind: 'artifact', filename: 'TEST newest generated report.md', status: 'indexed' })
      expect(files.slice(0, 50).some((file) => file.id === report.artifactId)).toBe(true)
      expect(files.slice(1).every((file) => file.kind === 'document')).toBe(true)
      expect(files[0]).not.toHaveProperty('createdAt') // Ordering does not change the wire shape.
    } finally { await app.close() }
  })
  it('uses an ID tie-break for identical timestamps across uploaded and generated files', async () => {
    const { sectorId, session } = await prepared()
    const report = await createArtifact(pool, { artifactId: 'TEST-order-m-report', sessionId: session.id, name: 'TEST same-time report.md', content: 'TEST same-time evidence', scope }, archive)
    const { rows } = await pool.query<{ at: Date }>("SELECT min(at) AS at FROM events WHERE partition=$1 AND type='t.artifact.stored' AND payload->>'artifactId'=$2", [`artifact:session:${session.id}`, report.artifactId])
    await pool.query(`INSERT INTO sector_documents(id,sector_id,filename,media_type,text,sha256,tenant_id,created_at)
      SELECT id,$1,id||'.md','text/markdown','TEST indexed source',repeat('b',64),$2,$3 FROM unnest($4::text[]) AS id`, [sectorId, scope.tenantId, rows[0]!.at, ['TEST-order-z-upload', 'TEST-order-a-upload']])
    await projectNewEvents(pool)
    expect((await listSectorLibrary(pool, sectorId, scope)).map((file) => file.id)).toEqual(['TEST-order-a-upload', report.artifactId, 'TEST-order-z-upload'])
  })
})
