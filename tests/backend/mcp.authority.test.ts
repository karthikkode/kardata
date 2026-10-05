import { createHmac } from 'node:crypto'
import { Pool } from 'pg'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { appendEvent, createSector, createSession, ensureResearchSession, readGlobalContext, recordPlanVersion, saveThreadContext, ingestSectorDocument, getSession } from '../../backend/src/db/index.js'
import { turnPalette } from '../../backend/src/temporal/activities/turn-palettes.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { hashKey } from '../../backend/src/auth/keys.js'
import { FakeRunsGateway } from './fake-gateway.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('MCP execution and resource authority over HTTP [F:http.mcpRpc] [F:backend.activity.turn_palettes.turnPalette]', () => {
  let pool: Pool, app: FastifyInstance, runs: FakeRunsGateway
  let normal: string, research: string, foreign: string, sectorId: string, general: string
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
    general = (await createSession(pool, 'TEST general Karbot', scope)).id
    normal = (await createSession(pool, 'TEST normal', scope, sectorId)).id
    research = (await ensureResearchSession(pool, sectorId, scope)).id
    foreign = (await createSession(pool, 'TEST foreign', { tenantId: 'foreign-tenant', projectId: null })).id
    await projectNewEvents(pool)
    for (const [id, parent] of [['normal-child', normal], ['research-child', research], ['general-child', general]]) await appendEvent(pool, { idempotencyKey: `test-launch-${id}`, partition: `session:${parent}`, type: 't.subagent.launched', payload: { sessionId: parent, parentSessionId: parent, childId: id, name: `TEST ${id}`, canDelegate: false } })
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
  it('lets a general Karbot execution read its own independent local context', async () => {
    await saveThreadContext(pool, general, { version: 0, notes: 'TEST private general context' }, scope)
    const result = await call('db.get_local_context', {}, general)
    expect(result.error).not.toBe(true)
    expect(JSON.parse(result.text)).toMatchObject({ threadKey: general, notes: 'TEST private general context' })
    expect((await call('db.get_local_context', { threadKey: foreign }, general)).error).toBe(true)
    expect((await call('db.get_local_context', {})).error).toBe(true)
  })
  it('allows explicit authorized sector context reads from general Karbot without exposing proposals or widening sector actors', async () => {
    const proposal = await call('db.propose_global_context', { baseVersion: 0, sections: sections('TEST private pending sector proposal'), idempotencyKey: 'private-context-read' }, normal)
    expect(proposal.error).not.toBe(true)
    const read = await call('db.get_global_context', { sectorId }, general)
    expect(read.error).not.toBe(true)
    expect(JSON.parse(read.text)).toMatchObject({ sectorId, changes: [] })
    expect(read.text).not.toContain('TEST private pending sector proposal')
    expect((await call('db.get_global_context', {}, normal)).text).toContain('TEST private pending sector proposal')
    const other = (await createSector(pool, { name: 'TEST other sector', scope })).sectorId
    const denied = (await createSector(pool, { name: 'TEST foreign sector', scope: { tenantId: 'foreign-tenant', projectId: null } })).sectorId
    await projectNewEvents(pool)
    expect((await call('db.get_global_context', { sectorId: other }, normal)).error).toBe(true)
    expect((await call('db.get_global_context', { sectorId: denied }, general)).error).toBe(true)
    expect((await call('db.get_global_context', {}, general)).error).toBe(true)
  })
  it('rechecks execution binding and grant on repeated operation keys', async () => {
    const payload = { jsonrpc: '2.0', id: 1000, method: 'tools/call', params: { name: 'db.get_local_context', arguments: {} } }
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'idempotency-key': 'TEST cached read authority', 'x-kardata-thread': general, 'x-kardata-execution': createHmac('sha256', token).update(general).digest('hex') }
    const first = await app.inject({ method: 'POST', url: '/mcp', headers, payload })
    expect(first.statusCode).toBe(200)
    expect(first.body).toContain('TEST private general context')
    const invalid = await app.inject({ method: 'POST', url: '/mcp', headers: { ...headers, 'x-kardata-execution': '0'.repeat(64) }, payload })
    expect(invalid.statusCode).toBe(403)
    expect(invalid.body).not.toContain('TEST private general context')
    const narrowed = await app.inject({ method: 'POST', url: '/mcp', headers: { ...headers, 'x-kardata-tool-grant': 'db.list_sessions' }, payload })
    expect(narrowed.body).not.toContain('TEST private general context')
    expect(narrowed.json().error).toBeDefined()
  })
  it('replays the same mutation across changed RPC ids without duplicating it', async () => {
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'idempotency-key': 'TEST changed RPC id' }
    const payload = { jsonrpc: '2.0', id: 101, method: 'tools/call', params: { name: 'db.create_session', arguments: { title: 'TEST exactly once RPC session' } } }
    const first = await app.inject({ method: 'POST', url: '/mcp', headers, payload })
    const second = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { ...payload, id: 202 } })
    expect(first.statusCode).toBe(200); expect(second.statusCode).toBe(200)
    expect(second.json().id).toBe(202)
    expect(second.json().result).toEqual(first.json().result)
  })
  it('does not let a general-chat child read or control its parent conversation', async () => {
    await appendEvent(pool, { idempotencyKey: 'TEST private general parent message', partition: `session:${general}`, type: 't.message.appended', payload: { threadKey: general, kind: 'text', message: { role: 'user', text: 'TEST parent-only brainstorming' } } })
    await projectNewEvents(pool)
    const parentRead = await call('db.get_thread', { threadKey: general }, 'agent:general-child')
    expect(parentRead.error).toBe(true)
    expect(parentRead.text).not.toContain('TEST parent-only brainstorming')
    expect((await call('db.get_thread', { threadKey: 'agent:general-child' }, 'agent:general-child')).error).not.toBe(true)
    runs.addRun({ id: `session-run-${general}`, sessionId: general, threadKey: general, state: 'RUNNING', budgetUsedRatio: 0, contextUsedRatio: 0, updatedAt: new Date().toISOString() })
    const priorSignals = runs.signals.length
    expect((await call('db.pause_run', { runId: `session-run-${general}` }, 'agent:general-child')).error).toBe(true)
    expect(runs.signals).toHaveLength(priorSignals)
    const title = (await getSession(pool, general, scope))?.title
    expect((await call('db.rename_session', { sessionId: general, title: 'TEST unauthorized child rename' }, 'agent:general-child')).error).toBe(true)
    expect((await getSession(pool, general, scope))?.title).toBe(title)
  })
  it('never replays a now-hidden file through a repeated read operation key', async () => {
    const doc = await ingestSectorDocument(pool, { sectorId, filename: 'TEST hidden replay.md', contentBase64: Buffer.from('TEST hidden file body').toString('base64'), scope })
    const payload = { jsonrpc: '2.0', id: 77, method: 'tools/call', params: { name: 'db.read_sector_document', arguments: { sectorId, documentId: doc.id } } }
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'idempotency-key': 'TEST file read operation', 'x-kardata-thread': normal, 'x-kardata-execution': createHmac('sha256', token).update(normal).digest('hex') }
    const before = await app.inject({ method: 'POST', url: '/mcp', headers, payload })
    expect(before.body).toContain('TEST hidden file body')
    const hidden = await app.inject({ method: 'PATCH', url: `/v1/sectors/${sectorId}/files/${doc.id}`, headers: { authorization: `Bearer ${token}` }, payload: { hidden: true } })
    expect(hidden.statusCode).toBe(200)
    const after = await app.inject({ method: 'POST', url: '/mcp', headers, payload })
    expect(after.json()).toMatchObject({ result: { isError: true } })
    expect(after.body).not.toContain('TEST hidden file body')
  })
  it('retries a proven missing-runner precondition under the same operation after recovery', async () => {
    const deps = app as FastifyInstance & { kardataRuns: FakeRunsGateway | undefined }
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'idempotency-key': 'TEST runner recovery' }
    const payload = { jsonrpc: '2.0', id: 900, method: 'tools/call', params: { name: 'db.send_message', arguments: { threadKey: general, text: 'TEST dependency recovery message' } } }
    const prior = runs.signals.length
    deps.kardataRuns = undefined
    try {
      const absent = await app.inject({ method: 'POST', url: '/mcp', headers, payload })
      expect(absent.json()).toMatchObject({ result: { isError: true } })
      expect(runs.signals).toHaveLength(prior)
      deps.kardataRuns = runs
      const recovered = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { ...payload, id: 901 } })
      expect(recovered.json().result.isError).not.toBe(true)
      expect(runs.signals).toHaveLength(prior + 1)
      const replayed = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { ...payload, id: 902 } })
      expect(replayed.json().result).toEqual(recovered.json().result)
      expect(runs.signals).toHaveLength(prior + 1)
    } finally { deps.kardataRuns = runs }
  })
  it('does not re-execute an uncertain mutation error', async () => {
    const send = vi.spyOn(runs, 'send').mockImplementationOnce(async () => {
      await appendEvent(pool, { idempotencyKey: 'TEST uncertain committed effect', partition: `session:${general}`, type: 't.message.appended', payload: { threadKey: general, kind: 'text', message: { role: 'user', text: 'TEST persisted effect before failure' } } })
      throw new Error('TEST uncertain post-effect transport failure')
    })
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'idempotency-key': 'TEST uncertain mutation' }
    const payload = { jsonrpc: '2.0', id: 910, method: 'tools/call', params: { name: 'db.send_message', arguments: { threadKey: general, text: 'TEST uncertain send' } } }
    try {
      const first = await app.inject({ method: 'POST', url: '/mcp', headers, payload })
      const repeat = await app.inject({ method: 'POST', url: '/mcp', headers, payload: { ...payload, id: 911 } })
      expect(first.json()).toMatchObject({ result: { isError: true } })
      expect(repeat.json().result).toEqual(first.json().result)
      expect(send).toHaveBeenCalledTimes(1)
    } finally { send.mockRestore() }
  })
  async function freshContextAuthority() {
    const sector = (await createSector(pool, { name: 'TEST independent context authority', topic: 'Widgets', scope })).sectorId
    await projectNewEvents(pool)
    const normalSession = (await createSession(pool, 'TEST independent normal', scope, sector)).id
    const researchSession = (await ensureResearchSession(pool, sector, scope)).id
    await projectNewEvents(pool)
    return { sector, normalSession, researchSession }
  }
  it('keeps normal and research-parent proposals pending for owner approval', async () => {
    const { sector, normalSession, researchSession } = await freshContextAuthority()
    const normalResult = await call('db.propose_global_context', { baseVersion: 0, sections: sections('TEST normal insight'), idempotencyKey: 'normal-insight' }, normalSession)
    expect(normalResult.error).not.toBe(true)
    expect(JSON.parse(normalResult.text)).toMatchObject({ state: 'pending', sourceThread: normalSession })
    const researchResult = await call('db.propose_global_context', { baseVersion: 0, sections: sections('TEST research evidence'), idempotencyKey: 'research-insight' }, researchSession)
    expect(JSON.parse(researchResult.text)).toMatchObject({ state: 'pending', version: null })
    expect((await readGlobalContext(pool, sector, scope)).version).toBe(0)
  })
  it('scopes proposal idempotency keys per sector so identical agent keys never collide', async () => {
    const first = await freshContextAuthority()
    const second = await freshContextAuthority()
    const args = { baseVersion: 0, sections: sections('TEST same-key insight'), idempotencyKey: 'same-agent-key' }
    const one = JSON.parse((await call('db.propose_global_context', args, first.normalSession)).text) as { id: string; state: string }
    expect(one.state).toBe('pending')
    const two = JSON.parse((await call('db.propose_global_context', args, second.normalSession)).text) as { id: string; state: string }
    expect(two.state).toBe('pending')
    expect(two.id).not.toBe(one.id)
    const replay = JSON.parse((await call('db.propose_global_context', args, first.normalSession)).text) as { id: string }
    expect(replay.id).toBe(one.id)
  })
  it('routes research-child updates through the parent to a pending owner proposal', async () => {
    const { sector, normalSession, researchSession } = await freshContextAuthority()
    const childId = `TEST-context-child-${++nonce}`
    await appendEvent(pool, { idempotencyKey: childId, partition: `session:${researchSession}`, type: 't.subagent.launched', payload: { sessionId: researchSession, parentSessionId: researchSession, childId, name: 'TEST independent research child', canDelegate: false } })
    await projectNewEvents(pool)
    const proposal = await call('db.propose_global_context', { baseVersion: 0, sections: sections('TEST child evidence'), idempotencyKey: 'child-insight' }, `agent:${childId}`)
    const data = JSON.parse(proposal.text) as { id: string; state: string }
    expect(data.state).toBe('parent-review')
    expect((await call('db.commit_child_context', { proposalId: data.id }, normalSession)).error).toBe(true)
    const committed = JSON.parse((await call('db.commit_child_context', { proposalId: data.id }, researchSession)).text) as { id: string; state: string }
    expect(committed.state).toBe('pending')
    expect(committed.id).not.toBe(data.id)
    expect((await readGlobalContext(pool, sector, scope)).version).toBe(0)
    const context = await readGlobalContext(pool, sector, scope)
    const override = await call('db.propose_global_context', { baseVersion: context.version, sections: { ...context.sections, decisions: 'TEST unauthorized replacement' }, idempotencyKey: 'protected-decision' }, researchSession)
    expect(JSON.parse(override.text)).toMatchObject({ state: 'pending' })
    expect((await readGlobalContext(pool, sector, scope)).sections.decisions).toBe('')
  })
  async function freshPlannedSector() {
    const planned = (await createSector(pool, { name: 'TEST planned widgets', topic: 'Widgets', scope, initialState: 'planned' })).sectorId
    await projectNewEvents(pool)
    await recordPlanVersion(pool, planned, '# TEST v1', `TEST plan v1 ${++nonce}`, scope)
    const researchSession = (await ensureResearchSession(pool, planned, scope)).id
    const normalSession = (await createSession(pool, 'TEST normal planned', scope, planned)).id
    await projectNewEvents(pool)
    return { planned, researchSession, normalSession }
  }
  it('denies plan writes from normal chats, research children and Karbot, allowing only the research parent', async () => {
    const { planned, researchSession, normalSession } = await freshPlannedSector()
    const childId = `TEST-plan-child-${++nonce}`
    await appendEvent(pool, { idempotencyKey: childId, partition: `session:${researchSession}`, type: 't.subagent.launched', payload: { sessionId: researchSession, parentSessionId: researchSession, childId, name: 'TEST plan research child', canDelegate: false } })
    await projectNewEvents(pool)
    const edit = (tag: string) => ({ sectorId: planned, markdown: '# TEST agent edit', idempotencyKey: `TEST plan lock ${tag} ${nonce}` })
    const normal = await call('db.update_sector_plan', edit('normal'), normalSession)
    expect(normal.error).toBe(true)
    expect(normal.text).toContain('Only the research conversation can change the plan')
    const child = await call('db.update_sector_plan', edit('child'), `agent:${childId}`)
    expect(child.error).toBe(true)
    expect(child.text).toContain('Only the research conversation can change the plan')
    const karbot = await call('db.update_sector_plan', edit('karbot'), general)
    expect(karbot.error).toBe(true)
    expect(karbot.text).toContain('Only the research conversation can change the plan')
    const parent = await call('db.update_sector_plan', edit('parent'), researchSession)
    expect(parent.error).not.toBe(true)
    expect(JSON.parse(parent.text)).toMatchObject({ version: 2 })
  })
  it('lists the plan tool only on the research parent palette', async () => {
    const list = async (grant: string[]) => {
      const response = await app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-kardata-tool-grant': grant.join(',') }, payload: { jsonrpc: '2.0', id: ++nonce, method: 'tools/list', params: {} } })
      expect(response.statusCode).toBe(200)
      const body = response.json<{ result?: { tools?: Array<{ name: string }> } }>()
      return (body.result?.tools ?? []).map((tool) => tool.name)
    }
    const normalGrant = turnPalette({ sectorScoped: true })
    expect(normalGrant).not.toContain('db.update_sector_plan')
    expect(await list(normalGrant)).not.toContain('db.update_sector_plan')
    const karbotGrant = turnPalette({})
    expect(karbotGrant).not.toContain('db.update_sector_plan')
    expect(await list(karbotGrant)).not.toContain('db.update_sector_plan')
    const researchGrant = turnPalette({ sectorScoped: true, researchParent: true })
    expect(researchGrant).toContain('db.update_sector_plan')
    expect(await list(researchGrant)).toContain('db.update_sector_plan')
  })
  it('lets a sector chat read its plan, progress and sessions, denying Karbot', async () => {
    const { planned, researchSession, normalSession } = await freshPlannedSector()
    const plan = await call('db.get_sector_plan', {}, normalSession)
    expect(plan.error).not.toBe(true)
    expect(JSON.parse(plan.text)).toMatchObject({ sectorId: planned, latest: { version: 1 } })
    const progress = await call('db.get_research_progress', {}, normalSession)
    expect(progress.error).not.toBe(true)
    expect(JSON.parse(progress.text)).toMatchObject({ sectorId: planned, planVersion: 1 })
    const sessions = await call('db.list_sector_sessions', {}, normalSession)
    expect(sessions.error).not.toBe(true)
    const listed = JSON.parse(sessions.text) as Array<{ id: string; kind: string; title: string; updatedAt: string; threadKeys: string[] }>
    expect(listed.map((session) => session.id).sort()).toEqual([normalSession, researchSession].sort())
    for (const session of listed) {
      expect(typeof session.title).toBe('string')
      expect(typeof session.updatedAt).toBe('string')
      expect(session.threadKeys).toContain(session.id)
    }
    expect(listed.find((session) => session.id === researchSession)?.kind).toBe('research')
    expect(listed.find((session) => session.id === normalSession)?.kind).toBe('normal')
    for (const name of ['db.get_sector_plan', 'db.get_research_progress', 'db.list_sector_sessions'] as const) {
      const denied = await call(name, {}, general)
      expect(denied.error, name).toBe(true)
      expect(denied.text).toContain('sector conversation')
    }
  })
  it('lets a normal chat read a sibling chat and a subagent thread, denying subagents and foreign sectors', async () => {
    const { planned, normalSession } = await freshPlannedSector()
    const sibling = (await createSession(pool, 'TEST sibling chat', scope, planned)).id
    await appendEvent(pool, { idempotencyKey: `TEST sibling msg ${++nonce}`, partition: `session:${sibling}`, type: 't.message.appended', payload: { threadKey: sibling, kind: 'text', message: { text: 'TEST sibling verdict', role: 'agent' } } })
    const childId = `TEST-read-child-${++nonce}`
    await appendEvent(pool, { idempotencyKey: childId, partition: `session:${sibling}`, type: 't.subagent.launched', payload: { sessionId: sibling, parentSessionId: sibling, childId, name: 'TEST read child', canDelegate: false } })
    await appendEvent(pool, { idempotencyKey: `TEST child msg ${++nonce}`, partition: `session:${sibling}`, type: 't.message.appended', payload: { threadKey: `agent:${childId}`, kind: 'text', message: { text: 'TEST child finding', role: 'agent' } } })
    await projectNewEvents(pool)
    const siblingRead = await call('db.read_sector_thread', { threadKey: sibling }, normalSession)
    expect(siblingRead.error).not.toBe(true)
    expect(siblingRead.text).toContain('TEST sibling verdict')
    const childRead = await call('db.read_sector_thread', { threadKey: `agent:${childId}` }, normalSession)
    expect(childRead.error).not.toBe(true)
    expect(childRead.text).toContain('TEST child finding')
    const ownChild = `TEST-own-child-${++nonce}`
    await appendEvent(pool, { idempotencyKey: ownChild, partition: `session:${normalSession}`, type: 't.subagent.launched', payload: { sessionId: normalSession, parentSessionId: normalSession, childId: ownChild, name: 'TEST own child', canDelegate: false } })
    await projectNewEvents(pool)
    const subagentRead = await call('db.read_sector_thread', { threadKey: sibling }, `agent:${ownChild}`)
    expect(subagentRead.error).toBe(true)
    expect(subagentRead.text).toContain('isolated')
    const otherSector = (await createSector(pool, { name: 'TEST other sector', topic: 'Other', scope })).sectorId
    const otherSession = (await createSession(pool, 'TEST other session', scope, otherSector)).id
    await projectNewEvents(pool)
    const foreignRead = await call('db.read_sector_thread', { threadKey: otherSession }, normalSession)
    expect(foreignRead.error).toBe(true)
    expect(foreignRead.text).toContain('outside this sector')
    const sessions = JSON.parse((await call('db.list_sector_sessions', {}, normalSession)).text) as Array<{ id: string; threadKeys: string[] }>
    expect(sessions.find((session) => session.id === sibling)?.threadKeys).toContain(`agent:${childId}`)
  })
  it('lists the sector read tools on every palette; the server denies non-sector callers', async () => {
    // Stacking contract: sectorMcpClient sits on productMcpClient, so every
    // SECTOR_TOOL must survive the Karbot palette (like db.get_local_context).
    // The tools/list grant is not the boundary: workspaceIdentity denies any
    // caller outside a sector execution, pinned by the Karbot denials above.
    for (const name of ['db.get_sector_plan', 'db.get_research_progress', 'db.list_sector_sessions', 'db.read_sector_thread'] as const) {
      expect(turnPalette({ sectorScoped: true })).toContain(name)
      expect(turnPalette({ sectorScoped: true, researchParent: true })).toContain(name)
      expect(turnPalette({})).toContain(name)
    }
  })
})
