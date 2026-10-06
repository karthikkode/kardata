// Components-facing sessions seam: session reads plus lifecycle
// actions as real hooks (state + error + retry), never re-exported api
// calls.
import type { StagingConfig } from './api/client'
import {
  compactSession,
  createSession,
  deleteSession,
  getSession,
  listSessions,
  renameSession,
  type CompactSessionResult,
  type Session,
} from './api/sessions'
import { useAction, useResource, type ResourceStatus } from './useResource'

export type { Session } from './api/sessions'

export function useSessionsList(
  config: StagingConfig | null,
  options: { sectorId?: string; refreshSignal?: number; onData?: (sessions: Session[]) => void } = {},
): { data: Session[] | undefined; status: ResourceStatus; reload: () => void; refresh: () => void } {
  const { sectorId, refreshSignal = 0, onData } = options
  const key = config ? `${config.baseUrl} ${config.apiKey} ${sectorId ?? ''} ${refreshSignal}` : null
  return useResource(() => (config ? listSessions(config, sectorId) : null), key, onData)
}

export function useSession(
  config: StagingConfig | null,
  sessionId: string | null,
  options: { onData?: (session: Session) => void } = {},
): { data: Session | undefined; status: ResourceStatus; reload: () => void } {
  const key = config && sessionId ? `${config.baseUrl} ${config.apiKey} ${sessionId}` : null
  return useResource(() => (config && sessionId ? getSession(config, sessionId) : null), key, options.onData)
}

export function useSessionActions(config: StagingConfig | null): {
  compact: { run: (sessionId: string) => Promise<CompactSessionResult>; pending: boolean; error: unknown; reset: () => void }
  create: { run: (title: string, sectorId?: string) => Promise<Session>; pending: boolean; error: unknown; reset: () => void }
  remove: { run: (sessionId: string) => Promise<{ id: string; deleted: boolean }>; pending: boolean; error: unknown; reset: () => void }
  rename: { run: (sessionId: string, title: string) => Promise<Session>; pending: boolean; error: unknown; reset: () => void }
} {
  const needConfig = (): StagingConfig => {
    if (!config) throw new Error('session actions need a staging config')
    return config
  }
  const compact = useAction(async (sessionId: string) => compactSession(needConfig(), sessionId))
  const create = useAction(async (title: string, sectorId?: string) => createSession(needConfig(), title, sectorId))
  const remove = useAction(async (sessionId: string) => deleteSession(needConfig(), sessionId))
  const rename = useAction(async (sessionId: string, title: string) => renameSession(needConfig(), sessionId, title))
  return { compact, create, remove, rename }
}
