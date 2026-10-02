import { useState } from 'react'
import { z } from 'zod'
import { request, StagingApiError, type StagingConfig } from './staging-api'
import { useWorkspaceResource } from './useWorkspace'

export const SupervisionAlert = z.object({
  seq: z.number().int().positive(), at: z.string().datetime(),
  sessionId: z.string().min(1), sessionTitle: z.string(), threadKey: z.string().min(1), sectorId: z.string().nullable(),
  kind: z.enum(['closed-owner', 'missing-heartbeat', 'stalled-progress', 'queue-starvation', 'owner-unavailable']),
  response: z.enum(['observe', 'park']), state: z.enum(['current-warning', 'historical']), threadStatus: z.string(),
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
