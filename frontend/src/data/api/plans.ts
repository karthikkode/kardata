// Sector plan API: versioned research plans and approvals.
import { request, StagingApiError, type StagingConfig } from './client'
import { SectorPlanResponse, type ExecutableResearchPlan } from '../research-plan'
import type { SectorResearch } from './sectors'

interface PlanVersionView {
  version: number
  markdown: string
  at: string
  executable?: ExecutableResearchPlan
}

export interface SectorPlanView {
  sectorId: string
  versions: PlanVersionView[]
  latest: PlanVersionView | null
  approvals?: number[]
  approvedVersion?: number | null
}

/** Explicit plan: draft/failed enters planning with a visible planning chat. */
export function planSector(config: StagingConfig, sectorId: string): Promise<SectorResearch> {
  return request<SectorResearch>(config, 'POST', `/v1/sectors/${encodeURIComponent(sectorId)}/plan`)
}

/** Read the versioned research plan artifact (empty until planned). */
export async function readSectorPlan(config: StagingConfig, sectorId: string): Promise<SectorPlanView> {
  const result = SectorPlanResponse.safeParse(await request<unknown>(config, 'GET', `/v1/sectors/${encodeURIComponent(sectorId)}/plan`))
  if (!result.success) throw new StagingApiError(502, 'invalid_response', 'The research plan response could not be validated.')
  return result.data
}

/** Owner approval: pins a plan version (planned to approved). */
export function approveSectorPlan(config: StagingConfig, sectorId: string, version: number, contextVersion?: number): Promise<SectorResearch> {
  return request<SectorResearch>(config, 'POST', `/v1/sectors/${encodeURIComponent(sectorId)}/approve`, { version, ...(contextVersion === undefined ? {} : { contextVersion }) })
}

/** Brainstorm edit: appends a plan version (re-opens review when approved). */
export function updateSectorPlan(config: StagingConfig, sectorId: string, markdown: string): Promise<{ version: number }> {
  return request<{ version: number }>(config, 'PATCH', `/v1/sectors/${encodeURIComponent(sectorId)}/plan`, {
    markdown,
  })
}
