// API view mapping for threads and messages. B3.1 shapes, shared by the
// REST routes and the B3.2 SSE stream so both serve byte-identical frames.
import type { ThreadView } from './project.js'

export interface ApiThread {
  key: string
  sessionId: string
  kind: 'session' | 'subagent'
  status: string
  acceptingSteer: boolean
  queueDepth: number
  updatedAt: string
}

export function toApiThread(view: ThreadView): ApiThread {
  return {
    key: view.key,
    sessionId: view.sessionId,
    kind: view.kind,
    status: view.status,
    acceptingSteer: view.acceptingSteer,
    queueDepth: view.queueDepth,
    updatedAt: view.updatedAt,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function booleanOf(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** Projection payload to the spec's ThreadMessage union. Launch-notice
 * records (`launched`) are routing metadata, not chat: they map to
 * undefined and callers skip them while keeping the underlying seqs. */
export function toApiMessage(message: {
  seq: number
  kind: string
  payload: unknown
  at: string
}): Record<string, unknown> | undefined {
  if (!isRecord(message.payload)) return undefined
  if (message.payload['launched'] === 'true') return undefined
  const base: Record<string, unknown> = { seq: message.seq, kind: message.kind, at: message.at }
  const payload = message.payload
  if (message.kind === 'text') {
    const role = textOf(payload['role'])
    if (role === 'user' || role === 'agent') base['role'] = role
    const text = textOf(payload['text'])
    if (text !== undefined) base['text'] = text
    // Thinking trace: provider reasoning attached to agent replies,
    // rendered as a collapsible block, never mixed into the reply text.
    const reasoning = textOf(payload['reasoning'])
    if (reasoning !== undefined && role === 'agent') base['reasoning'] = reasoning
    for (const flag of ['failed', 'streaming', 'queued'] as const) {
      const value = booleanOf(payload[flag])
      if (value !== undefined) base[flag] = value
    }
    if (booleanOf(payload['missedSteer']) === true) base['missedSteer'] = true
    const target = textOf(payload['target'])
    if (target !== undefined) base['target'] = target
    return base
  }
  if (message.kind === 'tool') {
    const name = textOf(payload['name'])
    const detail = textOf(payload['detail'])
    const state = textOf(payload['state'])
    if (name !== undefined) base['name'] = name
    if (detail !== undefined) base['detail'] = detail
    if (state === 'running' || state === 'done' || state === 'failed') base['state'] = state
    return base
  }
  if (message.kind === 'approval') {
    const action = textOf(payload['action'])
    if (action === 'pause' || action === 'resume' || action === 'send') base['action'] = action
    const title = textOf(payload['title'])
    if (title !== undefined) base['title'] = title
    const decision = textOf(payload['decision'])
    base['decision'] = decision === 'approved' || decision === 'denied' ? decision : 'pending'
    const detail = textOf(payload['detail'])
    if (detail !== undefined) base['detail'] = detail
    return base
  }
  return undefined
}
