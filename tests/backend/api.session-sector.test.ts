// Sector-linked sessions: sector chats live apart from general Karbot
// sessions via sectorId on t.session.created. Live database, Temporal
// faked; skipped explicitly without TEST_DATABASE_URL.
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''

const OPERATOR = 'key-operator'

function authHeader(): Record<string, string> {
  return { authorization: `Bearer ${OPERATOR}` }
}

describe.skipIf(!ENABLED)('sector-linked sessions', () => {
  let app: FastifyInstance
  let pool: Pool
  let sectorChat = ''
  let generalChat = ''

  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_session_sector')
    pool = new Pool({ connectionString: url })
    await pool.query(
      `INSERT INTO api_keys (key_id, key_hash, tenant_id, project_id, roles)
       VALUES ('op', $1, 'tenant-a', NULL, 'operator')
       ON CONFLICT (key_id) DO UPDATE SET key_hash = EXCLUDED.key_hash`,
      [hashKey(OPERATOR)],
    )
    await pool.query(
      `INSERT INTO sectors (id, name, topic, state, tenant_id, project_id)
       VALUES ('sec-foods', 'Speciality Foods', '', 'draft', 'tenant-a', NULL)
       ON CONFLICT (id) DO NOTHING`,
    )
    app = buildApp({ pool, runs: new FakeRunsGateway(pool), auth: true })
  })

  afterAll(async () => {
    await app?.close()
    await pool?.end()
  })

  it('creates sector chats and general sessions side by side', async () => {
    const linked = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(),
      payload: { title: 'Speciality Foods chat', sectorId: 'sec-foods' },
    })
    expect(linked.statusCode).toBe(201)
    const linkedBody = linked.json() as { data: { id: string; sectorId?: string } }
    expect(linkedBody.data.sectorId).toBe('sec-foods')
    sectorChat = linkedBody.data.id

    const general = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(),
      payload: { title: 'Karbot' },
    })
    expect(general.statusCode).toBe(201)
    const generalBody = general.json() as { data: { id: string; sectorId?: string } }
    expect(generalBody.data.sectorId).toBeUndefined()
    generalChat = generalBody.data.id
  })

  it('reads the link back and filters the list by sector', async () => {
    const one = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${sectorChat}`,
      headers: authHeader(),
    })
    expect(one.statusCode).toBe(200)
    expect((one.json() as { data: { sectorId?: string } }).data.sectorId).toBe('sec-foods')

    const filtered = await app.inject({
      method: 'GET',
      url: '/v1/sessions?sectorId=sec-foods',
      headers: authHeader(),
    })
    expect(filtered.statusCode).toBe(200)
    const ids = ((filtered.json() as { data: Array<{ id: string }> }).data).map((row) => row.id)
    expect(ids).toContain(sectorChat)
    expect(ids).not.toContain(generalChat)

    const general = await app.inject({ method: 'GET', url: '/v1/sessions', headers: authHeader() })
    const generalIds = ((general.json() as { data: Array<{ id: string }> }).data).map((row) => row.id)
    expect(generalIds).toContain(generalChat)
    expect(generalIds).not.toContain(sectorChat)
  })

  it('rejects unknown sectors and blank filters loudly', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(),
      payload: { title: 'Ghost chat', sectorId: 'sec-nope' },
    })
    expect(missing.statusCode).toBe(404)

    const blank = await app.inject({
      method: 'GET',
      url: '/v1/sessions?sectorId=%20',
      headers: authHeader(),
    })
    expect(blank.statusCode).toBe(400)
  })
})
