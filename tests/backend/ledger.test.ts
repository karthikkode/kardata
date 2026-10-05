import { Pool } from 'pg'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  appendEvent,
  fleetTotals,
  projectUsage,
  readPartition,
  rebuildLedger,
  runTotals,
} from '../../backend/src/db/index.js'
import { formatCents } from '../../backend/src/ledger/project.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe('ledger rounding (B1.3) [F:db.index.appendEvent] [F:db.index.readPartition] [F:db.index.projectUsage] [F:db.index.runTotals] [F:db.index.fleetTotals] [F:db.index.rebuildLedger] [F:db.events.readPartition] [F:db.events.appendEvent] [F:db.ledger.projectUsage] [F:db.ledger.runTotals] [F:db.ledger.fleetTotals] [F:db.ledger.rebuildLedger] [F:db.events.DURABLE_STREAM_LOCK_SQL] [F:db.index.Db] [F:db.index.StoredEvent]', () => {
  it('rounds half-up to cents on decimal strings', () => {
    expect(formatCents('0.005')).toBe('0.01')
    expect(formatCents('0.004')).toBe('0.00')
    expect(formatCents('1.239')).toBe('1.24')
    expect(formatCents('2')).toBe('2.00')
    expect(formatCents('0.05000')).toBe('0.05')
  })
})

describe.skipIf(!TEST_DATABASE_URL)('ledger projection (B1.3)', () => {
  let url = ''

  beforeAll(async () => {
    url = await ensureTestDb('kardata_test_ledger')
  }, 30_000)

  function pool(): Pool {
    return new Pool({ connectionString: url })
  }

  async function fixture(db: Pool): Promise<void> {
    await db.query("DELETE FROM events WHERE partition = 'ledger:fixture'")
    await db.query('TRUNCATE ledger_entries')
    const rows = [
      { key: 'u-1', payload: { runId: 'r1', inputTokens: 100, outputTokens: 50, cost: '0.0125' } },
      { key: 'u-2', payload: { runId: 'r1', inputTokens: 200, outputTokens: 100, cost: '0.0375' } },
      { key: 'u-3', payload: { runId: 'r2', inputTokens: 50, outputTokens: 25, cost: '0.005' } },
    ]
    for (const row of rows) {
      await appendEvent(db, {
        idempotencyKey: row.key,
        partition: 'ledger:fixture',
        type: 't.usage.recorded',
        payload: row.payload,
      })
    }
  }

  it('totals per run and fleet match the hand-computed fixture to the cent', async () => {
    const db = pool()
    try {
      await fixture(db)
      const events = await readPartition(db, 'ledger:fixture')
      const result = await projectUsage(db, events)
      expect(result).toEqual({ applied: 3, ignored: [] })

      const r1 = await runTotals(db, 'r1')
      expect(r1.inputTokens).toBe(300)
      expect(r1.outputTokens).toBe(150)
      expect(formatCents(r1.cost)).toBe('0.05')

      const r2 = await runTotals(db, 'r2')
      expect(formatCents(r2.cost)).toBe('0.01')

      const fleet = await fleetTotals(db)
      expect(fleet.inputTokens).toBe(350)
      expect(fleet.outputTokens).toBe(175)
      expect(formatCents(fleet.cost)).toBe('0.06')
    } finally {
      await db.end()
    }
  })

  it('re-projection is idempotent: replay and rebuild keep totals exact', async () => {
    const db = pool()
    try {
      await fixture(db)
      const events = await readPartition(db, 'ledger:fixture')
      await projectUsage(db, events)
      const before = await fleetTotals(db)

      const replay = await projectUsage(db, events)
      expect(replay).toEqual({ applied: 0, ignored: [] })
      expect(await fleetTotals(db)).toEqual(before)

      const rebuilt = await rebuildLedger(db, events)
      expect(rebuilt).toEqual({ applied: 3, ignored: [] })
      expect(await fleetTotals(db)).toEqual(before)
      expect(formatCents((await fleetTotals(db)).cost)).toBe('0.06')
    } finally {
      await db.end()
    }
  })
})
