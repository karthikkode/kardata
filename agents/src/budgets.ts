// Budgets, repetition detection, progress tracking. T1.2.
// The loop consults these every turn; tripping any cap halts the run.
import type { Clock } from './clock.js'

export interface BudgetLimits {
  maxTurns: number
  maxToolCalls: number
  maxTokens: number
  maxCost: number
  maxWallMs: number
  maxStalledTurns: number
}

export type TrippedBudget =
  | 'turns'
  | 'toolCalls'
  | 'tokens'
  | 'cost'
  | 'wallClock'
  | 'stalledTurns'

export class BudgetTracker {
  private turns = 0
  private toolCalls = 0
  private tokens = 0
  private cost = 0
  private stalledTurns = 0
  private readonly startedAt: number

  constructor(
    private readonly limits: BudgetLimits,
    private readonly clock: Clock,
  ) {
    this.startedAt = clock.now()
  }

  noteTurn(progress: boolean): void {
    this.turns += 1
    this.stalledTurns = progress ? 0 : this.stalledTurns + 1
  }

  noteToolCall(): void {
    this.toolCalls += 1
  }

  noteTokens(count: number): void {
    this.tokens += count
  }

  noteCost(amount: number): void {
    this.cost += amount
  }

  tripped(): TrippedBudget[] {
    const out: TrippedBudget[] = []
    if (this.turns >= this.limits.maxTurns) out.push('turns')
    if (this.toolCalls >= this.limits.maxToolCalls) out.push('toolCalls')
    if (this.tokens >= this.limits.maxTokens) out.push('tokens')
    if (this.cost >= this.limits.maxCost) out.push('cost')
    if (this.clock.now() - this.startedAt >= this.limits.maxWallMs) out.push('wallClock')
    if (this.stalledTurns >= this.limits.maxStalledTurns) out.push('stalledTurns')
    return out
  }
}

// Normalized action identity: tool plus canonical arguments. Escalation is
// fixed: first repeat warns (caller re-sends the prior result), second forces
// replanning, third suspends the run as blocked.
export type RepeatVerdict = 'ok' | 'warn' | 'replan' | 'blocked'

export function fingerprintAction(tool: string, args: unknown): string {
  return `${tool}:${JSON.stringify(args) ?? 'null'}`
}

export class RepetitionTracker {
  private readonly counts = new Map<string, number>()

  note(fingerprint: string): RepeatVerdict {
    const count = (this.counts.get(fingerprint) ?? 0) + 1
    this.counts.set(fingerprint, count)
    if (count >= 4) return 'blocked'
    if (count === 3) return 'replan'
    if (count === 2) return 'warn'
    return 'ok'
  }
}
