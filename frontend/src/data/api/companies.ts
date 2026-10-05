// Company API: paged company lists.
import { request, type StagingConfig } from './client'
import type { CompanyResearch, SectorFilters } from './sectors'

export interface CompanyPage {
  companies: CompanyResearch[]
  total: number
}

export function listCompanies(
  config: StagingConfig,
  filters: SectorFilters & { sectorId?: string; limit?: number; offset?: number } = {},
): Promise<CompanyPage> {
  const params = new URLSearchParams()
  if (filters.state) params.set('state', filters.state)
  if (filters.query) params.set('query', filters.query)
  if (filters.sectorId) params.set('sectorId', filters.sectorId)
  if (filters.limit !== undefined) params.set('limit', String(filters.limit))
  if (filters.offset !== undefined) params.set('offset', String(filters.offset))
  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  return request<CompanyPage>(config, 'GET', `/v1/companies${suffix}`)
}
