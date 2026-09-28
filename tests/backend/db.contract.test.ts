// DB layer contract (B7.x): misaligned calls throw DbContractError
// before any SQL runs. No database needed; the fake Db asserts it is
// never touched.
import { describe, expect, it } from 'vitest'
import {
  checkRate,
  claimIdempotency,
  completeIdempotency,
  DbContractError,
  findKeyByHash,
  getSession,
  getThread,
  latestOutboxSeq,
  listThreads,
  projectBatch,
  projectUsage,
  pruneHeartbeats,
  pruneOutbox,
  readEventsAfter,
  readOutboxBacklog,
  recordHeartbeat,
  releaseIdempotency,
  runCheckpointTx,
  runTotals,
  sweepIdempotency,
} from '../../backend/src/db/index.js'

function untouchedDb(): {
  db: { query: () => Promise<never>; connect: () => Promise<never> }
  wasQueried: () => boolean
} {
  let queried = false
  const fail = async (): Promise<never> => {
    queried = true
    throw new Error('must not touch the database')
  }
  return { db: { query: fail, connect: fail }, wasQueried: () => queried }
}

describe('db layer contract', () => {
  it('rejects empty key hashes without SQL', async () => {
    const { db, wasQueried } = untouchedDb()
    await expect(findKeyByHash(db, '')).rejects.toBeInstanceOf(DbContractError)
    expect(wasQueried()).toBe(false)
  })

  it('rejects bad rate inputs without SQL', async () => {
    const { db, wasQueried } = untouchedDb()
    await expect(checkRate(db, '', 10)).rejects.toBeInstanceOf(DbContractError)
    await expect(checkRate(db, 'b', 0)).rejects.toBeInstanceOf(DbContractError)
    await expect(checkRate(db, 'b', 1.5)).rejects.toBeInstanceOf(DbContractError)
    expect(wasQueried()).toBe(false)
  })

  it('rejects bad heartbeat inputs without SQL', async () => {
    const { db, wasQueried } = untouchedDb()
    await expect(recordHeartbeat(db, '', 'op', true)).rejects.toBeInstanceOf(DbContractError)
    await expect(recordHeartbeat(db, 'r', '', true)).rejects.toBeInstanceOf(DbContractError)
    await expect(
      recordHeartbeat(db, 'r', 'op', 'yes' as unknown as boolean),
    ).rejects.toBeInstanceOf(DbContractError)
    expect(wasQueried()).toBe(false)
  })

  it('rejects bad outbox reads without SQL', async () => {
    const { db, wasQueried } = untouchedDb()
    await expect(readOutboxBacklog(db, '', 0)).rejects.toBeInstanceOf(DbContractError)
    await expect(readOutboxBacklog(db, 't', -1)).rejects.toBeInstanceOf(DbContractError)
    await expect(readOutboxBacklog(db, 't', 0, 0)).rejects.toBeInstanceOf(DbContractError)
    await expect(readOutboxBacklog(db, 't', 0, -5)).rejects.toBeInstanceOf(DbContractError)
    await expect(latestOutboxSeq(db, '')).rejects.toBeInstanceOf(DbContractError)
    expect(wasQueried()).toBe(false)
  })

  it('rejects bad thread and session reads without SQL', async () => {
    const { db, wasQueried } = untouchedDb()
    await expect(getThread(db, '')).rejects.toBeInstanceOf(DbContractError)
    await expect(listThreads(db, '')).rejects.toBeInstanceOf(DbContractError)
    await expect(getSession(db, '')).rejects.toBeInstanceOf(DbContractError)
    await expect(projectBatch(db, 'nope' as unknown as [])).rejects.toBeInstanceOf(DbContractError)
    expect(wasQueried()).toBe(false)
  })

  it('rejects bad ledger and projector inputs without SQL', async () => {
    const { db, wasQueried } = untouchedDb()
    await expect(runTotals(db, '')).rejects.toBeInstanceOf(DbContractError)
    await expect(projectUsage(db, 'nope' as unknown as [])).rejects.toBeInstanceOf(DbContractError)
    await expect(readEventsAfter(db, -1, 10)).rejects.toBeInstanceOf(DbContractError)
    await expect(readEventsAfter(db, 0, 0)).rejects.toBeInstanceOf(DbContractError)
    await expect(
      runCheckpointTx(db, '', async () => undefined),
    ).rejects.toBeInstanceOf(DbContractError)
    expect(wasQueried()).toBe(false)
  })

  it('rejects bad idempotency inputs without SQL', async () => {
    const { db, wasQueried } = untouchedDb()
    await expect(claimIdempotency(db, '', 'f')).rejects.toBeInstanceOf(DbContractError)
    await expect(claimIdempotency(db, 'k', '')).rejects.toBeInstanceOf(DbContractError)
    await expect(completeIdempotency(db, '', 200, null)).rejects.toBeInstanceOf(DbContractError)
    await expect(completeIdempotency(db, 'k', 99, null)).rejects.toBeInstanceOf(DbContractError)
    await expect(releaseIdempotency(db, '')).rejects.toBeInstanceOf(DbContractError)
    expect(wasQueried()).toBe(false)
  })

  it('rejects bad retention-sweep cutoffs without SQL', async () => {
    const { db, wasQueried } = untouchedDb()
    const bad = new Date('not-a-date')
    await expect(pruneOutbox(db, bad)).rejects.toBeInstanceOf(DbContractError)
    await expect(sweepIdempotency(db, bad)).rejects.toBeInstanceOf(DbContractError)
    await expect(pruneHeartbeats(db, bad)).rejects.toBeInstanceOf(DbContractError)
    expect(wasQueried()).toBe(false)
  })

  it('retention sweepers delete only expired rows and report counts', async () => {
    const seen: Array<{ text: string; params: unknown[] }> = []
    const db = {
      query: async (text: string, params?: unknown[]) => {
        seen.push({ text, params: params ?? [] })
        return { rowCount: 3, rows: [] }
      },
    } as unknown as Parameters<typeof pruneOutbox>[0]
    const cutoff = new Date('2026-01-01T00:00:00.000Z')
    await expect(pruneOutbox(db, cutoff)).resolves.toBe(3)
    await expect(sweepIdempotency(db, cutoff)).resolves.toBe(3)
    await expect(pruneHeartbeats(db, cutoff)).resolves.toBe(3)
    expect(seen[0]?.text).toMatch(/DELETE FROM outbox/)
    expect(seen[1]?.text).toMatch(/DELETE FROM idempotency_records/)
    // Completed replays age out; in-progress claims are never swept.
    expect(seen[1]?.text).toMatch(/state = 'completed'/)
    expect(seen[1]?.text).not.toMatch(/in_progress/)
    expect(seen[2]?.text).toMatch(/DELETE FROM heartbeats/)
    for (const query of seen) expect(query.params).toEqual([cutoff.toISOString()])
  })
})
