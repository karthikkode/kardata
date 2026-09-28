// Subagent delegation: launch/get/message/redirect/cancel/collect. T4.1-T4.2.
// Adopted shapes: Hermes verbs plus registry, DeepAgents async record, Pi
// control-inbox semantics. Every child owns a persistent native thread with
// the same status as a parent thread; switching views never migrates data.
import { BoundedQueue } from './queue.js'
import type { ChatMessage } from './providers.js'
import type { Clock } from './clock.js'

export type ChildStatus = 'running' | 'finished' | 'cancelled' | 'failed'
export type ContextMode = 'empty' | 'fork'

export interface ChildSummary {
  id: string
  goal: string
  status: ChildStatus
  depth: number
  mode: ContextMode
  threadLength: number
  missedSteer: string[]
}

export interface ChildSnapshot {
  id: string
  goal: string
  status: ChildStatus
  acceptingSteer: boolean
  queueDepth: number
  elapsedMs: number
  lastTool: string | undefined
}

export type MessageVerdict =
  | { delivered: 'queued' }
  | { delivered: 'rejected'; reason: string }

interface ChildRecord {
  id: string
  goal: string
  status: ChildStatus
  depth: number
  mode: ContextMode
  parentId: string | undefined
  queue: BoundedQueue<string>
  thread: ChatMessage[]
  missedSteer: string[]
  acceptingSteer: boolean
  cancelRequested: boolean
  lastTool: string | undefined
  lastActivityAt: number
  createdAt: number
}

export interface SubagentOptions {
  parentId?: string
  depth?: number
  mode?: ContextMode
  queueCapacity?: number
}

export interface SubagentLimits {
  maxDepth: number
  maxConcurrent: number
}

export class SubagentManager {
  private readonly children = new Map<string, ChildRecord>()
  private readonly recent: ChildSummary[] = []
  private nextId = 1

  constructor(
    private readonly limits: SubagentLimits,
    private readonly clock: Clock,
  ) {}

  launch(goal: string, options: SubagentOptions = {}): ChildRecord {
    const depth = options.parentId ? (options.depth ?? 1) : 0
    if (depth > this.limits.maxDepth) {
      throw new Error(`delegation depth ${depth} exceeds max ${this.limits.maxDepth}`)
    }
    const running = [...this.children.values()].filter((child) => child.status === 'running').length
    if (running >= this.limits.maxConcurrent) {
      throw new Error(`max concurrent children ${this.limits.maxConcurrent} reached`)
    }
    if (!goal.trim()) throw new Error('delegation needs a non-empty goal')
    const now = this.clock.now()
    const record: ChildRecord = {
      id: `child-${this.nextId++}`,
      goal,
      status: 'running',
      depth,
      mode: options.mode ?? 'empty',
      parentId: options.parentId,
      queue: new BoundedQueue<string>(options.queueCapacity ?? 8),
      thread: [],
      missedSteer: [],
      acceptingSteer: true,
      cancelRequested: false,
      lastTool: undefined,
      lastActivityAt: now,
      createdAt: now,
    }
    this.children.set(record.id, record)
    return record
  }

  // Fork children continue the parent conversation and must not delegate.
  canDelegate(id: string): boolean {
    const child = this.require(id)
    if (child.mode === 'fork') return false
    return child.depth + 1 <= this.limits.maxDepth
  }

  get(id: string): ChildSnapshot {
    const child = this.require(id)
    return {
      id: child.id,
      goal: child.goal,
      status: child.status,
      acceptingSteer: child.acceptingSteer && child.status === 'running',
      queueDepth: child.queue.size,
      elapsedMs: this.clock.now() - child.createdAt,
      lastTool: child.lastTool,
    }
  }

  list(): ChildSnapshot[] {
    return [...this.children.values()].map((child) => this.get(child.id))
  }

  // Non-preemptive steer: queued into the child's inbox for the next
  // iteration boundary. The current tool call is never cut.
  message(id: string, text: string): MessageVerdict {
    const child = this.require(id)
    if (child.status !== 'running' || !child.acceptingSteer) {
      child.missedSteer.push(text)
      return { delivered: 'rejected', reason: `child ${id} is ${child.status}; kept as missed steer` }
    }
    const result = child.queue.enqueue(text)
    if (!result.ok) {
      child.missedSteer.push(text)
      return { delivered: 'rejected', reason: result.reason }
    }
    return { delivered: 'queued' }
  }

  // Redirect is message with a goal rewrite; implementation identical.
  redirect(id: string, newGoal: string): MessageVerdict {
    const child = this.require(id)
    if (!newGoal.trim()) return { delivered: 'rejected', reason: 'redirect needs a non-empty goal' }
    const verdict = this.message(id, `Course correction. New goal: ${newGoal}`)
    if (verdict.delivered === 'queued') child.goal = newGoal
    return verdict
  }

  // Cooperative cancel: records intent and propagates to direct children.
  // Drivers check cancelRequested at each iteration boundary.
  cancel(id: string): void {
    const child = this.require(id)
    child.cancelRequested = true
    if (child.status === 'running') child.status = 'cancelled'
    for (const grandchild of this.children.values()) {
      if (grandchild.parentId === id && grandchild.status === 'running') {
        this.cancel(grandchild.id)
      }
    }
  }

  noteActivity(id: string, tool?: string): void {
    const child = this.require(id)
    child.lastActivityAt = this.clock.now()
    if (tool) child.lastTool = tool
  }

  idleMs(id: string): number {
    const child = this.require(id)
    return this.clock.now() - child.lastActivityAt
  }

  appendToThread(id: string, message: ChatMessage): void {
    this.require(id).thread.push(message)
  }

  thread(id: string): ChatMessage[] {
    return [...this.require(id).thread]
  }

  finish(id: string, status: ChildStatus): ChildSummary {
    const child = this.require(id)
    if (child.status !== 'running' && child.status !== 'cancelled') {
      throw new Error(`child ${id} already ${child.status}`)
    }
    if (status === 'running') throw new Error('finish needs a terminal status')
    child.status = status
    child.acceptingSteer = false
    // Final drain: leftover inbox becomes missed steer on the completion entry.
    child.missedSteer.push(...child.queue.drain())
    const summary = this.summarize(child)
    this.recent.push(summary)
    if (this.recent.length > 200) this.recent.shift()
    return summary
  }

  // Parent sees the delegation call plus this summary, never intermediates.
  collect(id: string): ChildSummary {
    return this.summarize(this.require(id))
  }

  recentCompletions(): ChildSummary[] {
    return [...this.recent]
  }

  private summarize(child: ChildRecord): ChildSummary {
    return {
      id: child.id,
      goal: child.goal,
      status: child.status,
      depth: child.depth,
      mode: child.mode,
      threadLength: child.thread.length,
      missedSteer: [...child.missedSteer],
    }
  }

  private require(id: string): ChildRecord {
    const child = this.children.get(id)
    if (!child) throw new Error(`unknown child '${id}'`)
    return child
  }
}
