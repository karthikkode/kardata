// Research health composite: one read-only snapshot answering "is this
// research alive and moving?" from sector state, the sector timeline, and
// the sector's session threads. A heuristic signal for Karbot monitoring,
// not a verdict: stale means the sector claims running while no thread is
// open to do work. Fleet liveness beats are deliberately excluded — they
// do not attribute to a sector, and reporting them here once flagged a
// running sector stale-free on another sector's beats. No writes.
import { z } from 'zod'
import type { Scope } from '../auth/keys.js'
import { DbContractError } from './errors.js'
import type { Db } from './events.js'
import { listSessions } from './events.js'
import { getSector, sectorActivity } from './sectors.js'
import { listThreads } from './threads.js'

const SectorIdSchema = z.string().min(1)

export interface ResearchThreadHealth {
  key: string
  status: string
  acceptingSteer: boolean
  queueDepth: number
  updatedAgeSec: number
}

export interface ResearchSessionHealth {
  sessionId: string
  threads: ResearchThreadHealth[]
}

export interface ResearchHealth {
  sector: { id: string; name: string; state: string }
  activityEntries: number
  lastActivitySeq: number | null
  sessions: ResearchSessionHealth[]
  liveThreads: number
  /** True when the sector claims running but no thread is open. */
  stale: boolean
  /** Historical observations, not an assertion these warnings remain active. */
  recentSupervision: Array<{ threadKey: string; kind: string; response: string; reason: string; at: string }>
}

export async function researchHealth(
  db: Db,
  sectorId: string,
  scope?: Scope,
  now: Date = new Date(),
): Promise<ResearchHealth> {
  if (!SectorIdSchema.safeParse(sectorId).success) throw new DbContractError('sectorId must be a non-empty string')
  const sector = await getSector(db, sectorId, scope)
  if (!sector) throw new DbContractError(`unknown sector ${sectorId}`)
  // Health signals come from the tail (latest entries), not the head: read
  // the total first, then the last window. Two cheap reads; the partition
  // scan dominates and stays small at thousand-event scale.
  const head = await sectorActivity(db, sectorId, scope, { limit: 1, offset: 0 })
  const tailOffset = Math.max(0, head.total - 200)
  const { entries: activity } = await sectorActivity(db, sectorId, scope, { limit: 200, offset: tailOffset })
  const sessions = await listSessions(db, scope, sectorId)
  const sessionHealth: ResearchSessionHealth[] = []
  let liveThreads = 0
  for (const session of sessions) {
    const threads = await listThreads(db, session.id)
    const rows = threads.map((thread) => {
      if (!['FINISHED','ERROR','PAUSED','SUSPENDED'].includes(thread.status)) liveThreads += 1
      return {
        key: thread.key,
        status: thread.status,
        acceptingSteer: thread.acceptingSteer,
        queueDepth: thread.queueDepth,
        updatedAgeSec: Math.max(0, Math.round((now.getTime() - new Date(thread.updatedAt).getTime()) / 1000)),
      }
    })
    sessionHealth.push({ sessionId: session.id, threads: rows })
  }
  const { rows: supervision } = await db.query<{ payload: { threadKey: string; kind: string; response: string; reason: string }; at: Date }>(
    `SELECT payload,at FROM events WHERE type='t.reconciliation.finding'
      AND partition=ANY($1::text[]) AND payload->>'threadKey'=ANY($2::text[])
      ORDER BY seq DESC LIMIT 20`,
    [sessionHealth.map((session) => `session:${session.sessionId}`),sessionHealth.flatMap((session) => session.threads.map((thread) => thread.key))],
  )
  return {
    sector: { id: sector.id, name: sector.name, state: sector.state },
    activityEntries: head.total,
    lastActivitySeq: activity.length > 0 ? (activity[activity.length - 1]?.seq ?? null) : null,
    sessions: sessionHealth,
    liveThreads,
    stale: sector.state === 'running' && liveThreads === 0,
    recentSupervision: supervision.map((row) => ({ threadKey: row.payload.threadKey,kind: row.payload.kind,response: row.payload.response,reason: row.payload.reason,at: new Date(row.at).toISOString() })),
  }
}
