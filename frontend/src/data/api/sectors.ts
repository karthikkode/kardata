// Sector API: sector CRUD, lifecycle, and detail views.
import { request, type StagingConfig } from './client'

export type ResearchState =
  | 'draft'
  | 'planning'
  | 'planned'
  | 'approved'
  | 'running'
  | 'paused'
  | 'queued'
  | 'failed'
  | 'complete'

export interface SectorResearch {
  id: string
  name: string
  topic: string
  companiesFound: number
  state: ResearchState
  /** Chat session that started the research (pinned); absent until recorded. */
  researchSessionId?: string | null
  createdAt: string
  updatedAt: string
}

export interface CompanyResearch {
  id: string
  sectorId: string
  sectorName: string
  name: string
  stage: string
  state: ResearchState
}

interface SectorActivityEntry {
  seq: number
  text: string
}

export interface SectorDetail extends SectorResearch {
  companies: CompanyResearch[]
  /** Full company count; companies holds the first page window. */
  companiesTotal: number
  activity: SectorActivityEntry[]
  /** Full timeline count; activity holds the first page window. */
  activityTotal: number
}

export interface SectorFilters {
  state?: ResearchState
  query?: string
}

function sectorPath(base: string, filters: SectorFilters & { sectorId?: string }): string {
  const params = new URLSearchParams()
  if (filters.state) params.set('state', filters.state)
  if (filters.query) params.set('query', filters.query)
  if (filters.sectorId) params.set('sectorId', filters.sectorId)
  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  return `${base}${suffix}`
}

export function listSectors(config: StagingConfig, filters: SectorFilters = {}): Promise<SectorResearch[]> {
  return request<SectorResearch[]>(config, 'GET', sectorPath('/v1/sectors', filters))
}

export function getSectorDetail(config: StagingConfig, sectorId: string): Promise<SectorDetail> {
  return request<SectorDetail>(config, 'GET', `/v1/sectors/${encodeURIComponent(sectorId)}`)
}

export function restartSector(config: StagingConfig, sectorId: string): Promise<SectorResearch> {
  return request<SectorResearch>(config, 'POST', `/v1/sectors/${encodeURIComponent(sectorId)}/restart`)
}

/** Owner pause from the chat window: running -> paused. */
export function pauseSector(config: StagingConfig, sectorId: string): Promise<SectorResearch> {
  return request<SectorResearch>(config, 'POST', `/v1/sectors/${encodeURIComponent(sectorId)}/pause`)
}

/** Owner resume from the chat window: paused -> running. */
export function resumeSector(config: StagingConfig, sectorId: string): Promise<SectorResearch> {
  return request<SectorResearch>(config, 'POST', `/v1/sectors/${encodeURIComponent(sectorId)}/resume`)
}

/** Create a sector (defaults to draft: attach files, start explicitly). */
export function createSector(
  config: StagingConfig,
  input: { name: string; topic?: string; state?: 'draft' | 'queued' },
): Promise<SectorResearch> {
  return request<SectorResearch>(config, 'POST', '/v1/sectors', input)
}

/** Explicit start: draft enters the research queue. */
export function startSector(config: StagingConfig, sectorId: string): Promise<SectorResearch> {
  return request<SectorResearch>(config, 'POST', `/v1/sectors/${encodeURIComponent(sectorId)}/start`)
}
