// Sector-plan activities: thin worker wrappers over the db plan layer.
// Each owns its pool from env like the sweep activities; the layer's
// deterministic keys keep retries replaying instead of duplicating.
import { z } from 'zod'
import type { Scope } from '../../auth/keys.js'
import {
  DbContractError,
  recordPlanVersion,
  readSectorPlan,
  setSectorState,
  workerPoolFromEnv,
  type PlanVersion,
  type SectorPlan,
} from '../../db/index.js'
import { projectNewEvents } from '../../projector.js'

const SectorId = z.string().min(1)

export type { PlanVersion, SectorPlan }

/** Read the plan artifact through the worker pool. */
export async function readSectorPlanActivity(input: {
  sectorId: string
  scope?: Scope
}): Promise<SectorPlan | undefined> {
  if (!SectorId.safeParse(input.sectorId).success) throw new DbContractError('sectorId must be non-empty')
  const pool = workerPoolFromEnv()
  await projectNewEvents(pool)
  return readSectorPlan(pool, input.sectorId, input.scope)
}

/** Record one plan version through the worker pool. */
export async function writePlanArtifactActivity(input: {
  sectorId: string
  markdown: string
  idempotencyKey: string
  scope?: Scope
}): Promise<{ version: number }> {
  if (!SectorId.safeParse(input.sectorId).success) throw new DbContractError('sectorId must be non-empty')
  const pool = workerPoolFromEnv()
  const stored = await recordPlanVersion(pool, input.sectorId, input.markdown, input.idempotencyKey, input.scope)
  await projectNewEvents(pool)
  return stored
}

/** Terminal transition for planning: planning -> planned | failed. */
export async function setPlanStateActivity(input: {
  sectorId: string
  state: 'planned' | 'failed'
  scope?: Scope
}): Promise<void> {
  if (!SectorId.safeParse(input.sectorId).success) throw new DbContractError('sectorId must be non-empty')
  const pool = workerPoolFromEnv()
  await setSectorState(pool, input.sectorId, input.state, { scope: input.scope })
  await projectNewEvents(pool)
}
