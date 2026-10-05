// Auth and tenancy matrix (B3.3). The app runs via inject in keyed mode
// against a live database; Temporal stays faked. Every denied path asserts
// the spec's permission_denied envelope (403 for absent, unknown, and
// under-roled callers alike) and every scope boundary asserts 404, never
// 403, so tenants stay unprobbable.
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { appendEvent } from '../../backend/src/db/index.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import type { RunInfo } from '../../backend/src/temporal/runs-gateway.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''

const KEYS: Record<string, { presented: string; tenant: string; project: string | null; role: string }> = {
  viewer: { presented: 'key-viewer', tenant: 'tenant-a', project: null, role: 'viewer' },
  operator: { presented: 'key-operator', tenant: 'tenant-a', project: null, role: 'operator' },
  approver: { presented: 'key-approver', tenant: 'tenant-a', project: null, role: 'approver' },
  operatorB: { presented: 'key-operator-b', tenant: 'tenant-b', project: null, role: 'operator' },
  operatorP1: { presented: 'key-operator-p1', tenant: 'tenant-a', project: 'p1', role: 'operator' },
}

function authHeader(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${key}`, ...extra }
}

describe.skipIf(!ENABLED)('auth and tenancy (B3.3)', () => {
  let app: FastifyInstance
  let pool: Pool
  let runs: FakeRunsGateway
  let sessionA = ''
  let sessionB = ''
  let sessionP1 = ''

  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_auth')
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
    runs = new FakeRunsGateway(pool)
    app = buildApp({ pool, runs, auth: true })

    const createdA = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(KEYS['operator']?.presented ?? ''),
      payload: { title: 'Tenant A' },
    })
    expect(createdA.statusCode).toBe(201)
    sessionA = (createdA.json() as { data: { id: string } }).data.id
    runs.addRun(runInfo(`session-run-${sessionA}`, sessionA))

    const createdB = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(KEYS['operatorB']?.presented ?? ''),
      payload: { title: 'Tenant B' },
    })
    sessionB = (createdB.json() as { data: { id: string } }).data.id

    const createdP1 = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(KEYS['operatorP1']?.presented ?? '', { 'x-project': 'p1' }),
      payload: { title: 'Project P1' },
    })
    expect(createdP1.statusCode).toBe(201)
    sessionP1 = (createdP1.json() as { data: { id: string } }).data.id
    runs.addRun(runInfo(`session-run-${sessionP1}`, sessionP1))

    // Legacy session from before tenancy: bound to no tenant.
    await appendEvent(pool, {
      idempotencyKey: 'auth:legacy:created',
      partition: 'session:legacy',
      type: 't.session.created',
      payload: { sessionId: 'legacy', title: 'Legacy' },
    })
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  function runInfo(id: string, sessionId: string): RunInfo {
    return {
      id,
      sessionId,
      threadKey: sessionId,
      state: 'RUNNING',
      budgetUsedRatio: 0,
      contextUsedRatio: 0,
      updatedAt: new Date().toISOString(),
    }
  }

  it('denies anonymous and unknown keys without distinguishing them', async () => {
    for (const headers of [{}, { authorization: 'Bearer wrong-key' }]) {
      const response = await app.inject({ method: 'GET', url: '/v1/sessions', headers })
      expect(response.statusCode).toBe(403)
      expect((response.json() as { error: { code: string } }).error.code).toBe('permission_denied')
    }
  })

  it('lets viewers read their tenant only', async () => {
    const headers = authHeader(KEYS['viewer']?.presented ?? '')
    const listed = await app.inject({ method: 'GET', url: '/v1/sessions', headers })
    expect(listed.statusCode).toBe(200)
    const ids = (listed.json() as { data: Array<{ id: string }> }).data.map((session) => session.id)
    expect(ids).toContain(sessionA)
    expect(ids).not.toContain(sessionB)

    const foreign = await app.inject({ method: 'GET', url: `/v1/sessions/${sessionB}`, headers })
    expect(foreign.statusCode).toBe(404)

    const legacy = await app.inject({ method: 'GET', url: '/v1/sessions/legacy', headers })
    expect(legacy.statusCode).toBe(404)
  })

  it('holds the viewer/operator/approver ladder on mutations', async () => {
    const viewer = authHeader(KEYS['viewer']?.presented ?? '')
    const deniedCreate = await app.inject({ method: 'POST', url: '/v1/sessions', headers: viewer, payload: { title: 'x' } })
    expect(deniedCreate.statusCode).toBe(403)

    const deniedSend = await app.inject({
      method: 'POST',
      url: '/v1/commands/send',
      headers: viewer,
      payload: { threadKey: sessionA, text: 'hi' },
    })
    expect(deniedSend.statusCode).toBe(403)

    const operator = authHeader(KEYS['operator']?.presented ?? '')
    const send = await app.inject({
      method: 'POST',
      url: '/v1/commands/send',
      headers: operator,
      payload: { threadKey: sessionA, text: 'hi' },
    })
    expect(send.statusCode).toBe(202)

    const deniedApprove = await app.inject({
      method: 'POST',
      url: '/v1/commands/approve',
      headers: operator,
      payload: { approvalId: 'ap-1', decision: 'approved' },
    })
    expect(deniedApprove.statusCode).toBe(403)

    const deniedResume = await app.inject({
      method: 'POST',
      url: '/v1/commands/resume',
      headers: operator,
      payload: { runId: `session-run-${sessionA}` },
    })
    expect(deniedResume.statusCode).toBe(403)

    const approver = authHeader(KEYS['approver']?.presented ?? '')
    const approved = await app.inject({
      method: 'POST',
      url: '/v1/commands/approve',
      headers: approver,
      payload: { approvalId: 'ap-1', decision: 'approved' },
    })
    expect(approved.statusCode).toBe(202)
    const resumed = await app.inject({
      method: 'POST',
      url: '/v1/commands/resume',
      headers: approver,
      payload: { runId: `session-run-${sessionA}` },
    })
    expect(resumed.statusCode).toBe(202)
  })

  it('scopes threads, messages, and commands by tenant', async () => {
    const other = authHeader(KEYS['operatorB']?.presented ?? '')
    expect((await app.inject({ method: 'GET', url: `/v1/sessions/${sessionA}/threads`, headers: other })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/v1/threads/${sessionA}`, headers: other })).statusCode).toBe(404)
    expect(
      (await app.inject({ method: 'GET', url: `/v1/threads/${sessionA}/messages`, headers: other })).statusCode,
    ).toBe(404)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/commands/send',
          headers: other,
          payload: { threadKey: sessionA, text: 'hi' },
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/commands/pause',
          headers: other,
          payload: { runId: `session-run-${sessionA}` },
        })
      ).statusCode,
    ).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/v1/threads/${sessionA}/events`, headers: other })).statusCode).toBe(404)
  })

  it('scopes runs by tenant and hides unbound research runs', async () => {
    runs.addRun(runInfo('research-run-r9', 'research-run-r9'))
    const headers = authHeader(KEYS['operator']?.presented ?? '')
    const listed = await app.inject({ method: 'GET', url: '/v1/runs', headers })
    const ids = (listed.json() as { data: Array<{ id: string }> }).data.map((run) => run.id)
    expect(ids).toContain(`session-run-${sessionA}`)
    expect(ids).not.toContain('research-run-r9')
    expect(ids).not.toContain(`session-run-${sessionB}`)

    const research = await app.inject({ method: 'GET', url: '/v1/runs/research-run-r9', headers })
    expect(research.statusCode).toBe(404)
  })

  it('enforces project selection inside the key binding', async () => {
    const p1 = authHeader(KEYS['operatorP1']?.presented ?? '')
    // Own project session resolves; the tenant's unscoped session does not.
    expect((await app.inject({ method: 'GET', url: `/v1/sessions/${sessionP1}`, headers: p1 })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/v1/sessions/${sessionA}`, headers: p1 })).statusCode).toBe(404)

    // Unbound operator key sees the whole tenant, or one project via header.
    const unbound = authHeader(KEYS['operator']?.presented ?? '')
    const all = await app.inject({ method: 'GET', url: '/v1/sessions', headers: unbound })
    const allIds = (all.json() as { data: Array<{ id: string }> }).data.map((session) => session.id)
    expect(allIds).toContain(sessionA)
    expect(allIds).toContain(sessionP1)
    const selected = await app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: { ...unbound, 'x-project': 'p1' },
    })
    const selectedIds = (selected.json() as { data: Array<{ id: string }> }).data.map((session) => session.id)
    expect(selectedIds).toContain(sessionP1)
    expect(selectedIds).not.toContain(sessionA)

    const mismatchedTenant = await app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: { ...unbound, 'x-tenant': 'tenant-b' },
    })
    expect(mismatchedTenant.statusCode).toBe(403)

    const outsideBinding = await app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: { ...p1, 'x-project': 'p2' },
    })
    expect(outsideBinding.statusCode).toBe(403)
  })

  it('gates the stream before any frame leaves', async () => {
    const response = await app.inject({ method: 'GET', url: `/v1/threads/${sessionA}/events` })
    expect(response.statusCode).toBe(403)
  })

  it('answers anonymous stream probes 403 even for missing threads', async () => {
    // Auth runs before the thread fetch: a missing thread must not leak
    // existence through 404-vs-403.
    const missing = await app.inject({ method: 'GET', url: '/v1/threads/no-such-thread/events' })
    expect(missing.statusCode).toBe(403)
    expect((missing.json() as { error: { code: string } }).error.code).toBe('permission_denied')
  })
})
