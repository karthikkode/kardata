// A15 owner subagent spawn: POST /v1/sessions/:id/subagents delegates for
// the session thread with inherited parent context, a name, and the
// 50-in-flight cap as 409.
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { appendEvent, createSector, createSession } from '../../backend/src/db/index.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

describe.skipIf(!TEST_DATABASE_URL)('owner subagent spawn (A15)', () => {
  let app: FastifyInstance
  let pool: Pool
  let runs: FakeRunsGateway
  const scope = { tenantId: 'test-spawn', projectId: null }
  const operatorToken = 'test-spawn-operator-key'
  const viewerToken = 'test-spawn-viewer-key'
  let sessionId = ''
  let nonce = 0
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_spawn'), max: 5 })
    await pool.query('INSERT INTO api_keys(key_id,key_hash,tenant_id,roles) VALUES($1,$2,$3,$4)', ['test-spawn-operator', hashKey(operatorToken), scope.tenantId, 'operator'])
    await pool.query('INSERT INTO api_keys(key_id,key_hash,tenant_id,roles) VALUES($1,$2,$3,$4)', ['test-spawn-viewer', hashKey(viewerToken), scope.tenantId, 'viewer'])
    runs = new FakeRunsGateway(pool)
    app = buildApp({ pool, runs, auth: true })
    const sectorId = (await createSector(pool, { name: 'TEST spawn', topic: 'Spawn', scope })).sectorId
    await projectNewEvents(pool)
    sessionId = (await createSession(pool, 'TEST spawn parent', scope, sectorId)).id
    await projectNewEvents(pool)
  })
  afterAll(async () => { await app?.close(); await pool?.end() })

  async function spawn(body: Record<string, unknown>, token: string = operatorToken) {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/subagents`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': `TEST spawn ${++nonce}` },
      payload: body,
    })
    return { status: response.statusCode, body: response.json() as { ok: boolean; data?: { childId: string; threadKey: string } } }
  }

  it('spawns with the goal and a default name, returning the child thread', async () => {
    const result = await spawn({ goal: 'dig into pricing' })
    expect(result.status).toBe(201)
    expect(result.body.data?.threadKey).toBe(`agent:${result.body.data?.childId}`)
    expect(runs.delegated.at(-1)).toMatchObject({ sessionId, goal: 'dig into pricing', name: 'Subagent 1' })
  })

  it('uses the given name and stores inherited context before the goal', async () => {
    const result = await spawn({ goal: 'dig deeper', name: 'Pricer' })
    expect(result.status).toBe(201)
    expect(runs.delegated.at(-1)).toMatchObject({ name: 'Pricer' })
    const childId = result.body.data?.childId ?? ''
    expect(runs.delegationOrder.slice(-2)).toEqual([`accepted:${childId}`, `goal:${childId}`])
    const { rows } = await pool.query('SELECT inherited FROM thread_context WHERE thread_key=$1', [`agent:${childId}`])
    expect(typeof rows[0]?.inherited).toBe('string')
  })

  it('rejects viewer callers, bad bodies and unknown sessions', async () => {
    expect((await spawn({ goal: 'x' }, viewerToken)).status).toBe(403)
    expect((await spawn({ goal: '' })).status).toBe(400)
    expect((await spawn({ goal: 'x'.repeat(4001) })).status).toBe(400)
    const missing = await app.inject({
      method: 'POST',
      url: '/v1/sessions/does-not-exist/subagents',
      headers: { authorization: `Bearer ${operatorToken}`, 'content-type': 'application/json', 'idempotency-key': `TEST spawn ${++nonce}` },
      payload: { goal: 'x' },
    })
    expect(missing.statusCode).toBe(404)
  })

  it('returns 409 at the 50-in-flight cap', async () => {
    for (let index = 0; index < 50; index += 1) {
      await appendEvent(pool, {
        idempotencyKey: `TEST spawn cap ${index}`,
        partition: `session:${sessionId}`,
        type: 't.subagent.launched',
        payload: { sessionId, parentSessionId: sessionId, childId: `TEST-cap-${index}`, name: `Cap ${index}`, canDelegate: false },
      })
    }
    await projectNewEvents(pool)
    const result = await spawn({ goal: 'one too many' })
    expect(result.status).toBe(409)
  })
})
