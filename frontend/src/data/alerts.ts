import { useState } from 'react'
import { z } from 'zod'
import { request, StagingApiError, type StagingConfig } from './api/client'
import { useWorkspaceResource } from './useWorkspace'

export const SupervisionAlert = z.object({
  seq: z.number().int().positive(), at: z.string().datetime(),
  kind: z.string().min(1), severity: z.enum(['info', 'warning', 'high', 'critical']), subject: z.string().min(1),
  threadKey: z.string().min(1).nullable(), sectorId: z.string().min(1).nullable(), sessionId: z.string().min(1).nullable(),
  resolvedAt: z.string().datetime().nullable(), state: z.enum(['current-warning', 'historical']),
})
export type SupervisionAlert = z.infer<typeof SupervisionAlert>
export const SupervisionAlertsPage = z.object({ items: z.array(SupervisionAlert).max(100), nextBeforeSeq: z.number().int().positive().nullable() })
export type SupervisionAlertsPage = z.infer<typeof SupervisionAlertsPage>
export async function listSupervisionAlerts(config: StagingConfig, beforeSeq: number | null = null): Promise<SupervisionAlertsPage> {
  const query = new URLSearchParams({ limit: '20' })
  if (beforeSeq !== null) query.set('beforeSeq', String(beforeSeq))
  const result = SupervisionAlertsPage.safeParse(await request(config, 'GET', `/v1/alerts?${query}`))
  if (!result.success) throw new StagingApiError(502, 'invalid_response', 'The server returned invalid alert records.')
  return result.data
}
export function useSupervisionAlerts(config: StagingConfig | null, enabled: boolean) {
  const [beforeSeq, setBeforeSeq] = useState<number | null>(null)
  const identity = config ? `${config.baseUrl}:${config.apiKey}` : null
  const [current, setCurrent] = useState(identity)
  if (identity !== current) { setCurrent(identity); setBeforeSeq(null) }
  const resource = useWorkspaceResource(enabled ? config : null, enabled ? `alerts:${beforeSeq ?? 'latest'}` : null, (cfg) => listSupervisionAlerts(cfg, beforeSeq), beforeSeq === null)
  return { resource, older: () => { if (resource.data?.nextBeforeSeq) setBeforeSeq(resource.data.nextBeforeSeq) }, latest: () => setBeforeSeq(null), viewingOlder: beforeSeq !== null }
}
