// Production HTTP/MCP/activity/Postgres path. Provider is explicitly scripted.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import type { FastifyInstance } from 'fastify'
import { MockActivityEnvironment } from '@temporalio/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { commitThreadCompaction, createSession, listSessions, readThreadContext, readTurnContinuation, registerApiKey } from '../../backend/src/db/index.js'
import { readPartition } from '../../backend/src/db/events.js'
import { readExecutionRecord, resolveArchiveTarget, type ArchivedExecutionRecord } from '../../backend/src/archive/targets.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { karbotTurnActivity, type TurnOutcome } from '../../backend/src/temporal/activities/turn.js'
import { type KarbotTurnInput } from '../../backend/src/temporal/activities/karbot-turn-input.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('uncertain mutation recovery over real HTTP', () => {
  let pool: Pool, app: FastifyInstance, endpoint: string
  const scope = { tenantId: 'test-mutation-recovery', projectId: null }
  const credential = 'TEST operation recovery worker credential'
  let dropReply = false
  let preparedBeforeReplyLoss = false
  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_mcp_op_recovery')
    pool = new Pool({ connectionString: url, max: 5 })
    vi.stubEnv('DATABASE_URL', url); vi.stubEnv('KARDATA_PROVIDER', 'fake')
    vi.stubEnv('KARDATA_MCP_TOKEN', credential)
    vi.stubEnv('KARDATA_GCS_BUCKET', '')
    vi.stubEnv('KARDATA_ARCHIVE_DIR', mkdtempSync(join(tmpdir(), 'kardata-op-recovery-')))
    await registerApiKey(pool, { keyId: 'TEST recovery key', keyHash: hashKey(credential), scope, role: 'operator' })
    app = buildApp({ pool, auth: true })
    app.addHook('onSend', async (request, reply, payload) => {
      const rpc = request.body as { method?: string; params?: { name?: string } } | undefined
      if (dropReply && rpc?.method === 'tools/call' && rpc.params?.name === 'db.create_session') {
        dropReply = false
        const thread = (request.headers['x-kardata-thread'] as string | undefined)
        preparedBeforeReplyLoss = !!thread && !!(await readTurnContinuation(pool, thread))?.meta.blockedOperations?.length
        // The actual route has committed its effect/cache; only delivery is lost.
        reply.raw.destroy()
      }
      return payload
    })
    endpoint = await app.listen({ host: '127.0.0.1', port: 0 })
  })
  afterAll(async () => { await app?.close(); await pool?.end(); vi.unstubAllEnvs() })
  it('retains exact request, provider reply and MCP result records after the production turn clears its continuation', async () => {
    const session = await createSession(pool, 'TEST execution archive caller', scope)
    await projectNewEvents(pool)
    const environment = new MockActivityEnvironment()
    const outcome = await environment.run<[KarbotTurnInput], TurnOutcome, typeof karbotTurnActivity>(karbotTurnActivity, {
      sessionId: session.id, threadKey: session.id, runKey: 'TEST archived execution', text: 'TEST inspect own session', mcpEndpoint: `${endpoint}/mcp`, mcpToken: credential, toolAllow: ['db.get_session'],
      fakeSteps: [{ text: '', toolCalls: [{ id: 'TEST archived read', name: 'db.get_session', args: { sessionId: session.id } }] }, { text: 'TEST archived final answer' }],
    })
    expect(outcome.reply).toBe('TEST archived final answer')
    expect(await readTurnContinuation(pool, session.id)).toBeUndefined()
    const entries = (await readPartition(pool, `session:${session.id}`)).filter((entry) => entry.type === 't.execution.recorded')
    expect(entries.map((entry) => (entry.payload as { kind: string }).kind)).toEqual(['request','response','tool-result','request','response'])
    const contents = await Promise.all(entries.map((entry) => readExecutionRecord(resolveArchiveTarget(), session.id, (entry.payload as { ref: ArchivedExecutionRecord }).ref)))
    expect(contents[0]).toMatchObject({ version: 1, provider: 'fake', round: 1, data: { messages: [{ role: 'user', text: 'TEST inspect own session' }] } })
    expect(contents[2]).toMatchObject({ data: { call: { id: 'TEST archived read', name: 'db.get_session' }, operationId: 'TEST archived execution:TEST archived read', outcome: { isError: false } } })
    expect(contents[4]).toMatchObject({ round: 2, data: { text: outcome.reply } })
    expect(JSON.stringify(contents)).not.toContain(credential)
    expect(JSON.stringify(entries)).not.toContain(outcome.reply)
  }, 20000)
  it('parks a lost reply, exposes its original identity, and replays one created session on resume', async () => {
    const session = await createSession(pool, 'TEST caller session', scope)
    await projectNewEvents(pool)
    const environment = new MockActivityEnvironment()
    const input: KarbotTurnInput = { sessionId: session.id, threadKey: session.id, runKey: 'TEST mutation operation', text: 'TEST create a session', mcpEndpoint: `${endpoint}/mcp`, mcpToken: credential, toolAllow: ['db.create_session'], fakeSteps: [
      { text: '', toolCalls: [{ id: 'TEST mutation call', name: 'db.create_session', args: { title: 'TEST created once' } }] },
      { text: 'Must not continue after an uncertain mutation.' },
    ] }
    dropReply = true
    await expect(environment.run(karbotTurnActivity, input)).rejects.toMatchObject({ type: 'OperationBlocked', nonRetryable: true })
    expect(preparedBeforeReplyLoss).toBe(true)
    const saved = await readTurnContinuation(pool, session.id)
    expect(saved?.meta.blockedOperations).toHaveLength(1)
    expect(saved?.meta.blockedOperations?.[0]?.authorityId).toMatch(/^[a-f0-9]{64}$/)
    const rotated = 'TEST rotated recovery worker credential'
    await registerApiKey(pool, { keyId: 'TEST rotated recovery key', keyHash: hashKey(rotated), scope, role: 'operator' })
    vi.stubEnv('KARDATA_MCP_TOKEN', rotated)
    await expect(environment.run(karbotTurnActivity, { ...input, mcpToken: rotated, fakeSteps: [{ text: 'Must not execute under a new caller identity' }] })).rejects.toMatchObject({ type: 'OperationBlocked' })
    expect((await listSessions(pool, scope)).filter((entry) => entry.title === 'TEST created once')).toHaveLength(1)
    expect((await readTurnContinuation(pool, session.id))?.meta.blockedOperations?.[0]?.authorityId).toBe(saved?.meta.blockedOperations?.[0]?.authorityId)
    vi.stubEnv('KARDATA_MCP_TOKEN', credential)
    await expect(environment.run(karbotTurnActivity, { ...input, runKey: 'TEST replacement run', text: 'TEST new task', fakeSteps: [{ text: 'Must not run a new task' }] })).rejects.toMatchObject({ type: 'OperationBlocked' })
    expect((await readTurnContinuation(pool, session.id))?.runKey).toBe(input.runKey)
    const pending = await readThreadContext(pool, session.id, scope)
    expect(pending.pendingOperations?.[0]?.operationId).toBe('TEST mutation operation:TEST mutation call')
    expect((await listSessions(pool, scope)).filter((entry) => entry.title === 'TEST created once')).toHaveLength(1)
    await pool.query("UPDATE api_keys SET roles='viewer' WHERE key_id=$1", ['TEST recovery key'])
    await expect(environment.run(karbotTurnActivity, { ...input, fakeSteps: [{ text: 'Must not continue after authority denial' }] })).rejects.toMatchObject({ type: 'OperationBlocked' })
    expect((await readTurnContinuation(pool, session.id))?.meta.blockedOperations?.[0]?.operationId).toBe(saved?.meta.blockedOperations?.[0]?.operationId)
    await pool.query("UPDATE api_keys SET roles='operator' WHERE key_id=$1", ['TEST recovery key'])
    const latest = await readTurnContinuation(pool, session.id)
    const local = await readThreadContext(pool, session.id, scope)
    await commitThreadCompaction(pool, session.id, { version: local.version, summary: 'TEST preserve task and unresolved operation', coveredSeq: 0, continuation: { previous: latest!, messages: [{ role: 'assistant', text: 'TEST compacted working history' }] } }, scope)
    expect((await readTurnContinuation(pool, session.id))?.meta.blockedOperations).toEqual(latest?.meta.blockedOperations)
    const completed = await environment.run<[KarbotTurnInput], TurnOutcome, typeof karbotTurnActivity>(karbotTurnActivity, { ...input, fakeSteps: [{ text: 'TEST original creation confirmed.' }] })
    expect(completed.reply).toBe('TEST original creation confirmed.')
    expect((await listSessions(pool, scope)).filter((entry) => entry.title === 'TEST created once')).toHaveLength(1)
    expect(await readTurnContinuation(pool, session.id)).toBeUndefined()
    expect((await readThreadContext(pool, session.id, scope)).pendingOperations).toBeUndefined()
  }, 20000)
})
