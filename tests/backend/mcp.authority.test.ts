import { createHmac } from 'node:crypto'
import { Pool } from 'pg'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { appendEvent, createSector, createSession, ensureResearchSession, readGlobalContext } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { FakeRunsGateway } from './fake-gateway.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('MCP execution and resource authority over HTTP', () => {
  let pool: Pool, app: FastifyInstance, runs: FakeRunsGateway
  let normal: string, research: string, foreign: string, sectorId: string
  const scope = { tenantId: 'test-authority', projectId: null }
  const token = 'test-authority-worker-key'
  let nonce = 0
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_mcp_authority'), max: 5 })
    await pool.query('INSERT INTO api_keys(key_id,key_hash,tenant_id,roles) VALUES($1,$2,$3,$4)', ['test-authority-key', hashKey(token), scope.tenantId, 'approver'])
    vi.stubEnv('KARDATA_MCP_TOKEN', token)
    runs = new FakeRunsGateway(pool)
    app = buildApp({ pool, runs, auth: true })
    sectorId = (await createSector(pool, { name: 'TEST Widgets', topic: 'Widgets', scope })).sectorId
    await projectNewEvents(pool)
    normal = (await createSession(pool, 'TEST normal', scope, sectorId)).id
    research = (await ensureResearchSession(pool, sectorId, scope)).id
    foreign = (await createSession(pool, 'TEST foreign', { tenantId: 'foreign-tenant', projectId: null })).id
    await projectNewEvents(pool)
    for (const [id, parent] of [['normal-child', normal], ['research-child', research]]) await appendEvent(pool, { idempotencyKey: `test-launch-${id}`, partition: `session:${parent}`, type: 't.subagent.launched', payload: { sessionId: parent, parentSessionId: parent, childId: id, name: `TEST ${id}`, canDelegate: false } })
    await projectNewEvents(pool)
    for (const id of [normal, foreign]) runs.addRun({ id: `session-run-${id}`, sessionId: id, threadKey: id, state: 'RUNNING', budgetUsedRatio: 0, contextUsedRatio: 0, updatedAt: new Date().toISOString() })
  })
  afterAll(async () => { await app?.close(); await pool?.end(); vi.unstubAllEnvs() })

  async function call(name: string, args: unknown, thread?: string, overrides: Record<string, string> = {}) {
    const response = await app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(thread ? { 'x-kardata-thread': thread, 'x-kardata-execution': createHmac('sha256', token).update(thread).digest('hex') } : {}), ...overrides }, payload: { jsonrpc: '2.0', id: ++nonce, method: 'tools/call', params: { name, arguments: args } } })
    const body = response.json<{ result?: { isError?: boolean; content: Array<{ text: string }> }; error?: { code: string } }>()
    return { status: response.statusCode, error: body.result?.isError, text: body.result?.content[0]?.text ?? '', body }
  }
  const sections = (findings: string) => ({ scope: 'Widgets', decisions: '', findings, questions: '' })

  it('rejects invalid/partial execution signatures rather than falling back to unbound access', async () => {
    const invalid = await call('db.list_sessions', {}, normal, { 'x-kardata-execution': '0'.repeat(64) })
    expect(invalid.status).toBe(403)
    expect(invalid.body).toMatchObject({ error: { code: 'permission_denied' } })
  })
  it('denies global event plumbing to a scoped caller even with an approver key', async () => {
    for (const [name, args] of [
      ['db.read_partition', { partition: `session:${foreign}` }],
      ['db.read_events_after', { fromSeq: 0, limit: 10 }],
      ['db.append_event', { idempotencyKey: 'TEST unauthorized event injection', partition: `session:${foreign}`, type: 't.message.appended', payload: { threadKey: foreign, kind: 'text', message: { role: 'agent', text: 'TEST unauthorized injection' } } }],
    ] as const) {
      const result = await call(name, args)
      expect(result.error, name).toBe(true)
      expect(result.text).toContain('permission_denied')
    }
  })
  it('denies cross-tenant thread reads, messages and run controls even without execution headers', async () => {
    for (const [name, args] of [['db.get_thread', { threadKey: foreign }], ['db.send_message', { threadKey: foreign, text: 'TEST unauthorized' }], ['db.pause_run', { runId: `session-run-${foreign}` }]] as const) {
      const result = await call(name, args)
      expect(result.error, name).toBe(true)
    }
    expect(runs.signals).toEqual([])
  })
  it('denies leaf delegation and raw lifecycle mutation from a bound execution', async () => {
    expect((await call('db.delegate_subagent', { sessionId: normal, goal: 'TEST nested escape' }, 'agent:normal-child')).text).toContain('Leaf subagents cannot delegate')
    expect((await call('db.set_sector_state', { sectorId, state: 'complete' }, normal)).text).toContain('approved research lifecycle')
    expect(runs.signals).toEqual([])
  })
  it('does not cancel a foreign or protected research run when deletion is denied', async () => {
    const headers = { authorization: `Bearer ${token}` }
    expect((await app.inject({ method: 'DELETE', url: `/v1/sessions/${foreign}`, headers })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/v1/sessions/${research}`, headers })).statusCode).toBe(409)
    expect((await call('db.delete_session', { sessionId: normal }, normal)).text).toContain('owner confirmation')
    expect(runs.signals).toEqual([])
  })
  it('lists thread metadata without exposing another child local transcript', async () => {
    await appendEvent(pool, { idempotencyKey: 'test-private-child-message', partition: 'child:normal-child', type: 't.message.appended', payload: { threadKey: 'agent:normal-child', kind: 'text', message: { role: 'agent', text: 'TEST private child context' } } })
    await projectNewEvents(pool)
    for (const thread of [normal, 'agent:normal-child']) {
      const result = await call('db.list_threads', { sessionId: normal }, thread)
      expect(result.error).not.toBe(true)
      expect(result.text).not.toContain('TEST private child context')
      const headers = JSON.parse(result.text) as Array<{ messages: unknown[] }>
      expect(headers.length).toBeGreaterThan(0)
      expect(headers.every((header) => header.messages.length === 0)).toBe(true)
    }
  })
  it('keeps normal proposals pending while the research parent commits permitted findings autonomously', async () => {
    const normalResult = await call('db.propose_global_context', { baseVersion: 0, sections: sections('TEST normal insight'), idempotencyKey: 'normal-insight' }, normal)
    expect(normalResult.error).not.toBe(true)
    expect(JSON.parse(normalResult.text)).toMatchObject({ state: 'pending', sourceThread: normal })
    const researchResult = await call('db.propose_global_context', { baseVersion: 0, sections: sections('TEST research evidence'), idempotencyKey: 'research-insight' }, research)
    expect(JSON.parse(researchResult.text)).toMatchObject({ state: 'approved', version: 1 })
    expect((await readGlobalContext(pool, sectorId, scope)).sections.findings).toBe('TEST research evidence')
  })
  it('routes research-child updates to the actual parent and rejects protected-decision overrides', async () => {
    const proposal = await call('db.propose_global_context', { baseVersion: 1, sections: sections('TEST child evidence'), idempotencyKey: 'child-insight' }, 'agent:research-child')
    const data = JSON.parse(proposal.text) as { id: string; state: string }
    expect(data.state).toBe('parent-review')
    expect((await call('db.commit_child_context', { proposalId: data.id }, normal)).error).toBe(true)
    expect(JSON.parse((await call('db.commit_child_context', { proposalId: data.id }, research)).text)).toMatchObject({ state: 'approved' })
    const context = await readGlobalContext(pool, sectorId, scope)
    const override = await call('db.propose_global_context', { baseVersion: context.version, sections: { ...context.sections, decisions: 'TEST unauthorized replacement' }, idempotencyKey: 'protected-decision' }, research)
    expect(JSON.parse(override.text)).toMatchObject({ state: 'pending' })
    expect((await readGlobalContext(pool, sectorId, scope)).sections.decisions).toBe('')
  })
})
