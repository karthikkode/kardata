// B5.5 run inspector: read-only debug answers come strictly from the event
// log. The suite seeds session/approval/artifact partitions, then asserts
// state, timeline, approvals, artifacts, and idempotency keys render from
// those events, the gateway sees zero calls, and cross-tenant or
// under-roled callers get 403/404 envelopes with no payload.
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

const KEYS = {
  operator: { presented: 'key-insp-operator', tenant: 'tenant-a', project: null, role: 'operator' },
  viewer: { presented: 'key-insp-viewer', tenant: 'tenant-a', project: null, role: 'viewer' },
  operatorB: { presented: 'key-insp-operator-b', tenant: 'tenant-b', project: null, role: 'operator' },
} as const

function authHeader(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` }
}

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

/** Fake that records every gateway contact; the inspector must make none. */
class CountingGateway extends FakeRunsGateway {
  getRunCalls = 0
  listRunsCalls = 0

  override async getRun(runId: string): Promise<RunInfo | null> {
    this.getRunCalls += 1
    return super.getRun(runId)
  }

  override async listRuns(sessionId?: string): Promise<RunInfo[]> {
    this.listRunsCalls += 1
    return super.listRuns(sessionId)
  }
}

describe.skipIf(!ENABLED)('run inspector (B5.5)', () => {
  let app: FastifyInstance
  let pool: Pool
  let runs: CountingGateway
  let sessionA = ''

  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_inspector')
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
    runs = new CountingGateway(pool)
    app = buildApp({ pool, runs, auth: true })

    const created = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(KEYS.operator.presented),
      payload: { title: 'Inspector A' },
    })
    expect(created.statusCode).toBe(201)
    sessionA = (created.json() as { data: { id: string } }).data.id
    runs.addRun(runInfo(`session-run-${sessionA}`, sessionA))

    const sessionPartition = `session:${sessionA}`
    await appendEvent(pool, {
      idempotencyKey: `insp-thread-${sessionA}`,
      partition: sessionPartition,
      type: 't.thread.state',
      payload: { threadKey: sessionPartition, status: 'PAUSED', acceptingSteer: true },
    })
    await appendEvent(pool, {
      idempotencyKey: `insp-gate-${sessionA}`,
      partition: sessionPartition,
      type: 't.approval.decided',
      payload: { approvalId: 'call-1', toolName: 'plan.write', decision: 'approved' },
    })
    await appendEvent(pool, {
      idempotencyKey: 'insp-operator-call-1',
      partition: 'approval:call-1',
      type: 't.approval.decided',
      payload: { approvalId: 'call-1', decision: 'approved' },
    })
    await appendEvent(pool, {
      idempotencyKey: `insp-art-stored-${sessionA}`,
      partition: `artifact:session:${sessionA}`,
      type: 't.artifact.stored',
      payload: { artifactId: 'art-1', name: 'plan.md', bytes: 12, sha256: 'abc' },
    })
    await appendEvent(pool, {
      idempotencyKey: `insp-art-indexed-${sessionA}`,
      partition: `artifact:session:${sessionA}`,
      type: 't.artifact.indexed',
      payload: { artifactId: 'art-1', name: 'plan.md' },
    })

    runs.getRunCalls = 0
    runs.listRunsCalls = 0
    runs.signals.length = 0
  })

  afterAll(async () => {
    await app?.close()
    await pool?.end()
  })

  it('renders state, timeline, approvals, artifacts, and keys from events', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/debug/runs/session-run-${sessionA}`,
      headers: authHeader(KEYS.operator.presented),
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as { ok: boolean; data: Record<string, unknown> }
    expect(body.ok).toBe(true)

    const run = body.data['run'] as { runId: string; sessionId: string }
    expect(run).toMatchObject({ runId: `session-run-${sessionA}`, sessionId: sessionA })

    const state = body.data['state'] as {
      eventCount: number
      lastSeq: number
      lastEventType: string
      threads: Array<{ threadKey: string; status: string }>
    }
    expect(state.eventCount).toBeGreaterThanOrEqual(3)
    expect(state.lastEventType).toBe('t.approval.decided')
    expect(state.threads).toContainEqual(
      expect.objectContaining({ threadKey: `session:${sessionA}`, status: 'PAUSED' }),
    )

    const timeline = body.data['timeline'] as Array<{ seq: number; type: string; key: string }>
    expect(timeline.map((entry) => entry.type)).toContain('t.approval.decided')
    expect(timeline.map((entry) => entry.type)).toContain('t.thread.state')
    expect(timeline[0]?.seq).toBeGreaterThan(0)

    const approvals = body.data['approvals'] as Array<{
      approvalId: string
      toolName?: string
      gateDecision?: string
      operatorDecision?: string
      events: Array<{ source: string }>
    }>
    expect(approvals).toHaveLength(1)
    expect(approvals[0]).toMatchObject({
      approvalId: 'call-1',
      toolName: 'plan.write',
      gateDecision: 'approved',
      operatorDecision: 'approved',
    })
    expect(approvals[0]?.events.map((event) => event.source).sort()).toEqual([
      'approval:call-1',
      `session:${sessionA}`,
    ])

    const artifacts = body.data['artifacts'] as Array<{
      artifactId: string
      stored: unknown
      indexed: unknown
    }>
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.artifactId).toBe('art-1')
    expect(artifacts[0]?.stored).toBeDefined()
    expect(artifacts[0]?.indexed).toBeDefined()

    const keys = body.data['idempotencyKeys'] as string[]
    expect(keys).toEqual(expect.arrayContaining([`insp-gate-${sessionA}`, `insp-art-stored-${sessionA}`]))
    expect([...keys].sort()).toEqual(keys)
  })

  it('accepts a raw session id and paginates the timeline', async () => {
    const bySession = await app.inject({
      method: 'GET',
      url: `/v1/debug/runs/${sessionA}`,
      headers: authHeader(KEYS.operator.presented),
    })
    expect(bySession.statusCode).toBe(200)

    const full = (
      bySession.json() as { data: { timeline: Array<{ seq: number }> } }
    ).data.timeline
    const paged = await app.inject({
      method: 'GET',
      url: `/v1/debug/runs/${sessionA}?afterSeq=${full[0]?.seq ?? 0}&limit=1`,
      headers: authHeader(KEYS.operator.presented),
    })
    expect(paged.statusCode).toBe(200)
    const entries = (paged.json() as { data: { timeline: Array<{ seq: number }> } }).data.timeline
    expect(entries).toHaveLength(1)
    expect(entries[0]?.seq).toBeGreaterThan(full[0]?.seq ?? 0)
  })

  it('rejects bad pagination without touching the gateway', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/debug/runs/${sessionA}?limit=5000`,
      headers: authHeader(KEYS.operator.presented),
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ ok: false, error: { code: 'validation_failed' } })
  })

  it('answers from events only: no gateway calls on any inspector read', async () => {
    const before = { get: runs.getRunCalls, list: runs.listRunsCalls, signals: runs.signals.length }
    for (const url of [
      `/v1/debug/runs/session-run-${sessionA}`,
      `/v1/debug/runs/${sessionA}`,
      `/v1/debug/runs/${sessionA}?limit=2`,
      '/v1/debug/runs/does-not-exist',
    ]) {
      await app.inject({ method: 'GET', url, headers: authHeader(KEYS.operator.presented) })
    }
    expect(runs.getRunCalls).toBe(before.get)
    expect(runs.listRunsCalls).toBe(before.list)
    expect(runs.signals.length).toBe(before.signals)
  })

  it('denies viewers and hides other tenants without a payload', async () => {
    const viewer = await app.inject({
      method: 'GET',
      url: `/v1/debug/runs/session-run-${sessionA}`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(viewer.statusCode).toBe(403)
    expect(viewer.json()).toMatchObject({ ok: false, error: { code: 'permission_denied' } })

    const crossTenant = await app.inject({
      method: 'GET',
      url: `/v1/debug/runs/session-run-${sessionA}`,
      headers: authHeader(KEYS.operatorB.presented),
    })
    expect(crossTenant.statusCode).toBe(404)
    expect(crossTenant.json()).not.toHaveProperty('data')

    const unknown = await app.inject({
      method: 'GET',
      url: '/v1/debug/runs/research-1',
      headers: authHeader(KEYS.operator.presented),
    })
    expect(unknown.statusCode).toBe(404)
    expect(unknown.json()).not.toHaveProperty('data')
  })
})
