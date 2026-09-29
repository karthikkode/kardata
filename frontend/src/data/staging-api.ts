// Staging API client (B6.1 entry). Typed fetch wrapper over the backend
// v1 routes; the UI renders a not-connected state until VITE_STAGING_API=1.
// Auth is header-based everywhere, including the thread stream,
// which reads via fetch (EventSource cannot set headers).
//
// Every function takes its config explicitly: no ambient base URL, no
// stored key. Non-2xx responses throw StagingApiError with status + code.
// Provider catalog and session-model payloads validate with zod against
// the OpenAPI counterparts (SessionModel, ProviderCatalog); a shape the
// server should never send throws StagingApiError with code
// invalid_response instead of reaching the UI.
import { z } from 'zod'

export interface StagingConfig {
  baseUrl: string
  apiKey: string
}

export function stagingEnabled(): boolean {
  return import.meta.env.VITE_STAGING_API === '1'
}

/** Client config from the environment. Null unless the staging flag is on
 * and both values are present; callers show the not-connected state. */
export function stagingConfig(): StagingConfig | null {
  if (!stagingEnabled()) return null
  const baseUrl = import.meta.env.VITE_STAGING_URL as string | undefined
  const apiKey = import.meta.env.VITE_STAGING_KEY as string | undefined
  if (!baseUrl || !apiKey) return null
  return { baseUrl, apiKey }
}

/** Per-session provider+model selection. Mirrors the OpenAPI
 * SessionModel: absent until PATCH sets one. */
export const SessionModelSelection = z.object({
  provider: z.literal('meta'),
  model: z.string().min(1),
  reasoning: z.boolean(),
  effort: z.string().min(1).optional(),
})

export type SessionModelSelection = z.infer<typeof SessionModelSelection>

/** One selectable model with its reasoning capability. Mirrors the
 * OpenAPI ProviderModel. */
export const ProviderModelSchema = z.object({
  provider: z.literal('meta'),
  model: z.string().min(1),
  displayName: z.string().min(1),
  reasoning: z.enum(['native', 'none']),
  mode: z.enum(['chat', 'responses']).optional(),
  /** Selectable reasoning depths; empty means no depth control. */
  efforts: z.array(z.string().min(1)).default([]),
})

export type ProviderModel = z.infer<typeof ProviderModelSchema>

/** One provider row: key presence only, never key material. Mirrors the
 * OpenAPI ProviderEntry. */
export const ProviderEntrySchema = z.object({
  name: z.literal('meta'),
  hasKey: z.boolean(),
  defaultModel: z.string().min(1),
  models: z.array(ProviderModelSchema),
})

export type ProviderEntry = z.infer<typeof ProviderEntrySchema>

/** Provider catalog envelope data. Mirrors the OpenAPI ProviderCatalog. */
export const ProviderCatalogSchema = z.object({
  defaultProvider: z.literal('meta'),
  providers: z.array(ProviderEntrySchema),
})

export type ProviderCatalog = z.infer<typeof ProviderCatalogSchema>

/** Outgoing session-model write. Reasoning is optional on the wire;
 * the server defaults it to false. Effort must be listed in the model's
 * efforts or the server rejects it. */
export const SetSessionModelInput = z.object({
  provider: z.literal('meta'),
  model: z.string().min(1),
  reasoning: z.boolean().optional(),
  effort: z.string().min(1).optional(),
})

export type SetSessionModelInput = z.infer<typeof SetSessionModelInput>

export interface Session {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  /** Owning sector for sector chats; absent for general Karbot sessions. */
  sectorId?: string
  /** Latest stored selection; absent until the caller sets one. */
  model?: SessionModelSelection
}

export interface ThreadView {
  key: string
  sessionId: string
  kind: string
  status: string
  acceptingSteer: boolean
  queueDepth: number
  updatedAt: string
}

export interface ArtifactSummary {
  artifactId: string
  name?: string
  kind?: string
  bytes?: number
  sha256?: string
  detail?: string
  indexed: boolean
}

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

