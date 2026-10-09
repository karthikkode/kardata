import { describe, expect, it, vi } from 'vitest'
import { recordHeartbeat } from '../../backend/src/db/heartbeats.js'

describe('heartbeat persistence recovery [F:db.heartbeats.recordHeartbeat]', () => {
  it('persists busy/idle transitions inside the throttle interval and recovers from clock rollback', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) }
    await recordHeartbeat(db, 'busy-transition', 'stage', true, 10000)
    await recordHeartbeat(db, 'busy-transition', 'stage', false, 10001)
    await recordHeartbeat(db, 'busy-transition', 'stage', false, 10002)
    expect(db.query).toHaveBeenCalledTimes(2)
    await recordHeartbeat(db, 'busy-transition', 'stage', false, 9000)
    expect(db.query).toHaveBeenCalledTimes(3)
  })
  it('retries a failed write immediately rather than suppressing it as a recent beat', async () => {
    const failure = new Error('database disconnected')
    const query = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue({ rows: [], rowCount: 1 })
    const db = { query }
    await expect(recordHeartbeat(db, 'failed-write', 'turn', true, 10000)).rejects.toBe(failure)
    await recordHeartbeat(db, 'failed-write', 'turn', true, 10001)
    expect(query).toHaveBeenCalledTimes(2)
  })
  it('does not share throttle state across databases', async () => {
    const first = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) }
    const second = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) }
    await recordHeartbeat(first, 'same-run', 'turn', true, 10000)
    await recordHeartbeat(second, 'same-run', 'turn', true, 10001)
    expect(second.query).toHaveBeenCalledOnce()
  })
  it('does not alias distinct run/operation pairs containing colons', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) }
    await recordHeartbeat(db, 'agent:a', 'fetch', true, 10000)
    await recordHeartbeat(db, 'agent', 'a:fetch', true, 10001)
    expect(db.query).toHaveBeenCalledTimes(2)
  })
})
