// Pure unit tests for the Karbot monitor tick: skip reasons, sector/thread
// snapshots, and guard release. No database, no Temporal server.
import { describe, expect, it, vi, afterEach } from 'vitest'
import { finishMonitorActivity, monitorTickActivity } from '../../backend/src/temporal/activities/monitor.js'

const db = vi.hoisted(() => ({
  pool: {},
  getMonitor: vi.fn(),
  threadTurnBusy: vi.fn(),
  claimMonitorTick: vi.fn(),
  releaseMonitorTick: vi.fn(),
  researchHealth: vi.fn(),
  listSupervisionAlerts: vi.fn(),
  threadHealth: vi.fn(),
  finishMonitor: vi.fn(),
}))
vi.mock('../../backend/src/db/index.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/db/index.js')>()),
  workerPoolFromEnv: () => db.pool,
  getMonitor: db.getMonitor,
  threadTurnBusy: db.threadTurnBusy,
  claimMonitorTick: db.claimMonitorTick,
  releaseMonitorTick: db.releaseMonitorTick,
  researchHealth: db.researchHealth,
  listSupervisionAlerts: db.listSupervisionAlerts,
  threadHealth: db.threadHealth,
  finishMonitor: db.finishMonitor,
}))
const net = vi.hoisted(() => ({ connect: vi.fn(), close: vi.fn(), send: vi.fn() }))
vi.mock('../../backend/src/temporal/connection.js', () => ({ connectClient: net.connect }))
vi.mock('../../backend/src/temporal/runs-gateway.js', () => ({
  TemporalRunsGateway: class FakeGateway {
    constructor(public readonly pool: unknown, public readonly connection: unknown) {}
    send = net.send
  },
}))

afterEach(() => { vi.clearAllMocks() })

function monitor(overrides: Record<string, unknown> = {}) {
  return { id: 'mon-1', karbotThreadKey: 'sess-1', brief: 'watch the sector', tenantId: 't1', projectId: null, stoppedAt: null, ...overrides }
}

