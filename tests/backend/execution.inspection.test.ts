import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { FilesystemTarget, persistExecutionRecord, type ArchivedExecutionRecord } from '../../backend/src/archive/targets.js'
import { beginThreadTurn, createSession, listThreadExecutionRecords, recordTurnExecution, registerApiKey } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('keyed execution inspection over real HTTP', () => {
  let pool: Pool, app: FastifyInstance, endpoint: string, sessionId: string, lease: string, directory: string, archive: FilesystemTarget
  const scope = { tenantId: 'TEST execution inspection', projectId: null }
  const key = (role: string) => `TEST execution inspection ${role}`
  const refs: ArchivedExecutionRecord[] = []
  const seqs: number[] = []
  async function get(path: string, role = 'approver') {
    const response = await fetch(`${endpoint}${path}`, { headers: { authorization: `Bearer ${key(role)}` } })
    return { status: response.status, body: await response.json() as { ok: boolean; data?: { records?: Array<{ seq: number; ref: { hash: string; bytes: number } }>; nextAfterSeq?: number | null; record?: Record<string, unknown> }; error?: { code: string; message: string } } }
  }
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_execution_inspect') })
    directory = mkdtempSync(join(tmpdir(), 'kardata-test-execution-inspection-'))
    archive = new FilesystemTarget(directory)
    for (const role of ['approver','operator','viewer','foreign'] as const) {
      await registerApiKey(pool, { keyId: `TEST inspect ${role}`, keyHash: hashKey(key(role)), role: role === 'foreign' ? 'approver' : role, scope: role === 'foreign' ? { tenantId: 'TEST unrelated inspection tenant', projectId: null } : scope })
    }
    const session = await createSession(pool, 'TEST archived private session', scope)
    sessionId = session.id
    await projectNewEvents(pool)
    lease = await beginThreadTurn(pool, sessionId, 'TEST inspected run')
    for (let index = 0; index < 22; index++) {
      const ref = await persistExecutionRecord(archive, sessionId, { version: 1, provider: 'TEST', model: 'TEST', round: index + 1, boundary: { contextVersion: 4, planVersion: 2 }, data: { text: `TEST private body ${index}`, usage: { cacheReadTokens: index } } })
      refs.push(ref)
      await recordTurnExecution(pool, { sessionId, threadKey: sessionId, runKey: 'TEST inspected run', lease, round: index + 1, kind: 'response', ref })
    }
    seqs.push(...(await listThreadExecutionRecords(pool, sessionId, scope, 0, 100)).records.map((entry) => entry.seq))
    app = buildApp({ pool, archiveTarget: archive, auth: true })
    endpoint = await app.listen({ host: '127.0.0.1', port: 0 })
  })
  afterAll(async () => { await app?.close(); await pool?.end() })
  it('returns bounded chronological metadata without private bodies or archive keys', async () => {
    let after = 0
    const collected: number[] = []
    for (let page = 0; page < 4; page++) {
      const result = await get(`/v1/threads/${sessionId}/execution-records?limit=7&afterSeq=${after}`)
      expect(result.status).toBe(200)
      const records = result.body.data!.records!
      expect(records.length).toBeLessThanOrEqual(7)
      expect(JSON.stringify(result.body)).not.toContain('TEST private body')
      expect(JSON.stringify(result.body)).not.toContain('execution-records/')
      collected.push(...records.map((entry) => entry.seq))
      if (result.body.data!.nextAfterSeq === null) break
      after = result.body.data!.nextAfterSeq!
    }
    expect(collected).toEqual(seqs)
    expect(new Set(collected).size).toBe(22)
  })
  it('requires a registered approver even in open mode and denies foreign conversation access', async () => {
    for (const role of ['operator','viewer','unregistered']) expect((await get(`/v1/threads/${sessionId}/execution-records`, role)).status).toBe(403)
    expect((await get(`/v1/threads/${sessionId}/execution-records`, 'foreign')).status).toBe(404)
    expect((await get(`/v1/threads/${sessionId}/execution-records/${seqs[0]}`, 'operator')).status).toBe(403)
    expect((await get(`/v1/threads/${sessionId}/execution-records/${seqs[0]}`, 'foreign')).status).toBe(404)
    const open = buildApp({ pool, archiveTarget: archive, auth: false })
    try {
      expect((await open.inject({ method: 'GET', url: `/v1/threads/${sessionId}/execution-records` })).statusCode).toBe(403)
      expect((await open.inject({ method: 'GET', url: `/v1/threads/${sessionId}/execution-records/${seqs[0]}` })).statusCode).toBe(403)
    } finally { await open.close() }
  })
  it('validates all cursor boundaries and rejects a sequence from another same-tenant conversation', async () => {
    for (const query of ['limit=0','limit=101','limit=1.5','afterSeq=-1','afterSeq=9007199254740992','unexpected=TEST']) expect((await get(`/v1/threads/${sessionId}/execution-records?${query}`)).status).toBe(400)
    for (const seq of ['0','-1','1.5','9007199254740992']) expect((await get(`/v1/threads/${sessionId}/execution-records/${seq}`)).status).toBe(400)
    const other = await createSession(pool, 'TEST same tenant other conversation', scope)
    await projectNewEvents(pool)
    expect((await get(`/v1/threads/${other.id}/execution-records/${seqs[0]}`)).status).toBe(404)
  })
  it('returns the exact owner-authorized object and honestly reports corrupt content', async () => {
    const result = await get(`/v1/threads/${sessionId}/execution-records/${seqs[0]}`)
    expect(result.status).toBe(200)
    expect(result.body.data!.record).toMatchObject({ version: 1, boundary: { contextVersion: 4, planVersion: 2 }, data: { text: 'TEST private body 0' } })
    writeFileSync(join(directory, refs[21]!.key), 'TEST corrupted owned archive fixture')
    const corrupt = await get(`/v1/threads/${sessionId}/execution-records/${seqs[21]}`)
    expect(corrupt.status).toBe(409)
    expect(corrupt.body.error?.code).toBe('conflict')
    expect(corrupt.body.error?.message).not.toContain('TEST corrupted')
  })
  it('rejects a foreign archive namespace before publishing a pointer', async () => {
    const foreign = await persistExecutionRecord(archive, 'TEST foreign session', { text: 'TEST foreign content' })
    await expect(recordTurnExecution(pool, { sessionId, threadKey: sessionId, runKey: 'TEST inspected run', lease, round: 99, kind: 'response', ref: foreign })).rejects.toMatchObject({ code: 'permission_denied' })
    expect((await listThreadExecutionRecords(pool, sessionId, scope, 0, 100)).records).toHaveLength(22)
  })
})
