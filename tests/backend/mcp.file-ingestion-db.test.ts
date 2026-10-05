// Actual keyed HTTP/MCP, isolated Postgres and filesystem admission. The runner
// only records starts: no provider/Temporal execution or live research claim.
import { createHmac, randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { FilesystemTarget } from '../../backend/src/archive/targets.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { appendEvent, createSector, ensureResearchSession, listSectorDocuments, listSectorLibrary, readGlobalContext, readPartition, registerApiKey } from '../../backend/src/db/index.js'
import { listSectorFileProcessing } from '../../backend/src/db/file-jobs.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import type { RunsGateway } from '../../backend/src/temporal/runs-types.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { testPdf } from './pdf-fixtures.js'

describe.skipIf(!TEST_DATABASE_URL)('scoped full-PDF admission through HTTP/MCP', () => {
  let pool: Pool, app: FastifyInstance, archive: FilesystemTarget, sectorId: string, secondSector: string, child: string
  const scope = { tenantId: 'TEST PDF attachment tenant', projectId: null }, foreign = { tenantId: 'TEST foreign PDF tenant', projectId: null }
  const workerToken = 'TEST PDF execution binding', operator = 'TEST PDF operator', viewer = 'TEST PDF viewer', foreignKey = 'TEST foreign PDF operator'
  const calls: Array<[string, number]> = []
  const runs = { startFileProcessing: async (jobId: string, revision: number) => { calls.push([jobId, revision]) } } as unknown as RunsGateway
  let nonce = 0
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_mcp_pdf_attach'), max: 5 })
    archive = new FilesystemTarget(mkdtempSync(join(tmpdir(), 'kardata-test-mcp-pdf-')))
    vi.stubEnv('KARDATA_MCP_TOKEN', workerToken)
    for (const [keyId, key, role, keyScope] of [['TEST operator', operator, 'operator', scope], ['TEST viewer', viewer, 'viewer', scope], ['TEST foreign operator', foreignKey, 'operator', foreign]] as const) await registerApiKey(pool, { keyId, keyHash: hashKey(key), role, scope: keyScope })
    sectorId = (await createSector(pool, { name: 'TEST full PDF sector', scope })).sectorId
    secondSector = (await createSector(pool, { name: 'TEST other same-tenant PDF sector', scope })).sectorId
    await projectNewEvents(pool)
    const research = await ensureResearchSession(pool, sectorId, scope)
    const childId = `TEST-pdf-child-${randomUUID()}`; child = `agent:${childId}`
    await appendEvent(pool, { idempotencyKey: childId, partition: `session:${research.id}`, type: 't.subagent.launched', payload: { sessionId: research.id, parentSessionId: research.id, childId, name: 'TEST PDF child', canDelegate: false } })
    await projectNewEvents(pool)
    app = buildApp({ pool, runs, archiveTarget: archive, auth: true, rateLimitPerMin: 0 })
  })
  afterAll(async () => { await app?.close(); await pool?.end(); vi.unstubAllEnvs() })
  async function rpc(target: FastifyInstance, arguments_: unknown, key = operator, thread?: string) {
    const response = await target.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${key}`, ...(thread ? { 'x-kardata-thread': thread, 'x-kardata-execution': createHmac('sha256', workerToken).update(thread).digest('hex') } : {}) }, payload: { jsonrpc: '2.0', id: ++nonce, method: 'tools/call', params: { name: 'db.attach_sector_document', arguments: arguments_ } } })
    return { response, result: response.json().result as { isError?: boolean; content: Array<{ text: string }> } }
  }
  const contentBase64 = () => testPdf(true).toString('base64')
  it('coalesces actual HTTP and child-MCP uploads, retains originals and records only actual source identity', async () => {
    const body = { filename: 'TEST shared full.pdf', contentBase64: contentBase64() }
    const before = await readGlobalContext(pool, sectorId, scope)
    const http = await app.inject({ method: 'POST', url: `/v1/sectors/${sectorId}/documents`, headers: { authorization: `Bearer ${operator}` }, payload: body })
    expect(http.statusCode).toBe(201)
    const uploaded = http.json().data
    expect(uploaded).toMatchObject({ status: 'processing', unitCount: 0, chars: 0, processing: { state: 'queued', totalImages: null } })
    const call = await rpc(app, { sectorId, ...body, sourceThread: 'TEST forged owner', owner: true }, operator, child)
    expect(call.response.statusCode).toBe(200); expect(call.result.isError).not.toBe(true)
    const attached = JSON.parse(call.result.content[0]!.text)
    expect(attached.id).toBe(uploaded.id); expect(attached.processing.jobId).toBe(uploaded.processing.jobId)
    expect((await listSectorDocuments(pool, sectorId, scope)).filter((file) => file.id === uploaded.id)).toHaveLength(1)
    const sources = (await readPartition(pool, `sector:${sectorId}`)).filter((event) => event.type === 'sector.file.processing.source')
    expect(sources.map((event) => event.payload)).toContainEqual({ jobId: uploaded.processing.jobId, fileId: uploaded.id, sourceThread: child })
    expect(JSON.stringify(sources)).not.toContain('TEST forged owner')
    expect((await readGlobalContext(pool, sectorId, scope)).sections).toEqual(before.sections)
    expect((await listSectorLibrary(pool, sectorId, scope)).find((file) => file.id === uploaded.id)?.included).toBe(false)
    expect(calls.filter(([id]) => id === uploaded.processing.jobId).every(([, revision]) => revision === 0)).toBe(true)
    const original = await app.inject({ method: 'GET', url: `/v1/sectors/${sectorId}/files/${uploaded.id}/body`, headers: { authorization: `Bearer ${operator}` } })
    expect(original.statusCode).toBe(200); expect(original.json().data.contentBase64).toBe(body.contentBase64)
  })
  it('denies foreign tenant, under-role and a bound child changing sectors before file publication', async () => {
    const before = await listSectorDocuments(pool, sectorId, scope, true)
    const input = { sectorId, filename: 'TEST denied.pdf', contentBase64: contentBase64() }
    for (const [key, thread, args] of [[foreignKey, undefined, input], [viewer, undefined, input], [operator, child, { ...input, sectorId: secondSector }]] as const) {
      const result = await rpc(app, args, key, thread)
      expect(result.result.isError).toBe(true)
    }
    expect(await listSectorDocuments(pool, sectorId, scope, true)).toEqual(before)
    expect(await listSectorDocuments(pool, secondSector, scope, true)).toEqual([])
  })
  it('keeps missing-runner and invalid-byte requests outside the retained file/job inventory', async () => {
    const noRunner = buildApp({ pool, archiveTarget: archive, auth: true, rateLimitPerMin: 0 })
    const before = await listSectorFileProcessing(pool, sectorId, scope)
    try {
      const blocked = await rpc(noRunner, { sectorId, filename: 'TEST no runner.pdf', contentBase64: testPdf(false).toString('base64') })
      expect(blocked.result.isError).toBe(true); expect(blocked.result.content[0]!.text).toContain('unconfigured')
      const invalid = await rpc(app, { sectorId, filename: 'TEST invalid.pdf', contentBase64: '!!!' })
      expect(invalid.result.isError).toBe(true); expect(invalid.result.content[0]!.text).toContain('validation_failed')
      expect(await listSectorFileProcessing(pool, sectorId, scope)).toEqual(before)
    } finally { await noRunner.close() }
  })
  it('coalesces concurrent new PDF admissions into one retained document/job with stable revision', async () => {
    const payload = { sectorId, filename: 'TEST concurrent native.pdf', contentBase64: testPdf(false).toString('base64') }
    const results = await Promise.all(Array.from({ length: 6 }, () => rpc(app, payload)))
    expect(results.every((result) => !result.result.isError)).toBe(true)
    const records = results.map((result) => JSON.parse(result.result.content[0]!.text))
    expect(new Set(records.map((record) => record.id)).size).toBe(1)
    expect(new Set(records.map((record) => record.processing.jobId)).size).toBe(1)
    expect(records.every((record) => record.status === 'processing' && record.processing.revision === 0)).toBe(true)
    expect((await listSectorDocuments(pool, sectorId, scope)).filter((file) => file.id === records[0].id)).toHaveLength(1)
  })
})
