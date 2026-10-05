import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSector, createSession, recordPlanVersion } from '../../backend/src/db/index.js'
import { invokeTool } from '../../backend/src/mcp/tools.js'
import type { McpToolContext } from '../../backend/src/mcp/tools-types.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('MCP sector scope for Karbot reads [F:mcp.db.get_sector_plan] [F:mcp.db.get_research_progress] [F:mcp.db.list_sector_sessions] [F:mcp.db.read_sector_thread]', () => {
  let pool: Pool, sectorA: string, sectorB: string, sessionA: string, sessionB: string
  const scope = { tenantId: 'test-sector-scope', projectId: null }
  const karbot = (role: 'viewer' | 'operator' | 'approver' = 'approver'): McpToolContext =>
    ({ pool, scope, role, keyId: 'test-scope-key' })
  const bound = (thread: string): McpToolContext => ({ pool, scope, role: 'approver', keyId: 'test-scope-key', executionThread: thread })

  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_mcp_sector_scope'), max: 5 })
    sectorA = (await createSector(pool, { name: 'TEST Scope A', topic: 'A', scope })).sectorId
    sectorB = (await createSector(pool, { name: 'TEST Scope B', topic: 'B', scope })).sectorId
    sessionA = (await createSession(pool, 'TEST scope chat A', scope, sectorA)).id
    sessionB = (await createSession(pool, 'TEST scope chat B', scope, sectorB)).id
    await recordPlanVersion(pool, sectorA, '# TEST v1', 'TEST plan v1', scope)
    await projectNewEvents(pool)
  })
  afterAll(async () => { await pool?.end() })

  it('Karbot without sectorId is told to specify it', async () => {
    for (const [name, args] of [
      ['db.get_sector_plan', {}], ['db.get_research_progress', {}], ['db.list_sector_sessions', {}],
      ['db.read_sector_thread', { threadKey: sessionA }],
    ] as const) {
      await expect(invokeTool(name, karbot(), args)).rejects.toMatchObject({ code: 'validation_failed' })
    }
  })

  it('Karbot with sectorId reads the sector', async () => {
    await expect(invokeTool('db.get_sector_plan', karbot(), { sectorId: sectorA })).resolves.toMatchObject({ latest: { version: 1 } })
    await expect(invokeTool('db.get_research_progress', karbot(), { sectorId: sectorA })).resolves.toBeDefined()
    const sessions = await invokeTool('db.list_sector_sessions', karbot(), { sectorId: sectorA }) as Array<{ id: string }>
    expect(sessions.map((session) => session.id)).toContain(sessionA)
    await expect(invokeTool('db.read_sector_thread', karbot(), { threadKey: sessionA, sectorId: sectorA })).resolves.toBeDefined()
  })

  it('a sector-bound caller reads its own sector with or without the arg', async () => {
    const ctx = bound(sessionA)
    await expect(invokeTool('db.get_sector_plan', ctx, {})).resolves.toMatchObject({ latest: { version: 1 } })
    await expect(invokeTool('db.get_sector_plan', ctx, { sectorId: sectorA })).resolves.toMatchObject({ latest: { version: 1 } })
    await expect(invokeTool('db.read_sector_thread', ctx, { threadKey: sessionA })).resolves.toBeDefined()
  })

  it('a mismatched sectorId is denied inside a sector session', async () => {
    const ctx = bound(sessionA)
    for (const [name, args] of [
      ['db.get_sector_plan', { sectorId: sectorB }], ['db.get_research_progress', { sectorId: sectorB }],
      ['db.list_sector_sessions', { sectorId: sectorB }], ['db.read_sector_thread', { threadKey: sessionA, sectorId: sectorB }],
    ] as const) {
      await expect(invokeTool(name, ctx, args)).rejects.toMatchObject({ code: 'permission_denied' })
    }
  })

  it('threads outside the resolved sector are denied', async () => {
    await expect(invokeTool('db.read_sector_thread', karbot(), { threadKey: sessionB, sectorId: sectorA })).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(invokeTool('db.read_sector_thread', bound(sessionA), { threadKey: sessionB })).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('viewer role may read (floor is viewer)', async () => {
    await expect(invokeTool('db.get_sector_plan', karbot('viewer'), { sectorId: sectorA })).resolves.toMatchObject({ latest: { version: 1 } })
  })
})
