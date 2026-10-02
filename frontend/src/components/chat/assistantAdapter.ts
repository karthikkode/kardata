// SPIKE (ui-revamp-spike-assistant): Kardata snapshot -> assistant-ui thread
// messages. Pure mapping, no transport, no fetching. Kardata owns threads,
// merge order, resume tokens, dead-stream bounds, and stick-to-bottom; this
// module only shapes rows into primitive-ready parts.
import type {
  ThreadAssistantMessagePart,
  ThreadMessage,
} from '@assistant-ui/react'
import type { ChatMessage, ChatTool } from '../ChatPanel'

export interface PendingParts {
  pendingText: string | null
  pendingReasoning: string | null
  pendingTools: ChatTool[]
}

function stamp(at?: string): Date {
  const time = at ? Date.parse(at) : Number.NaN
  return Number.isNaN(time) ? new Date(0) : new Date(time)
}

/** Settled rows in seq order, then live pending parts as one running turn. */
export function toThreadMessages(
  settled: ChatMessage[],
  pending: PendingParts,
): ThreadMessage[] {
  const messages: ThreadMessage[] = []
  for (const row of settled) {
    if (row.kind === 'text') {
      if (row.role === 'user') {
        messages.push({
          id: row.id,
          role: 'user',
          content: [{ type: 'text', text: row.text }],
          attachments: [],
          metadata: { custom: {} },
          createdAt: stamp(row.at),
        })
      } else {
        const content: ThreadAssistantMessagePart[] = []
        if (row.reasoning) content.push({ type: 'reasoning', text: row.reasoning })
        content.push({ type: 'text', text: row.text })
        messages.push({
          id: row.id,
          role: 'assistant',
          content,
          status: row.failed
            ? { type: 'incomplete', reason: 'error' }
            : { type: 'complete', reason: 'stop' },
          metadata: {
            unstable_state: null,
            unstable_annotations: [],
            unstable_data: [],
            steps: [],
            custom: {},
          },
          createdAt: stamp(row.at),
        })
      }
    } else {
      messages.push({
        id: row.id,
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: row.id,
            toolName: row.name,
            args: {},
            argsText: row.detail,
            ...(row.state === 'failed' ? { isError: true } : {}),
            ...(row.state === 'running' ? { isPreliminary: true } : {}),
          },
        ],
        status:
          row.state === 'running'
            ? { type: 'running' }
            : row.state === 'failed'
              ? { type: 'incomplete', reason: 'error' }
              : { type: 'complete', reason: 'stop' },
        metadata: {
          unstable_state: null,
          unstable_annotations: [],
          unstable_data: [],
          steps: [],
          custom: {},
        },
        createdAt: stamp(row.at),
      })
    }
  }
  const live: ThreadAssistantMessagePart[] = []
  for (const tool of pending.pendingTools) {
    live.push({
      type: 'tool-call',
      toolCallId: tool.id,
      toolName: tool.name,
      args: {},
      argsText: tool.detail,
      ...(tool.state === 'failed' ? { isError: true } : {}),
      ...(tool.state === 'running' ? { isPreliminary: true } : {}),
    })
  }
  if (pending.pendingReasoning) live.push({ type: 'reasoning', text: pending.pendingReasoning })
  if (pending.pendingText) live.push({ type: 'text', text: pending.pendingText })
  if (live.length > 0) {
    messages.push({
      id: 'live',
      role: 'assistant',
      content: live,
      status: { type: 'running' },
      metadata: {
        unstable_state: null,
        unstable_annotations: [],
        unstable_data: [],
        steps: [],
        custom: {},
      },
      createdAt: new Date(0),
    })
  }
  return messages
}
