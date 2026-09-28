// Session model binding over the real event log. The provider catalog is an
// injected live-endpoint response, so the test never needs a provider key or
// outbound network call.
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { getSessionModel, readPartition } from '../../backend/src/db/index.js'
import { modelsFor } from '../../backend/src/providers/registry.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''

describe.skipIf(!ENABLED)('Meta session model and catalog', () => {
  let app: FastifyInstance
  let pool: Pool
  let sessionId: string
  let previousKey: string | undefined

  beforeAll(async () => {
    previousKey = process.env['KARDATA_META_KEY']
    process.env['KARDATA_META_KEY'] = 'test-only-key'
    const url = await ensureTestDb('kardata_test_session_model')
    pool = new Pool({ connectionString: url })
    app = buildApp({ pool, metaCatalog: async () => modelsFor('meta') })
    const created = await app.inject({ method: 'POST', url: '/v1/sessions', payload: { title: 'Model session' } })
    expect(created.statusCode).toBe(201)
    sessionId = (created.json() as { data: { id: string } }).data.id
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await pool.end()
    if (previousKey === undefined) delete process.env['KARDATA_META_KEY']
    else process.env['KARDATA_META_KEY'] = previousKey
  })

  it('defaults a saved Contributor selection to high effort', async () => {
    expect(await getSessionModel(pool, sessionId)).toBeUndefined()
    const response = await app.inject({
      method: 'PATCH', url: `/v1/sessions/${sessionId}/model`,
      payload: { provider: 'meta', model: 'muse-spark-1.3-contributor' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true, data: {
      provider: 'meta', model: 'muse-spark-1.3-contributor', reasoning: true, effort: 'high',
    } })
    const fetched = await app.inject({ method: 'GET', url: `/v1/sessions/${sessionId}` })
    expect((fetched.json() as { data: { model: unknown } }).data.model).toEqual(response.json().data)
  })

  it('keeps model history append-only and replays idempotent PATCH', async () => {
    const second = await app.inject({
      method: 'PATCH', url: `/v1/sessions/${sessionId}/model`,
      payload: { provider: 'meta', model: 'muse-spark-1.3', effort: 'low' },
    })
    expect(second.statusCode).toBe(200)
    expect(second.json().data).toMatchObject({ model: 'muse-spark-1.3', effort: 'low' })
    const before = (await readPartition(pool, `session:${sessionId}`)).filter((event) => event.type === 't.session.model').length
    const payload = { provider: 'meta', model: 'muse-spark-1.3-contributor', effort: 'high' }
    const idempotencyKey = `model:${sessionId}`
    const first = await app.inject({ method: 'PATCH', url: `/v1/sessions/${sessionId}/model`, headers: { 'idempotency-key': idempotencyKey }, payload })
    const replay = await app.inject({ method: 'PATCH', url: `/v1/sessions/${sessionId}/model`, headers: { 'idempotency-key': idempotencyKey }, payload })
    expect(replay.json()).toEqual(first.json())
    const after = (await readPartition(pool, `session:${sessionId}`)).filter((event) => event.type === 't.session.model').length
    expect(after).toBe(before + 1)
  })

  it('rejects removed providers, unavailable models, and unlisted effort', async () => {
    const removed = await app.inject({ method: 'PATCH', url: `/v1/sessions/${sessionId}/model`, payload: { provider: 'deepseek', model: 'deepseek-chat' } })
    expect(removed.statusCode).toBe(400)
    const unknown = await app.inject({ method: 'PATCH', url: `/v1/sessions/${sessionId}/model`, payload: { provider: 'meta', model: 'future-model' } })
    expect(unknown.statusCode).toBe(400)
    const effort = await app.inject({ method: 'PATCH', url: `/v1/sessions/${sessionId}/model`, payload: { provider: 'meta', model: 'muse-spark-1.3', effort: 'ultra' } })
    expect(effort.statusCode).toBe(400)
  })

  it('returns 404 for an unknown session and 503 when the catalog is unavailable', async () => {
    const missing = await app.inject({ method: 'PATCH', url: '/v1/sessions/nope/model', payload: { provider: 'meta', model: 'muse-spark-1.3-contributor' } })
    expect(missing.statusCode).toBe(404)
    const unavailable = buildApp({ pool, metaCatalog: async () => { throw new Error('offline') } })
    try {
      const response = await unavailable.inject({ method: 'GET', url: '/v1/providers' })
      expect(response.statusCode).toBe(503)
      expect(response.json()).toMatchObject({ ok: false, error: { code: 'overload' } })
    } finally {
      await unavailable.close()
    }
  })

  it('serves only Meta and never exposes the key', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/providers' })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.data.defaultProvider).toBe('meta')
    expect(body.data.providers).toHaveLength(1)
    expect(body.data.providers[0]).toMatchObject({ name: 'meta', hasKey: true, defaultModel: 'muse-spark-1.3-contributor' })
    expect(body.data.providers[0].models[0].model).toBe('muse-spark-1.3-contributor')
    expect(JSON.stringify(body)).not.toContain('test-only-key')
    expect(JSON.stringify(body)).not.toContain('deepseek')
  })
})
