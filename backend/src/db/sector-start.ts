// Sector research start protocol: the single sequence behind both
// POST /v1/sectors/:id/start and the db.start_sector_research MCP tool.
// Plan-mandatory start only (approved plans start, never drafts);
// anything past approved is a conflict; a sweep that never starts
// compensates back to approved so a retry stays a start instead of a
// 409 dead end.
import type { Scope } from '../auth/keys.js'
import { DbContractError } from './errors.js'
import { getSession } from './sessions.js'
import { type Db } from './events.js'
import { getSector, recordResearchSession, setSectorState } from './sectors.js'
import { readGlobalContext } from './workspace-global-context.js'
import { readSectorPlan } from './sector-plan.js'

export type SectorStartFailure = 'not_found' | 'conflict' | 'overload'

export class SectorStartError extends Error {
  readonly failure: SectorStartFailure

  constructor(failure: SectorStartFailure, message: string) {
    super(message)
    this.failure = failure
  }
}

export interface SectorSweepRunner {
  startSectorSweep(sectorId: string, scope?: { tenantId: string; projectId: string | null }): Promise<unknown>
  /** Halt the sector's sweep workflow. Already-gone runs accept quietly;
   * an unreachable worker throws. */
  cancelSectorSweep(sectorId: string): Promise<unknown>
}

export async function startSectorResearch(
  db: Db,
  runs: SectorSweepRunner | undefined,
  sectorId: string,
  scope?: Scope,
  idempotencyKey?: string,
  sessionId?: string,
): Promise<{ sectorId: string; state: string; researchSessionId: string | null }> {
  const sector = await getSector(db, sectorId, scope).catch((error: unknown) => {
    if (error instanceof DbContractError) return undefined
    throw error
  })
  if (!sector) throw new SectorStartError('not_found', `no such sector ${sectorId}`)
  // Plan-mandatory: only owner-approved plans start. The P1 interim
  // (draft starts) is gone.
  if (sector.state !== 'approved') {
    throw new SectorStartError('conflict', `sector ${sectorId} is ${sector.state}, not approved`)
  }
  const plan = await readSectorPlan(db, sectorId, scope)
  if (!plan?.versions.find((entry) => entry.version === plan.approvedVersion)?.executable) {
    throw new SectorStartError('conflict', 'Create and approve an executable plan before starting research.')
  }
  if (plan.approvedContext && (await readGlobalContext(db, sectorId, scope)).sections.scope !== plan.approvedContext.scope) {
    throw new SectorStartError('conflict', 'Shared scope changed. Revise and approve the plan before starting.')
  }
  // The calling chat owns the pin: it must exist and belong to this
  // sector, otherwise another session could claim the research.
  if (sessionId !== undefined) {
    const session = await getSession(db, sessionId, scope)
    if (!session) throw new SectorStartError('not_found', `no such session ${sessionId}`)
    if (session.sectorId !== sectorId) {
      throw new SectorStartError('conflict', `session ${sessionId} is not a ${sectorId} chat`)
    }
  }
  // Fail closed after the read: no state changes before this line, so a
  // runner-less caller can never half-start a sector.
  if (!runs) throw new DbContractError('research start unavailable: no sweep runner attached')
  await setSectorState(db, sectorId, 'queued', { scope, idempotencyKey })
  try {
    await runs.startSectorSweep(sectorId, scope ? { tenantId: scope.tenantId, projectId: scope.projectId } : undefined)
  } catch {
    await setSectorState(db, sectorId, 'approved', { scope }).catch(() => undefined)
    throw new SectorStartError('overload', 'sweep worker unavailable; sector returned to approved')
  }
  if (sessionId !== undefined) {
    await recordResearchSession(db, sectorId, sessionId, {
      scope,
      idempotencyKey: idempotencyKey === undefined ? undefined : `${idempotencyKey}:session`,
    })
  }
  const started = await getSector(db, sectorId, scope)
  // The recorded session is echoed from input: the projection catches up
  // on the next projectNewEvents, but the caller already knows the pin.
  return { sectorId, state: started?.state ?? 'queued', researchSessionId: sessionId ?? null }
}
