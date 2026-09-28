// B5.5 find→diagnose→act flow: a stuck run is findable and diagnosable
// from the read-only inspector, then actionable through the RBAC
// command routes (suspend = pause, retry = resume, cancel). Every action
// lands in the structured access log (B5.1 proves the lines); this suite
// proves the dispatch and the denial envelopes.
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { appendEvent } from '../../backend/src/db/index.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''

const KEYS = {
  operator: { presented: 'key-ops-operator', tenant: 'tenant-a', project: null, role: 'operator' },
  approver: { presented: 'key-ops-approver', tenant: 'tenant-a', project: null, role: 'approver' },
  viewer: { presented: 'key-ops-viewer', tenant: 'tenant-a', project: null, role: 'viewer' },
} as const

function authHeader(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` }
}

describe.skipIf(!ENABLED)('ops find-diagnose-act (B5.5)', () => {
  let app: FastifyInstance
  let pool: Pool
  let runs: FakeRunsGateway
  let sessionId = ''
  let runId = ''

  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_ops')
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

    const created = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(KEYS.operator.presented),
      payload: { title: 'Stuck run' },
    })
    expect(created.statusCode).toBe(201)
    sessionId = (created.json() as { data: { id: string } }).data.id
    runId = `session-run-${sessionId}`
    runs.addRun({
      id: runId,
      sessionId,
      threadKey: sessionId,
      state: 'RUNNING',
      budgetUsedRatio: 0,
      contextUsedRatio: 0,
      updatedAt: new Date().toISOString(),
    })

    // The run stalls: paused thread plus a sweeper finding in the log.
    await appendEvent(pool, {
      idempotencyKey: `ops-thread-${sessionId}`,
      partition: `session:${sessionId}`,
      type: 't.thread.state',
      payload: { threadKey: `session:${sessionId}`, status: 'PAUSED', acceptingSteer: false },
    })
    await appendEvent(pool, {
      idempotencyKey: `ops-stall-${sessionId}`,
      partition: `session:${sessionId}`,
      type: 't.stall.response',
      payload: {
        runId,
        kind: 'no_progress',
        detail: 'no heartbeat for 600s',
        response: 'page_operator',
        reason: 'exceeded threshold',
        at: new Date().toISOString(),
      },
    })
  })

  afterAll(async () => {
    await app?.close()
    await pool?.end()
  })

  it('finds and diagnoses the stuck run from events', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/debug/runs/${runId}`,
      headers: authHeader(KEYS.operator.presented),
    })
    expect(response.statusCode).toBe(200)
    const data = (response.json() as { data: Record<string, unknown> }).data

    const findings = data['findings'] as Array<{ finding: { kind: string; response: string } }>
    expect(findings).toHaveLength(1)
    expect(findings[0]?.finding).toMatchObject({ kind: 'no_progress', response: 'page_operator' })

    const state = data['state'] as { threads: Array<{ threadKey: string; status: string }> }
    expect(state.threads).toContainEqual(
      expect.objectContaining({ threadKey: `session:${sessionId}`, status: 'PAUSED' }),
    )
  })

  it('retries the stuck run through resume and dispatches the signal', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/commands/resume',
      headers: authHeader(KEYS.approver.presented),
      payload: { runId },
    })
    expect(response.statusCode).toBe(202)
    expect(runs.signals).toContainEqual({ workflowId: runId, signal: 'runResume', args: [] })
  })

  it('suspends and cancels through operator commands', async () => {
    const pause = await app.inject({
      method: 'POST',
      url: '/v1/commands/pause',
      headers: authHeader(KEYS.operator.presented),
      payload: { runId },
    })
    expect(pause.statusCode).toBe(202)
    expect(runs.signals).toContainEqual({ workflowId: runId, signal: 'runPause', args: [] })

    const cancel = await app.inject({
      method: 'POST',
      url: '/v1/commands/cancel',
      headers: authHeader(KEYS.operator.presented),
      payload: { runId },
    })
    expect(cancel.statusCode).toBe(202)
    expect(runs.signals).toContainEqual({ workflowId: runId, signal: 'runCancel', args: [] })
  })

  it('denies unauthorized actions with the permission envelope', async () => {
    const viewerResume = await app.inject({
      method: 'POST',
      url: '/v1/commands/resume',
      headers: authHeader(KEYS.viewer.presented),
      payload: { runId },
    })
    expect(viewerResume.statusCode).toBe(403)
    expect(viewerResume.json()).toMatchObject({ ok: false, error: { code: 'permission_denied' } })

    const viewerCancel = await app.inject({
      method: 'POST',
      url: '/v1/commands/cancel',
      headers: authHeader(KEYS.viewer.presented),
      payload: { runId },
    })
    expect(viewerCancel.statusCode).toBe(403)
    expect(viewerCancel.json()).toMatchObject({ ok: false, error: { code: 'permission_denied' } })

    const operatorResume = await app.inject({
      method: 'POST',
      url: '/v1/commands/resume',
      headers: authHeader(KEYS.operator.presented),
      payload: { runId },
    })
    expect(operatorResume.statusCode).toBe(403)
  })
})
