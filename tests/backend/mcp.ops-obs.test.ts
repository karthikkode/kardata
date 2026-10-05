import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSector, createSession, raiseAlert, recordPlanVersion } from '../../backend/src/db/index.js'
import { invokeTool } from '../../backend/src/mcp/tools.js'
import type { McpToolContext } from '../../backend/src/mcp/tools-types.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('MCP ops observability tools [F:mcp.ops.list_alerts] [F:mcp.ops.thread_health] [F:mcp.ops.cost] [F:mcp.ops.sector_evaluation] [F:mcp.ops.recent_activity]', () => {
  let pool: Pool, sectorA: string, sessionA: string
  const scope = { tenantId: 'test-ops-obs', projectId: null }
  const karbot = (role: 'viewer' | 'approver' = 'approver'): McpToolContext => ({ pool, scope, role, keyId: 'test-ops-key' })
  const traceId = 'test-trace-obs-1'

  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_mcp_ops_obs'), max: 5 })
    sectorA = (await createSector(pool, { name: 'TEST Obs A', topic: 'A', scope })).sectorId
    sessionA = (await createSession(pool, 'TEST obs chat', scope, sectorA)).id
    await recordPlanVersion(pool, sectorA, '# TEST v1', 'TEST plan v1', scope)
    await projectNewEvents(pool)
    const rounds = await pool.query<{ id: number }>(
      `INSERT INTO execution_rounds(trace_id, run_id, thread_key, session_id, sector_id, kind, round, attempt, model, provider, started_at, finished_at, latency_ms, input_tokens, output_tokens, cached_tokens, outcome)
       VALUES ($1, 'run-obs-1', $2, $3, $4, 'chat', 1, 0, 'meta-test', 'meta', now(), now(), 120, 100, 50, 0, 'ok') RETURNING id`,
      [traceId, sessionA, sessionA, sectorA],
    )
    await pool.query(
      `INSERT INTO tool_calls(round_id, thread_key, tool, args_hash, outcome, latency_ms, at)
       VALUES ($1, $2, 'db.get_thread', 'hash-1', 'ok', 30, now())`,
      [rounds.rows[0]?.id, sessionA],
    )
    await raiseAlert(pool, { kind: 'missing-heartbeat', severity: 'high', subject: 'TEST obs alert', threadKey: sessionA })
  })
  afterAll(async () => { await pool?.end() })

  it('list_alerts reads the scope alerts with sector filter', async () => {
    const page = await invokeTool('ops.list_alerts', karbot(), {}) as { items: Array<{ subject: string; sectorId: string | null }> }
    expect(page.items.map((item) => item.subject)).toContain('TEST obs alert')
    const filtered = await invokeTool('ops.list_alerts', karbot(), { sectorId: sectorA }) as { items: unknown[] }
    expect(filtered.items.length).toBeGreaterThan(0)
    const other = await invokeTool('ops.list_alerts', karbot(), { sectorId: 'sector-nothing' }) as { items: unknown[] }
    expect(other.items).toEqual([])
  })

  it('list_alerts refuses unscoped callers', async () => {
    const bare: McpToolContext = { pool, scope: undefined, role: 'approver', keyId: 'test-ops-key' }
    await expect(invokeTool('ops.list_alerts', bare, {})).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('thread_health snapshots state plus the latest round', async () => {
    const health = await invokeTool('ops.thread_health', karbot(), { threadKey: sessionA }) as { status: string; stalled: boolean; lastRound: { model: string; outcome: string } | null }
    expect(health.lastRound).toMatchObject({ model: 'meta-test', outcome: 'ok' })
    expect(health.stalled).toBe(false)
    await expect(invokeTool('ops.thread_health', karbot(), { threadKey: 'thread-missing' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('cost reads thread and sector tokens', async () => {
    await expect(invokeTool('ops.cost', karbot(), { threadKey: sessionA })).resolves.toMatchObject({ rounds: 1, inputTokens: 100, outputTokens: 50 })
    await expect(invokeTool('ops.cost', karbot(), { sectorId: sectorA })).resolves.toMatchObject({ rounds: 1, inputTokens: 100 })
    await expect(invokeTool('ops.cost', karbot(), { sectorId: 'sector-nothing' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('sector_evaluation reads the sector rollup', async () => {
    const evaluation = await invokeTool('ops.sector_evaluation', karbot(), { sectorId: sectorA }) as { sectorId: string; cost: { rounds: number } }
    expect(evaluation.sectorId).toBe(sectorA)
    expect(evaluation.cost.rounds).toBe(1)
    await expect(invokeTool('ops.sector_evaluation', karbot(), {})).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('recent_activity merges rounds, calls and events without bodies', async () => {
    const byThread = await invokeTool('ops.recent_activity', karbot(), { threadKey: sessionA }) as { rounds: unknown[]; toolCalls: Array<{ tool: string }>; events: unknown[] }
    expect(byThread.rounds).toHaveLength(1)
    expect(byThread.toolCalls.map((call) => call.tool)).toEqual(['db.get_thread'])
    const byTrace = await invokeTool('ops.recent_activity', karbot(), { traceId }) as { rounds: unknown[]; toolCalls: unknown[] }
    expect(byTrace.rounds).toHaveLength(1)
    expect(byTrace.toolCalls).toHaveLength(1)
    await expect(invokeTool('ops.recent_activity', karbot(), {})).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('viewer role may observe', async () => {
    await expect(invokeTool('ops.thread_health', karbot('viewer'), { threadKey: sessionA })).resolves.toBeDefined()
  })
})
