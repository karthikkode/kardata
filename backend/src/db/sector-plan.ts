// Sector plan protocol: the single sequence behind POST
// /v1/sectors/:id/plan. Drafts and failed sectors enter planning with a
// visible planning chat; the plan workflow runs there, then the sector
// lands planned (artifact ready) or failed. Anything past draft/failed
// is a conflict; a plan run that never starts compensates back so a
// retry stays a plan instead of a 409 dead end.
import { z } from 'zod'
import { readGlobalContext, retainCompatibleDiscovery, workspaceTransaction } from './workspace.js'
import { readSectorExecutionState } from './sectors.js'
import type { TransactableDb } from './checkpoints.js'
import type { Scope } from '../auth/keys.js'
import { DbContractError } from './errors.js'
import { parseExecutablePlan, visiblePlan, type ExecutablePlan } from '../temporal/research-plan.js'
import { appendEvent, getSession, readPartition, type Db } from './events.js'
import {
  getSector,
  SECTOR_PLAN_APPROVED_EVENT,
  SECTOR_PLAN_WRITTEN_EVENT,
  SectorTransitionError,
  setSectorState,
} from './sectors.js'

export interface PlanVersion {
  version: number
  markdown: string
  at: string
  executable?: ExecutablePlan
}

export interface SectorPlan {
  sectorId: string
  versions: PlanVersion[]
  latest: PlanVersion | null
  /** Pinned versions in approval order; the last is the approved one. */
  approvals: number[]
  approvedVersion: number | null
  approvedContext?: { version: number; scope: string; decisions?: string }
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
  const events = await readPartition(db, `sector:${sectorId}`, 0, [SECTOR_PLAN_WRITTEN_EVENT, SECTOR_PLAN_APPROVED_EVENT])
  const versions: PlanVersion[] = []
  const approvals: number[] = []
  let approvedContext: SectorPlan['approvedContext']
  for (const event of events) {
    if (event.type === SECTOR_PLAN_WRITTEN_EVENT) {
      const payload = event.payload as { markdown?: unknown; executable?: ExecutablePlan }
      if (typeof payload.markdown !== 'string' || !payload.markdown.trim()) continue
      versions.push({ version: versions.length + 1, markdown: payload.markdown, at: event.at, ...(payload.executable ? { executable: payload.executable } : {}) })
    } else if (event.type === SECTOR_PLAN_APPROVED_EVENT) {
      const payload = event.payload as { version?: unknown; context?: unknown }
      if (typeof payload.version === 'number' && Number.isInteger(payload.version) && payload.version >= 1) {
        approvals.push(payload.version)
        approvedContext = payload.context === undefined ? undefined : z.object({ version: z.number().int().nonnegative(), scope: z.string(), decisions: z.string().optional() }).strict().parse(payload.context)
      }
    }
  }
  return { sectorId, versions, latest: versions[versions.length - 1] ?? null, approvals, approvedVersion: approvals[approvals.length - 1] ?? null, ...(approvedContext ? { approvedContext } : {}) }
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
  retainedExecutable?: ExecutablePlan,
): Promise<{ version: number }> {
  if (!markdown.trim()) throw new DbContractError('plan markdown must be non-empty')
  if (!idempotencyKey.trim()) throw new DbContractError('idempotencyKey must be non-empty')
  const existing = await readSectorPlan(db, sectorId, scope)
  if (!existing) throw new DbContractError(`unknown sector ${sectorId}`)
  let executable: ExecutablePlan | undefined
  try {
    executable = parseExecutablePlan(markdown) ?? retainedExecutable
  } catch (error) {
    throw new DbContractError('Invalid executable research plan', { cause: error })
  }
  const appended = await appendEvent(db, {
    idempotencyKey: `sector-plan:${sectorId}:${idempotencyKey}`,
    partition: `sector:${sectorId}`,
    type: SECTOR_PLAN_WRITTEN_EVENT,
    payload: { sectorId, markdown: visiblePlan(markdown), ...(executable ? { executable } : {}) },
  })
  const events = await readPartition(db, `sector:${sectorId}`)
  const version = events.filter((event) => event.type === SECTOR_PLAN_WRITTEN_EVENT && event.seq <= appended.seq).length
  return { version }
}

/** Brainstorm edit: appends a version on planned sectors. On approved
 * sectors the edit re-opens review (back to planned) — approval always
 * pins the exact text the owner saw, never a later edit. Anything else
 * (including running) conflicts: the run's scope is frozen. */
