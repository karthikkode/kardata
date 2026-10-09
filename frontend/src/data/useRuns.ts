// Components-facing runs seam: run listing plus lifecycle actions as
// real hooks (state + error + retry), never re-exported api calls.
import type { StagingConfig } from './api/client'
import { cancelRun, pauseRun, resumeRun, type CommandAccepted } from './api/commands'
import { listRuns, type RunSummary } from './api/runs'
import { useAction, useResource, type ResourceStatus } from './useResource'

export type { RunState, RunSummary } from './api/runs'
export type { ExecutionRecordBody, ExecutionRecordPage } from './api/execution-records'

export interface RunAction {
  run: (runId: string) => Promise<CommandAccepted>
  pending: boolean
  error: unknown
  reset: () => void
}

export function useRunsList(
  config: StagingConfig | null,
  options: { sessionId?: string; refreshSignal?: number; onData?: (runs: RunSummary[]) => void } = {},
): { data: RunSummary[] | undefined; status: ResourceStatus; reload: () => void; refresh: () => void } {
  const { sessionId, refreshSignal = 0, onData } = options
  const key = config ? `${config.baseUrl} ${config.apiKey} ${sessionId ?? ''} ${refreshSignal}` : null
  return useResource(() => (config ? listRuns(config, sessionId) : null), key, onData)
}

export function useRunActions(config: StagingConfig | null): {
  cancel: RunAction
  pause: RunAction
  resume: RunAction
} {
  const needConfig = (): StagingConfig => {
    if (!config) throw new Error('run actions need a staging config')
    return config
  }
  const cancel = useAction(async (runId: string) => cancelRun(needConfig(), runId))
  const pause = useAction(async (runId: string) => pauseRun(needConfig(), runId))
  const resume = useAction(async (runId: string) => resumeRun(needConfig(), runId))
  return { cancel, pause, resume }
}
