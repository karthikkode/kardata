// Phase 8 B1: UI-only enforcement. With KARDATA_UI_ONLY=1, mutating /v1
// calls need the UI key + pilot origin + X-Kardata-Client header, else
// 403 ui_only_violation plus an alert row; events carry the key's
// client. Flag off keeps today's route-based behavior. Real keyed
// loopback HTTP against an isolated database.
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { registerApiKey } from '../../backend/src/db/index.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

const scope = { tenantId: 'TEST ui-only', projectId: null }
const UI_ORIGIN = 'http://localhost:25174'
const KEYS = {
  ui: 'TEST-ui-only-ui-key',
  mcp: 'TEST-ui-only-mcp-key',
  viewer: 'TEST-ui-only-viewer-key',
  legacy: 'TEST-ui-only-legacy-key',
}

describe.skipIf(!TEST_DATABASE_URL)('UI-only gate over real HTTP [F:http.authorize] [F:db.keys.registerApiKey] [F:db.alerts.recordUiOnlyViolation]', () => {
  let pool: Pool
  let app: FastifyInstance
  let origin: string
  const savedFlag = process.env['KARDATA_UI_ONLY']
  const savedOrigin = process.env['KARDATA_UI_ORIGIN']

  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_ui_only') })
    await registerApiKey(pool, { keyId: 'ui-key', keyHash: hashKey(KEYS.ui), scope, role: 'approver', client: 'ui' })
    await registerApiKey(pool, { keyId: 'mcp-key', keyHash: hashKey(KEYS.mcp), scope, role: 'approver', client: 'agent-mcp' })
    await registerApiKey(pool, { keyId: 'viewer-key', keyHash: hashKey(KEYS.viewer), scope, role: 'operator', client: 'viewer' })
    await registerApiKey(pool, { keyId: 'legacy-key', keyHash: hashKey(KEYS.legacy), scope, role: 'approver' })
    process.env['KARDATA_UI_ONLY'] = '1'
    process.env['KARDATA_UI_ORIGIN'] = UI_ORIGIN
    app = buildApp({ pool, runs: new FakeRunsGateway(pool), auth: true })
    origin = await app.listen({ port: 0, host: '127.0.0.1' })
  })
  afterAll(async () => {
    if (savedFlag === undefined) delete process.env['KARDATA_UI_ONLY']
    else process.env['KARDATA_UI_ONLY'] = savedFlag
    if (savedOrigin === undefined) delete process.env['KARDATA_UI_ORIGIN']
    else process.env['KARDATA_UI_ORIGIN'] = savedOrigin
    await app?.close()
    await pool?.end()
  })

  async function postSector(key: string, extra: Record<string, string> = {}) {
    const response = await fetch(`${origin}/v1/sectors`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
        ...extra,
      },
      body: JSON.stringify({ name: 'TEST ui-only', topic: 'TEST only' }),
    })
    return { status: response.status, body: (await response.json()) as { ok: boolean; error?: { code?: string }; data?: { id?: string } } }
  }

  async function violations() {
    const { rows } = await pool.query<{ kind: string; subject: string }>(
      "SELECT kind, subject FROM alerts WHERE kind = 'ui_only_violation' ORDER BY id ASC",
    )
    return rows
  }

  it('rejects a non-UI key client on a mutating route with 403 + alert row', async () => {
    const before = (await violations()).length
    const result = await postSector(KEYS.mcp, { origin: UI_ORIGIN, 'x-kardata-client': 'ui' })
    expect(result.status).toBe(403)
    expect(result.body.error?.code).toBe('ui_only_violation')
    const rows = await violations()
    expect(rows.length).toBe(before + 1)
    expect(rows[rows.length - 1]!.subject).toContain('POST /v1/sectors')
    expect(rows[rows.length - 1]!.subject).toContain('mcp-key')
    expect(rows[rows.length - 1]!.subject).toContain(UI_ORIGIN)
    expect(rows[rows.length - 1]!.subject).not.toContain(KEYS.mcp)
  })

  it('rejects a missing client header and a wrong origin', async () => {
    const before = (await violations()).length
    const noHeader = await postSector(KEYS.ui, { origin: UI_ORIGIN })
    expect(noHeader.status).toBe(403)
    expect(noHeader.body.error?.code).toBe('ui_only_violation')
    const wrongOrigin = await postSector(KEYS.ui, { origin: 'http://evil.test', 'x-kardata-client': 'ui' })
    expect(wrongOrigin.status).toBe(403)
    expect(wrongOrigin.body.error?.code).toBe('ui_only_violation')
    expect((await violations()).length).toBe(before + 2)
  })

  it('holds viewer-client and legacy keys to the same gate', async () => {
    const before = (await violations()).length
    const viewer = await postSector(KEYS.viewer, { origin: UI_ORIGIN, 'x-kardata-client': 'ui' })
    expect(viewer.status).toBe(403)
    expect(viewer.body.error?.code).toBe('ui_only_violation')
    const legacy = await postSector(KEYS.legacy, { origin: UI_ORIGIN, 'x-kardata-client': 'ui' })
    expect(legacy.status).toBe(403)
    expect(legacy.body.error?.code).toBe('ui_only_violation')
    expect((await violations()).length).toBe(before + 2)
  })

  it('accepts the UI key + header + origin and stamps the event client=ui', async () => {
    const result = await postSector(KEYS.ui, { origin: UI_ORIGIN, 'x-kardata-client': 'ui' })
    expect(result.status).toBe(201)
    const sectorId = result.body.data?.id
    expect(sectorId).toBeTruthy()
    const { rows } = await pool.query<{ client: string }>(
      "SELECT client FROM events WHERE type = 'sector.created' AND payload->>'sectorId' = $1",
      [sectorId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.client).toBe('ui')
  })

  it('stamps /mcp writes with the key client, not the route default (P8-M1)', async () => {
    const title = `TEST mcp client probe ${randomUUID()}`
    const response = await fetch(`${origin}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${KEYS.ui}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'db.create_session', arguments: { title } },
      }),
    })
    expect(response.status).toBe(200)
    const { rows } = await pool.query<{ client: string }>(
      `SELECT client FROM events WHERE type = 't.session.created' AND payload->>'title' = $1`,
      [title],
    )
    expect(rows).toHaveLength(1)
    // The UI key's client — not the /mcp route default (agent-mcp).
    expect(rows[0]!.client).toBe('ui')
  })

  it('every mutating /v1 route 403s a non-UI key: no authorize() bypass (P8-M1)', async () => {
    const registered =
      (app as FastifyInstance & { kardataRoutes?: { method: string; url: string }[] }).kardataRoutes ?? []
    const mutating = registered.filter(
      ({ method, url }) => url.startsWith('/v1/') && ['POST', 'PATCH', 'DELETE'].includes(method.toUpperCase()),
    )
    expect(mutating.length).toBeGreaterThan(20)
    for (const { method, url } of mutating) {
      const target = url.replace(/:[A-Za-z0-9_]+/g, 'TEST')
      const response = await fetch(`${origin}${target}`, {
        method,
        headers: {
          authorization: `Bearer ${KEYS.mcp}`,
          'content-type': 'application/json',
          origin: UI_ORIGIN,
          'x-kardata-client': 'ui',
        },
        body: JSON.stringify({}),
      })
      const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null
      expect(response.status, `${method} ${url} → ${response.status} ${body?.error?.code}`).toBe(403)
      expect(body?.error?.code, `${method} ${url}`).toBe('ui_only_violation')
    }
  })

  it('leaves reads ungated under the flag', async () => {
    const response = await fetch(`${origin}/v1/sectors?limit=1`, {
      headers: { authorization: `Bearer ${KEYS.mcp}` },
    })
    expect(response.status).toBe(200)
  })

  it('rejects legacy keys on /mcp under the flag, allows them with the flag off', async () => {
    const call = async () =>
      fetch(`${origin}/mcp`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${KEYS.legacy}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      })
    const blocked = await call()
    expect(blocked.status).toBe(403)
    expect(((await blocked.json()) as { error?: { code?: string } }).error?.code).toBe('permission_denied')
    delete process.env['KARDATA_UI_ONLY']
    try {
      expect((await call()).status).toBe(200)
    } finally {
      process.env['KARDATA_UI_ONLY'] = '1'
    }
  })

  it('viewer key on an approver route gets permission_denied with no violation alert', async () => {
    const before = (await violations()).length
    const response = await fetch(`${origin}/v1/commands/approve`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${KEYS.viewer}`,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
        origin: UI_ORIGIN,
        'x-kardata-client': 'ui',
      },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('permission_denied')
    expect((await violations()).length).toBe(before)
  })

  it('flag off keeps route-based behavior: any key mutates, event client=ui', async () => {
    delete process.env['KARDATA_UI_ONLY']
    try {
      const before = (await violations()).length
      const result = await postSector(KEYS.legacy)
      expect(result.status).toBe(201)
      const sectorId = result.body.data?.id
      const { rows } = await pool.query<{ client: string }>(
        "SELECT client FROM events WHERE type = 'sector.created' AND payload->>'sectorId' = $1",
        [sectorId],
      )
      expect(rows[0]!.client).toBe('ui')
      expect((await violations()).length).toBe(before)
    } finally {
      process.env['KARDATA_UI_ONLY'] = '1'
    }
  })
})
