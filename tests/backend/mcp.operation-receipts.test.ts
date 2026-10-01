import { createHmac } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { createSession, listSessions, type TransactableDb } from '../../backend/src/db/index.js'
import { inspectOperationReceipt, recordOperationIntent, recordOperationResult, recoverOperationResult } from '../../backend/src/db/operation-receipts.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('durable MCP operation receipts', () => {
  let pool: Pool
  beforeAll(async () => { pool = new Pool({ connectionString: await ensureTestDb('kardata_test_mcp_receipts') }); vi.stubEnv('KARDATA_MCP_TOKEN', 'TEST receipt execution secret') })
  afterAll(async () => { await pool?.end(); vi.unstubAllEnvs() })
  it('repairs a response-cache write failure over actual MCP without repeating its committed effect', async () => {
    let fail = true
    const db: TransactableDb = { connect: pool.connect.bind(pool), query: async <T>(sql: string, params?: unknown[]) => {
      if (fail && sql.includes("SET state = 'completed'")) { fail = false; throw new Error('TEST response cache unavailable') }
      const result = await pool.query(sql, params); return { rows: result.rows as T[], rowCount: result.rowCount }
    } }
    const session = await createSession(pool, 'TEST receipt caller')
    await projectNewEvents(pool)
    const app = buildApp({ pool: db })
    const headers = { 'idempotency-key': 'TEST receipt operation', 'x-kardata-thread': session.id, 'x-kardata-execution': createHmac('sha256', 'TEST receipt execution secret').update(session.id).digest('hex') }
    const payload = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'db.create_session', arguments: { title: 'TEST receipt created once' } } }
    try {
      expect((await app.inject({ method: 'POST', url: '/mcp', headers, payload })).statusCode).toBe(500)
      const inspection = await app.inject({ method: 'GET', url: `/v1/threads/${session.id}/operations/${encodeURIComponent(headers['idempotency-key'])}` })
      expect(inspection.statusCode).toBe(200)
      expect(inspection.json().data).toMatchObject({ state: 'confirmed', toolName: 'db.create_session' })
      expect(inspection.body).not.toContain('TEST receipt created once')
      const replay = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { ...payload, id: 2 } })
      expect(replay.statusCode).toBe(200); expect(replay.json().id).toBe(2)
      expect((await listSessions(pool)).filter((row) => row.title === 'TEST receipt created once')).toHaveLength(1)
      const changed = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { ...payload, params: { ...payload.params, arguments: { title: 'TEST unsafe changed arguments' } } } })
      expect(changed.statusCode).toBe(409)
    } finally { await app.close() }
  })
  it('does not infer success from an intent and denies foreign-thread or changed-authority proofs', async () => {
    const scope = { tenantId: 'TEST receipt owner', projectId: null }
    const session = await createSession(pool, 'TEST unresolved caller', scope)
    await projectNewEvents(pool)
    const identity = { keyId: 'TEST original key', operationId: 'TEST unresolved operation', threadKey: session.id, fingerprint: 'TEST original authority', toolName: 'db.create_session' }
    await recordOperationIntent(pool, identity)
    expect(await inspectOperationReceipt(pool, session.id, identity.operationId, scope)).toMatchObject({ state: 'unresolved' })
    await expect(inspectOperationReceipt(pool, session.id, identity.operationId, { tenantId: 'TEST foreign owner', projectId: null })).rejects.toMatchObject({ code: 'not_found' })
    await recordOperationResult(pool, identity, 200, 'TEST exact successful reply')
    expect(await recoverOperationResult(pool, { ...identity, fingerprint: 'TEST changed authority' })).toBeUndefined()
    expect(await recoverOperationResult(pool, { ...identity, threadKey: 'TEST foreign thread' })).toBeUndefined()
    expect(await recoverOperationResult(pool, identity)).toEqual({ status: 200, body: 'TEST exact successful reply' })
    await expect(recordOperationIntent(pool, { ...identity, fingerprint: 'TEST replaced intent' })).rejects.toMatchObject({ code: 'conflict' })
    await pool.query(`INSERT INTO thread_context (thread_key, working_meta) VALUES ($1,$2::jsonb) ON CONFLICT(thread_key) DO UPDATE SET working_meta=EXCLUDED.working_meta`, [session.id, JSON.stringify({ blockedOperations: [{ operationId: 'TEST legacy unknown effect' }] })])
    expect(await inspectOperationReceipt(pool, session.id, 'TEST legacy unknown effect', scope)).toMatchObject({ state: 'unresolved', reason: expect.stringContaining('Legacy') })
    await expect(inspectOperationReceipt(pool, session.id, 'TEST invented operation', scope)).rejects.toMatchObject({ code: 'not_found' })
  })
  it.each(['completed', 'in_progress'] as const)('never overwrites a different request %s guard with a retained old receipt', async (state) => {
    const session = await createSession(pool, 'TEST retained receipt caller')
    await projectNewEvents(pool)
    const app = buildApp({ pool })
    const operationId = `TEST retained receipt ${state}`
    const headers = { 'idempotency-key': operationId, 'x-kardata-thread': session.id, 'x-kardata-execution': createHmac('sha256', 'TEST receipt execution secret').update(session.id).digest('hex') }
    const payload = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'db.create_session', arguments: { title: `TEST original effect ${state}` } } }
    try {
      expect((await app.inject({ method: 'POST', url: '/mcp', headers, payload })).statusCode).toBe(200)
      // Isolated fault fixture: old replay-cache retention followed by another
      // request claiming the same caller/key. The old durable receipt remains.
      await pool.query(`UPDATE idempotency_records SET fingerprint=$2,state=$3,status=202,response=$4::jsonb WHERE key=$1`, [`open:${operationId}`, 'TEST different HTTP request B', state, JSON.stringify({ result: 'TEST B protected response' })])
      const before = (await pool.query('SELECT * FROM idempotency_records WHERE key=$1', [`open:${operationId}`])).rows[0]
      expect((await app.inject({ method: 'POST', url: '/mcp', headers, payload })).statusCode).toBe(409)
      expect((await pool.query('SELECT * FROM idempotency_records WHERE key=$1', [`open:${operationId}`])).rows[0]).toEqual(before)
    } finally { await app.close() }
  })
  it('fences recovery completion when the guard changes after the claim read', async () => {
    const session = await createSession(pool, 'TEST receipt CAS caller')
    await projectNewEvents(pool)
    const operationId = 'TEST receipt CAS race'
    const recordKey = `open:${operationId}`
    const headers = { 'idempotency-key': operationId, 'x-kardata-thread': session.id, 'x-kardata-execution': createHmac('sha256', 'TEST receipt execution secret').update(session.id).digest('hex') }
    const payload = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'db.create_session', arguments: { title: 'TEST CAS original effect' } } }
    let injectRace = false
    const db: TransactableDb = { connect: pool.connect.bind(pool), query: async <T>(sql: string, params?: unknown[]) => {
      if (injectRace && sql.includes("SET state = 'completed'")) {
        injectRace = false
        await pool.query(`UPDATE idempotency_records SET fingerprint=$2,status=202,response=$3::jsonb WHERE key=$1`, [recordKey, 'TEST racing request B', JSON.stringify({ result: 'TEST racing B protected response' })])
      }
      const result = await pool.query(sql, params); return { rows: result.rows as T[], rowCount: result.rowCount }
    } }
    const app = buildApp({ pool: db })
    try {
      expect((await app.inject({ method: 'POST', url: '/mcp', headers, payload })).statusCode).toBe(200)
      await pool.query("UPDATE idempotency_records SET state='in_progress' WHERE key=$1", [recordKey])
      injectRace = true
      expect((await app.inject({ method: 'POST', url: '/mcp', headers, payload })).statusCode).toBe(409)
      expect((await pool.query('SELECT fingerprint,state,response FROM idempotency_records WHERE key=$1', [recordKey])).rows[0]).toEqual({ fingerprint: 'TEST racing request B', state: 'in_progress', response: { result: 'TEST racing B protected response' } })
    } finally { await app.close() }
  })
})
