// Sector context compaction route: consolidates multiple notes into one
// summary, no-ops honestly below two notes. Live-app suite, skipped
// explicitly without TEST_DATABASE_URL.
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { addContextNotes, createSector } from '../../backend/src/db/index.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''
const STAMP = randomUUID()

const KEYS = {
  operator: { presented: 'key-cmp-operator', tenant: 'tenant-cmp', project: null, role: 'operator' },
  viewer: { presented: 'key-cmp-viewer', tenant: 'tenant-cmp', project: null, role: 'viewer' },
} as const

function authHeader(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` }
}

describe.skipIf(!ENABLED)('sector context compaction', () => {
  let app: FastifyInstance
  let pool: Pool
  const sector = `sec-compact-${STAMP}`
  const scope = { tenantId: 'tenant-cmp', projectId: null }

  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_sector_compact')
    pool = new Pool({ connectionString: url })
    for (const [keyId, key] of Object.entries(KEYS)) {
      await pool.query(
        `INSERT INTO api_keys (key_id, key_hash, tenant_id, project_id, roles)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (key_id) DO UPDATE SET key_hash = EXCLUDED.key_hash, tenant_id = EXCLUDED.tenant_id,
           project_id = EXCLUDED.project_id, roles = EXCLUDED.roles`,
        [keyId, hashKey(key.presented), key.tenant, key.project, key.role],
      )
    }
    app = buildApp({ pool, runs: new FakeRunsGateway(pool), auth: true })
    await createSector(pool, { name: 'Compact sector', topic: 'Memory', scope, sectorId: sector })
    await projectNewEvents(pool)
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  it('consolidates multiple notes into one summary', async () => {
    await addContextNotes(pool, sector, ['Price evidence first.', 'Buyers run RevOps.'])
    const response = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${sector}/context/compact`,
      headers: authHeader(KEYS.operator.presented),
    })
    expect(response.statusCode).toBe(200)
    const data = response.json<{ data: { compacted: boolean; beforeCount: number; afterCount: number; notes: Array<{ text: string }> } }>().data
    expect(data).toMatchObject({ compacted: true, beforeCount: 2, afterCount: 1 })
    expect(data.notes[0]?.text).toContain('Price evidence first.')
    // A second run is an honest no-op: one note cannot consolidate.
    const again = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${sector}/context/compact`,
      headers: authHeader(KEYS.operator.presented),
    })
    expect(again.json<{ data: { compacted: boolean; afterCount: number } }>().data).toMatchObject({
      compacted: false,
      afterCount: 1,
    })
  })

  it('denies viewers and 404s unknown sectors', async () => {
    const denied = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${sector}/context/compact`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(denied.statusCode).toBe(403)
    const missing = await app.inject({
      method: 'POST',
      url: '/v1/sectors/sec-missing/context/compact',
      headers: authHeader(KEYS.operator.presented),
    })
    expect(missing.statusCode).toBe(404)
  })
})
