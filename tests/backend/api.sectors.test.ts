// Sector research routes (B-S4). Viewer reads with state/text filters,
// 404s for unknown and cross-tenant ids, operator-only restart of failed
// sectors with 409 for anything else. Runs against the live database;
// without TEST_DATABASE_URL the suite skips explicitly.
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import {
  createSector,
  markCompanyFound,
  recordPlanVersion,
  setSectorState,
} from '../../backend/src/db/index.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''
const STAMP = randomUUID()

const KEYS = {
  operator: { presented: 'key-sec-operator', tenant: 'tenant-sec', project: null, role: 'operator' },
  viewer: { presented: 'key-sec-viewer', tenant: 'tenant-sec', project: null, role: 'viewer' },
  operatorB: { presented: 'key-sec-operator-b', tenant: 'tenant-sec-b', project: null, role: 'operator' },
} as const

function authHeader(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` }
}

describe.skipIf(!ENABLED)('sector research routes (B-S4)', () => {
  let app: FastifyInstance
  let pool: Pool
  let runsGateway: FakeRunsGateway
  const sector = `sec-api-${STAMP}`
  const failed = `sec-failed-${STAMP}`

  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_sectors_api')
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
    runsGateway = new FakeRunsGateway(pool)
    app = buildApp({ pool, runs: runsGateway, auth: true })
    const scope = { tenantId: 'tenant-sec', projectId: null }
    await createSector(pool, { name: 'Pet care', topic: 'D2C pet brands', scope, sectorId: sector })
    await createSector(pool, { name: 'Vintage hi-fi', topic: 'Used receivers', scope, sectorId: failed })
    await projectNewEvents(pool)
    await markCompanyFound(pool, {
      sectorId: sector,
      name: 'West Paw',
      stage: 'Final validation',
      state: 'running',
      scope,
      companyId: `com-api-${STAMP}`,
    })
    await projectNewEvents(pool)
    await setSectorState(pool, sector, 'running', { scope })
    await setSectorState(pool, failed, 'failed', { scope })
    await projectNewEvents(pool)
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await pool?.end()
  })

  it('lists sectors with counts and filters for viewers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/sectors',
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(response.statusCode).toBe(200)
    const data = (response.json() as { data: Array<Record<string, unknown>> }).data
    const pet = data.find((entry) => entry['id'] === sector)
    expect(pet).toMatchObject({ name: 'Pet care', state: 'running', companiesFound: 1 })

    const running = await app.inject({
      method: 'GET',
      url: '/v1/sectors?state=running',
      headers: authHeader(KEYS.viewer.presented),
    })
    const runningIds = (
      running.json() as { data: Array<Record<string, unknown>> }
    ).data.map((entry) => entry['id'])
    expect(runningIds).toContain(sector)
    expect(runningIds).not.toContain(failed)

    const queried = await app.inject({
      method: 'GET',
      url: '/v1/sectors?query=hi-fi',
      headers: authHeader(KEYS.viewer.presented),
    })
    const queriedIds = (
      queried.json() as { data: Array<Record<string, unknown>> }
    ).data.map((entry) => entry['id'])
    expect(queriedIds).toContain(failed)
    expect(queriedIds).not.toContain(sector)

    const bad = await app.inject({
      method: 'GET',
      url: '/v1/sectors?state=bogus',
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(bad.statusCode).toBe(400)
  })

  it('serves one sector with companies and activity', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/sectors/${sector}`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(response.statusCode).toBe(200)
    const data = response.json() as {
      data: {
        companiesFound: number
        companies: Array<Record<string, unknown>>
        companiesTotal: number
        activity: Array<{ text: string }>
        activityTotal: number
      }
    }
    expect(data.data.companiesFound).toBe(1)
    expect(data.data.companiesTotal).toBe(1)
    expect(data.data.companies[0]).toMatchObject({ name: 'West Paw', sectorName: 'Pet care' })
    expect(data.data.activityTotal).toBeGreaterThanOrEqual(data.data.activity.length)
    expect(data.data.activity.map((entry) => entry.text)).toContain(
      'Research started for D2C pet brands.',
    )

    const missing = await app.inject({
      method: 'GET',
      url: '/v1/sectors/sec-missing',
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(missing.statusCode).toBe(404)

    const cross = await app.inject({
      method: 'GET',
      url: `/v1/sectors/${sector}`,
      headers: authHeader(KEYS.operatorB.presented),
    })
    expect(cross.statusCode).toBe(404)
  })

  it('lists companies with sector names and filters', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/companies?sectorId=${sector}`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(response.statusCode).toBe(200)
    const data = (response.json() as { data: { companies: Array<Record<string, unknown>>; total: number } }).data
    expect(data.companies).toHaveLength(1)
    expect(data.total).toBe(1)
    expect(data.companies[0]).toMatchObject({ name: 'West Paw', stage: 'Final validation' })

    const paged = await app.inject({
      method: 'GET',
      url: `/v1/companies?sectorId=${sector}&limit=1&offset=1`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(paged.statusCode).toBe(200)
    const page = (paged.json() as { data: { companies: Array<Record<string, unknown>>; total: number } }).data
    expect(page.total).toBe(1)
    expect(page.companies).toHaveLength(0)

    const bad = await app.inject({
      method: 'GET',
      url: `/v1/companies?sectorId=${sector}&limit=501`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(bad.statusCode).toBe(400)
  })

  it('restarts failed sectors for operators only', async () => {
    const denied = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${failed}/restart`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(denied.statusCode).toBe(403)

    const missing = await app.inject({
      method: 'POST',
      url: '/v1/sectors/sec-missing/restart',
      headers: authHeader(KEYS.operator.presented),
    })
    expect(missing.statusCode).toBe(404)

    const conflict = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${sector}/restart`,
      headers: authHeader(KEYS.operator.presented),
    })
    expect(conflict.statusCode).toBe(409)

    const restarted = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${failed}/restart`,
      headers: { ...authHeader(KEYS.operator.presented), 'idempotency-key': `restart-${STAMP}` },
    })
    expect(restarted.statusCode).toBe(200)
    expect((restarted.json() as { data: Record<string, unknown> }).data).toMatchObject({
      id: failed,
      state: 'running',
    })
    // Restart ensures a real run behind the state, not a relabel.
    expect(runsGateway.startedSweeps).toContain(failed)

    // Same key replays the stored outcome without a second transition.
    const replayed = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${failed}/restart`,
      headers: { ...authHeader(KEYS.operator.presented), 'idempotency-key': `restart-${STAMP}` },
    })
    expect(replayed.statusCode).toBe(200)
  })

  it('pauses running sectors and resumes paused ones for operators only', async () => {
    const operator = authHeader(KEYS.operator.presented)
    const denied = await app.inject({ method: 'POST', url: `/v1/sectors/${sector}/pause`, headers: authHeader(KEYS.viewer.presented) })
    expect(denied.statusCode).toBe(403)

    const missing = await app.inject({ method: 'POST', url: '/v1/sectors/sec-missing/pause', headers: operator })
    expect(missing.statusCode).toBe(404)

    const paused = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${sector}/pause`,
      headers: { ...operator, 'idempotency-key': `pause-${STAMP}` },
    })
    expect(paused.statusCode).toBe(200)
    expect((paused.json() as { data: Record<string, unknown> }).data).toMatchObject({ id: sector, state: 'paused' })
    // Pause halts the run before recording the state.
    expect(runsGateway.cancelledSweeps).toContain(sector)

    const repause = await app.inject({ method: 'POST', url: `/v1/sectors/${sector}/pause`, headers: operator })
    expect(repause.statusCode).toBe(409)

    const resumeConflict = await app.inject({ method: 'POST', url: `/v1/sectors/${failed}/resume`, headers: operator })
    expect(resumeConflict.statusCode).toBe(409)

    const resumed = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${sector}/resume`,
      headers: { ...operator, 'idempotency-key': `resume-${STAMP}` },
    })
    expect(resumed.statusCode).toBe(200)
    expect((resumed.json() as { data: Record<string, unknown> }).data).toMatchObject({ id: sector, state: 'running' })
    // Resume ensures the run behind the state.
    expect(runsGateway.startedSweeps).toContain(sector)
  })

  it('plans drafts with a visible planning chat and reads the artifact', async () => {
    const operator = authHeader(KEYS.operator.presented)
    const created = await app.inject({
      method: 'POST',
      url: '/v1/sectors',
      headers: operator,
      payload: { name: `Plan me ${STAMP}`, topic: 'shaped in chat' },
    })
    expect(created.statusCode).toBe(201)
    const draft = (created.json() as { data: { id: string; state: string } }).data
    expect(draft.state).toBe('draft')

    const planned = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${draft.id}/plan`,
      headers: { ...operator, 'idempotency-key': `plan-${STAMP}` },
    })
    expect(planned.statusCode).toBe(200)
    expect((planned.json() as { data: Record<string, unknown> }).data).toMatchObject({
      id: draft.id,
      state: 'planning',
    })
    expect(runsGateway.startedPlans).toContain(draft.id)
    // The planning chat is visible in the sector pool immediately.
    const chats = await app.inject({
      method: 'GET',
      url: `/v1/sessions?sectorId=${draft.id}`,
      headers: operator,
    })
    expect(chats.statusCode).toBe(200)
    expect((chats.json() as { data: Array<{ title: string }> }).data.map((entry) => entry.title)).toContain(
      'Research plan',
    )

    const conflict = await app.inject({ method: 'POST', url: `/v1/sectors/${sector}/plan`, headers: operator })
    expect(conflict.statusCode).toBe(409)

    const empty = await app.inject({ method: 'GET', url: `/v1/sectors/${draft.id}/plan`, headers: operator })
    expect(empty.statusCode).toBe(200)
    expect((empty.json() as { data: { versions: unknown[]; latest: unknown } }).data).toMatchObject({
      versions: [],
      latest: null,
    })

    await recordPlanVersion(pool, draft.id, '## scope\nFoods.', `plan-test-${STAMP}`, {
      tenantId: 'tenant-sec',
      projectId: null,
    })
    await projectNewEvents(pool)
    const read = await app.inject({ method: 'GET', url: `/v1/sectors/${draft.id}/plan`, headers: operator })
    expect(read.statusCode).toBe(200)
    const artifact = (read.json() as { data: { versions: Array<{ version: number; markdown: string }>; latest: { version: number } } }).data
    expect(artifact.versions).toHaveLength(1)
    expect(artifact.latest.version).toBe(1)
    expect(artifact.versions[0]?.markdown).toContain('Foods')

    const missing = await app.inject({ method: 'GET', url: '/v1/sectors/sec-missing/plan', headers: operator })
    expect(missing.statusCode).toBe(404)
  })

  it('creates drafts, attaches context, and starts explicitly (never auto-research)', async () => {
    const operator = authHeader(KEYS.operator.presented)
    const viewer = authHeader(KEYS.viewer.presented)
    const created = await app.inject({
      method: 'POST',
      url: '/v1/sectors',
      headers: operator,
      payload: { name: `Draft ${STAMP}`, topic: 'shaped in chat' },
    })
    expect(created.statusCode).toBe(201)
    const draft = (created.json() as { data: { id: string; state: string } }).data
    expect(draft.state).toBe('draft')

    // Creation never queues research: still draft until start.
    const reread = await app.inject({ method: 'GET', url: `/v1/sectors/${draft.id}`, headers: viewer })
    expect(((reread.json() as { data: { state: string } }).data).state).toBe('draft')

    const attached = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${draft.id}/documents`,
      headers: operator,
      payload: {
        filename: 'gemini-dump.md',
        contentBase64: Buffer.from('# Speciality foods\n- insight one').toString('base64'),
      },
    })
    expect(attached.statusCode).toBe(201)
    expect((attached.json() as { data: Record<string, unknown> }).data).toMatchObject({
      filename: 'gemini-dump.md',
      mediaType: 'text/plain',
    })
    const listed = await app.inject({ method: 'GET', url: `/v1/sectors/${draft.id}/documents`, headers: viewer })
    expect(((listed.json() as { data: Array<{ filename: string }> }).data).map((doc) => doc.filename)).toEqual([
      'gemini-dump.md',
    ])

    const refused = await app.inject({ method: 'POST', url: `/v1/sectors/${draft.id}/start`, headers: operator })
    expect(refused.statusCode).toBe(409)

    // Plan-mandatory flow: plan, approve the version, then start.
    const planned = await app.inject({ method: 'POST', url: `/v1/sectors/${draft.id}/plan`, headers: operator })
    expect(planned.statusCode).toBe(200)
    await recordPlanVersion(pool, draft.id, '## scope\nShaped in chat.', `plan-approved-${STAMP}`, {
      tenantId: 'tenant-sec',
      projectId: null,
    })
    await projectNewEvents(pool)
    await setSectorState(pool, draft.id, 'planned', { scope: { tenantId: 'tenant-sec', projectId: null } })
    await projectNewEvents(pool)
    const approved = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${draft.id}/approve`,
      headers: operator,
      payload: { version: 1 },
    })
    expect(approved.statusCode).toBe(200)
    expect(((approved.json() as { data: { state: string } }).data).state).toBe('approved')

    const started = await app.inject({ method: 'POST', url: `/v1/sectors/${draft.id}/start`, headers: operator })
    expect(started.statusCode).toBe(200)
    expect(((started.json() as { data: { state: string } }).data).state).toBe('queued')
    // Explicit start launches exactly one sweep workflow for the sector
    // (other lifecycle tests record their own sectors in the shared fake).
    expect(runsGateway.startedSweeps.filter((id) => id === draft.id)).toEqual([draft.id])

    const again = await app.inject({ method: 'POST', url: `/v1/sectors/${draft.id}/start`, headers: operator })
    expect(again.statusCode).toBe(409)

    const unsupported = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${draft.id}/documents`,
      headers: operator,
      payload: { filename: 'deck.pptx', contentBase64: Buffer.from('junk').toString('base64') },
    })
    expect(unsupported.statusCode).toBe(400)
  })
})
