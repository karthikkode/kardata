// Rate limits and mutation idempotency (B3.4). The app runs via inject in
// keyed mode against a live database; Temporal stays faked. The 429 matrix
// asserts the spec's rate_limited envelope plus the Retry-After hint and
// per-key budget isolation; the idempotency matrix asserts replay (same
// status and body, no re-execution), 409 on key reuse for a different
// request, and caller-scoped records.
import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { createLogger } from '../../backend/src/observability/logging.js'
import type { RunInfo } from '../../backend/src/temporal/runs-types.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''

const OPERATOR = 'key-limits-operator'
const OPERATOR_B = 'key-limits-operator-b'
// Rate windows and idempotency records persist in the shared test database
// across runs, so caller secrets and keys are stamped per run: reuse within
// a run replays against a fresh budget, never collides with a previous run.
const STAMP = randomUUID()
const RATE_KEY = `key-limits-rate-${STAMP}`
const RATE_KEY_OTHER = `key-limits-rate-other-${STAMP}`
const REPLAY_KEY = `k-limits-replay-1-${STAMP}`
const SEND_KEY = `k-limits-send-1-${STAMP}`

function authHeader(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${key}`, ...extra }
}

function run(id: string, sessionId: string): RunInfo {
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

describe.skipIf(!ENABLED)('rate limits and idempotency (B3.4)', () => {
  let app: FastifyInstance
  let throttled: FastifyInstance
  let pool: Pool
  let runs: FakeRunsGateway
  let baselineSessions = 0
  const logLines: string[] = []
  const logStream = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).split('\n')) {
        if (line.trim()) logLines.push(line)
      }
      callback()
    },
  })

  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_limits')
    pool = new Pool({ connectionString: url })
    await pool.query(
      `INSERT INTO api_keys (key_id, key_hash, tenant_id, project_id, roles)
       VALUES ('limits-op', $1, 'tenant-a', NULL, 'operator'),
              ('limits-op-b', $2, 'tenant-b', NULL, 'operator'),
              ('limits-rate', $3, 'tenant-a', NULL, 'viewer'),
              ('limits-rate-other', $4, 'tenant-a', NULL, 'viewer')
       ON CONFLICT (key_id) DO UPDATE SET key_hash = EXCLUDED.key_hash`,
      [hashKey(OPERATOR), hashKey(OPERATOR_B), hashKey(RATE_KEY), hashKey(RATE_KEY_OTHER)],
    )
    runs = new FakeRunsGateway(pool)
    app = buildApp({ pool, runs, auth: true, rateLimitPerMin: 1000 })
    throttled = buildApp({
      pool,
      runs,
      auth: true,
      rateLimitPerMin: 3,
      logger: createLogger({ op: 'http' }, logStream),
    })

    const created = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(OPERATOR),
      payload: { title: 'Limits baseline' },
    })
    expect(created.statusCode).toBe(201)
    const listed = await app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: authHeader(OPERATOR),
    })
    baselineSessions = (listed.json() as { data: unknown[] }).data.length
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await throttled?.close()
    await pool?.end()
  })

  it('429s past budget with the rate_limited envelope and Retry-After', async () => {
    for (let n = 0; n < 3; n += 1) {
      const ok = await throttled.inject({
        method: 'GET',
        url: '/v1/sessions',
        headers: authHeader(RATE_KEY),
      })
      expect(ok.statusCode).toBe(200)
    }
    const limited = await throttled.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: authHeader(RATE_KEY),
    })
    expect(limited.statusCode).toBe(429)
    expect(limited.json()).toEqual({
      ok: false,
      error: { code: 'rate_limited', message: expect.stringMatching(/retry after \d+ seconds/i) },
    })
    const retryAfter = Number(limited.headers['retry-after'])
    expect(Number.isInteger(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(60)
    const breach = logLines.map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(breach).toContainEqual(
      expect.objectContaining({ op: 'http.rate_limited', limit: 3, msg: 'rate limit exceeded' }),
    )
  })

  it('isolates budgets per key and leaves /healthz unthrottled', async () => {
    const other = await throttled.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: authHeader(RATE_KEY_OTHER),
    })
    expect(other.statusCode).toBe(200)
    const health = await throttled.inject({ method: 'GET', url: '/healthz' })
    expect(health.statusCode).toBe(200)
  })

  it('replays identical session creates without a second session', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(OPERATOR, { 'idempotency-key': REPLAY_KEY }),
      payload: { title: 'Replay me' },
    })
    expect(first.statusCode).toBe(201)
    const firstId = (first.json() as { data: { id: string } }).data.id

    const second = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(OPERATOR, { 'idempotency-key': REPLAY_KEY }),
      payload: { title: 'Replay me' },
    })
    expect(second.statusCode).toBe(201)
    expect((second.json() as { data: { id: string } }).data.id).toBe(firstId)

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: authHeader(OPERATOR),
    })
    expect((listed.json() as { data: unknown[] }).data.length).toBe(baselineSessions + 1)
  })

  it('409s idempotency-key reuse for a different request', async () => {
    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(OPERATOR, { 'idempotency-key': REPLAY_KEY }),
      payload: { title: 'A different title' },
    })
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json()).toEqual({
      ok: false,
      error: { code: 'conflict', message: expect.stringMatching(/different request/) },
    })
  })

  it('replays send without re-signaling the run', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(OPERATOR),
      payload: { title: 'Send replay' },
    })
    const sessionId = (created.json() as { data: { id: string } }).data.id
    runs.addRun(run(`session-run-${sessionId}`, sessionId))
    const signalsBefore = runs.signals.length

    const headers = authHeader(OPERATOR, { 'idempotency-key': SEND_KEY })
    const payload = { threadKey: sessionId, text: 'hello again' }
    const first = await app.inject({ method: 'POST', url: '/v1/commands/send', headers, payload })
    expect(first.statusCode).toBe(202)
    const firstCommand = (first.json() as { data: { commandId: string } }).data.commandId

    const second = await app.inject({ method: 'POST', url: '/v1/commands/send', headers, payload })
    expect(second.statusCode).toBe(202)
    expect((second.json() as { data: { commandId: string } }).data.commandId).toBe(firstCommand)
    expect(runs.signals.length).toBe(signalsBefore + 1)
  })

  it('scopes idempotency records to the caller', async () => {
    // Same key and body as the tenant-a send above, but a tenant-b key:
    // no replay across callers (and no visibility into tenant-a threads).
    const foreign = await app.inject({
      method: 'POST',
      url: '/v1/commands/send',
      headers: authHeader(OPERATOR_B, { 'idempotency-key': SEND_KEY }),
      payload: { threadKey: 'whatever', text: 'hello again' },
    })
    expect(foreign.statusCode).toBe(404)
    expect(foreign.json()).toEqual({
      ok: false,
      error: { code: 'not_found', message: expect.any(String) },
    })
  })

  it('executes keyless mutations every time and rejects overlong keys', async () => {
    const one = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(OPERATOR),
      payload: { title: 'Keyless one' },
    })
    const two = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(OPERATOR),
      payload: { title: 'Keyless one' },
    })
    expect(one.statusCode).toBe(201)
    expect(two.statusCode).toBe(201)
    expect((one.json() as { data: { id: string } }).data.id).not.toBe(
      (two.json() as { data: { id: string } }).data.id,
    )

    const overlong = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(OPERATOR, { 'idempotency-key': 'k'.repeat(129) }),
      payload: { title: 'Overlong' },
    })
    expect(overlong.statusCode).toBe(400)
    expect(overlong.json()).toEqual({
      ok: false,
      error: { code: 'validation_failed', message: expect.any(String) },
    })
  })
})