export interface SectorActivityEntry {
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

export interface ArtifactReference {
  artifactId: string
  name?: string
  kind?: string
  reason?: string
  producedBy?: string
  referencedFrom?: { kind: string; id: string }
  sessionId?: string
  indexed: boolean
}

export interface ArtifactBody {
  body: string
  meta: Record<string, unknown>
}

/** Live token text from the thread stream. Ephemeral: the terminal message
 * frame supersedes deltas, and reconnects replay persisted messages only. */
export interface DeltaPayload {
  runKey: string
  text: string
}

/** Ephemeral MCP execution status. Arguments and results stay off the
 * stream; persisted tool rows replace these when the turn finishes. */
export interface ToolPayload {
  runKey: string
  id: string
  name: string
  state: 'running' | 'done' | 'failed'
}

export interface StreamFrame {
  seq: number
  threadKey: string
  type: string
  at: string
  payload: unknown
}

export class StagingApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'StagingApiError'
    this.status = status
    this.code = code
  }
}

/** One error-meaning mapper for every surface: offline (browser flag),
 * denied (the API refused this key), error (everything else). Components
 * keep their own status unions but never their own copy of this rule. */
export function apiErrorStatus(error: unknown): 'offline' | 'denied' | 'error' {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
  if (error instanceof StagingApiError && (error.status === 401 || error.status === 403)) {
    return 'denied'
  }
  return 'error'
}

async function request<T>(config: StagingConfig, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const parsed = (await response.json()) as {
    ok: boolean
    data?: T
    error?: { code?: string; message?: string }
  }
  if (!response.ok || !parsed.ok) {
    throw new StagingApiError(
      response.status,
      parsed.error?.code ?? 'unknown',
      parsed.error?.message ?? `request failed: ${method} ${path}`,
    )
  }
  return parsed.data as T
}

export function listSessions(config: StagingConfig, sectorId?: string): Promise<Session[]> {
  const suffix = sectorId ? `?sectorId=${encodeURIComponent(sectorId)}` : ''
  return request<Session[]>(config, 'GET', `/v1/sessions${suffix}`)
}

export interface SkillSummary {
  name: string
  description: string
  tools: string[]
}

