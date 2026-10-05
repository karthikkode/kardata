// Chat message shapes and pure transforms shared by the Karbot panel and
// the sector workspace. No React: grouping, merging, and server-record
// mapping live here so both surfaces stay consistent.
import { apiErrorStatus, type ArtifactSummary, type LiveMessage } from '../../data/staging-api'

export type ChatScope = { id: string; name: string } | null

export type ChatText = {
  id: string
  kind: 'text'
  role: 'user' | 'agent'
  text: string
  /** Provider thinking trace; rendered as a collapsible block. */
  reasoning?: string
  failed?: boolean
  missedSteer?: boolean
  /** Server stamp; rendered as relative age, omitted when absent. */
  at?: string
}

export type ChatTool = {
  id: string
  kind: 'tool'
  name: string
  detail: string
  state: 'running' | 'done' | 'failed'
  /** Client-side first-seen stamp (live rows only) for elapsed display. */
  seenAt?: number
  /** Server stamp; rendered as relative age, omitted when absent. */
  at?: string
}

export type ChatMessage = ChatText | ChatTool

export function messageSeq(message: ChatMessage): number {
  return Number(message.id.slice(2)) || 0
}

// Dead-stream bound: consecutive error snapshots before the tail stops
// waiting silently and fails visible instead of spinning Replying forever
// (a turn that dies server-side with no terminal message otherwise wedges
// the indicator: the hold-open tail never ends on its own).
export const STREAM_ERROR_LIMIT = 3

export type ChatFile = {
  id: string
  name: string
  detail: string
  source: string
}

export type LoadState = 'loading' | 'ready' | 'error' | 'denied' | 'offline'

export function offlineNow(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

export function loadStateOf(error: unknown): LoadState {
  return apiErrorStatus(error)
}

/** Relative age for session rows, computed from real timestamps. */
export function sessionAge(at: string, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - Date.parse(at))
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Server message records to chat rows. Unknown kinds are skipped, never
 * rendered as guesswork. Approval cards have no server producer, so only
 * text and tool rows exist. */
export function toChatMessages(raw: unknown[]): ChatMessage[] {
  const rows: ChatMessage[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const kind = textOf(entry['kind'])
    const seq = typeof entry['seq'] === 'number' ? entry['seq'] : undefined
    if (seq === undefined) continue
    const id = `m-${seq}`
    const at = textOf(entry['at'])
    if (kind === 'text') {
      const role = textOf(entry['role'])
      const text = textOf(entry['text'])
      if ((role === 'user' || role === 'agent') && text !== undefined) {
        const row: ChatText = { id, kind: 'text', role, text }
        const reasoning = textOf(entry['reasoning'])
        if (reasoning !== undefined && role === 'agent') row.reasoning = reasoning
        if (entry['failed'] === true) row.failed = true
        if (entry['missedSteer'] === true) row.missedSteer = true
        if (at !== undefined) row.at = at
        rows.push(row)
      }
    } else if (kind === 'tool') {
      const name = textOf(entry['name']) ?? 'Tool call'
      const detail = textOf(entry['detail']) ?? ''
      const state = textOf(entry['state'])
      rows.push({
        id,
        kind: 'tool',
        name,
        detail,
        state: state === 'done' || state === 'failed' ? state : 'running',
        ...(at === undefined ? {} : { at }),
      })
    }
  }
  return rows
}

export type MessageSegment = { key: string; tools: ChatTool[]; reply?: ChatText } | { key: string; message: ChatMessage }

/** Fold consecutive tool rows into one collapsible group per turn; text
 * rows pass through untouched. Grouping is purely presentational: the
 * message order from the server never changes. Segments are not a wire
 * shape, so they must not join the contract parity table. */
export function groupMessageSegments(messages: ChatMessage[]): MessageSegment[] {
  const segments: MessageSegment[] = []
  for (const message of messages) {
    const last = segments[segments.length - 1]
    if (message.kind === 'tool' && last !== undefined && 'tools' in last) {
      last.tools.push(message)
    } else if (message.kind === 'tool') {
      segments.push({ key: message.id, tools: [message] })
    } else if (message.kind === 'text' && message.role === 'agent' && last !== undefined && 'tools' in last && !last.reply) {
      last.reply = message
    } else {
      segments.push({ key: message.id, message })
    }
  }
  return segments
}

export function toLiveMessages(raw: LiveMessage[]): ChatMessage[] {
  return toChatMessages(
    raw.map((message, index) => ({
      seq: message.seq ?? 1_000_000 + index,
      kind: message.kind,
      role: message.role,
      text: message.text,
      ...(message.reasoning === undefined ? {} : { reasoning: message.reasoning }),
      // Tool rows stream with their identity and lifecycle attached;
      // dropping them here is what rendered every live tool as a
      // nameless, permanently-running row.
      ...(message.name === undefined ? {} : { name: message.name }),
      ...(message.detail === undefined ? {} : { detail: message.detail }),
      ...(message.state === undefined ? {} : { state: message.state }),
      at: message.at ?? '',
    })),
  )
}

/** REST and SSE can finish in either order. Merge by the shared thread seq
 * so a slower history request never erases a newly streamed reply. */
export function mergeChatMessages(left: ChatMessage[], right: ChatMessage[]): ChatMessage[] {
  const byId = new Map(left.map((message) => [message.id, message]))
  for (const message of right) byId.set(message.id, message)
  return [...byId.values()].sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)))
}

export function toChatFile(summary: ArtifactSummary): ChatFile {
  return {
    id: summary.artifactId,
    name: summary.name ?? summary.artifactId,
    detail: summary.detail ?? summary.kind ?? '',
    source: summary.kind ?? 'artifact',
  }
}
