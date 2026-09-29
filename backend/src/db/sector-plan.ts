// Sector plan protocol: the single sequence behind POST
// /v1/sectors/:id/plan. Drafts and failed sectors enter planning with a
// visible planning chat; the plan workflow runs there, then the sector
// lands planned (artifact ready) or failed. Anything past draft/failed
// is a conflict; a plan run that never starts compensates back so a
// retry stays a plan instead of a 409 dead end.
import type { Scope } from '../auth/keys.js'
import { DbContractError } from './errors.js'
import { appendEvent, getSession, readPartition, type Db } from './events.js'
import {
  getSector,
  SECTOR_PLAN_WRITTEN_EVENT,
  setSectorState,
} from './sectors.js'

export interface PlanVersion {
  version: number
  markdown: string
  at: string
}

export interface SectorPlan {
  sectorId: string
  versions: PlanVersion[]
  latest: PlanVersion | null
}

/** Read the plan artifact: every t.sector.plan_written in partition
 * order; versions are 1-based by position. Unknown sectors read as
 * undefined (never an empty plan pretending to exist). */
export async function readSectorPlan(
  db: Db,
  sectorId: string,
  scope?: Scope,
): Promise<SectorPlan | undefined> {
  const sector = await getSector(db, sectorId, scope).catch((error: unknown) => {
    if (error instanceof DbContractError) return undefined
    throw error
  })
  if (!sector) return undefined
  const events = await readPartition(db, `sector:${sectorId}`)
  const versions: PlanVersion[] = []
  for (const event of events) {
    if (event.type !== SECTOR_PLAN_WRITTEN_EVENT) continue
    const payload = event.payload as { markdown?: unknown }
    if (typeof payload.markdown !== 'string' || !payload.markdown.trim()) continue
    versions.push({ version: versions.length + 1, markdown: payload.markdown, at: event.at })
  }
  return { sectorId, versions, latest: versions[versions.length - 1] ?? null }
}

/** Record one plan version. The version is the next position in the
 * partition: concurrent writers serialize on the event log, so versions
 * never collide. Idempotent on the caller key — a retried write replays
 * the same version instead of appending a duplicate. */
export async function recordPlanVersion(
  db: Db,
  sectorId: string,
  markdown: string,
  idempotencyKey: string,
  scope?: Scope,
): Promise<{ version: number }> {
  if (!markdown.trim()) throw new DbContractError('plan markdown must be non-empty')
  if (!idempotencyKey.trim()) throw new DbContractError('idempotencyKey must be non-empty')
  const existing = await readSectorPlan(db, sectorId, scope)
  if (!existing) throw new DbContractError(`unknown sector ${sectorId}`)
  await appendEvent(db, {
    idempotencyKey: `sector-plan:${sectorId}:${idempotencyKey}`,
    partition: `sector:${sectorId}`,
    type: SECTOR_PLAN_WRITTEN_EVENT,
    payload: { sectorId, markdown },
  })
  const updated = await readSectorPlan(db, sectorId, scope)
  return { version: updated?.versions.length ?? 0 }
}

export type SectorPlanFailure = 'not_found' | 'conflict' | 'overload'

export class SectorPlanError extends Error {
  readonly failure: SectorPlanFailure

  constructor(failure: SectorPlanFailure, message: string) {
    super(message)
    this.failure = failure
  }
}

export interface SectorPlanRunner {
  startSectorPlan(sectorId: string, scope?: { tenantId: string; projectId: string | null }): Promise<unknown>
}

export async function planSectorResearch(
  db: Db,
  runs: SectorPlanRunner | undefined,
  sectorId: string,
  sessionId: string,
  scope?: Scope,
  idempotencyKey?: string,
): Promise<{ sectorId: string; state: string }> {
  const sector = await getSector(db, sectorId, scope).catch((error: unknown) => {
    if (error instanceof DbContractError) return undefined
    throw error
  })
  if (!sector) throw new SectorPlanError('not_found', `no such sector ${sectorId}`)
  if (sector.state !== 'draft' && sector.state !== 'failed') {
    throw new SectorPlanError('conflict', `sector ${sectorId} is ${sector.state}, not draft or failed`)
  }
  // The planning chat owns the run: it must exist and belong to this
  // sector, otherwise another session could claim the plan.
  const session = await getSession(db, sessionId, scope)
  if (!session) throw new SectorPlanError('not_found', `no such session ${sessionId}`)
  if (session.sectorId !== sectorId) {
    throw new SectorPlanError('conflict', `session ${sessionId} is not a ${sectorId} chat`)
  }
  // Fail closed after the reads: no state changes before this line, so a
  // runner-less caller can never half-plan a sector.
  if (!runs) throw new DbContractError('plan unavailable: no plan runner attached')
  const from = sector.state
  await setSectorState(db, sectorId, 'planning', { scope, idempotencyKey })
  try {
    await runs.startSectorPlan(sectorId, scope ? { tenantId: scope.tenantId, projectId: scope.projectId } : undefined)
  } catch {
    await setSectorState(db, sectorId, from, { scope }).catch(() => undefined)
    throw new SectorPlanError('overload', 'plan worker unavailable; sector returned')
  }
  return { sectorId, state: 'planning' }
}
