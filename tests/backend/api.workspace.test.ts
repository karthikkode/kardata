// Workspace routes: global context, file library, thread context,
// research session, and progress. Live-app suite, skipped explicitly
// without TEST_DATABASE_URL. Guards the regression where the UI called
// these endpoints against a server that never registered them: every
// assertion first rules out the `no route` 404 before checking payload.
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { beginThreadTurn, consumeSteering, enqueueSteering, finishSteering, createSector } from '../../backend/src/db/index.js'
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

describe.skipIf(!ENABLED)('workspace routes [F:http.listSteeringReceipts] [F:http.getGlobalContext] [F:http.listSectorFiles] [F:http.attachSectorDocument] [F:http.getSectorFileBody] [F:http.setSectorFileVisibility] [F:http.proposeGlobalContext] [F:http.decideContextProposal] [F:http.ensureSectorResearchSession] [F:http.getLocalContext] [F:http.compactLocalContext] [F:http.editLocalContext] [F:http.requestFileContext] [F:http.getResearchProgress]', () => {
  let app: FastifyInstance
  let pool: Pool
  const sector = `sec-workspace-${STAMP}`
  const scope = { tenantId: 'tenant-ws', projectId: null }
  let sessionId = ''
  const archived = new Map<string, string>()

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
    app = buildApp({ pool, runs: new FakeRunsGateway(pool), auth: true, archiveTarget: {
      async write(key, body) { archived.set(key, body) },
      async read(key) { return archived.get(key) },
      async list(prefix) { return [...archived.keys()].filter((key) => key.startsWith(prefix)) },
    } })
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

  it('reads durable steering outcomes in bounded pages with owning-thread authority', async () => {
    await beginThreadTurn(pool, sessionId, 'TEST receipt operation')
    await enqueueSteering(pool, sessionId, 'TEST consumed instruction', 'TEST-receipt-a', scope)
    await consumeSteering(pool, sessionId, 'TEST receipt operation', 1)
    await enqueueSteering(pool, sessionId, 'TEST missed instruction', 'TEST-receipt-b', scope)
    await finishSteering(pool, sessionId, 'TEST receipt operation')
    const url = `/v1/threads/${sessionId}/steering-receipts`
    const first = await app.inject({ method: 'GET', url: `${url}?limit=1`, headers: authHeader(KEYS.viewer.presented) })
    expect(first.statusCode).toBe(200)
    expect(first.json().data).toEqual({ items: [{ id: 'TEST-receipt-a', state: 'consumed' }], nextAfterId: 'TEST-receipt-a' })
    const next = await app.inject({ method: 'GET', url: `${url}?limit=1&afterId=TEST-receipt-a`, headers: authHeader(KEYS.viewer.presented) })
    expect(next.json().data).toEqual({ items: [{ id: 'TEST-receipt-b', state: 'missed' }], nextAfterId: null })
    expect((await app.inject({ method: 'GET', url: `${url}?limit=201`, headers: authHeader(KEYS.viewer.presented) })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(403)
    // A foreign scope is checked at the DB authority boundary as well as HTTP.
    const { readSteeringReceiptsPage } = await import('../../backend/src/db/index.js')
    await expect(readSteeringReceiptsPage(pool, sessionId, '', 200, { tenantId: 'TEST foreign', projectId: null })).rejects.toMatchObject({ code: 'not_found' })
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

  it('serves exact uploaded bytes and extracted text, denies hidden reads, then reveals the same version', async () => {
    const headers = authHeader(KEYS.approver.presented)
    const original = '# TEST evidence\nA real indexed unit for a synthetic test.'
    const upload = await app.inject({ method: 'POST', url: `/v1/sectors/${sector}/documents`, headers, payload: { filename: 'test-evidence.md', contentBase64: Buffer.from(original).toString('base64') } })
    expect(upload.statusCode).toBe(201)
    const fileId = upload.json<{ data: { id: string } }>().data.id
    const path = `/v1/sectors/${sector}/files/${fileId}`
    const read = await app.inject({ method: 'GET', url: `${path}/body`, headers })
    expect(read.statusCode).toBe(200)
    expect(read.json<{ data: { text: string; contentBase64: string; originalAvailable: boolean } }>().data).toMatchObject({ text: original, contentBase64: Buffer.from(original).toString('base64'), originalAvailable: true })
    expect((await app.inject({ method: 'PATCH', url: path, headers, payload: { hidden: true } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `${path}/body`, headers })).statusCode).toBe(403)
    expect((await app.inject({ method: 'PATCH', url: path, headers, payload: { hidden: false } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `${path}/body`, headers })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/v1/sectors/another-sector/files/${fileId}/body`, headers })).statusCode).toBe(404)
  })
  it('retains different original uploads with the same filename when OCR is unavailable', async () => {
    vi.stubEnv('KARDATA_OCR_DISABLED', '1')
    try {
      const headers = authHeader(KEYS.approver.presented)
      const originals = [Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('TEST image version one')]), Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('TEST image version two')])]
      const ids: string[] = []
      for (const original of originals) {
        const uploaded = await app.inject({ method: 'POST', url: `/v1/sectors/${sector}/documents`, headers, payload: { filename: 'test-scan.png', contentBase64: Buffer.from(original).toString('base64') } })
        expect(uploaded.statusCode).toBe(201)
        const data = uploaded.json<{ data: { id: string; status: string } }>().data
        expect(data.status).toBe('needs-ocr')
        ids.push(data.id)
      }
      expect(new Set(ids).size).toBe(2)
      for (let index = 0; index < ids.length; index++) {
        const read = await app.inject({ method: 'GET', url: `/v1/sectors/${sector}/files/${ids[index]}/body`, headers })
        expect(read.statusCode).toBe(200)
        expect(read.json<{ data: { contentBase64: string } }>().data.contentBase64).toBe(Buffer.from(originals[index]!).toString('base64'))
      }
    } finally { vi.unstubAllEnvs() }
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

  it('edits local thread notes under the version guard', async () => {
    const read = await app.inject({
      method: 'GET',
      url: `/v1/threads/${sessionId}/context`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(read.statusCode).toBe(200)
    const version = read.json<{ data: { version: number } }>().data.version
    const saved = await app.inject({
      method: 'PATCH',
      url: `/v1/threads/${sessionId}/context`,
      headers: authHeader(KEYS.operator.presented),
      payload: { version, notes: 'TEST edited notes' },
    })
    expect(saved.statusCode).toBe(200)
    notNoRoute(saved.json())
    expect(saved.json<{ data: { version: number; notes: string } }>().data).toMatchObject({
      version: version + 1,
      notes: 'TEST edited notes',
    })
    const reread = await app.inject({
      method: 'GET',
      url: `/v1/threads/${sessionId}/context`,
      headers: authHeader(KEYS.viewer.presented),
    })
    expect(reread.json<{ data: { notes: string } }>().data.notes).toBe('TEST edited notes')
    const stale = await app.inject({
      method: 'PATCH',
      url: `/v1/threads/${sessionId}/context`,
      headers: authHeader(KEYS.operator.presented),
      payload: { version, notes: 'TEST stale notes' },
    })
    expect(stale.statusCode).toBe(409)
  })

  it('proposes indexed file units into global context', async () => {
    const headers = authHeader(KEYS.operator.presented)
    const upload = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${sector}/documents`,
      headers,
      payload: { filename: 'test-context.md', contentBase64: Buffer.from('# TEST context\nA unit for file context proposals.').toString('base64') },
    })
    expect(upload.statusCode).toBe(201)
    const fileId = upload.json<{ data: { id: string } }>().data.id
    const reread = await app.inject({
      method: 'GET',
      url: `/v1/sectors/${sector}/global-context`,
      headers: authHeader(KEYS.viewer.presented),
    })
    const baseVersion = reread.json<{ data: { version: number } }>().data.version
    const proposed = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${sector}/files/${fileId}/context`,
      headers,
      payload: { baseVersion, sourceThread: sessionId },
    })
    expect(proposed.statusCode).toBe(200)
    notNoRoute(proposed.json())
    const change = proposed.json<{ data: { id: string; fileRef: { fileId: string; ords: number[] } } }>().data
    expect(typeof change.id).toBe('string')
    expect(change.fileRef.fileId).toBe(fileId)
    expect(change.fileRef.ords.length).toBeGreaterThan(0)
    const unknown = await app.inject({
      method: 'POST',
      url: `/v1/sectors/${sector}/files/${fileId}/context`,
      headers,
      payload: { baseVersion, sourceThread: sessionId, ords: [99999] },
    })
    expect(unknown.statusCode).toBe(400)
  })
})
