import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appendEvent, createSector, createSession, ensureResearchSession, setSectorState } from '../../backend/src/db/index.js'
import { invokeTool } from '../../backend/src/mcp/tools.js'
import type { McpToolContext } from '../../backend/src/mcp/tools-types.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

describe.skipIf(!TEST_DATABASE_URL)('MCP spawn/restart/propose/request tools [F:mcp.ops.spawn_subagent] [F:mcp.ops.restart_sector_research] [F:mcp.db.propose_global_context] [F:mcp.db.request_plan]', () => {
  let pool: Pool, fake: FakeRunsGateway, sectorA: string, sectorB: string, sessionA: string, karbotSession: string, researchSession: string
  const scope = { tenantId: 'test-ops-spawn', projectId: null }
  const karbot = (role: 'viewer' | 'operator' | 'approver' = 'approver', executionThread?: string): McpToolContext =>
    ({ pool, scope, role, keyId: 'test-ops-key', messenger: fake, runReader: fake, runs: fake, delegator: fake, ...(executionThread ? { executionThread } : {}) })

  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_mcp_ops_spawn'), max: 5 })
    fake = new FakeRunsGateway(pool)
    sectorA = (await createSector(pool, { name: 'TEST Spawn A', topic: 'A', scope })).sectorId
    sectorB = (await createSector(pool, { name: 'TEST Spawn B', topic: 'B', scope })).sectorId
    sessionA = (await createSession(pool, 'TEST spawn chat', scope, sectorA)).id
    karbotSession = (await createSession(pool, 'TEST karbot general', scope)).id
    researchSession = (await ensureResearchSession(pool, sectorA, scope)).id
    await appendEvent(pool, { idempotencyKey: 'test-spawn-launch', partition: `session:${sessionA}`, type: 't.subagent.launched', payload: { sessionId: sessionA, parentSessionId: sessionA, childId: 'child-spawn-1', name: 'TEST spawn child', canDelegate: false } })
    await setSectorState(pool, sectorB, 'planning', { scope })
    await setSectorState(pool, sectorB, 'failed', { scope })
    await projectNewEvents(pool)
  })
  afterAll(async () => { await pool?.end() })

  it('spawn_subagent launches under the thread session and inherits the thread', async () => {
    const result = await invokeTool('ops.spawn_subagent', karbot('operator'), { threadKey: sessionA, goal: 'research widgets' }) as { childId: string }
    expect(result.childId).toMatch(/^child-fake-/)
    expect(fake.delegated.at(-1)).toMatchObject({ sessionId: sessionA, goal: 'research widgets', mode: 'empty', queueCapacity: 8 })
    await expect(invokeTool('ops.spawn_subagent', karbot('operator'), { threadKey: 'thread-missing', goal: 'x' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(invokeTool('ops.spawn_subagent', karbot('viewer'), { threadKey: sessionA, goal: 'x' })).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('leaf subagents cannot spawn', async () => {
    await expect(invokeTool('ops.spawn_subagent', karbot('operator', 'agent:child-spawn-1'), { threadKey: 'agent:child-spawn-1', goal: 'x' })).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('restart_sector_research restarts failed sectors only', async () => {
    const restarted = await invokeTool('ops.restart_sector_research', karbot('operator'), { sectorId: sectorB }) as { state: string }
    expect(restarted.state).toBe('running')
    expect(fake.startedSweeps).toContain(sectorB)
    await expect(invokeTool('ops.restart_sector_research', karbot('operator'), { sectorId: sectorA })).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('Karbot proposes pending-only with an explicit sectorId', async () => {
    const args = { baseVersion: 0, sections: { findings: 'TEST karbot findings' }, idempotencyKey: 'karbot-propose-1', sectorId: sectorA }
    const first = await invokeTool('db.propose_global_context', karbot('operator', karbotSession), args) as { state: string; id: string }
    expect(first.state).toBe('pending')
    const replay = await invokeTool('db.propose_global_context', karbot('operator', karbotSession), args) as { id: string }
    expect(replay.id).toBe(first.id)
    await expect(invokeTool('db.propose_global_context', karbot('operator', karbotSession), { ...args, idempotencyKey: 'karbot-propose-2' })).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(invokeTool('db.propose_global_context', karbot('operator', sessionA), { ...args, idempotencyKey: 'karbot-propose-3', sectorId: sectorB })).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('request_plan sends the instruction to the research session', async () => {
    const result = await invokeTool('db.request_plan', karbot(), { sectorId: sectorA, instruction: 'focus on Sydney' }) as { state: string }
    expect(result.state).toBe('accepted')
    expect(fake.signals).toContainEqual({ workflowId: `session-run-${researchSession}`, signal: 'runSend', args: ['focus on Sydney'] })
    await expect(invokeTool('db.request_plan', karbot(), { sectorId: sectorB, instruction: 'x' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(invokeTool('db.request_plan', karbot('operator'), { sectorId: sectorA, instruction: 'x' })).rejects.toMatchObject({ code: 'permission_denied' })
  })
})
