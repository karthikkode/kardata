// Session API: sessions, settings, subagent spawn, compaction.
import { request, StagingApiError, type StagingConfig } from './client'
import { SessionModelSelection } from './models'

export interface Session {
  kind?: 'research' | 'normal'
  id: string
  title: string
  createdAt: string
  updatedAt: string
  /** Owning sector for sector chats; absent for general Karbot sessions. */
  sectorId?: string
  /** Latest stored selection; absent until the caller sets one. */
  model?: SessionModelSelection
  /** Per-chat global context switch; absent means on. */
  useGlobalContext?: boolean
}

/** Set the per-chat global context switch (operator+). */
export function setSessionSettings(
  config: StagingConfig,
  sessionId: string,
  value: boolean,
): Promise<{ useGlobalContext: boolean; purpose: string }> {
  return request(config, 'PATCH', `/v1/sessions/${encodeURIComponent(sessionId)}/settings`, { useGlobalContext: value }, crypto.randomUUID())
}

/** Spawn an owner subagent on a session thread (operator+). */
export function spawnSessionSubagent(
  config: StagingConfig,
  sessionId: string,
  body: { goal: string; name?: string },
): Promise<{ childId: string; threadKey: string }> {
  return request(config, 'POST', `/v1/sessions/${encodeURIComponent(sessionId)}/subagents`, body, crypto.randomUUID())
}

export function listSessions(config: StagingConfig, sectorId?: string): Promise<Session[]> {
  const suffix = sectorId ? `?sectorId=${encodeURIComponent(sectorId)}` : ''
  return request<Session[]>(config, 'GET', `/v1/sessions${suffix}`)
}

export async function getSession(config: StagingConfig, sessionId: string): Promise<Session> {
  const session = await request<Session>(
    config,
    'GET',
    `/v1/sessions/${encodeURIComponent(sessionId)}`,
  )
  if (session.model !== undefined) {
    const parsed = SessionModelSelection.safeParse(session.model)
    if (!parsed.success) {
      throw new StagingApiError(200, 'invalid_response', 'session model did not validate')
    }
    session.model = parsed.data
  }
  return session
}

export function createSession(config: StagingConfig, title: string, sectorId?: string): Promise<Session> {
  return request<Session>(config, 'POST', '/v1/sessions', sectorId ? { title, sectorId } : { title })
}

export interface CompactSessionResult {
  sessionId: string
  compacted: boolean
  messageCount?: number
  reason?: string
  summary?: { summaryText: string }
}

export function compactSession(
  config: StagingConfig,
  sessionId: string,
): Promise<CompactSessionResult> {
  return request<CompactSessionResult>(
    config,
    'POST',
    `/v1/sessions/${encodeURIComponent(sessionId)}/compact`,
  )
}

/** Rename a session (operator+). Reads resolve the latest title, so the
 * renamed row comes back in this response. */
export function renameSession(
  config: StagingConfig,
  sessionId: string,
  title: string,
): Promise<Session> {
  return request(config, 'POST', `/v1/sessions/${encodeURIComponent(sessionId)}/rename`, { title })
}

/** Delete a session (operator+). Stops its workflow and appends a
 * tombstone: reads hide it while history stays in the log. */
export function deleteSession(config: StagingConfig, sessionId: string): Promise<{ id: string; deleted: boolean }> {
  return request(config, 'DELETE', `/v1/sessions/${encodeURIComponent(sessionId)}`)
}
