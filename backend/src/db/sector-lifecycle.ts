// Sector sweep lifecycle: pause halts the run, resume and restart ensure
// one. The single sequence behind the pause/resume/restart routes and the
// db.pause/resume MCP tools. Ordering is the contract: cancel-before-state
// on pause (a halt that never lands must not relabel), start-before-state
// on resume/restart (a start that never lands must not relabel). Without a
// runner every path fails closed — a state-only transition would lie about
// a run that keeps going (pause) or never starts (resume/restart).
import { readGlobalContext } from './workspace-global-context.js'
import { readSectorPlan } from './sector-plan.js'
import type { Scope } from '../auth/keys.js'
import { DbContractError } from './errors.js'
import type { Db } from './events.js'
import { getSector, SectorTransitionError, setSectorState, type SectorRecord } from './sectors.js'
import type { SectorSweepRunner } from './sector-start.js'

function requireRunner(runs: SectorSweepRunner | undefined): SectorSweepRunner {
  if (!runs) throw new DbContractError('sweep lifecycle unavailable: no sweep runner attached')
  return runs
}

/** Owner pause: cancel the sweep workflow first, then record paused.
 * An already-gone run still lands paused; an unreachable worker fails
 * with overload and the state stays running. */
export async function pauseSectorSweep(
  db: Db,
  runs: SectorSweepRunner | undefined,
  sectorId: string,
  scope?: Scope,
  idempotencyKey?: string,
): Promise<SectorRecord> {
  const sector = await getSector(db, sectorId, scope).catch((error: unknown) => {
    if (error instanceof DbContractError) return undefined
    throw error
  })
  if (!sector) throw new SectorTransitionError('not_found', `no such sector ${sectorId}`)
  if (sector.state !== 'running') {
    throw new SectorTransitionError('conflict', `sector ${sectorId} is ${sector.state}, not running`)
  }
  const runner = requireRunner(runs)
  try {
    await runner.cancelSectorSweep(sectorId)
  } catch {
    throw new SectorTransitionError('overload', 'sweep worker unavailable; sector left running')
  }
  await setSectorState(db, sectorId, 'paused', { scope, idempotencyKey })
  const paused = await getSector(db, sectorId, scope)
  if (!paused) throw new SectorTransitionError('not_found', `no such sector ${sectorId}`)
  return paused
}

/** Owner resume: ensure the sweep workflow first (a closed run restarts
 * under the same id; a live one is accepted, never duplicated), then
 * record running. */
export async function resumeSectorSweep(
  db: Db,
  runs: SectorSweepRunner | undefined,
  sectorId: string,
  scope?: Scope,
  idempotencyKey?: string,
): Promise<SectorRecord> {
  const sector = await getSector(db, sectorId, scope).catch((error: unknown) => {
    if (error instanceof DbContractError) return undefined
    throw error
  })
  if (!sector) throw new SectorTransitionError('not_found', `no such sector ${sectorId}`)
  if (sector.state !== 'paused') {
    throw new SectorTransitionError('conflict', `sector ${sectorId} is ${sector.state}, not paused`)
  }
  const plan = await readSectorPlan(db, sectorId, scope)
  if (plan?.approvedContext && (await readGlobalContext(db, sectorId, scope)).sections.scope !== plan.approvedContext.scope) {
    throw new SectorTransitionError('conflict', 'Shared scope changed. Revise and approve the plan before resuming.')
  }
  const runner = requireRunner(runs)
  try {
    await runner.startSectorSweep(sectorId, scope ? { tenantId: scope.tenantId, projectId: scope.projectId } : undefined)
  } catch {
    throw new SectorTransitionError('overload', 'sweep worker unavailable; sector left paused')
  }
  await setSectorState(db, sectorId, 'running', { scope, idempotencyKey })
  const running = await getSector(db, sectorId, scope)
  if (!running) throw new SectorTransitionError('not_found', `no such sector ${sectorId}`)
  return running
}

/** Owner restart: a failed sector gets a real run, not a relabel.
 * Anything past failed is a conflict. */
export async function restartSectorSweep(
  db: Db,
  runs: SectorSweepRunner | undefined,
  sectorId: string,
  scope?: Scope,
  idempotencyKey?: string,
): Promise<SectorRecord> {
  const sector = await getSector(db, sectorId, scope).catch((error: unknown) => {
    if (error instanceof DbContractError) return undefined
    throw error
  })
  if (!sector) throw new SectorTransitionError('not_found', `no such sector ${sectorId}`)
  if (sector.state !== 'failed') {
    throw new SectorTransitionError('conflict', `sector ${sectorId} is ${sector.state}, not failed`)
  }
  const runner = requireRunner(runs)
  try {
    await runner.startSectorSweep(sectorId, scope ? { tenantId: scope.tenantId, projectId: scope.projectId } : undefined)
  } catch {
    throw new SectorTransitionError('overload', 'sweep worker unavailable; sector left failed')
  }
  await setSectorState(db, sectorId, 'running', { scope, idempotencyKey })
  const running = await getSector(db, sectorId, scope)
  if (!running) throw new SectorTransitionError('not_found', `no such sector ${sectorId}`)
  return running
}
