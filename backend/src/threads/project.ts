// Transcript projection: threads, messages, queues, and routing derived
// from events. B1.2. Implements documentation/frontend-thread-contract.md:
// session thread per session plus one thread per subagent, `@name` routing,
// per-thread queues with acceptingSteer + depth, and sends to finished
// children landing as missed_steer on the session thread (never relaunch).
// Pure thread domain (B7.5): event payload schemas, view shapes, and
// @name routing. All SQL lives in backend/src/db/threads.ts.
import { z } from 'zod'

export const SessionCreated = z.object({
  sessionId: z.string().min(1),
  title: z.string().min(1),
})

export const SessionDeleted = z.object({
  sessionId: z.string().min(1),
})

export const SubagentLaunched = z.object({
  sessionId: z.string().min(1),
  childId: z.string().min(1),
  name: z.string().min(1),
})

// B2.4 durable child workflows write a richer isolation record instead of
// the B1.2 launch shape: same child identity, session under
// parentSessionId, optional owner-given display name (the child id doubles
// as the name when absent).
export const SubagentLaunchedV2 = z.object({
  childId: z.string().min(1),
  parentSessionId: z.string().min(1),
  name: z.string().min(1).optional(),
})

export const SubagentCompleted = z.object({
  summary: z.object({
    id: z.string().min(1),
    status: z.string().min(1),
  }),
})

export const SubagentMissedSteer = z.object({
  childId: z.string().min(1),
  text: z.string().min(1),
})

const MessageKind = z.enum(['text', 'tool', 'approval'])

export const MessageAppended = z.object({
  threadKey: z.string().min(1),
  kind: MessageKind,
  message: z.record(z.string(), z.unknown()),
})

export const SendReceived = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1),
})

export const QueueEnqueued = z.object({
  threadKey: z.string().min(1),
  text: z.string().min(1),
})

export const QueueReleased = z.object({
  threadKey: z.string().min(1),
  seq: z.number().int().positive(),
})

export const ThreadFinished = z.object({
  threadKey: z.string().min(1),
})

export const ThreadState = z.object({
  threadKey: z.string().min(1),
  status: z.string().min(1),
  acceptingSteer: z.boolean().optional(),
  reasonCode: z.string().optional(),
})

export interface ChildRef {
  name: string
  threadKey: string
}

/**
 * `@name` in the session thread routes to that subagent's thread; anything
 * else routes to the parent. Match is `@` + full child name,
 * case-insensitive; launch order wins ties.
 */
export function routeSend(sessionThreadKey: string, text: string, children: ChildRef[]): string {
  const lowered = text.toLowerCase()
  for (const child of children) {
    if (lowered.includes(`@${child.name.toLowerCase()}`)) return child.threadKey
  }
  return sessionThreadKey
}

export interface ThreadView {
  name?: string
  key: string
  sessionId: string
  kind: 'session' | 'subagent'
  status: string
  acceptingSteer: boolean
  queueDepth: number
  updatedAt: string
  messages: Array<{ seq: number; kind: string; payload: unknown; at: string }>

}