export async function updateSectorPlan(
  db: TransactableDb,
  sectorId: string,
  markdown: string,
  scope?: Scope,
  idempotencyKey?: string,
): Promise<{ version: number; state: string }> {
  return workspaceTransaction(db, sectorId, async (tx) => {
    if (!markdown.trim()) throw new DbContractError('plan markdown must be non-empty')
    const sector = await getSector(tx, sectorId, scope).catch((error: unknown) => {
      if (error instanceof DbContractError) return undefined
      throw error
    })
    if (!sector) throw new SectorTransitionError('not_found', `no such sector ${sectorId}`)
    sector.state = await readSectorExecutionState(tx, sectorId, scope)
    if (sector.state !== 'planned' && sector.state !== 'approved' && sector.state !== 'paused') {
      throw new SectorTransitionError('conflict', `sector ${sectorId} is ${sector.state}, not planned`)
    }
    const existing = await readSectorPlan(tx, sectorId, scope)
    if (!existing || existing.versions.length === 0) throw new DbContractError(`no plan to update on ${sectorId}`)
    const stored = await recordPlanVersion(tx, sectorId, markdown, idempotencyKey ?? `edit:${Date.now()}`, scope, existing.latest?.executable)
    if (sector.state === 'approved' || sector.state === 'paused') {
      await setSectorState(tx, sectorId, 'planned', { scope })
    }
    return { version: stored.version, state: sector.state === 'approved' || sector.state === 'paused' ? 'planned' : sector.state }
  })
}

/** Owner approval: pins an existing version and moves planned to
 * approved. Unknown versions and non-planned states fail loudly —
 * approval never invents a version. */
export async function approveSectorPlan(
  db: TransactableDb,
  sectorId: string,
  version: number,
  scope?: Scope,
  idempotencyKey?: string,
  expectedContextVersion?: number,
): Promise<{ version: number; state: string }> {
  if (expectedContextVersion !== undefined && !z.number().int().nonnegative().safeParse(expectedContextVersion).success) throw new DbContractError('Expected context version must be a non-negative integer.')
  return workspaceTransaction(db, sectorId, async (tx) => {
    const sector = await getSector(tx, sectorId, scope).catch((error: unknown) => {
      if (error instanceof DbContractError) return undefined
      throw error
    })
    if (!sector) throw new SectorTransitionError('not_found', `no such sector ${sectorId}`)
    sector.state = await readSectorExecutionState(tx, sectorId, scope)
    if (sector.state !== 'planned') {
      throw new SectorTransitionError('conflict', `sector ${sectorId} is ${sector.state}, not planned`)
    }
    const existing = await readSectorPlan(tx, sectorId, scope)
    if (!existing || !existing.versions.some((entry) => entry.version === version)) {
      throw new DbContractError(`unknown plan version ${version} on ${sectorId}`)
    }
    if (existing.latest?.version !== version) throw new SectorTransitionError('conflict', 'The plan changed. Review its latest version before approval.')
    const context = await readGlobalContext(tx, sectorId, scope)
    if (expectedContextVersion !== undefined && expectedContextVersion !== context.version) throw new SectorTransitionError('conflict', 'Global context changed. Review it before approving the plan.')
    await retainCompatibleDiscovery(tx, { sectorId, version, plan: existing, contextScope: context.sections.scope, contextDecisions: context.sections.decisions, scope })
    await appendEvent(tx, {
      idempotencyKey: idempotencyKey ?? `sector-plan-approved:${sectorId}:${version}`,
      partition: `sector:${sectorId}`,
      type: SECTOR_PLAN_APPROVED_EVENT,
      payload: { sectorId, version, context: { version: context.version, scope: context.sections.scope, decisions: context.sections.decisions } },
    })
    await setSectorState(tx, sectorId, 'approved', { scope })
    return { version, state: 'approved' }
  })
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
  startSectorPlan(
    sectorId: string,
    scope?: { tenantId: string; projectId: string | null },
    sessionId?: string,
  ): Promise<unknown>
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
    await runs.startSectorPlan(
      sectorId,
      scope ? { tenantId: scope.tenantId, projectId: scope.projectId } : undefined,
      sessionId,
    )
  } catch {
    await setSectorState(db, sectorId, from, { scope }).catch(() => undefined)
    throw new SectorPlanError('overload', 'plan worker unavailable; sector returned')
  }
  return { sectorId, state: 'planning' }
}