/** Registered product skills for the chat slash picker. */
export function listSkills(config: StagingConfig): Promise<SkillSummary[]> {
  return request<SkillSummary[]>(config, 'GET', '/v1/skills')
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

export function listThreads(config: StagingConfig, sessionId: string): Promise<ThreadView[]> {
  return request<ThreadView[]>(
    config,
    'GET',
    `/v1/sessions/${encodeURIComponent(sessionId)}/threads`,
  )
}

export function listSessionArtifacts(config: StagingConfig, sessionId: string): Promise<ArtifactSummary[]> {
  return request<ArtifactSummary[]>(
    config,
    'GET',
    `/v1/sessions/${encodeURIComponent(sessionId)}/artifacts`,
  )
}

export function listMessages(
  config: StagingConfig,
  threadKey: string,
  afterSeq = 0,
): Promise<unknown[]> {
  return request(
    config,
    'GET',
    `/v1/threads/${encodeURIComponent(threadKey)}/messages?afterSeq=${afterSeq}`,
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

/** Provider catalog with reasoning flags and key-presence booleans
 * only. Response validates against ProviderCatalogSchema. */
export async function listProviders(config: StagingConfig): Promise<ProviderCatalog> {
  const data = await request<unknown>(config, 'GET', '/v1/providers')
  const parsed = ProviderCatalogSchema.safeParse(data)
  if (!parsed.success) {
    throw new StagingApiError(200, 'invalid_response', 'provider catalog did not validate')
  }
  return parsed.data
}

/** Store the session provider+model (operator+). Input validates
 * client-side first; the stored selection validates on the way back. */
export async function setSessionModel(
  config: StagingConfig,
  sessionId: string,
  input: SetSessionModelInput,
): Promise<SessionModelSelection> {
  const body = SetSessionModelInput.parse(input)
  const data = await request<unknown>(
    config,
    'PATCH',
    `/v1/sessions/${encodeURIComponent(sessionId)}/model`,
    body,
  )
  const parsed = SessionModelSelection.safeParse(data)
  if (!parsed.success) {
    throw new StagingApiError(200, 'invalid_response', 'stored session model did not validate')
  }
  return parsed.data
}

export function decideApproval(
  config: StagingConfig,
  approvalId: string,
  decision: 'approved' | 'denied',
): Promise<{ commandId: string }> {
  return request(config, 'POST', '/v1/commands/approve', { approvalId, decision })
}

/** Accepted command outcome. `missed_steer` means the text landed after the
 * run moved on: shown, never silently relaunched (backend commands.ts). */
export interface CommandAccepted {
  commandId: string
  state: 'accepted' | 'missed_steer'
}

/** Talk to a thread's run (operator+). The reply arrives through the
 * thread stream/message list, never in this response. */
export function sendThreadText(
  config: StagingConfig,
  threadKey: string,
  text: string,
): Promise<CommandAccepted> {
  return request(config, 'POST', '/v1/commands/send', { threadKey, text })
}

export function steerThread(
  config: StagingConfig,
  threadKey: string,
  text: string,
): Promise<CommandAccepted> {
  return request(config, 'POST', '/v1/commands/steer', { threadKey, text })
}

export function cancelRun(config: StagingConfig, runId: string): Promise<CommandAccepted> {
  return request(config, 'POST', '/v1/commands/cancel', { runId })
}

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

export function restartSector(config: StagingConfig, sectorId: string): Promise<SectorResearch> {
  return request<SectorResearch>(config, 'POST', `/v1/sectors/${encodeURIComponent(sectorId)}/restart`)
}

export interface PlanVersionView {
  version: number
  markdown: string
  at: string
}

export interface SectorPlanView {
  sectorId: string
  versions: PlanVersionView[]
  latest: PlanVersionView | null
  approvals?: number[]
  approvedVersion?: number | null
}

/** Explicit plan: draft/failed enters planning with a visible planning chat. */
export function planSector(config: StagingConfig, sectorId: string): Promise<SectorResearch> {
  return request<SectorResearch>(config, 'POST', `/v1/sectors/${encodeURIComponent(sectorId)}/plan`)
}

/** Read the versioned research plan artifact (empty until planned). */
export function readSectorPlan(config: StagingConfig, sectorId: string): Promise<SectorPlanView> {
  return request<SectorPlanView>(config, 'GET', `/v1/sectors/${encodeURIComponent(sectorId)}/plan`)
}

/** Owner pause from the chat window: running -> paused. */
export function pauseSector(config: StagingConfig, sectorId: string): Promise<SectorResearch> {
  return request<SectorResearch>(config, 'POST', `/v1/sectors/${encodeURIComponent(sectorId)}/pause`)
}

/** Owner resume from the chat window: paused -> running. */
export function resumeSector(config: StagingConfig, sectorId: string): Promise<SectorResearch> {
  return request<SectorResearch>(config, 'POST', `/v1/sectors/${encodeURIComponent(sectorId)}/resume`)
}

export interface SectorDocumentSummary {
  id: string
  sectorId: string
  filename: string
  mediaType: string
  chars: number
  sha256: string
  createdAt: string
  status: 'indexed' | 'needs-ocr'
}

export interface ContextUnitView {
  ord: number
  kind: string
  text: string
  uncertain: boolean
  excluded: boolean
}

export interface ContextFileView {
  id: string
  filename: string
  mediaType: string
  status: 'indexed' | 'needs-ocr'
  sha256: string
  chars: number
  excluded: boolean
  units: ContextUnitView[]
}

export interface ContextNoteView {
  id: string
  text: string
  createdAt: string
}

export interface SectorContextView {
  sectorId: string
  digest: { version: string; text: string }
  segments: { system: string; references: string[]; history: string[]; tail: string[] }
  usage: {
    system: { messages: number; estimatedTokens: number }
    references: { messages: number; estimatedTokens: number }
    history: { messages: number; estimatedTokens: number }
    tail: { messages: number; estimatedTokens: number }
    totalEstimatedTokens: number
  }
  files: ContextFileView[]
  notes: ContextNoteView[]
}

export function getSectorContext(config: StagingConfig, sectorId: string): Promise<SectorContextView> {
  return request<SectorContextView>(config, 'GET', `/v1/sectors/${encodeURIComponent(sectorId)}/context`)
}

export function patchSectorContext(
  config: StagingConfig,
  sectorId: string,
  input: {
    exclude?: Array<{ documentId: string; ord?: number }>
    include?: Array<{ documentId: string; ord?: number }>
    notes?: string[]
  },
): Promise<SectorContextView> {
  return request<SectorContextView>(config, 'PATCH', `/v1/sectors/${encodeURIComponent(sectorId)}/context`, input)
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

export interface AttachedDocument extends SectorDocumentSummary {
  status: 'indexed' | 'needs-ocr'
  detail?: string
  unitCount?: number
}

/** Attach one context document (base64 bytes) to a sector. The response
 * carries extraction status: indexed with a unit count, or needs-ocr. */
export function attachSectorDocument(
  config: StagingConfig,
  sectorId: string,
  input: { filename: string; contentBase64: string },
): Promise<AttachedDocument> {
  return request<AttachedDocument>(
    config,
    'POST',
    `/v1/sectors/${encodeURIComponent(sectorId)}/documents`,
    input,
  )
}

export function listSectorDocuments(config: StagingConfig, sectorId: string): Promise<SectorDocumentSummary[]> {
  return request<SectorDocumentSummary[]>(config, 'GET', `/v1/sectors/${encodeURIComponent(sectorId)}/documents`)
}

export function listTenantArtifacts(config: StagingConfig): Promise<ArtifactReference[]> {
  return request<ArtifactReference[]>(config, 'GET', '/v1/artifacts')
}

export function referenceArtifact(
  config: StagingConfig,
  sessionId: string,
  artifactId: string,
  fromScope: { kind: 'session' | 'task'; id: string },
): Promise<ArtifactReference> {
  return request<ArtifactReference>(
    config,
    'POST',
    `/v1/sessions/${encodeURIComponent(sessionId)}/artifacts/references`,
    { artifactId, fromScope },
  )
}

export function getArtifactBody(
  config: StagingConfig,
  sessionId: string,
  artifactId: string,
): Promise<ArtifactBody> {
  return request<ArtifactBody>(
    config,
    'GET',
    `/v1/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}/body`,
  )
}

/** Thread stream over fetch: yields frames until the signal aborts.
 * SSE comments (`:` pings) are skipped; each `data:` line is one frame. */
/** A persisted thread message as the stream delivers it. Tool rows also
 * carry their name, detail, and lifecycle state; text rows leave those
 * absent. */
export interface LiveMessage {
  /** Thread message sequence, shared with the REST page for reconciliation. */
  seq?: number
  id?: string
  role: string
  kind: string
  text: string
  /** Provider thinking trace; present only on agent replies whose model
   * streamed reasoning. */
  reasoning?: string
  at?: string
  name?: string
  detail?: string
  state?: string
}

export interface LiveThread {
  messages: LiveMessage[]
  /** In-flight token text for the latest run; null when idle. Cleared the
   * moment the terminal message frame arrives (the message supersedes). */
  pendingText: string | null
  /** In-flight thinking trace for the latest run; same lifecycle as
   * pending text, never mixed into it. */
  pendingReasoning: string | null
  pendingTools: ToolPayload[]
  error: StagingApiError | null
}

/** Idle ceiling for the thread tail: the server pings every 15 s, so
 * silence past this means a half-open socket, not a slow turn. The tail
 * aborts and followThread resumes from its last token; the missed frames
 * replay and the terminal message clears the replying state. */
export const STREAM_IDLE_TIMEOUT_MS = 30_000

export interface FollowThreadOptions {
  /** Per-test override for the idle watchdog; production uses the default. */
  idleTimeoutMs?: number
}

/** Live thread follower (F-S3). Tails message frames into a list and
 * accumulates the latest run's deltas as pending text; reconnects replay
 * persisted messages only, never deltas. A stalled socket (no frame or
 * ping inside the idle window) reconnects the same way instead of hanging
 * the replying state forever. Framework-free: drives openThreadStream
 * and reports a snapshot per frame. */
export async function* followThread(
  config: StagingConfig,
  threadKey: string,
  signal?: AbortSignal,
  options?: FollowThreadOptions,
): AsyncGenerator<LiveThread> {
  const messages: LiveMessage[] = []
  let pendingText: string | null = null
  let pendingReasoning: string | null = null
  let pendingTools: ToolPayload[] = []
  let pendingRunKey: string | null = null
  let lastSeq = 0
  for (;;) {
    try {
      for await (const frame of openThreadStream(
        config,
        threadKey,
        lastSeq,
        signal,
        options?.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS,
      )) {
        lastSeq = frame.seq
        if (frame.type === 'delta') {
          const payload = frame.payload as Partial<DeltaPayload>
          if (typeof payload.text === 'string' && typeof payload.runKey === 'string') {
            if (pendingRunKey !== payload.runKey) {
              pendingText = null
              pendingReasoning = null
              pendingRunKey = payload.runKey
            }
            pendingText = (pendingText ?? '') + payload.text
          }
        } else if (frame.type === 'reasoning') {
          const payload = frame.payload as Partial<DeltaPayload>
          if (typeof payload.text === 'string' && typeof payload.runKey === 'string') {
            if (pendingRunKey !== payload.runKey) {
              pendingText = null
              pendingReasoning = null
              pendingRunKey = payload.runKey
            }
            pendingReasoning = (pendingReasoning ?? '') + payload.text
          }
        } else if (frame.type === 'tool') {
          const payload = frame.payload as Partial<ToolPayload> | null
          if (payload && typeof payload.runKey === 'string' && typeof payload.id === 'string' &&
              typeof payload.name === 'string' &&
              (payload.state === 'running' || payload.state === 'done' || payload.state === 'failed')) {
            const tool: ToolPayload = { runKey: payload.runKey, id: payload.id, name: payload.name, state: payload.state }
            const index = pendingTools.findIndex((entry) => entry.id === tool.id)
            if (index < 0) pendingTools = [...pendingTools, tool]
            else pendingTools = pendingTools.map((entry, at) => at === index ? tool : entry)
            // A provider preamble is transient; once a tool starts, the
            // activity row becomes the in-flight surface until the answer.
            if (tool.state === 'running') pendingText = null
          }
        } else if (frame.type === 'message') {
          const message = frame.payload as LiveMessage
          const seq = typeof message.seq === 'number' ? message.seq : frame.seq
          if (!messages.some((entry) => entry.seq === seq)) messages.push({ ...message, seq })
          pendingText = null
          pendingReasoning = null
          pendingRunKey = null
          if (message.kind === 'tool' || message.role === 'agent') pendingTools = []
        }
        yield { messages: [...messages], pendingText, pendingReasoning, pendingTools: [...pendingTools], error: null }
      }
      return
    } catch (error) {
      if (signal?.aborted) return
      // Resume from the last good token: the server replays persisted
      // messages after it, never deltas, so in-flight text rebuilds only
      // from fresh deltas and the finished message arrives whole.
      yield {
        messages: [...messages],
        pendingText,
        pendingReasoning,
        pendingTools: [...pendingTools],
        error:
          error instanceof StagingApiError
            ? error
            : new StagingApiError(0, 'unknown', 'thread stream failed'),
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
}

export async function* openThreadStream(
  config: StagingConfig,
  threadKey: string,
  fromSeq: number,
  signal?: AbortSignal,
  idleTimeoutMs: number = STREAM_IDLE_TIMEOUT_MS,
): AsyncGenerator<StreamFrame> {
  const response = await fetch(
    `${config.baseUrl}/v1/threads/${encodeURIComponent(threadKey)}/events?lastSeq=${fromSeq}`,
    { headers: { authorization: `Bearer ${config.apiKey}` }, signal },
  )
  if (!response.ok || !response.body) {
    throw new StagingApiError(response.status, 'unknown', `stream failed for ${threadKey}`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    // Idle watchdog: any bytes (frames or ping comments) re-arm the
    // timer, so only a truly silent socket trips it. The reader is
    // cancelled first so the dead socket cannot deliver a late frame
    // after the tail has already resumed elsewhere.
    let timer: ReturnType<typeof setTimeout> | undefined
    const idle = new Promise<'idle'>((resolve) => {
      timer = setTimeout(() => resolve('idle'), idleTimeoutMs)
    })
    const outcome = await Promise.race([
      reader.read().then((read) => ({ ...read, idle: false as const })),
      idle.then(() => ({ done: false, value: undefined, idle: true as const })),
    ]).finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    })
    if (outcome.idle) {
      await reader.cancel().catch(() => undefined)
      throw new StagingApiError(0, 'stream_idle', `thread stream went silent for ${threadKey}`)
    }
    const { done, value } = outcome
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.split('\n').find((entry) => entry.startsWith('data:'))
      if (!line) continue
      yield JSON.parse(line.slice('data:'.length).trim()) as StreamFrame
    }
  }
}
