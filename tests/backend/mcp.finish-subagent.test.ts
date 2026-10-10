// F3a: a subagent ends its own run with db.finish_subagent (pilot r0
// R0-17). Reproduces the missing finish path over HTTP/MCP dispatch:
// a subagent caller reaches the gateway exactly once; a session-thread
// caller gets a deterministic conflict; a call without verified
// execution context is denied; a messenger without the finish method
// fails closed instead of hanging.
import { createHmac } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { DbContractError } from '../../backend/src/db/index.js'
import { createSector, createSession } from '../../backend/src/db/index.js'
import { finishSubagentRun } from '../../backend/src/db/threads.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { FakeRunsGateway } from './fake-gateway.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('db.finish_subagent ends the caller child run [F:mcp.db.finish_subagent] [F:db.index.createSector] [F:db.sectors.createSector] [F:db.index.createSession] [F:db.sessions.createSession]', () => {
  let pool: Pool, app: FastifyInstance, runs: FakeRunsGateway
  const scope = { tenantId: 'test-finish-subagent', projectId: null }
  const token = 'test-finish-subagent-key'
  const childKey = 'agent:child-finish-1'
  let sessionId: string
  let nonce = 0
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_mcp_finish'), max: 5 })
    await pool.query('INSERT INTO api_keys(key_id,key_hash,tenant_id,roles) VALUES($1,$2,$3,$4)', ['test-finish-key', hashKey(token), scope.tenantId, 'operator'])
    vi.stubEnv('KARDATA_MCP_TOKEN', token)
    runs = new FakeRunsGateway(pool)
    app = buildApp({ pool, runs, auth: true })
    const sectorId = (await createSector(pool, { name: 'TEST Finish', topic: 'Widgets', scope })).sectorId
    await projectNewEvents(pool)
    sessionId = (await createSession(pool, 'TEST finish session', scope, sectorId)).id
    await projectNewEvents(pool)
    await pool.query('INSERT INTO threads(key, session_id, kind, status) VALUES($1, $2, $3, $4)', [childKey, sessionId, 'subagent', 'running'])
  })
  afterAll(async () => { await app?.close(); await pool?.end(); vi.unstubAllEnvs() })

  async function call(name: string, args: unknown, thread?: string, key = `TEST finish ${++nonce}`) {
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'idempotency-key': key }
    if (thread) { headers['x-kardata-thread'] = thread; headers['x-kardata-execution'] = createHmac('sha256', token).update(thread).digest('hex') }
    const response = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { jsonrpc: '2.0', id: nonce, method: 'tools/call', params: { name, arguments: args } } })
    const body = response.json<{ result?: { isError?: boolean; content: Array<{ text: string }> } }>()
    return { status: response.statusCode, isError: body.result?.isError, text: body.result?.content[0]?.text ?? '' }
  }

  it('a subagent caller finishes its own run exactly once', async () => {
    const result = await call('db.finish_subagent', {}, childKey)
    expect(result.status).toBe(200)
    expect(result.isError).toBeFalsy()
    expect(result.text).toContain('accepted')
    expect(runs.finished).toEqual([childKey])
  })

  it('a session-thread caller gets a deterministic denial', async () => {
    const result = await call('db.finish_subagent', {}, sessionId)
    expect(result.status).toBe(200)
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/not a subagent/i)
    expect(runs.finished).toEqual([childKey])
  })

  it('a call without verified execution context is denied', async () => {
    const result = await call('db.finish_subagent', {})
    expect(result.status).toBe(200)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('Verified execution context')
  })

  it('a messenger without the finish method fails closed', async () => {
    const bare = { send: async () => ({ commandId: 'c', state: 'accepted' as const }), steer: async () => ({ commandId: 'c', state: 'accepted' as const }), pauseRun: async () => ({ commandId: 'c', state: 'accepted' as const }), resumeRun: async () => ({ commandId: 'c', state: 'accepted' as const }), cancelRun: async () => ({ commandId: 'c', state: 'accepted' as const }) }
    await expect(finishSubagentRun(bare, childKey)).rejects.toThrow(DbContractError)
    await expect(finishSubagentRun(undefined, childKey)).rejects.toThrow(DbContractError)
  })
})
