import { useRef, useState } from 'react'
import type { StagingConfig } from './staging-api'
import { reviewResearchWork, type ResearchProgress } from './workspace-api'
import type { Resource } from './useWorkspace'
export function useWorkReview(config: StagingConfig | null, resource: Resource<ResearchProgress>) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const submission = useRef<{ fingerprint: string; key: string } | null>(null)
  const [identity, setIdentity] = useState(resource.data?.sectorId)
  if (identity !== resource.data?.sectorId) { setIdentity(resource.data?.sectorId); setError(null) }
  return { busy, error, clearError: () => setError(null), async decide(workId: string, version: number, receipt: string, decision: 'retry' | 'exclude', reason: string) {
    if (!config || !resource.data) { setError('No connection. Reconnect and try again.'); return false }
    const fingerprint = JSON.stringify([config.baseUrl, config.apiKey, resource.data.sectorId, workId, version, receipt, decision, reason])
    if (submission.current?.fingerprint !== fingerprint) submission.current = { fingerprint, key: crypto.randomUUID() }
    const key = submission.current.key
    setBusy(true); setError(null)
    try { await reviewResearchWork(config, resource.data.sectorId, workId, version, receipt, decision, reason, key); submission.current = null; resource.refresh(); return true }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The decision did not save. Your reason is kept.'); return false }
    finally { setBusy(false) }
  } }
}
