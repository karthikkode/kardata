// Workspace routes: global context, file library, thread context,
// research session, and progress. Live-app suite, skipped explicitly
// without TEST_DATABASE_URL. Guards the regression where the UI called
// these endpoints against a server that never registered them: every
// assertion first rules out the `no route` 404 before checking payload.
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { createSector } from '../../backend/src/db/index.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''
const STAMP = randomUUID()

const KEYS = {
  approver: { presented: 'key-ws-approver', tenant: 'tenant-ws', project: null, role: 'approver' },
  operator: { presented: 'key-ws-operator', tenant: 'tenant-ws', project: null, role: 'operator' },
  viewer: { presented: 'key-ws-viewer', tenant: 'tenant-ws', project: null, role: 'viewer' },
} as const

function authHeader(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` }
}

function notNoRoute(body: unknown): void {
  const message = (body as { error?: { message?: string } }).error?.message ?? ''
  expect(message).not.toContain('no route')
}

describe.skipIf(!ENABLED)('workspace routes', () => {
  let app: FastifyInstance
  let pool: Pool
  const sector = `sec-workspace-${STAMP}`
  const scope = { tenantId: 'tenant-ws', projectId: null }
  let sessionId = ''

  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_workspace')
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
    await createSector(pool, { name: 'Workspace sector', topic: 'Widgets', scope, sectorId: sector })
    await projectNewEvents(pool)
    const created = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(KEYS.operator.presented),
      payload: { title: `Workspace chat ${STAMP}`, sectorId: sector },
    })
    expect(created.statusCode).toBe(201)
    sessionId = (created.json() as { data: { id: string } }).data.id
    await projectNewEvents(pool)
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  it('reads the global context at version zero with a topic fallback', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/sectors/${sector}/global-context`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(response.statusCode).toBe(200)
    const data = response.json<{ data: { version: number; sections: { scope: string }; changes: unknown[] } }>().data
    expect(data.version).toBe(0)
    expect(data.sections.scope).toBe('Widgets')
    expect(data.changes).toEqual([])
  })

  it('404s unknown sectors from the layer, never as no-route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/sectors/sec-missing/global-context',
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(response.statusCode).toBe(404)
    notNoRoute(response.json())
  })

  it('lists sector files, empty before anything is attached', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/sectors/${sector}/files`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(response.statusCode).toBe(200)
    notNoRoute(response.json())
    expect(response.json<{ data: unknown[] }>().data).toEqual([])
  })

  it('gates global-context writes on the approver floor', async () => {
    const denied = await app.inject({
      method: 'PATCH',
      url: `/v1/sectors/${sector}/global-context`,
      headers: authHeader(KEYS.operator.presented),
      payload: { baseVersion: 0, sections: { scope: 'Widgets', decisions: '', findings: '', questions: '' } },
    })
    expect(denied.statusCode).toBe(403)

    const saved = await app.inject({
      method: 'PATCH',
      url: `/v1/sectors/${sector}/global-context`,
      headers: authHeader(KEYS.approver.presented),
      payload: { baseVersion: 0, sections: { scope: 'Widgets', decisions: 'Ship it.', findings: '', questions: '' } },
    })
    expect(saved.statusCode).toBe(200)
    const change = saved.json<{ data: { state: string; version: number } }>().data
    expect(change).toMatchObject({ state: 'approved', version: 1 })

    const reread = await app.inject({
      method: 'GET',
      url: `/v1/sectors/${sector}/global-context`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(reread.json<{ data: { version: number; sections: { decisions: string } } }>().data).toMatchObject({
      version: 1,
      sections: { decisions: 'Ship it.' },
    })
  })

  it('runs the proposal plus decision flow for normal chats', async () => {
    const reread = await app.inject({
      method: 'GET',
      url: `/v1/sectors/${sector}/global-context`,
      headers: authHeader(KEYS.viewer.presented),
    })
    const version = reread.json<{ data: { version: number } }>().data.version
    const proposed = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${sector}/global-context/proposals`,
      headers: authHeader(KEYS.operator.presented),
      payload: {
        baseVersion: version,
        sections: { scope: 'Widgets', decisions: 'Ship it.', findings: 'New evidence.', questions: '' },
        sourceThread: sessionId,
      },
    })
    expect(proposed.statusCode).toBe(200)
    const proposal = proposed.json<{ data: { id: string; state: string } }>().data
    expect(proposal.state).toBe('pending')

    const decided = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${sector}/global-context/proposals/${proposal.id}/decision`,
      headers: authHeader(KEYS.approver.presented),
      payload: { approve: true },
    })
    expect(decided.statusCode).toBe(200)
    expect(decided.json<{ data: { state: string } }>().data.state).toBe('approved')
  })

  it('ensures one research session per sector', async () => {
    const first = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${sector}/research-session`,
      headers: authHeader(KEYS.operator.presented),
    })
    expect(first.statusCode).toBe(200)
    const one = first.json<{ data: { id: string; kind: string } }>().data
    expect(one.kind).toBe('research')
    const second = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${sector}/research-session`,
      headers: authHeader(KEYS.operator.presented),
    })
    expect(second.json<{ data: { id: string } }>().data.id).toBe(one.id)
  })

  it('reads and compacts thread-local context', async () => {
    const local = await app.inject({
      method: 'GET',
      url: `/v1/threads/${sessionId}/context`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(local.statusCode).toBe(200)
    notNoRoute(local.json())
    expect(local.json<{ data: { threadKey: string; version: number } }>().data).toMatchObject({
      threadKey: sessionId,
      version: 0,
    })

    // A fresh thread is below the compaction threshold: honest no-op.
    const compacted = await app.inject({
      method: 'POST',
      url: `/v1/threads/${sessionId}/context/compact`,
      headers: authHeader(KEYS.operator.presented),
    })
    expect(compacted.statusCode).toBe(200)
    expect(compacted.json<{ data: { compacted: boolean } }>().data.compacted).toBe(false)
  })

  it('reads research progress for the sector', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/sectors/${sector}/progress`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(response.statusCode).toBe(200)
    notNoRoute(response.json())
    expect(response.json<{ data: { sectorId: string } }>().data.sectorId).toBe(sector)
  })
})
