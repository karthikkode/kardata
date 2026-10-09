// Run API: run summaries for the Runs view.
import { request, type StagingConfig } from './client'

export type RunState =
  | 'IDLE'
  | 'RUNNING'
  | 'PAUSED'
  | 'SUSPENDED'
  | 'CANCELLING'
  | 'FINISHED'
  | 'ERROR'

/** Summary-level run for the Runs view (detail carries the live query
 * state on the backend). Ratios are 0 until backend telemetry wires them. */
export interface RunSummary {
  id: string
  sessionId: string
  threadKey: string
  state: RunState
  budgetUsedRatio: number
  contextUsedRatio: number
  updatedAt: string
  stageCursor?: string
}

export function listRuns(config: StagingConfig, sessionId?: string): Promise<RunSummary[]> {
  const suffix = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
  return request<RunSummary[]>(config, 'GET', `/v1/runs${suffix}`)
}
