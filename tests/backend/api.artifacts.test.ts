// Artifact routes: files-menu metadata reads, index-gated body serving,
// cross-session references, and the tenant listing. Viewer-readable;
// references mutate, so they need the operator role. Cross-tenant ids 404
// with no payload.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { FilesystemTarget } from '../../backend/src/archive/targets.js'
import {
  storeAndIndex,
  storeArtifact,
  type ArtifactScope,
} from '../../backend/src/artifacts/pipeline.js'
import { appendEvent, findEventByKey } from '../../backend/src/db/index.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''

const KEYS = {
  operator: { presented: 'key-art-operator', tenant: 'tenant-a', project: null, role: 'operator' },
  viewer: { presented: 'key-art-viewer', tenant: 'tenant-a', project: null, role: 'viewer' },
  operatorB: { presented: 'key-art-operator-b', tenant: 'tenant-b', project: null, role: 'operator' },
} as const

function authHeader(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` }
}

describe.skipIf(!ENABLED)('session artifacts (files menu) [F:http.createSessionArtifact] [F:http.listSessionArtifacts] [F:http.getArtifactBody] [F:http.referenceArtifact] [F:http.listTenantArtifacts]', () => {
  let app: FastifyInstance
  let pool: Pool
  let archive: FilesystemTarget
  let sessionA = ''
  let servedId = ''
  let storedOnlyId = ''

  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_artifacts')
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
    archive = new FilesystemTarget(mkdtempSync(join(tmpdir(), 'kardata-art-api-')))
    app = buildApp({ pool, runs: new FakeRunsGateway(pool), auth: true, archiveTarget: archive })

    const created = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(KEYS.operator.presented),
      payload: { title: 'Artifacts A' },
    })
    expect(created.statusCode).toBe(201)
    sessionA = (created.json() as { data: { id: string } }).data.id

    await appendEvent(pool, {
      idempotencyKey: `art-stored-${sessionA}`,
      partition: `artifact:session:${sessionA}`,
      type: 't.artifact.stored',
      payload: { artifactId: 'art-1', name: 'plan.md', kind: 'note', bytes: 12, sha256: 'abc' },
    })
    await appendEvent(pool, {
      idempotencyKey: `art-indexed-${sessionA}`,
      partition: `artifact:session:${sessionA}`,
      type: 't.artifact.indexed',
      payload: { artifactId: 'art-1', name: 'plan.md', kind: 'note', detail: 'weekly plan' },
    })
    await appendEvent(pool, {
      idempotencyKey: `art-stored-only-${sessionA}`,
      partition: `artifact:session:${sessionA}`,
      type: 't.artifact.stored',
      payload: { artifactId: 'art-2', name: 'draft.md' },
    })
    // One real file with bytes behind it, for the body route.
    const scope: ArtifactScope = { kind: 'session', id: sessionA }
    const indexed = await storeAndIndex(
      archive,
      {
        scope,
        name: 'real.md',
        body: 'servable bytes',
        reason: 'subagent_output',
        producedBy: 'run-api',
      },
      {
        log: () => undefined,
        findEvent: (key) => findEventByKey(pool, key),
        record: (event) => appendEvent(pool, event).then(() => undefined),
      },
    )
    servedId = indexed.artifactId
    // One stored-but-never-indexed file, for the 409 path.
    const raw = await storeArtifact(
      archive,
      {
        scope,
        name: 'draft-real.md',
        body: 'not yet indexed',
        reason: 'user_upload',
        producedBy: 'run-api',
      },
      {
        log: () => undefined,
        findEvent: (key) => findEventByKey(pool, key),
        record: (event) => appendEvent(pool, event).then(() => undefined),
      },
    )
    storedOnlyId = raw.artifactId
  })

  afterAll(async () => {
    await app?.close()
    await pool?.end()
  })

  it('lists joined stored+indexed metadata for viewers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${sessionA}/artifacts`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(response.statusCode).toBe(200)
    const data = (response.json() as { data: Array<Record<string, unknown>> }).data
    expect(data).toHaveLength(4)
    expect(data[0]).toMatchObject({ artifactId: 'art-1', name: 'plan.md', indexed: true })
    expect(data[1]).toMatchObject({ artifactId: 'art-2', indexed: false })
    expect(data[2]).toMatchObject({
      name: 'real.md',
      indexed: true,
      reason: 'subagent_output',
      producedBy: 'run-api',
    })
    expect(data[3]).toMatchObject({ name: 'draft-real.md', indexed: false })
  })

  it('returns an empty list for sessions without artifacts', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(KEYS.operator.presented),
      payload: { title: 'Empty' },
    })
    const id = (created.json() as { data: { id: string } }).data.id
    const response = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${id}/artifacts`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(response.statusCode).toBe(200)
    expect((response.json() as { data: unknown[] }).data).toEqual([])
  })

  it('hides cross-tenant and unknown sessions without a payload', async () => {
    const cross = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${sessionA}/artifacts`,
      headers: authHeader(KEYS.operatorB.presented),
    })
    expect(cross.statusCode).toBe(404)
    expect(cross.json()).not.toHaveProperty('data')

    const unknown = await app.inject({
      method: 'GET',
      url: '/v1/sessions/does-not-exist/artifacts',
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(unknown.statusCode).toBe(404)
  })

  it('serves indexed bytes with provenance for viewers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${sessionA}/artifacts/${servedId}/body`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(response.statusCode).toBe(200)
    const data = (response.json() as { data: { body: string; meta: Record<string, unknown> } }).data
    expect(data.body).toBe('servable bytes')
    expect(data.meta).toMatchObject({
      artifactId: servedId,
      reason: 'subagent_output',
      producedBy: 'run-api',
    })
  })

  it('refuses unknown artifacts with 404 and unindexed bytes with 409', async () => {
    const missing = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${sessionA}/artifacts/art-missing/body`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).not.toHaveProperty('data')

    const unindexed = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${sessionA}/artifacts/${storedOnlyId}/body`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(unindexed.statusCode).toBe(409)
    expect((unindexed.json() as { error: { code: string } }).error.code).toBe('conflict')

    const cross = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${sessionA}/artifacts/${servedId}/body`,
      headers: authHeader(KEYS.operatorB.presented),
    })
    expect(cross.statusCode).toBe(404)
  })

  it('creates session files for operators, never viewers', async () => {
    const denied = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionA}/artifacts`,
      headers: authHeader(KEYS.viewer.presented),
      payload: { name: 'report.md', content: '# findings' },
    })
    expect(denied.statusCode).toBe(403)

    const created = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionA}/artifacts`,
      headers: authHeader(KEYS.operator.presented),
      payload: { name: 'report.md', content: '# findings', kind: 'report', reason: 'report' },
    })
    expect(created.statusCode).toBe(201)
    const summary = (created.json() as { data: { artifactId: string; name: string } }).data
    expect(summary.name).toBe('report.md')

    // The file is immediately servable through the body route.
    const served = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${sessionA}/artifacts/${summary.artifactId}/body`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(served.statusCode).toBe(200)
    expect((served.json() as { data: { body: string } }).data.body).toBe('# findings')

    const missing = await app.inject({
      method: 'POST',
      url: '/v1/sessions/s-nope/artifacts',
      headers: authHeader(KEYS.operator.presented),
      payload: { name: 'r.md', content: 'x' },
    })
    expect(missing.statusCode).toBe(404)
  })

  it('attaches files across sessions for operators, never viewers', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: authHeader(KEYS.operator.presented),
      payload: { title: 'Attach target' },
    })
    const target = (created.json() as { data: { id: string } }).data.id

    const denied = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${target}/artifacts/references`,
      headers: authHeader(KEYS.viewer.presented),
      payload: { artifactId: servedId, fromScope: { kind: 'session', id: sessionA } },
    })
    expect(denied.statusCode).toBe(403)

    const attached = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${target}/artifacts/references`,
      headers: authHeader(KEYS.operator.presented),
      payload: { artifactId: servedId, fromScope: { kind: 'session', id: sessionA } },
    })
    expect(attached.statusCode).toBe(201)
    const summary = (attached.json() as { data: Record<string, unknown> }).data
    expect(summary).toMatchObject({
      artifactId: servedId,
      indexed: true,
      referencedFrom: { kind: 'session', id: sessionA },
    })

    // The attached file serves from the new session through the owner index.
    const served = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${target}/artifacts/${servedId}/body`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(served.statusCode).toBe(200)
    expect((served.json() as { data: { body: string } }).data.body).toBe('servable bytes')

    const unknown = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${target}/artifacts/references`,
      headers: authHeader(KEYS.operator.presented),
      payload: { artifactId: 'art-missing', fromScope: { kind: 'session', id: sessionA } },
    })
    expect(unknown.statusCode).toBe(404)
  })

  it('lists tenant files for attach discovery, hiding other tenants', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/artifacts',
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(response.statusCode).toBe(200)
    const data = (response.json() as { data: Array<Record<string, unknown>> }).data
    const ids = data.map((entry) => `${entry['sessionId']}:${entry['artifactId']}`)
    expect(ids).toContain(`${sessionA}:${servedId}`)
    for (const entry of data) expect(entry['sessionId']).toBeTruthy()

    const foreign = await app.inject({
      method: 'GET',
      url: '/v1/artifacts',
      headers: authHeader(KEYS.operatorB.presented),
    })
    expect(foreign.statusCode).toBe(200)
    expect((foreign.json() as { data: unknown[] }).data).toEqual([])
  })
})
