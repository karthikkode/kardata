// Live thread API: SSE follower yielding snapshots per frame.
import { openStreamReader, StagingApiError, type StagingConfig } from './client'
import { listMessages, readSteeringReceipts } from './threads'

/** Live token text from the thread stream. Ephemeral: the terminal message
 * frame supersedes deltas, and reconnects replay persisted messages only. */
interface DeltaPayload {
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

/** Thread statuses after which no reply can arrive: the run is over. */
const TERMINAL_THREAD_STATUSES = ['FINISHED', 'ERROR', 'STOPPED']

export function isTerminalThreadStatus(status: string | undefined): boolean {
  return status !== undefined && TERMINAL_THREAD_STATUSES.includes(status)
}

/** True when a terminal server status is newer than the send basis: the
 * owed reply will never arrive, so the UI must stop waiting for it. */
export function isFreshTerminalStatus(status: string | undefined, statusSeq: number | undefined, sendBasis: number): boolean {
  return isTerminalThreadStatus(status) && (statusSeq ?? 0) > sendBasis
}

export interface LiveThread {
  pendingRunKey?: string | null
  threadStatus?: string
  /** Outbox seq of the state frame that set threadStatus; lets the UI tell
   * a fresh terminal status from a stale one after a new send. */
  threadStatusSeq?: number
  stateReason?: string
  steering?: Array<{ id: string; state: 'consumed' | 'missed' }>
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
const STREAM_IDLE_TIMEOUT_MS = 30_000

export interface FollowThreadOptions {
  /** Persistent UI tails retry graceful EOF with their last accepted token. */
  reconnectOnEOF?: boolean
  /** Per-test override for the idle watchdog; production uses the default. */
  idleTimeoutMs?: number
  /** Caller-owned token survives graceful EOF followed by a new follower. */
  cursor?: { seq: number; live?: LiveThread }
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
  const previous = options?.cursor?.live
  const messages: LiveMessage[] = [...(previous?.messages ?? [])]
  let pendingText: string | null = previous?.pendingText ?? null
  let pendingReasoning: string | null = previous?.pendingReasoning ?? null
  let pendingTools: ToolPayload[] = [...(previous?.pendingTools ?? [])]
  let pendingRunKey: string | null = options?.cursor?.live?.pendingRunKey ?? null
  let threadStatus: string | undefined = previous?.threadStatus
  let threadStatusSeq: number | undefined = previous?.threadStatusSeq
  let stateReason: string | undefined = previous?.stateReason
  const steering = new Map<string, 'consumed' | 'missed'>((previous?.steering ?? []).map(({ id, state }) => [id, state]))
  let lastSeq = options?.cursor?.seq ?? 0
  for (;;) {
    if (signal?.aborted) return
    try {
      for await (const frame of openThreadStream(
        config,
        threadKey,
        lastSeq,
        signal,
        options?.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS,
      )) {
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
        } else if (frame.type === 'steering-consumption') {
          const payload = frame.payload as { ids?: unknown; state?: unknown }
          if (Array.isArray(payload?.ids)) {
            for (const id of payload.ids) if (typeof id === 'string') steering.set(id, payload.state === 'missed' ? 'missed' : 'consumed')
          }
        } else if (frame.type === 'state') {
          const payload = frame.payload as { status?: unknown; historyRefresh?: unknown; stateReason?: unknown }
          if (payload?.historyRefresh === true) {
            const recovered = await listMessages(config, threadKey, Math.max(0, ...messages.map((message) => message.seq ?? 0)), signal) as LiveMessage[]
            const receipts = await readSteeringReceipts(config, threadKey, signal)
            for (const receipt of receipts) steering.set(receipt.id, receipt.state)
            for (const message of recovered) if (!messages.some((entry) => entry.seq === message.seq)) messages.push(message)
            pendingText = null; pendingReasoning = null; pendingTools = []; pendingRunKey = null
          }
          if (typeof payload?.status === 'string') {
            threadStatus = payload.status
            threadStatusSeq = frame.seq
            stateReason = typeof payload.stateReason === 'string' ? payload.stateReason : undefined
            if (['PAUSED', 'FINISHED', 'ERROR', 'CANCELLING'].includes(threadStatus)) {
              pendingText = null; pendingReasoning = null; pendingTools = []; pendingRunKey = null
            }
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
        lastSeq = frame.seq
        const live = { messages: [...messages], pendingText, pendingReasoning, pendingRunKey, pendingTools: [...pendingTools], threadStatus, threadStatusSeq, stateReason, steering: [...steering].map(([id, state]) => ({ id, state })), error: null }
        if (options?.cursor) { options.cursor.seq = lastSeq; options.cursor.live = live }
        yield live
      }
      if (signal?.aborted || !options?.reconnectOnEOF) return
      throw new StagingApiError(0, 'unknown', 'Conversation connection closed. Reconnecting.')
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
        threadStatus,
        threadStatusSeq,
        stateReason,
        steering: [...steering].map(([id, state]) => ({ id, state })),
        error:
          error instanceof StagingApiError
            ? error
            : new StagingApiError(0, 'unknown', 'thread stream failed'),
      }
      await new Promise<void>((resolve) => {
        const finish = (): void => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', finish)
          resolve()
        }
        const timer = setTimeout(finish, 1000)
        if (signal?.aborted) finish()
        else signal?.addEventListener('abort', finish, { once: true })
      })
    }
  }
}

async function* openThreadStream(
  config: StagingConfig,
  threadKey: string,
  fromSeq: number,
  signal?: AbortSignal,
  idleTimeoutMs: number = STREAM_IDLE_TIMEOUT_MS,
): AsyncGenerator<StreamFrame> {

  const reader = await openStreamReader(
    config,
    `/v1/threads/${encodeURIComponent(threadKey)}/events?lastSeq=${fromSeq}`,
    signal,
    threadKey,
  )

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