describe('monitor tick [F:backend.activity.monitor.monitorTickActivity] [F:backend.activity.monitor.finishMonitorActivity] [F:backend.activity.monitor.relevantAlerts]', () => {
  it('skips a stopped or missing monitor without claiming', async () => {
    db.getMonitor.mockResolvedValueOnce(monitor({ stoppedAt: '2026-01-01T00:00:00.000Z' }))
    await expect(monitorTickActivity({ monitorId: 'mon-1' })).resolves.toEqual({ ticked: false, skipped: 'stopped' })
    db.getMonitor.mockResolvedValueOnce(null)
    await expect(monitorTickActivity({ monitorId: 'mon-1' })).resolves.toEqual({ ticked: false, skipped: 'stopped' })
    expect(db.claimMonitorTick).not.toHaveBeenCalled()
  })
  it('skips while the Karbot thread runs a turn', async () => {
    db.getMonitor.mockResolvedValueOnce(monitor())
    db.threadTurnBusy.mockResolvedValueOnce(true)
    await expect(monitorTickActivity({ monitorId: 'mon-1' })).resolves.toEqual({ ticked: false, skipped: 'busy' })
    expect(db.claimMonitorTick).not.toHaveBeenCalled()
  })
  it('reports overlap when the claim loses on a live monitor', async () => {
    db.getMonitor.mockResolvedValueOnce(monitor()).mockResolvedValueOnce(monitor())
    db.threadTurnBusy.mockResolvedValueOnce(false)
    db.claimMonitorTick.mockResolvedValueOnce(null)
    await expect(monitorTickActivity({ monitorId: 'mon-1' })).resolves.toEqual({ ticked: false, skipped: 'overlap' })
    expect(net.send).not.toHaveBeenCalled()
  })
  it('reports stopped when the claim loses and the row is gone', async () => {
    db.getMonitor.mockResolvedValueOnce(monitor()).mockResolvedValueOnce(null)
    db.threadTurnBusy.mockResolvedValueOnce(false)
    db.claimMonitorTick.mockResolvedValueOnce(null)
    await expect(monitorTickActivity({ monitorId: 'mon-1' })).resolves.toEqual({ ticked: false, skipped: 'stopped' })
  })
  it('posts a sector snapshot with only that sector alerts', async () => {
    const claimed = monitor({ targetSectorId: 'sec-1' })
    db.getMonitor.mockResolvedValueOnce(monitor({ targetSectorId: 'sec-1' }))
    db.threadTurnBusy.mockResolvedValueOnce(false)
    db.claimMonitorTick.mockResolvedValueOnce(claimed)
    db.researchHealth.mockResolvedValueOnce({
      sector: { name: 'Optics', state: 'running' }, liveThreads: 2, stale: true,
      recentSupervision: [{ kind: 'nudge', response: 'sent' }],
    })
    db.listSupervisionAlerts.mockResolvedValueOnce({
      items: [
        ...Array.from({ length: 7 }, (_, i) => ({ sectorId: 'sec-1', state: 'open', severity: 'warning', subject: `own-${i}` })),
        { sectorId: 'sec-2', state: 'open', severity: 'critical', subject: 'other-sector' },
      ],
    })
    net.connect.mockResolvedValueOnce({ close: net.close })
    net.send.mockResolvedValueOnce({ commandId: 'c', state: 'accepted' })
    await expect(monitorTickActivity({ monitorId: 'mon-1' })).resolves.toEqual({ ticked: true })
    const [threadKey, text] = net.send.mock.calls[0] as [string, string]
    expect(threadKey).toBe('sess-1')
    expect(text).toContain('[Monitor mon-1] watch the sector')
    expect(text).toContain('sector Optics: running, 2 live threads (STALE)')
    expect(text).toContain('alert [warning] own-0')
    expect(text).not.toContain('own-5')
    expect(text).not.toContain('other-sector')
    expect(text).toContain('supervision: nudge sent')
    expect(db.releaseMonitorTick).toHaveBeenCalledWith(db.pool, 'mon-1')
    expect(net.close).toHaveBeenCalledOnce()
  })
  it('posts a thread snapshot with stalled and last-round detail', async () => {
    db.getMonitor.mockResolvedValueOnce(monitor({ targetThreadKey: 'sess-9' }))
    db.threadTurnBusy.mockResolvedValueOnce(false)
    db.claimMonitorTick.mockResolvedValueOnce(monitor({ targetThreadKey: 'sess-9' }))
    db.threadHealth.mockResolvedValueOnce({ status: 'RUNNING', queueDepth: 3, stalled: true, lastRound: { round: 4, model: 'm1', outcome: 'error', errorCode: 'provider_failed' } })
    net.connect.mockResolvedValueOnce({ close: net.close })
    net.send.mockResolvedValueOnce({ commandId: 'c', state: 'accepted' })
    await expect(monitorTickActivity({ monitorId: 'mon-1' })).resolves.toEqual({ ticked: true })
    const text = net.send.mock.calls[0]?.[1] as string
    expect(text).toContain('thread sess-9: RUNNING, queue 3 (STALLED)')
    expect(text).toContain('last round 4: m1 error (provider_failed)')
  })
  it('posts a healthy thread snapshot without extras', async () => {
    db.getMonitor.mockResolvedValueOnce(monitor({ targetThreadKey: 'sess-9' }))
    db.threadTurnBusy.mockResolvedValueOnce(false)
    db.claimMonitorTick.mockResolvedValueOnce(monitor({ targetThreadKey: 'sess-9' }))
    db.threadHealth.mockResolvedValueOnce({ status: 'IDLE', queueDepth: 0, stalled: false, lastRound: null })
    net.connect.mockResolvedValueOnce({ close: net.close })
    net.send.mockResolvedValueOnce({ commandId: 'c', state: 'accepted' })
    await expect(monitorTickActivity({ monitorId: 'mon-1' })).resolves.toEqual({ ticked: true })
    const text = net.send.mock.calls[0]?.[1] as string
    expect(text).toContain('thread sess-9: IDLE, queue 0')
    expect(text).not.toContain('STALLED')
    expect(text).not.toContain('last round')
  })
  it('releases the guard and connection when the send fails', async () => {
    db.getMonitor.mockResolvedValueOnce(monitor({ targetThreadKey: 'sess-9' }))
    db.threadTurnBusy.mockResolvedValueOnce(false)
    db.claimMonitorTick.mockResolvedValueOnce(monitor({ targetThreadKey: 'sess-9' }))
    db.threadHealth.mockResolvedValueOnce({ status: 'IDLE', queueDepth: 0, stalled: false, lastRound: null })
    net.connect.mockResolvedValueOnce({ close: net.close })
    const failure = new Error('gateway down')
    net.send.mockRejectedValueOnce(failure)
    await expect(monitorTickActivity({ monitorId: 'mon-1' })).rejects.toBe(failure)
    expect(db.releaseMonitorTick).toHaveBeenCalledWith(db.pool, 'mon-1')
    expect(net.close).toHaveBeenCalledOnce()
  })
  it('finishes a monitor', async () => {
    await expect(finishMonitorActivity({ monitorId: 'mon-1' })).resolves.toEqual({ finished: true })
    expect(db.finishMonitor).toHaveBeenCalledWith(db.pool, 'mon-1')
  })
})
