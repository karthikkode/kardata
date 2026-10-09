import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appendEvent, createSector, createSession } from '../../backend/src/db/index.js'
import { invokeTool } from '../../backend/src/mcp/tools.js'
import type { McpToolContext } from '../../backend/src/mcp/tools-types.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

describe.skipIf(!TEST_DATABASE_URL)('MCP ops run controls [F:mcp.ops.pause_run] [F:mcp.ops.resume_run] [F:mcp.ops.cancel_run]', () => {
  let pool: Pool, fake: FakeRunsGateway, sessionA: string
  const scope = { tenantId: 'test-ops-control', projectId: null }
  const karbot = (role: 'viewer' | 'operator' | 'approver' = 'approver'): McpToolContext =>
    ({ pool, scope, role, keyId: 'test-ops-key', messenger: fake, runReader: fake })
  const now = () => new Date().toISOString()
  const sessionRun = () => `session-run-${sessionA}`

  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_mcp_ops_control'), max: 5 })
    fake = new FakeRunsGateway(pool)
    const sectorA = (await createSector(pool, { name: 'TEST Control A', topic: 'A', scope })).sectorId
    sessionA = (await createSession(pool, 'TEST control chat', scope, sectorA)).id
    for (const childId of ['child-ctl-1', 'company-ctl-1']) {
      await appendEvent(pool, { idempotencyKey: `test-ctl-launch-${childId}`, partition: `session:${sessionA}`, type: 't.subagent.launched', payload: { sessionId: sessionA, parentSessionId: sessionA, childId, name: `TEST ${childId}`, canDelegate: false } })
    }
    await projectNewEvents(pool)
    fake.addRun({ id: sessionRun(), sessionId: sessionA, threadKey: sessionA, state: 'RUNNING', budgetUsedRatio: 0, contextUsedRatio: 0, updatedAt: now() })
    fake.addRun({ id: 'child-ctl-1', sessionId: sessionA, threadKey: 'agent:child-ctl-1', state: 'RUNNING', budgetUsedRatio: 0, contextUsedRatio: 0, updatedAt: now() }, 'subagentRun')
    fake.addRun({ id: 'company-ctl-1', sessionId: sessionA, threadKey: 'agent:company-ctl-1', state: 'RUNNING', budgetUsedRatio: 0, contextUsedRatio: 0, updatedAt: now() }, 'companyResearch')
  })
  afterAll(async () => { await pool?.end() })

  it('pauses every run kind including company research', async () => {
    await expect(invokeTool('ops.pause_run', karbot('operator'), { runId: sessionRun() })).resolves.toMatchObject({ state: 'accepted' })
    await expect(invokeTool('ops.pause_run', karbot('operator'), { runId: 'child-ctl-1' })).resolves.toMatchObject({ state: 'accepted' })
    await expect(invokeTool('ops.pause_run', karbot('operator'), { runId: 'company-ctl-1' })).resolves.toMatchObject({ state: 'accepted' })
    expect(fake.signals).toContainEqual({ workflowId: 'company-ctl-1', signal: 'childPause', args: [] })
    await expect(invokeTool('ops.pause_run', karbot('operator'), { runId: 'run-missing' })).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('resumes every run kind with per-type signals', async () => {
    await expect(invokeTool('ops.resume_run', karbot(), { runId: 'company-ctl-1' })).resolves.toMatchObject({ state: 'accepted' })
    expect(fake.signals).toContainEqual({ workflowId: 'company-ctl-1', signal: 'childResume', args: [] })
    await expect(invokeTool('ops.resume_run', karbot(), { runId: sessionRun() })).resolves.toMatchObject({ state: 'accepted' })
  })

  it('cancels every run kind', async () => {
    await expect(invokeTool('ops.cancel_run', karbot('operator'), { runId: 'company-ctl-1' })).resolves.toMatchObject({ state: 'accepted' })
    expect(fake.signals).toContainEqual({ workflowId: 'company-ctl-1', signal: 'cancel', args: [] })
    await expect(invokeTool('ops.cancel_run', karbot('operator'), { runId: 'child-ctl-1' })).resolves.toMatchObject({ state: 'accepted' })
    await expect(invokeTool('ops.cancel_run', karbot('operator'), { runId: sessionRun() })).resolves.toMatchObject({ state: 'accepted' })
  })

  it('enforces role floors: pause/cancel operator, resume approver', async () => {
    await expect(invokeTool('ops.pause_run', karbot('viewer'), { runId: sessionRun() })).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(invokeTool('ops.cancel_run', karbot('viewer'), { runId: sessionRun() })).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(invokeTool('ops.resume_run', karbot('operator'), { runId: sessionRun() })).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(invokeTool('ops.resume_run', karbot('viewer'), { runId: sessionRun() })).rejects.toMatchObject({ code: 'permission_denied' })
  })
})
