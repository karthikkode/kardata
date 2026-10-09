import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appendEvent, createSector, createSession } from '../../backend/src/db/index.js'
import { invokeTool } from '../../backend/src/mcp/tools.js'
import type { McpToolContext } from '../../backend/src/mcp/tools-types.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

describe.skipIf(!TEST_DATABASE_URL)('MCP ops runs and queue tools [F:mcp.ops.list_runs] [F:mcp.ops.get_run] [F:mcp.ops.thread_queue] [F:mcp.ops.queue_remove] [F:mcp.ops.queue_reorder] [F:db.threads.listThreadRuns] [F:db.threads.getThreadRun] [F:db.threads.listThreadQueue] [F:db.threads.removeThreadQueueItem] [F:db.threads.reorderThreadQueue] [F:db.index.listThreadRuns] [F:db.index.getThreadRun] [F:db.index.listThreadQueue] [F:db.index.removeThreadQueueItem] [F:db.index.reorderThreadQueue]', () => {
  let pool: Pool, fake: FakeRunsGateway, sectorA: string, sessionA: string, sessionB: string, foreign: string
  const scope = { tenantId: 'test-ops-runs', projectId: null }
  const karbot = (role: 'viewer' | 'operator' | 'approver' = 'approver'): McpToolContext =>
    ({ pool, scope, role, keyId: 'test-ops-key', messenger: fake })
  const now = () => new Date().toISOString()

  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_mcp_ops_runs'), max: 5 })
    fake = new FakeRunsGateway(pool)
    sectorA = (await createSector(pool, { name: 'TEST Ops A', topic: 'A', scope })).sectorId
    sessionA = (await createSession(pool, 'TEST ops chat A', scope, sectorA)).id
    sessionB = (await createSession(pool, 'TEST ops chat B', scope, sectorA)).id
    foreign = (await createSession(pool, 'TEST ops foreign', { tenantId: 'foreign-tenant', projectId: null })).id
    await appendEvent(pool, { idempotencyKey: 'test-ops-launch', partition: `session:${sessionA}`, type: 't.subagent.launched', payload: { sessionId: sessionA, parentSessionId: sessionA, childId: 'child-ops-1', name: 'TEST ops child', canDelegate: false } })
    await projectNewEvents(pool)
    fake.addRun({ id: `session-run-${sessionA}`, sessionId: sessionA, threadKey: sessionA, state: 'RUNNING', budgetUsedRatio: 0, contextUsedRatio: 0, updatedAt: now() })
    fake.addRun({ id: 'child-ops-1', sessionId: sessionA, threadKey: 'agent:child-ops-1', state: 'PAUSED', budgetUsedRatio: 0, contextUsedRatio: 0, updatedAt: now() }, 'subagentRun')
    fake.addRun({ id: `session-run-${sessionB}`, sessionId: sessionB, threadKey: sessionB, state: 'RUNNING', budgetUsedRatio: 0, contextUsedRatio: 0, updatedAt: now() })
    fake.addRun({ id: `session-run-${foreign}`, sessionId: foreign, threadKey: foreign, state: 'RUNNING', budgetUsedRatio: 0, contextUsedRatio: 0, updatedAt: now() })
    fake.seedQueue(`session-run-${sessionA}`, [{ id: 'q1', text: 'first', queuedAt: 1 }, { id: 'q2', text: 'second', queuedAt: 2 }])
  })
  afterAll(async () => { await pool?.end() })

  it('list_runs filters by sector, state and kind, and drops out-of-scope runs', async () => {
    const all = await invokeTool('ops.list_runs', karbot(), {}) as Array<{ id: string }>
    expect(all.map((run) => run.id).sort()).toEqual([`session-run-${sessionA}`, `session-run-${sessionB}`, 'child-ops-1'].sort())
    const paused = await invokeTool('ops.list_runs', karbot(), { state: 'PAUSED' }) as Array<{ id: string }>
    expect(paused.map((run) => run.id)).toEqual(['child-ops-1'])
    const children = await invokeTool('ops.list_runs', karbot(), { kind: 'subagent' }) as Array<{ id: string }>
    expect(children.map((run) => run.id)).toEqual(['child-ops-1'])
    const empty = await invokeTool('ops.list_runs', karbot(), { sectorId: 'sector-nothing' }) as unknown[]
    expect(empty).toEqual([])
  })

  it('get_run reads one run and hides out-of-scope runs', async () => {
    await expect(invokeTool('ops.get_run', karbot(), { runId: 'child-ops-1' })).resolves.toMatchObject({ id: 'child-ops-1', state: 'PAUSED' })
    await expect(invokeTool('ops.get_run', karbot(), { runId: 'run-missing' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(invokeTool('ops.get_run', karbot(), { runId: `session-run-${foreign}` })).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('thread_queue lists the queue; unknown threads are not_found', async () => {
    const items = await invokeTool('ops.thread_queue', karbot(), { threadKey: sessionA }) as Array<{ id: string }>
    expect(items.map((item) => item.id)).toEqual(['q1', 'q2'])
    await expect(invokeTool('ops.thread_queue', karbot(), { threadKey: 'thread-missing' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('queue_remove is naturally idempotent and approver-gated', async () => {
    fake.seedQueue(`session-run-${sessionA}`, [{ id: 'q1', text: 'first', queuedAt: 1 }, { id: 'q2', text: 'second', queuedAt: 2 }])
    await expect(invokeTool('ops.queue_remove', karbot(), { threadKey: sessionA, id: 'q1' })).resolves.toEqual({ removed: true })
    await expect(invokeTool('ops.queue_remove', karbot(), { threadKey: sessionA, id: 'q1' })).resolves.toEqual({ removed: false })
    await expect(invokeTool('ops.queue_remove', karbot('operator'), { threadKey: sessionA, id: 'q2' })).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(invokeTool('ops.queue_remove', karbot('viewer'), { threadKey: sessionA, id: 'q2' })).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('queue_reorder needs the exact id set and replays safely', async () => {
    fake.seedQueue(`session-run-${sessionA}`, [{ id: 'q1', text: 'first', queuedAt: 1 }, { id: 'q2', text: 'second', queuedAt: 2 }])
    await expect(invokeTool('ops.queue_reorder', karbot(), { threadKey: sessionA, ids: ['q1'] })).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(invokeTool('ops.queue_reorder', karbot(), { threadKey: sessionA, ids: ['q2', 'q1'] })).resolves.toEqual({ ok: true })
    await expect(invokeTool('ops.queue_reorder', karbot(), { threadKey: sessionA, ids: ['q2', 'q1'] })).resolves.toEqual({ ok: true })
    const items = await invokeTool('ops.thread_queue', karbot(), { threadKey: sessionA }) as Array<{ id: string }>
    expect(items.map((item) => item.id)).toEqual(['q2', 'q1'])
    await expect(invokeTool('ops.queue_reorder', karbot('operator'), { threadKey: sessionA, ids: ['q2', 'q1'] })).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('run tools fail closed without a messenger', async () => {
    const bare: McpToolContext = { pool, scope, role: 'approver', keyId: 'test-ops-key' }
    await expect(invokeTool('ops.list_runs', bare, {})).rejects.toThrow('no messenger attached')
    await expect(invokeTool('ops.thread_queue', bare, { threadKey: sessionA })).rejects.toThrow('no messenger attached')
  })
})
