// F1c: owner escape from paused-by-recovery threads. Discarding drops the
// thread's blocked operations, appends an audited transcript note, and
// resumes the run — without it, authority-halted threads brick forever.
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { createSession, findEventByKey, readTurnContinuation, saveTurnContinuation } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { FakeRunsGateway } from './fake-gateway.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('discard blocked operations [F:http.discardBlockedOperations] [F:db.workspace_threads.discardBlockedOperations] [F:db.index.createSession] [F:db.sessions.createSession] [F:db.workspace_threads.saveTurnContinuation] [F:db.workspace_threads.readTurnContinuation] [F:db.index.findEventByKey]', () => {
  let pool: Pool, app: FastifyInstance, runs: FakeRunsGateway
  const scope = { tenantId: 'test-discard', projectId: null }
  const token = 'test-discard-owner-key'
  const operatorToken = 'test-discard-operator-key'
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_cmd_discard'), max: 5 })
    await pool.query('INSERT INTO api_keys(key_id,key_hash,tenant_id,roles) VALUES($1,$2,$3,$4)', ['test-discard-key', hashKey(token), scope.tenantId, 'approver'])
    await pool.query('INSERT INTO api_keys(key_id,key_hash,tenant_id,roles) VALUES($1,$2,$3,$4)', ['test-discard-op', hashKey(operatorToken), scope.tenantId, 'operator'])
    runs = new FakeRunsGateway(pool)
    app = buildApp({ pool, runs, auth: true })
  })
  afterAll(async () => { await app?.close(); await pool?.end() })

  async function discard(runId: string, key = `TEST discard ${runId} ${Math.random()}`, auth = token) {
    const response = await app.inject({ method: 'POST', url: '/v1/commands/discard-blocked-operations', headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json', 'idempotency-key': key }, payload: { runId } })
    return { status: response.statusCode, body: response.json() as { ok: boolean; data?: { commandId: string; state: string }; error?: { code: string; message: string } } }
  }
  async function blockedFixture(title: string) {
    const session = await createSession(pool, title, scope)
    await projectNewEvents(pool)
    const runId = `session-run-${session.id}`
    runs.addRun({ id: runId, sessionId: session.id, threadKey: session.id, state: 'PAUSED', budgetUsedRatio: 0, contextUsedRatio: 0, updatedAt: new Date().toISOString() })
    await saveTurnContinuation(pool, session.id, { user: 'TEST blocked task', messages: [{ role: 'user', text: 'TEST blocked task' }], runKey: 'TEST blocked run', sources: [], meta: { round: 1, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 }, toolCalls: 1, elapsedMs: 11, blockedOperations: [{ operationId: 'TEST blocked op', reason: 'TEST authority changed', call: { id: 'TEST call', name: 'db.create_session', args: { title: 'TEST x' } } }] } })
    return { session, runId }
  }

  it('discards the block, notes the transcript as ui, and resumes the run', async () => {
    const { session, runId } = await blockedFixture('TEST discard caller')
    const result = await discard(runId, 'TEST discard once')
    expect(result.status).toBe(202)
    expect(result.body.data?.state).toBe('accepted')
    const continuation = await readTurnContinuation(pool, session.id)
    expect(continuation?.messages).toHaveLength(1)
    expect(continuation?.meta.blockedOperations).toBeUndefined()
    const note = await findEventByKey(pool, `discard-blocked:${session.id}:TEST blocked op`)
    expect(note?.client).toBe('ui')
    expect(note?.payload).toMatchObject({ threadKey: session.id, kind: 'tool', message: { name: 'operation.discard', state: 'done' } })
    const last = (await pool.query<{ kind: string; payload: unknown }>('SELECT kind, payload FROM thread_messages WHERE thread_key=$1 ORDER BY seq DESC LIMIT 1', [session.id])).rows[0]
    expect(last?.kind).toBe('tool')
    expect(last?.payload).toMatchObject({ name: 'operation.discard' })
    expect(runs.signals).toContainEqual({ workflowId: runId, signal: 'runResume', args: [] })
  })

  it('409s when nothing is blocked', async () => {
    const session = await createSession(pool, 'TEST unblocked caller', scope)
    await projectNewEvents(pool)
    const runId = `session-run-${session.id}`
    runs.addRun({ id: runId, sessionId: session.id, threadKey: session.id, state: 'PAUSED', budgetUsedRatio: 0, contextUsedRatio: 0, updatedAt: new Date().toISOString() })
    const result = await discard(runId, 'TEST discard empty')
    expect(result.status).toBe(409)
    expect(result.body.error?.code).toBe('conflict')
  })

  it('404s unknown runs and 403s non-approvers', async () => {
    expect((await discard('session-run-nope', 'TEST discard missing')).status).toBe(404)
    const { runId } = await blockedFixture('TEST discard floor caller')
    const denied = await discard(runId, 'TEST discard floor', operatorToken)
    expect(denied.status).toBe(403)
    expect(denied.body.error?.code).toBe('permission_denied')
  })

  it('replays the stored acceptance on key reuse', async () => {
    const { runId } = await blockedFixture('TEST discard replay caller')
    const first = await discard(runId, 'TEST discard replay')
    const second = await discard(runId, 'TEST discard replay')
    expect(first.status).toBe(202)
    expect(second).toEqual(first)
  })
})
