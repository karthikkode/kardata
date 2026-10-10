// F1a: deterministic pre-effect tool errors are retry-safe, never
// operation-uncertain. Reproduces pilot r0 R0-2 (propose conflict),
// R0-4 (plan conflict), R0-9 (commit permission) and R0-15 (duplicate
// monitor) over actual HTTP/MCP dispatch: each must answer isError
// with the retry-safe marker (so the turn hands the text to the agent
// instead of parking a blocked operation) and no uncertain marker.
import { createHmac } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { createSector, createSession, ensureResearchSession } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { FakeRunsGateway } from './fake-gateway.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('deterministic tool errors are retry-safe [F:http.mcpRpc] [F:mcp.db.propose_global_context] [F:mcp.db.commit_child_context] [F:mcp.db.update_sector_plan] [F:mcp.ops.start_monitor] [F:db.index.createSector] [F:db.sectors.createSector] [F:db.index.createSession] [F:db.sessions.createSession] [F:db.workspace.ensureResearchSession]', () => {
  let pool: Pool, app: FastifyInstance
  let sectorId: string, runningSectorId: string, normal: string, research: string, runningResearch: string
  const scope = { tenantId: 'test-deterministic', projectId: null }
  const token = 'test-deterministic-worker-key'
  let nonce = 0
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_mcp_deterministic'), max: 5 })
    await pool.query('INSERT INTO api_keys(key_id,key_hash,tenant_id,roles) VALUES($1,$2,$3,$4)', ['test-deterministic-key', hashKey(token), scope.tenantId, 'approver'])
    vi.stubEnv('KARDATA_MCP_TOKEN', token)
    const runs = new FakeRunsGateway(pool)
    app = buildApp({ pool, runs, auth: true })
    sectorId = (await createSector(pool, { name: 'TEST Deterministic', topic: 'Widgets', scope })).sectorId
    runningSectorId = (await createSector(pool, { name: 'TEST Running', topic: 'Widgets', scope, initialState: 'running' })).sectorId
    await projectNewEvents(pool)
    normal = (await createSession(pool, 'TEST normal', scope, sectorId)).id
    research = (await ensureResearchSession(pool, sectorId, scope)).id
    runningResearch = (await ensureResearchSession(pool, runningSectorId, scope)).id
    await projectNewEvents(pool)
  })
  afterAll(async () => { await app?.close(); await pool?.end(); vi.unstubAllEnvs() })

  async function call(name: string, args: unknown, thread: string, key = `TEST deterministic ${++nonce}`) {
    const response = await app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'idempotency-key': key, 'x-kardata-thread': thread, 'x-kardata-execution': createHmac('sha256', token).update(thread).digest('hex') }, payload: { jsonrpc: '2.0', id: nonce, method: 'tools/call', params: { name, arguments: args } } })
    const body = response.json<{ result?: { isError?: boolean; content: Array<{ text: string }>; _meta?: Record<string, unknown> } }>()
    return { status: response.statusCode, isError: body.result?.isError, text: body.result?.content[0]?.text ?? '', meta: body.result?._meta }
  }

  it('R0-2: a stale propose_global_context conflict is retry-safe with readable text', async () => {
    const result = await call('db.propose_global_context', { baseVersion: 999999, sections: { scope: 'Widgets', decisions: '', findings: 'TEST stale update', questions: '' }, idempotencyKey: 'TEST r0-2 stale propose', sectorId }, research)
    expect(result.status).toBe(200)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('conflict')
    expect(result.text).toContain('Global context changed')
    expect(result.meta?.['kardata/retry-safe-before-effect']).toBe(true)
    expect(result.meta?.['kardata/operation-uncertain']).toBeUndefined()
  })

  it('R0-4: update_sector_plan on a running sector conflicts retry-safe', async () => {
    const result = await call('db.update_sector_plan', { sectorId: runningSectorId, markdown: '# TEST short plan' }, runningResearch)
    expect(result.status).toBe(200)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('not planned')
    expect(result.meta?.['kardata/retry-safe-before-effect']).toBe(true)
    expect(result.meta?.['kardata/operation-uncertain']).toBeUndefined()
  })

  it('R0-9: commit_child_context outside the research parent denies retry-safe', async () => {
    const result = await call('db.commit_child_context', { proposalId: 'TEST no such proposal' }, normal)
    expect(result.status).toBe(200)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('permission_denied')
    expect(result.text).toContain('Only the research parent')
    expect(result.meta?.['kardata/retry-safe-before-effect']).toBe(true)
    expect(result.meta?.['kardata/operation-uncertain']).toBeUndefined()
  })

  it('R0-15: a duplicate start_monitor conflicts retry-safe', async () => {
    const args = { threadKey: normal, everyMinutes: 5, brief: 'TEST duplicate monitor' }
    const first = await call('ops.start_monitor', args, normal)
    expect(first.status).toBe(200)
    expect(first.isError).not.toBe(true)
    const result = await call('ops.start_monitor', args, normal)
    expect(result.status).toBe(200)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('conflict')
    expect(result.text).toContain('already running')
    expect(result.meta?.['kardata/retry-safe-before-effect']).toBe(true)
    expect(result.meta?.['kardata/operation-uncertain']).toBeUndefined()
  })
})
