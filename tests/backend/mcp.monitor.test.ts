import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { beginThreadTurn, claimMonitorTick, createSector, createSession, finishMonitor, finishSteering, getMonitor, releaseMonitorTick, threadTurnBusy } from '../../backend/src/db/index.js'
import { invokeTool } from '../../backend/src/mcp/tools.js'
import { monitorTickActivity } from '../../backend/src/temporal/activities/monitor.js'
import type { McpToolContext } from '../../backend/src/mcp/tools-types.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { FakeRunsGateway } from './fake-gateway.js'

describe.skipIf(!TEST_DATABASE_URL)('MCP monitor tools [F:mcp.ops.start_monitor] [F:mcp.ops.stop_monitor] [F:mcp.ops.list_monitors] [F:db.monitors.startMonitor] [F:db.monitors.stopMonitor] [F:db.monitors.listMonitors] [F:db.monitors.getMonitor] [F:db.monitors.claimMonitorTick] [F:db.monitors.releaseMonitorTick] [F:db.monitors.finishMonitor] [F:db.index.startMonitor] [F:db.index.stopMonitor] [F:db.index.listMonitors] [F:db.index.getMonitor] [F:db.index.claimMonitorTick] [F:db.index.releaseMonitorTick] [F:db.index.finishMonitor] [F:db.index.MonitorRecord] [F:db.index.MonitorRunner] [F:db.index.StartMonitorInput]', () => {
  let pool: Pool, fake: FakeRunsGateway, sectorA: string, sessionA: string, karbotSession: string, dbUrl: string
  const scope = { tenantId: 'test-ops-monitor', projectId: null }
  const karbot = (role: 'viewer' | 'operator' | 'approver' = 'operator', thread: string | null = karbotSession): McpToolContext =>
    ({ pool, scope, role, keyId: 'test-ops-key', monitor: fake, ...(thread ? { executionThread: thread } : {}) })

  beforeAll(async () => {
    dbUrl = await ensureTestDb('kardata_test_mcp_monitor')
    pool = new Pool({ connectionString: dbUrl, max: 5 })
    fake = new FakeRunsGateway(pool)
    sectorA = (await createSector(pool, { name: 'TEST Monitor A', topic: 'A', scope })).sectorId
    sessionA = (await createSession(pool, 'TEST monitor chat', scope, sectorA)).id
    karbotSession = (await createSession(pool, 'TEST karbot general', scope)).id
    await projectNewEvents(pool)
  })
  afterAll(async () => { await pool?.end() })

  it('starts one monitor per target with a 24h default until', async () => {
    const started = await invokeTool('ops.start_monitor', karbot(), { sectorId: sectorA, everyMinutes: 5, brief: 'watch research' }) as { id: string; karbotSessionId: string; until: string }
    expect(started.karbotSessionId).toBe(karbotSession)
    expect(new Date(started.until).getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000)
    expect(fake.monitorsStarted.at(-1)).toMatchObject({ monitorId: started.id, everyMs: 5 * 60 * 1000 })
    await expect(invokeTool('ops.start_monitor', karbot(), { sectorId: sectorA, everyMinutes: 10, brief: 'again' })).rejects.toMatchObject({ code: 'conflict' })
    const threaded = await invokeTool('ops.start_monitor', karbot(), { threadKey: sessionA, everyMinutes: 120, brief: 'watch thread' }) as { id: string }
    expect(threaded.id).not.toBe(started.id)
  })

  it('validates start inputs and floors', async () => {
    await expect(invokeTool('ops.start_monitor', karbot(), { everyMinutes: 5, brief: 'x' })).rejects.toThrow('exactly one of sectorId, threadKey')
    await expect(invokeTool('ops.start_monitor', karbot(), { sectorId: sectorA, threadKey: sessionA, everyMinutes: 5, brief: 'x' })).rejects.toThrow('exactly one of sectorId, threadKey')
    await expect(invokeTool('ops.start_monitor', karbot(), { sectorId: sectorA, everyMinutes: 4, brief: 'x' })).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(invokeTool('ops.start_monitor', karbot(), { sectorId: sectorA, everyMinutes: 5, brief: 'x', until: new Date(Date.now() - 1000).toISOString() })).rejects.toThrow('until must be a future timestamp')
    await expect(invokeTool('ops.start_monitor', karbot('viewer'), { sectorId: sectorA, everyMinutes: 5, brief: 'x' })).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(invokeTool('ops.start_monitor', karbot('operator', null), { sectorId: sectorA, everyMinutes: 5, brief: 'x' })).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('stops by id or target and lists the scope monitors', async () => {
    const listed = await invokeTool('ops.list_monitors', karbot(), {}) as Array<{ id: string; targetSectorId: string | null; stoppedAt: string | null }>
    expect(listed.length).toBeGreaterThanOrEqual(2)
    const first = listed.find((row) => row.targetSectorId === sectorA)
    const stopped = await invokeTool('ops.stop_monitor', karbot(), { monitorId: first?.id }) as { stoppedAt: string | null; workflowId: string }
    expect(stopped.stoppedAt).not.toBeNull()
    expect(fake.monitorsStopped).toContain(stopped.workflowId)
    const quiet = await invokeTool('ops.stop_monitor', karbot(), { monitorId: first?.id }) as { stoppedAt: string | null }
    expect(quiet.stoppedAt).toBe(stopped.stoppedAt)
    await expect(invokeTool('ops.stop_monitor', karbot(), { monitorId: 'monitor-missing' })).rejects.toMatchObject({ code: 'not_found' })
    const byTarget = await invokeTool('ops.stop_monitor', karbot(), { threadKey: sessionA }) as { stoppedAt: string | null }
    expect(byTarget.stoppedAt).not.toBeNull()
  })

  it('fails closed without a monitor runner', async () => {
    const bare: McpToolContext = { pool, scope, role: 'operator', keyId: 'test-ops-key', executionThread: karbotSession }
    await expect(invokeTool('ops.start_monitor', bare, { sectorId: sectorA, everyMinutes: 5, brief: 'x' })).rejects.toThrow('no monitor runner attached')
  })

  it('the overlap guard skips a tick while the previous one runs', async () => {
    const started = await invokeTool('ops.start_monitor', karbot(), { sectorId: sectorA, everyMinutes: 5, brief: 'overlap probe' }) as { id: string }
    expect(await claimMonitorTick(pool, started.id)).not.toBeNull()
    expect(await claimMonitorTick(pool, started.id)).toBeNull()
    await releaseMonitorTick(pool, started.id)
    expect(await claimMonitorTick(pool, started.id)).not.toBeNull()
    await releaseMonitorTick(pool, started.id)
    await finishMonitor(pool, started.id)
    expect(await claimMonitorTick(pool, started.id)).toBeNull()
    expect((await getMonitor(pool, started.id))?.stoppedAt).not.toBeNull()
  })

  it('reclaims a tick claim older than one interval (crashed tick)', async () => {
    const started = await invokeTool('ops.start_monitor', karbot(), { sectorId: sectorA, everyMinutes: 5, brief: 'stale probe' }) as { id: string }
    expect(await claimMonitorTick(pool, started.id)).not.toBeNull()
    // Simulates the crash: no release. A fresh claim still blocks...
    expect(await claimMonitorTick(pool, started.id)).toBeNull()
    // ...but once it ages past the interval, the escape reclaims it.
    await pool.query('UPDATE monitors SET last_tick_at = now() - make_interval(mins => every_minutes + 1) WHERE id = $1', [started.id])
    expect(await claimMonitorTick(pool, started.id)).not.toBeNull()
    await releaseMonitorTick(pool, started.id)
    await finishMonitor(pool, started.id)
  })

  it('skips the tick while the Karbot thread runs a turn [F:db.threads.threadTurnBusy] [F:db.index.threadTurnBusy]', async () => {
    // send() returns at enqueue, so without the idle check every tick
    // would pile another message onto the running turn.
    const started = await invokeTool('ops.start_monitor', karbot(), { sectorId: sectorA, everyMinutes: 5, brief: 'busy probe' }) as { id: string }
    const saved = process.env['DATABASE_URL']
    process.env['DATABASE_URL'] = dbUrl
    try {
      const runKey = 'TEST monitor busy turn'
      const lease = await beginThreadTurn(pool, karbotSession, runKey)
      try {
        expect(await threadTurnBusy(pool, karbotSession)).toBe(true)
        await expect(monitorTickActivity({ monitorId: started.id })).resolves.toEqual({ ticked: false, skipped: 'busy' })
        // The skipped tick claims nothing: the guard is still free.
        expect(await claimMonitorTick(pool, started.id)).not.toBeNull()
        await releaseMonitorTick(pool, started.id)
      } finally {
        await finishSteering(pool, karbotSession, runKey, lease)
      }
      expect(await threadTurnBusy(pool, karbotSession)).toBe(false)
    } finally {
      if (saved === undefined) delete process.env['DATABASE_URL']
      else process.env['DATABASE_URL'] = saved
    }
    await finishMonitor(pool, started.id)
  })
})
