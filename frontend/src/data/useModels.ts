// Components-facing models seam: per-session model selection as a real
// hook (pending + error + invoke), never a re-exported api call.
import type { StagingConfig } from './api/client'
import { setSessionModel, type SessionModelSelection, type SetSessionModelInput } from './api/models'
import { useAction } from './useResource'

export type { ProviderEntry, SessionModelSelection } from './api/models'

export function useModelActions(config: StagingConfig | null): {
  setModel: {
    run: (sessionId: string, input: SetSessionModelInput) => Promise<SessionModelSelection>
    pending: boolean
    error: unknown
    reset: () => void
  }
} {
  const setModel = useAction(async (sessionId: string, input: SetSessionModelInput) => {
    if (!config) throw new Error('model actions need a staging config')
    return setSessionModel(config, sessionId, input)
  })
  return { setModel }
}
