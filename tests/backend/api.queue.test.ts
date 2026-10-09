// A17 queue routes: list, remove and reorder waiting inbox items through
// the run gateway. Unknown threads and stopped runs 404.
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { createSector, createSession } from '../../backend/src/db/index.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

describe.skipIf(!TEST_DATABASE_URL)('inbox queue routes (A17) [F:db.index.createSector] [F:db.index.createSession] [F:db.sectors.createSector] [F:db.sessions.createSession] [F:db.workspace.WorkspaceError] [F:db.workspace.requireSector]', () => {
  let app: FastifyInstance
  let pool: Pool
  let runs: FakeRunsGateway
  const scope = { tenantId: 'test-queue', projectId: null }
  const operatorToken = 'test-queue-operator-key'
  const viewerToken = 'test-queue-viewer-key'
  let sessionId = ''
  let sectorId = ''
  let nonce = 0
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_queue'), max: 5 })
    await pool.query('INSERT INTO api_keys(key_id,key_hash,tenant_id,roles) VALUES($1,$2,$3,$4)', ['test-queue-operator', hashKey(operatorToken), scope.tenantId, 'operator'])
    await pool.query('INSERT INTO api_keys(key_id,key_hash,tenant_id,roles) VALUES($1,$2,$3,$4)', ['test-queue-viewer', hashKey(viewerToken), scope.tenantId, 'viewer'])
    runs = new FakeRunsGateway(pool)
    app = buildApp({ pool, runs, auth: true })
    sectorId = (await createSector(pool, { name: 'TEST queue', topic: 'Queue', scope })).sectorId
    await projectNewEvents(pool)
    sessionId = (await createSession(pool, 'TEST queue parent', scope, sectorId)).id
    await projectNewEvents(pool)
    runs.addRun({ id: `session-run-${sessionId}`, sessionId, threadKey: sessionId, state: 'RUNNING', budgetUsedRatio: 0, contextUsedRatio: 0, updatedAt: new Date().toISOString() }, 'sessionRun')
    runs.seedQueue(`session-run-${sessionId}`, [
      { id: 'q-one', text: 'ONE', queuedAt: 3 },
      { id: 'q-two', text: 'TWO', queuedAt: 2 },
      { id: 'q-three', text: 'THREE', queuedAt: 1 },
    ])
  })
  afterAll(async () => { await app?.close(); await pool?.end() })

  function headers(token: string, withBody: boolean) {
    return withBody
      ? { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': `TEST queue ${++nonce}` }
      : { authorization: `Bearer ${token}` }
  }

  it('lists the queue for viewers and operators', async () => {
    for (const token of [viewerToken, operatorToken]) {
      const response = await app.inject({ method: 'GET', url: `/v1/threads/${sessionId}/queue`, headers: headers(token, false) })
      expect(response.statusCode).toBe(200)
      expect((response.json() as { data: Array<{ id: string }> }).data.map((item) => item.id)).toEqual(['q-one', 'q-two', 'q-three'])
    }
  })

  it('removes one item as operator, 404 when unknown', async () => {
    const denied = await app.inject({ method: 'DELETE', url: `/v1/threads/${sessionId}/queue/q-two`, headers: headers(viewerToken, false) })
    expect(denied.statusCode).toBe(403)
    const removed = await app.inject({ method: 'DELETE', url: `/v1/threads/${sessionId}/queue/q-two`, headers: headers(operatorToken, false) })
    expect(removed.statusCode).toBe(200)
    const missing = await app.inject({ method: 'DELETE', url: `/v1/threads/${sessionId}/queue/q-two`, headers: headers(operatorToken, false) })
    expect(missing.statusCode).toBe(404)
    const listed = await app.inject({ method: 'GET', url: `/v1/threads/${sessionId}/queue`, headers: headers(operatorToken, false) })
    expect((listed.json() as { data: Array<{ id: string }> }).data.map((item) => item.id)).toEqual(['q-one', 'q-three'])
  })

  it('reorders with the exact set, 400 otherwise', async () => {
    const bad = await app.inject({ method: 'POST', url: `/v1/threads/${sessionId}/queue/reorder`, headers: headers(operatorToken, true), payload: { itemIds: ['q-one'] } })
    expect(bad.statusCode).toBe(400)
    const reordered = await app.inject({ method: 'POST', url: `/v1/threads/${sessionId}/queue/reorder`, headers: headers(operatorToken, true), payload: { itemIds: ['q-three', 'q-one'] } })
    expect(reordered.statusCode).toBe(200)
    const listed = await app.inject({ method: 'GET', url: `/v1/threads/${sessionId}/queue`, headers: headers(operatorToken, true) })
    expect((listed.json() as { data: Array<{ id: string }> }).data.map((item) => item.id)).toEqual(['q-three', 'q-one'])
  })

  it('404s unknown threads and stopped runs', async () => {
    const unknown = await app.inject({ method: 'GET', url: '/v1/threads/does-not-exist/queue', headers: headers(operatorToken, false) })
    expect(unknown.statusCode).toBe(404)
    const idle = (await createSession(pool, 'TEST idle', scope, sectorId)).id
    await projectNewEvents(pool)
    const stopped = await app.inject({ method: 'GET', url: `/v1/threads/${idle}/queue`, headers: headers(operatorToken, false) })
    expect(stopped.statusCode).toBe(404)
  })
})
