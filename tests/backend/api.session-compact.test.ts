// Session compaction route: below-threshold histories report honestly,
// unknown sessions 404, viewers denied. Live-app suite, skipped
// explicitly without TEST_DATABASE_URL.
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''
const STAMP = randomUUID()

const KEYS = {
  operator: { presented: 'key-scmp-operator', tenant: 'tenant-scmp', project: null, role: 'operator' },
  viewer: { presented: 'key-scmp-viewer', tenant: 'tenant-scmp', project: null, role: 'viewer' },
} as const

function authHeader(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` }
}

describe.skipIf(!ENABLED)('session compaction [F:http.compactSession]', () => {
  let app: FastifyInstance
  let pool: Pool
  let sessionId = ''

  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_session_compact')
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
    const created = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(KEYS.operator.presented),
      payload: { title: `Compact ${STAMP}` },
    })
    expect(created.statusCode).toBe(201)
    sessionId = (created.json() as { data: { id: string } }).data.id
    await projectNewEvents(pool)
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  it('reports below-threshold histories honestly', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/compact`,
      headers: authHeader(KEYS.operator.presented),
    })
    expect(response.statusCode).toBe(200)
    expect(response.json<{ data: { compacted: boolean; messageCount: number } }>().data).toMatchObject({
      compacted: false,
    })
  })

  it('denies viewers and 404s unknown sessions', async () => {
    const denied = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/compact`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(denied.statusCode).toBe(403)
    const missing = await app.inject({
      method: 'POST',
      url: '/v1/sessions/s-nope/compact',
      headers: authHeader(KEYS.operator.presented),
    })
    expect(missing.statusCode).toBe(404)
  })
})
