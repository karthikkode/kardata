// Sector context endpoints (Phase B). Gated live-app suite, skipped
// explicitly without TEST_DATABASE_URL. Proves the Context button payload:
// verbatim segments with estimates, unit exclusion round-trips, operator-
// only mutation, and 404s for unknown sectors.
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
  operator: { presented: 'key-ctx-operator', tenant: 'tenant-ctx', project: null, role: 'operator' },
  viewer: { presented: 'key-ctx-viewer', tenant: 'tenant-ctx', project: null, role: 'viewer' },
} as const

function authHeader(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` }
}

interface ContextFile {
  id: string
  filename: string
  status: string
  sha256: string
  units: Array<{ ord: number; kind: string; text: string; excluded: boolean }>
}

interface ContextPayload {
  sectorId: string
  digest: { version: string; text: string }
  segments: { system: string; references: string[]; history: string[]; tail: string[] }
  usage: { totalEstimatedTokens: number }
  files: ContextFile[]
  notes: Array<{ id: string; text: string }>
}

async function getContext(app: FastifyInstance, sectorId: string, key: string): Promise<{ status: number; payload: ContextPayload }> {
  const response = await app.inject({ method: 'GET', url: `/v1/sectors/${sectorId}/context`, headers: authHeader(key) })
  return { status: response.statusCode, payload: response.json<{ data: ContextPayload }>().data }
}

describe.skipIf(!ENABLED)('sector context routes (Phase B)', () => {
  let app: FastifyInstance
  let pool: Pool
  const sector = `sec-ctx-${STAMP}`
  const scope = { tenantId: 'tenant-ctx', projectId: null }

  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_sector_context')
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
    const runsGateway = new FakeRunsGateway(pool)
    app = buildApp({ pool, runs: runsGateway, auth: true })
    await createSector(pool, { name: 'Context sector', topic: 'Everything visible', scope, sectorId: sector })
    await projectNewEvents(pool)
    const attached = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${sector}/documents`,
      headers: { ...authHeader(KEYS.operator.presented) },
      payload: {
        // Sized past the 2000-char chunker cap so the file indexes as two
        // units (heading + first fact pack into unit 0, second fact spills
        // into unit 1): the verbatim and exclude flows need units[1].
        filename: 'notes.md',
        contentBase64: Buffer.from(`# Brief\n\n${'First fact. '.repeat(150)}\n\n${'Second fact. '.repeat(150)}`).toString('base64'),
      },
    })
    expect(attached.statusCode).toBe(201)
  }, 120_000)

  afterAll(async () => {
    await app?.close()
    await pool?.end()
  })

  it('shows verbatim segments with estimates for viewers', async () => {
    const { status, payload } = await getContext(app, sector, KEYS.viewer.presented)
    expect(status).toBe(200)
    expect(payload.sectorId).toBe(sector)
    expect(payload.segments.system).toContain('Context sector')
    expect(payload.digest.version).toMatch(/^[0-9a-f]{12}$/)
    expect(payload.segments.references[0]).toBe(payload.digest.text)
    expect(payload.segments.references[0]).not.toContain(payload.digest.version)
    expect(payload.segments.references.join('\n')).toContain('[notes.md:')
    expect(payload.segments.references.join('\n')).toContain('First fact.')
    expect(payload.usage.totalEstimatedTokens).toBeGreaterThan(0)
    expect(payload.files).toHaveLength(1)
    expect(payload.files[0]).toMatchObject({ filename: 'notes.md', status: 'indexed' })
    expect(payload.files[0]?.units.length).toBeGreaterThan(1)
    expect(typeof payload.files[0]?.sha256).toBe('string')
  })

  it('excludes and re-includes a unit for operators only', async () => {
    const before = (await getContext(app, sector, KEYS.viewer.presented)).payload
    const target = before.files[0]?.units[1]
    expect(target).toBeDefined()
    const patched = await app.inject({
      method: 'PATCH',
      url: `/v1/sectors/${sector}/context`,
      headers: { ...authHeader(KEYS.operator.presented) },
      payload: { exclude: [{ documentId: before.files[0]?.id, ord: target?.ord }] },
    })
    expect(patched.statusCode).toBe(200)
    const excluded = (await getContext(app, sector, KEYS.viewer.presented)).payload
    expect(excluded.files[0]?.units.find((unit) => unit.ord === target?.ord)?.excluded).toBe(true)
    expect(excluded.segments.references.join('\n')).not.toContain(target?.text ?? '###-never-present')
    const restored = await app.inject({
      method: 'PATCH',
      url: `/v1/sectors/${sector}/context`,
      headers: { ...authHeader(KEYS.operator.presented) },
      payload: { include: [{ documentId: before.files[0]?.id, ord: target?.ord }] },
    })
    expect(restored.statusCode).toBe(200)
    const after = (await getContext(app, sector, KEYS.viewer.presented)).payload
    expect(after.files[0]?.units.find((unit) => unit.ord === target?.ord)?.excluded).toBe(false)
    expect(after.segments.references.join('\n')).toContain(target?.text ?? '')
    const denied = await app.inject({
      method: 'PATCH',
      url: `/v1/sectors/${sector}/context`,
      headers: { ...authHeader(KEYS.viewer.presented) },
      payload: { exclude: [] },
    })
    expect(denied.statusCode).toBe(403)
  })

  it('stores user context notes', async () => {
    const created = await app.inject({
      method: 'PATCH',
      url: `/v1/sectors/${sector}/context`,
      headers: { ...authHeader(KEYS.operator.presented) },
      payload: { notes: ['Focus on pricing evidence.'] },
    })
    expect(created.statusCode).toBe(200)
    const { payload } = await getContext(app, sector, KEYS.viewer.presented)
    expect(payload.notes.map((note) => note.text)).toContain('Focus on pricing evidence.')
    expect(payload.segments.references.join('\n')).toContain('Focus on pricing evidence.')
  })

  it('404s unknown sectors', async () => {
    const missing = await app.inject({
      method: 'GET',
      url: '/v1/sectors/sec-nope/context',
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(missing.statusCode).toBe(404)
  })
})
