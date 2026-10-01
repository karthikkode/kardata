import { EventEmitter } from 'node:events'
import type { PoolClient } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { openThreadStream } from '../../backend/src/streams/outbox.js'
import { subscribeOutbox, type ConnectableDb } from '../../backend/src/db/outbox.js'

function fixture(failCommand?: string) {
  const listener = new EventEmitter()
  const failure = Object.assign(new Error('TEST listener failure'), { code: 'TEST_LISTEN_FAILURE' })
  const query = vi.fn(async (sql: string) => {
    if (sql === failCommand) throw failure
    return { rows: [], rowCount: 0 }
  })
  const release = vi.fn()
  const client = Object.assign(listener, { query, release }) as unknown as PoolClient
  const db = { query, connect: vi.fn(async () => client) } as unknown as ConnectableDb
  return { listener, query, release, db, failure }
}

describe('outbox subscription resource lifecycle', () => {
  it('destroys the leased client when LISTEN fails and preserves the error', async () => {
    const f = fixture('LISTEN kardata_outbox')
    await expect(subscribeOutbox(f.db)).rejects.toBe(f.failure)
    expect(f.release).toHaveBeenCalledExactlyOnceWith(true)
    expect(f.listener.listenerCount('notification')).toBe(0)
  })

  it('registers each callback once and removes all handlers on concurrent close', async () => {
    const f = fixture()
    const subscription = await subscribeOutbox(f.db)
    const callback = vi.fn()
    subscription.onNotification(callback)
    subscription.onNotification(callback)
    f.listener.emit('notification', { payload: '42' })
    expect(callback).toHaveBeenCalledExactlyOnceWith('42')
    await Promise.all([subscription.close(), subscription.close(), subscription.close()])
    expect(f.query.mock.calls.filter(([sql]) => sql === 'UNLISTEN kardata_outbox')).toHaveLength(1)
    expect(f.release).toHaveBeenCalledTimes(1)
    expect(f.listener.listenerCount('notification')).toBe(0)
    subscription.onNotification(callback)
    f.listener.emit('notification', { payload: '43' })
    expect(callback).toHaveBeenCalledTimes(1)
    expect(f.listener.listenerCount('notification')).toBe(0)
  })

  it('destroys an unsuccessfully cleaned client and exposes cleanup failure', async () => {
    const f = fixture('UNLISTEN kardata_outbox')
    const subscription = await subscribeOutbox(f.db)
    subscription.onNotification(vi.fn())
    await expect(subscription.close()).rejects.toBe(f.failure)
    await expect(subscription.close()).rejects.toBe(f.failure)
    expect(f.release).toHaveBeenCalledExactlyOnceWith(true)
    expect(f.listener.listenerCount('notification')).toBe(0)
  })

  it('keeps distinct callbacks and releases a clean client for reuse', async () => {
    const f = fixture()
    const subscription = await subscribeOutbox(f.db)
    const first = vi.fn()
    const second = vi.fn()
    subscription.onNotification(first)
    subscription.onNotification(second)
    f.listener.emit('notification', { payload: '99' })
    expect(first).toHaveBeenCalledExactlyOnceWith('99')
    expect(second).toHaveBeenCalledExactlyOnceWith('99')
    await subscription.close()
    expect(f.release).toHaveBeenCalledExactlyOnceWith()
    expect(f.listener.listenerCount('notification')).toBe(0)
  })

  it('supervises a leased client disconnect and delivers it to late subscribers', async () => {
    const f = fixture()
    const subscription = await subscribeOutbox(f.db)
    const failed = vi.fn()
    // A pg leased client has no pool-owned error handler.
    expect(() => f.listener.emit('error', f.failure)).not.toThrow()
    subscription.onError(failed)
    expect(failed).toHaveBeenCalledExactlyOnceWith(f.failure)
    await expect(subscription.close()).rejects.toBe(f.failure)
    expect(f.release).toHaveBeenCalledExactlyOnceWith(true)
  })
  it('rejects a stream disconnect that arrives while its backlog query is pending', async () => {
    const f = fixture()
    let reads = 0
    let settleRead: (() => void) | undefined
    f.db.query = vi.fn(async () => {
      reads += 1
      if (reads === 2) await new Promise<void>((resolve) => { settleRead = resolve })
      return { rows: [], rowCount: 0 }
    }) as ConnectableDb['query']
    const controller = new AbortController()
    const stream = openThreadStream(f.db, 'TEST-disconnect-race', 0, controller.signal)
    const pending = stream.next().then(() => 'resolved', () => 'rejected')
    try {
      await vi.waitFor(() => expect(settleRead).toBeTypeOf('function'))
      f.listener.emit('error', f.failure)
      settleRead?.()
      const result = await Promise.race([
        pending,
        new Promise<string>((resolve) => setTimeout(() => resolve('stalled'), 100)),
      ])
      expect(result).toBe('rejected')
      expect(f.release).toHaveBeenCalledExactlyOnceWith(true)
      expect(f.listener.listenerCount('notification')).toBe(0)
    } finally {
      settleRead?.()
      controller.abort()
      await pending
      await stream.return(undefined)
    }
  })

})
