// REST parity contract tests (B3.1). The app runs via inject (never a bound
// port) against a live database with all migrations; Temporal is the
// in-memory fake gateway. Every route asserts its envelope, status, and the
// documented behavior matrix: loading/empty/error/denied ownership is in
// docs/architecture.md; 403/409-idempotency enforcement belongs to B3.3/B3.4.
import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { appendEvent } from '../../backend/src/db/index.js'
import type { RunInfo } from '../../backend/src/temporal/runs-types.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''

function run(id: string, sessionId: string, state: RunInfo['state'], threadKey?: string): RunInfo {
  return {
    id,
    sessionId,
    threadKey: threadKey ?? sessionId,
    state,
    budgetUsedRatio: 0,
    contextUsedRatio: 0,
    updatedAt: new Date().toISOString(),
  }
}

describe.skipIf(!ENABLED)('REST parity (B3.1) [F:http.createSession] [F:http.getSession] [F:http.listSessions] [F:http.renameSession] [F:http.deleteSession] [F:http.listThreads] [F:http.getThread] [F:http.listMessages] [F:http.listRuns] [F:http.getRun] [F:http.sendMessage] [F:http.steerThread] [F:http.pauseRun] [F:http.resumeRun] [F:http.cancelRun] [F:http.decideApproval] [F:http.listSkills]', () => {
  let app: FastifyInstance
  let pool: Pool
  let runs: FakeRunsGateway

  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_api')
    pool = new Pool({ connectionString: url })
    runs = new FakeRunsGateway(pool)
    runs.addRun(run('session-run-s-a', 's-a', 'RUNNING'))
    runs.addRun(run('session-run-s-b', 's-b', 'IDLE'))
    runs.addRun(
      run('company-run-c1', 'company-run-c1', 'IDLE', 'agent:company-run-c1'),
      'companyResearch',
    )
    runs.addRun(run('research-run-r1', 'research-run-r1', 'RUNNING'), 'researchRun')
    app = buildApp({ pool, runs })

    // Session A: live thread with text + tool messages.
    await appendEvent(pool, {
      idempotencyKey: 'seed:s-a:created',
      partition: 'session:s-a',
      type: 't.session.created',
      payload: { sessionId: 's-a', title: 'Alpha' },
    })
    await appendEvent(pool, {
      idempotencyKey: 'seed:s-a:m1',
      partition: 'session:s-a',
      type: 't.message.appended',
      payload: { threadKey: 's-a', kind: 'text', message: { text: 'hello', role: 'user' } },
    })
    await appendEvent(pool, {
      idempotencyKey: 'seed:s-a:m2',
      partition: 'session:s-a',
      type: 't.message.appended',
      payload: { threadKey: 's-a', kind: 'text', message: { text: 'hi', role: 'agent' } },
    })
    await appendEvent(pool, {
      idempotencyKey: 'seed:s-a:m3',
      partition: 'session:s-a',
      type: 't.message.appended',
      payload: { threadKey: 's-a', kind: 'tool', message: { name: 'domain.scan', detail: 'scan', state: 'done' } },
    })
    // Session B: created, empty thread.
    await appendEvent(pool, {
      idempotencyKey: 'seed:s-b:created',
      partition: 'session:s-b',
      type: 't.session.created',
      payload: { sessionId: 's-b', title: 'Beta' },
    })
    // Session C: finished session thread (steer conflicts here).
    await appendEvent(pool, {
      idempotencyKey: 'seed:s-c:created',
      partition: 'session:s-c',
      type: 't.session.created',
      payload: { sessionId: 's-c', title: 'Gamma' },
    })
    await appendEvent(pool, {
      idempotencyKey: 'seed:s-c:finished',
      partition: 'session:s-c',
      type: 't.thread.finished',
      payload: { threadKey: 's-c' },
    })
    // Child c1 of session A, closed: B2.4 isolation-record shape.
    await appendEvent(pool, {
      idempotencyKey: 'seed:c1:launched',
      partition: 'session:s-a',
      type: 't.subagent.launched',
      payload: {
        childId: 'c1',
        parentSessionId: 's-a',
        parentWorkflowId: 'parent-wf',
        name: 'Scout',
        depth: 1,
        mode: 'empty',
        goal: 'research',
        queueCapacity: 8,
        canDelegate: false,
      },
    })
    await appendEvent(pool, {
      idempotencyKey: 'seed:c1:completed',
      partition: 'session:s-a',
      type: 't.subagent.completed',
      payload: { summary: { id: 'c1', status: 'finished' } },
    })
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  it('creates, gets, and lists sessions newest first', async () => {
    const created = await app.inject({ method: 'POST', url: '/v1/sessions', payload: { title: 'Delta' } })
    expect(created.statusCode).toBe(201)
    const createdBody = created.json() as { ok: boolean; data: { id: string; title: string } }
    expect(createdBody.ok).toBe(true)
    expect(createdBody.data.title).toBe('Delta')

    const fetched = await app.inject({ method: 'GET', url: `/v1/sessions/${createdBody.data.id}` })
    expect(fetched.statusCode).toBe(200)
    expect((fetched.json() as { data: { title: string } }).data.title).toBe('Delta')

    const missing = await app.inject({ method: 'GET', url: '/v1/sessions/nope' })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toEqual({ ok: false, error: { code: 'not_found', message: 'no such session nope' } })

    const listed = await app.inject({ method: 'GET', url: '/v1/sessions' })
    const sessions = (listed.json() as { data: Array<{ id: string }> }).data
    // Delta was touched last: newest first. The set contains the seeds plus
    // this run's create (the database persists across runs by design).
    expect(sessions[0]?.id).toBe(createdBody.data.id)
    for (const id of ['s-a', 's-b', 's-c', createdBody.data.id]) {
      expect(sessions.map((session) => session.id)).toContain(id)
    }
  })

  it('renames a session through a rename event, preserving history', async () => {
    const renamed = await app.inject({ method: 'POST', url: '/v1/sessions/s-a/rename', payload: { title: 'Alpha renamed' } })
    expect(renamed.statusCode).toBe(200)
    expect((renamed.json() as { data: { title: string } }).data.title).toBe('Alpha renamed')

    // Both reads resolve the latest title; creation is untouched.
    const fetched = await app.inject({ method: 'GET', url: '/v1/sessions/s-a' })
    expect((fetched.json() as { data: { title: string } }).data.title).toBe('Alpha renamed')
    const listed = await app.inject({ method: 'GET', url: '/v1/sessions' })
    const row = (listed.json() as { data: Array<{ id: string; title: string }> }).data.find((s) => s.id === 's-a')
    expect(row?.title).toBe('Alpha renamed')

    const missing = await app.inject({ method: 'POST', url: '/v1/sessions/nope/rename', payload: { title: 'x' } })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toEqual({ ok: false, error: { code: 'not_found', message: 'no such session nope' } })

    const blank = await app.inject({ method: 'POST', url: '/v1/sessions/s-a/rename', payload: { title: '' } })
    expect(blank.statusCode).toBe(400)
    expect((blank.json() as { error: { code: string } }).error.code).toBe('validation_failed')
  })

  it('rejects invalid session creates', async () => {
    const empty = await app.inject({ method: 'POST', url: '/v1/sessions', payload: { title: '' } })
    expect(empty.statusCode).toBe(400)
    expect((empty.json() as { error: { code: string } }).error.code).toBe('validation_failed')
    const absent = await app.inject({ method: 'POST', url: '/v1/sessions', payload: {} })
    expect(absent.statusCode).toBe(400)
  })

  it('lists session threads including the closed subagent', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/sessions/s-a/threads' })
    expect(response.statusCode).toBe(200)
    const threads = (response.json() as { data: Array<{ key: string; kind: string; status: string; acceptingSteer: boolean }> }).data
    expect(threads.map((thread) => thread.key).sort()).toEqual(['agent:c1', 's-a'])
    const child = threads.find((thread) => thread.key === 'agent:c1')
    expect(child).toMatchObject({ kind: 'subagent', status: 'FINISHED', acceptingSteer: false })
  })

  it('gets one thread with live steer availability', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/threads/s-a' })
    expect(response.statusCode).toBe(200)
    const thread = (response.json() as { data: Record<string, unknown> }).data
    expect(thread).toMatchObject({ key: 's-a', sessionId: 's-a', kind: 'session', acceptingSteer: true })
    expect(typeof thread['updatedAt']).toBe('string')

    const missing = await app.inject({ method: 'GET', url: '/v1/threads/nope' })
    expect(missing.statusCode).toBe(404)
    expect((missing.json() as { error: { code: string } }).error.code).toBe('not_found')
  })

  it('pages thread messages with afterSeq and limit', async () => {
    const full = await app.inject({ method: 'GET', url: '/v1/threads/s-a/messages' })
    expect(full.statusCode).toBe(200)
    const fullBody = full.json() as { data: Array<{ seq: number; kind: string }>; nextAfterSeq: number }
    expect(fullBody.data.map((message) => message.seq)).toEqual([1, 2, 3])
    expect(fullBody.nextAfterSeq).toBe(3)
    expect(fullBody.data[2]).toMatchObject({ kind: 'tool', name: 'domain.scan', state: 'done' })

    const page = await app.inject({ method: 'GET', url: '/v1/threads/s-a/messages?afterSeq=1&limit=1' })
    const pageBody = page.json() as { data: Array<{ seq: number; text: string }>; nextAfterSeq: number }
    expect(pageBody.data).toHaveLength(1)
    expect(pageBody.data[0]).toMatchObject({ seq: 2, text: 'hi' })
    expect(pageBody.nextAfterSeq).toBe(2)

    const empty = await app.inject({ method: 'GET', url: '/v1/threads/s-b/messages' })
    expect(empty.json()).toEqual({ ok: true, data: [], nextAfterSeq: 0 })

    const bad = await app.inject({ method: 'GET', url: '/v1/threads/s-a/messages?limit=999' })
    expect(bad.statusCode).toBe(400)
    expect((bad.json() as { error: { code: string } }).error.code).toBe('validation_failed')
  })

  it('lists and gets runs', async () => {
    const listed = await app.inject({ method: 'GET', url: '/v1/runs' })
    expect(listed.statusCode).toBe(200)
    expect((listed.json() as { data: Array<{ id: string }> }).data.map((run) => run.id).sort()).toEqual([
      'company-run-c1',
      'research-run-r1',
      'session-run-s-a',
      'session-run-s-b',
    ])

    const filtered = await app.inject({ method: 'GET', url: '/v1/runs?sessionId=s-a' })
    expect((filtered.json() as { data: Array<{ id: string }> }).data.map((run) => run.id)).toEqual([
      'session-run-s-a',
    ])

    const one = await app.inject({ method: 'GET', url: '/v1/runs/session-run-s-a' })
    expect(one.statusCode).toBe(200)
    expect((one.json() as { data: Record<string, unknown> }).data).toMatchObject({
      id: 'session-run-s-a',
      sessionId: 's-a',
      threadKey: 's-a',
      state: 'RUNNING',
    })

    const missing = await app.inject({ method: 'GET', url: '/v1/runs/session-run-nope' })
    expect(missing.statusCode).toBe(404)

    const child = await app.inject({ method: 'GET', url: '/v1/runs/company-run-c1' })
    expect(child.statusCode).toBe(200)
    expect((child.json() as { data: Record<string, unknown> }).data).toMatchObject({
      id: 'company-run-c1',
      sessionId: 'company-run-c1',
      threadKey: 'agent:company-run-c1',
      state: 'IDLE',
    })
  })

  it('sends to a session and routes @name to the child', async () => {
    const send = await app.inject({ method: 'POST', url: '/v1/commands/send', payload: { threadKey: 's-a', text: 'go' } })
    expect(send.statusCode).toBe(202)
    const sendBody = send.json() as { data: { commandId: string; state: string } }
    expect(sendBody.data.state).toBe('accepted')
    expect(runs.signals.at(-1)).toMatchObject({ workflowId: 'session-run-s-a', signal: 'runSend' })

    const mention = await app.inject({
      method: 'POST',
      url: '/v1/commands/send',
      payload: { threadKey: 's-a', text: '@scout dig deeper' },
    })
    expect(mention.statusCode).toBe(202)
    expect(runs.signals.at(-1)).toMatchObject({ workflowId: 'c1', signal: 'childMessage' })

    const firstSend = await app.inject({
      method: 'POST',
      url: '/v1/commands/send',
      payload: { threadKey: 's-c', text: 'hello?' },
    })
    expect(firstSend.statusCode).toBe(202)
    const started = await app.inject({ method: 'GET', url: '/v1/runs/session-run-s-c' })
    expect(started.statusCode).toBe(200)
    expect((started.json() as { data: Record<string, unknown> }).data).toMatchObject({
      id: 'session-run-s-c',
      sessionId: 's-c',
      state: 'RUNNING',
    })

    const noThread = await app.inject({
      method: 'POST',
      url: '/v1/commands/send',
      payload: { threadKey: 'nope', text: 'hello?' },
    })
    expect(noThread.statusCode).toBe(404)

    const bad = await app.inject({ method: 'POST', url: '/v1/commands/send', payload: { threadKey: 's-a' } })
    expect(bad.statusCode).toBe(400)
  })

  it('dispatches slash skills to runSkill and rejects unknown skills', async () => {
    const skill = await app.inject({
      method: 'POST',
      url: '/v1/commands/send',
      payload: { threadKey: 's-a', text: '/brainstorm new sectors' },
    })
    expect(skill.statusCode).toBe(202)
    const invoked = runs.signals.at(-1)
    expect(invoked).toMatchObject({ workflowId: 'session-run-s-a', signal: 'runSkill' })
    const args = (invoked?.args ?? []) as Array<{ prompt: string; tools: string[]; text: string }>
    expect(args[0]?.text).toBe('new sectors')
    expect(args[0]?.tools).toContain('db.kb_search')

    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/commands/send',
      payload: { threadKey: 's-a', text: '/nope do it' },
    })
    expect(unknown.statusCode).toBe(400)
    expect((unknown.json() as { error: { code: string } }).error.code).toBe('validation_failed')
  })

  it('lists registered skills for the slash picker', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/skills' })
    expect(response.statusCode).toBe(200)
    const names = ((response.json() as { data: Array<{ name: string }> }).data).map((skill) => skill.name)
    expect(names).toContain('brainstorm')
    expect(names).toContain('sector-draft')
  })

  it('steers accepted, conflicts closed sessions, and records missed steer', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/commands/steer',
      payload: { threadKey: 's-a', text: 'pivot' },
    })
    expect(ok.statusCode).toBe(202)
    expect((ok.json() as { data: { state: string } }).data.state).toBe('accepted')
    expect(runs.signals.at(-1)).toMatchObject({ workflowId: 'session-run-s-a', signal: 'runSteer' })

    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/commands/steer',
      payload: { threadKey: 's-c', text: 'too late' },
    })
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json()).toEqual({
      ok: false,
      error: { code: 'conflict', message: 'thread s-c is not accepting steer' },
    })

    const missed = await app.inject({
      method: 'POST',
      url: '/v1/commands/steer',
      payload: { threadKey: 'agent:c1', text: 'after close' },
    })
    expect(missed.statusCode).toBe(202)
    expect((missed.json() as { data: { state: string } }).data.state).toBe('missed_steer')
  })

  it('pauses, resumes, and cancels runs', async () => {
    for (const command of ['pause', 'resume', 'cancel'] as const) {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/commands/${command}`,
        payload: { runId: 'session-run-s-a' },
      })
      expect(response.statusCode).toBe(202)
      expect((response.json() as { data: { state: string } }).data.state).toBe('accepted')
    }
    const signals = runs.signals.slice(-3).map((signal) => signal.signal)
    expect(signals).toEqual(['runPause', 'runResume', 'runCancel'])

    const resumed = await app.inject({
      method: 'POST',
      url: '/v1/commands/resume',
      payload: { runId: 'session-run-s-a', extendedBudgetMs: 60000 },
    })
    expect(resumed.statusCode).toBe(202)

    const missing = await app.inject({
      method: 'POST',
      url: '/v1/commands/pause',
      payload: { runId: 'session-run-nope' },
    })
    expect(missing.statusCode).toBe(404)

    const childPause = await app.inject({
      method: 'POST',
      url: '/v1/commands/pause',
      payload: { runId: 'company-run-c1' },
    })
    expect(childPause.statusCode).toBe(409)
    expect((childPause.json() as { error: { code: string } }).error.code).toBe('conflict')

    const researchCancel = await app.inject({
      method: 'POST',
      url: '/v1/commands/cancel',
      payload: { runId: 'research-run-r1' },
    })
    expect(researchCancel.statusCode).toBe(409)
  })

  it('records approval decisions', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/commands/approve',
      payload: { approvalId: 'ap-1', decision: 'approved' },
    })
    expect(response.statusCode).toBe(202)
    expect((response.json() as { data: { state: string } }).data.state).toBe('accepted')

    const bad = await app.inject({
      method: 'POST',
      url: '/v1/commands/approve',
      payload: { approvalId: 'ap-1', decision: 'maybe' },
    })
    expect(bad.statusCode).toBe(400)

    // Same decision replays idempotently; a distinct second decision
    // conflicts — one approval never carries both verdicts.
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/commands/approve',
      payload: { approvalId: 'ap-1', decision: 'approved' },
    })
    expect(replay.statusCode).toBe(202)
    const clash = await app.inject({
      method: 'POST',
      url: '/v1/commands/approve',
      payload: { approvalId: 'ap-1', decision: 'denied' },
    })
    expect(clash.statusCode).toBe(409)
    expect((clash.json() as { error: { code: string } }).error.code).toBe('conflict')
  })

  it('answers unknown routes with the not_found envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/nope' })
    expect(response.statusCode).toBe(404)
    expect((response.json() as { error: { code: string } }).error.code).toBe('not_found')
  })

  it('deletes a session through a tombstone, hiding reads but keeping history', async () => {
    const created = await app.inject({ method: 'POST', url: '/v1/sessions', payload: { title: 'Ephemeral' } })
    expect(created.statusCode).toBe(201)
    const id = (created.json() as { data: { id: string } }).data.id
    runs.addRun(run(`session-run-${id}`, id, 'RUNNING'))
    const deleted = await app.inject({ method: 'DELETE', url: `/v1/sessions/${id}` })
    expect(deleted.statusCode).toBe(200)
    expect((deleted.json() as { data: unknown }).data).toEqual({ id, deleted: true })
    // The session workflow is stopped first; history stays in the log.
    expect(runs.signals).toContainEqual({ workflowId: `session-run-${id}`, signal: 'runCancel', args: [] })
    expect((await app.inject({ method: 'GET', url: `/v1/sessions/${id}` })).statusCode).toBe(404)
    const listed = await app.inject({ method: 'GET', url: '/v1/sessions' })
    const ids = ((listed.json() as { data: Array<{ id: string }> }).data).map((row) => row.id)
    expect(ids).not.toContain(id)
    // Mutations on the tombstone 404: rename, model, and sends.
    expect((await app.inject({ method: 'POST', url: `/v1/sessions/${id}/rename`, payload: { title: 'x' } })).statusCode).toBe(404)
    expect(
      (await app.inject({ method: 'POST', url: `/v1/commands/send`, payload: { threadKey: id, text: 'hi' } })).statusCode,
    ).toBe(404)
    // Deleting twice 404s: the tombstone is terminal.
    expect((await app.inject({ method: 'DELETE', url: `/v1/sessions/${id}` })).statusCode).toBe(404)
    // A late turn result landing after the tombstone must not poison
    // projection: it is consumed, other reads keep working, and the
    // thread stays gone.
    await appendEvent(pool, {
      idempotencyKey: `late:${id}`,
      partition: `session:${id}`,
      type: 't.message.appended',
      payload: { threadKey: id, kind: 'text', message: { text: 'late', role: 'agent' } },
    })
    expect((await app.inject({ method: 'GET', url: '/v1/sectors' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/v1/threads/${id}/messages` })).statusCode).toBe(404)
  })

  it('deleting a missing session 404s without touching runs', async () => {
    const before = runs.signals.length
    const response = await app.inject({ method: 'DELETE', url: '/v1/sessions/nope' })
    expect(response.statusCode).toBe(404)
    expect(runs.signals.length).toBe(before)
  })

  it('deletes a session whose workflow already closed', async () => {
    const created = await app.inject({ method: 'POST', url: '/v1/sessions', payload: { title: 'Closed run' } })
    const id = (created.json() as { data: { id: string } }).data.id
    runs.addRun(run(`session-run-${id}`, id, 'RUNNING'))
    runs.closeRun(`session-run-${id}`)
    // Signalling a closed handle reports the run gone: the tombstone
    // still lands instead of 500ing.
    const deleted = await app.inject({ method: 'DELETE', url: `/v1/sessions/${id}` })
    expect(deleted.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/v1/sessions/${id}` })).statusCode).toBe(404)
  })
})
