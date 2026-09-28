// Ledger repository: ledger_entries projection (moved from
// ledger/project.ts, B7.6 behavior-neutral). Costs ride events as decimal
// strings and land in NUMERIC so totals are exact. Re-projection is
// idempotent: rows carry their source event seq with a uniqueness guard,
// and rebuild truncates before replaying. Presentation (formatCents) and
// the usage payload schema stay in ledger/project.ts.
import { z } from 'zod'
import { UsageRecorded } from '../ledger/project.js'
import { DbContractError } from './errors.js'
import type { Db, StoredEvent } from './events.js'

export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cost: string
}

export interface LedgerResult {
  applied: number
  ignored: string[]
}

const ZERO: UsageTotals = { inputTokens: 0, outputTokens: 0, cost: '0' }

export async function projectUsage(db: Db, events: StoredEvent[]): Promise<LedgerResult> {
  if (!Array.isArray(events)) throw new DbContractError('events must be an array')
  let applied = 0
  const ignored: string[] = []
  for (const event of events) {
    if (event.type !== 't.usage.recorded') {
      ignored.push(event.type)
      continue
    }
    const payload = UsageRecorded.parse(event.payload)
    const inserted = await db.query(
      `INSERT INTO ledger_entries (run_id, input_tokens, output_tokens, cost, event_seq)
       VALUES ($1, $2, $3, $4::numeric, $5)
       ON CONFLICT (event_seq) DO NOTHING
       RETURNING id`,
      [payload.runId, payload.inputTokens, payload.outputTokens, payload.cost, event.seq],
    )
    applied += inserted.rowCount ?? 0
  }
  return { applied, ignored }
}

/** Full rebuild: truncates the ledger and replays every usage event. */
export async function rebuildLedger(db: Db, events: StoredEvent[]): Promise<LedgerResult> {
  if (!Array.isArray(events)) throw new DbContractError('events must be an array')
  await db.query('TRUNCATE ledger_entries')
  return projectUsage(db, events)
}

interface TotalsRow {
  input_tokens: number | null
  output_tokens: number | null
  cost: string | null
}

async function totalsWhere(db: Db, where: string, params: unknown[]): Promise<UsageTotals> {
  const { rows } = await db.query<TotalsRow>(
    `SELECT SUM(input_tokens)::bigint AS input_tokens, SUM(output_tokens)::bigint AS output_tokens,
            SUM(cost)::numeric AS cost FROM ledger_entries ${where}`,
    params,
  )
  const row = rows[0]
  if (!row || row.input_tokens === null) return { ...ZERO }
  return {
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cost: row.cost ?? '0',
  }
}

export async function runTotals(db: Db, runId: string): Promise<UsageTotals> {
  if (!z.string().min(1).safeParse(runId).success) throw new DbContractError('runId must be a non-empty string')
  return totalsWhere(db, 'WHERE run_id = $1', [runId])
}

export async function fleetTotals(db: Db): Promise<UsageTotals> {
  return totalsWhere(db, '', [])
}
