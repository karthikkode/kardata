// Sector evaluation reads over the P3.5 evaluation views: research
// quality, per-kind agent reliability and token cost, all scoped to one
// sector. Cost is measured in tokens; no pricing table exists.
import type { Scope } from '../auth/types.js'
import { createLogger, logOp } from '../observability/logging.js'
import type { Db } from './events.js'
import { requireSector, requireThread } from './workspace.js'

export interface SectorQuality {
  found: number
  accepted: number
  rejected: number
  duplicates: number
  /** Fraction of company work items carrying evidence, null when no work. */
  sourceCoverage: number | null
  /** Tokens per accepted company, null when none accepted. */
  costPerAccepted: number | null
}

export interface KindReliability {
  kind: string
  runs: number
  rounds: number
  ok: number
  errors: number
  timeouts: number
  cancelled: number
  retries: number
  loops: number
  stalls: number
}

export interface SectorCost {
  threads: number
  rounds: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  errors: number
}

export interface SectorEvaluation {
  sectorId: string
  quality: SectorQuality
  reliability: KindReliability[]
  cost: SectorCost
}

const evaluationLogger = createLogger({ op: 'sector.evaluation' })

async function readQuality(db: Db, sectorId: string): Promise<SectorQuality> {
  const quality = await db.query<{
    found: string; accepted: string; rejected: string; duplicates: string
    source_coverage: string | null; cost_per_accepted: string | null
  }>('SELECT found, accepted, rejected, duplicates, source_coverage, cost_per_accepted FROM v_research_quality WHERE sector_id = $1', [sectorId])
  const row = quality.rows[0]
  return {
    found: Number(row?.found ?? 0),
    accepted: Number(row?.accepted ?? 0),
    rejected: Number(row?.rejected ?? 0),
    duplicates: Number(row?.duplicates ?? 0),
    sourceCoverage: row?.source_coverage == null ? null : Number(row.source_coverage),
    costPerAccepted: row?.cost_per_accepted == null ? null : Number(row.cost_per_accepted),
  }
}

async function readReliability(db: Db, sectorId: string): Promise<KindReliability[]> {
  const reliability = await db.query<{
    kind: string; runs: string; rounds: string; ok: string; errors: string
    timeouts: string; cancelled: string; retries: string; loops: string; stalls: string
  }>('SELECT kind, runs, rounds, ok, errors, timeouts, cancelled, retries, loops, stalls FROM v_agent_reliability WHERE sector_id = $1 ORDER BY kind ASC', [sectorId])
  return reliability.rows.map((row) => ({
    kind: row.kind,
    runs: Number(row.runs),
    rounds: Number(row.rounds),
    ok: Number(row.ok),
    errors: Number(row.errors),
    timeouts: Number(row.timeouts),
    cancelled: Number(row.cancelled),
    retries: Number(row.retries),
    loops: Number(row.loops),
    stalls: Number(row.stalls),
  }))
}

async function readCost(db: Db, sectorId: string): Promise<SectorCost> {
  const cost = await db.query<{
    threads: string; rounds: string | null; input_tokens: string | null
    output_tokens: string | null; cached_tokens: string | null; errors: string | null
  }>(`SELECT COUNT(*) AS threads, SUM(rounds) AS rounds, SUM(input_tokens) AS input_tokens,
     SUM(output_tokens) AS output_tokens, SUM(cached_tokens) AS cached_tokens, SUM(errors) AS errors
     FROM v_thread_cost WHERE sector_id = $1`, [sectorId])
  const row = cost.rows[0]
  return {
    threads: Number(row?.threads ?? 0),
    rounds: Number(row?.rounds ?? 0),
    inputTokens: Number(row?.input_tokens ?? 0),
    outputTokens: Number(row?.output_tokens ?? 0),
    cachedTokens: Number(row?.cached_tokens ?? 0),
    errors: Number(row?.errors ?? 0),
  }
}

export interface ThreadCost {
  rounds: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  errors: number
  lastRoundAt: string | null
}

/** Token cost for one thread. Unknown or out-of-scope threads fail
 * before the view is touched; threads without rounds read zeros. */
export async function readThreadCost(db: Db, threadKey: string, scope?: Scope): Promise<ThreadCost> {
  await requireThread(db, threadKey, scope)
  const { rows } = await db.query<{
    rounds: string | null; input_tokens: string | null; output_tokens: string | null
    cached_tokens: string | null; errors: string | null; last_round_at: Date | null
  }>(`SELECT rounds, input_tokens, output_tokens, cached_tokens, errors, last_round_at
      FROM v_thread_cost WHERE thread_key = $1`, [threadKey])
  const row = rows[0]
  return {
    rounds: Number(row?.rounds ?? 0),
    inputTokens: Number(row?.input_tokens ?? 0),
    outputTokens: Number(row?.output_tokens ?? 0),
    cachedTokens: Number(row?.cached_tokens ?? 0),
    errors: Number(row?.errors ?? 0),
    lastRoundAt: row?.last_round_at ? new Date(row.last_round_at).toISOString() : null,
  }
}

/** Token cost for one sector (the evaluation cost block, standalone). */
export async function readSectorCost(db: Db, sectorId: string, scope?: Scope): Promise<SectorCost> {
  await requireSector(db, sectorId, scope)
  return readCost(db, sectorId)
}

/** Reads the three evaluation views for one sector. Unknown sectors fail
 * before any view is touched; sectors without research read zeros. */
export async function readSectorEvaluation(db: Db, sectorId: string, scope?: Scope): Promise<SectorEvaluation> {
  return logOp(evaluationLogger, 'sector.evaluation', async () => {
    await requireSector(db, sectorId, scope)
    const [quality, reliability, cost] = await Promise.all([
      readQuality(db, sectorId),
      readReliability(db, sectorId),
      readCost(db, sectorId),
    ])
    return { sectorId, quality, reliability, cost }
  }, { sectorId })
}
