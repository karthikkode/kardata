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
  const activity = await sectorActivity(db, sectorId, scope)
  const sessions = await listSessions(db, scope, sectorId)
  const sessionHealth: ResearchSessionHealth[] = []
  let liveThreads = 0
  for (const session of sessions) {
    const threads = await listThreads(db, session.id)
    const rows = threads.map((thread) => {
      if (thread.status !== 'FINISHED') liveThreads += 1
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
  return {
    sector: { id: sector.id, name: sector.name, state: sector.state },
    activityEntries: activity.length,
    lastActivitySeq: activity.length > 0 ? (activity[activity.length - 1]?.seq ?? null) : null,
    sessions: sessionHealth,
    liveThreads,
    stale: sector.state === 'running' && liveThreads === 0,
  }
}
