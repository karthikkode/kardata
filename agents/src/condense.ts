// Condensation as projection over an immutable log, plus per-unit usage
// ledger. T5.2. Originals are never overwritten: condense returns a new view
// (pinned head plus linked summary plus recent tail) and a summary artifact.
import type { ChatMessage, Usage } from './providers.js'

export type CondenseReason = 'events' | 'tokens' | 'request'

export interface SummaryArtifact {
  coveredSeq?: number
  forgetStart: number
  forgetEnd: number
  summaryText: string
  summarizer: string
  reason: CondenseReason
}

export type CondenseResult =
  | { needed: false }
  | { needed: true; view: ChatMessage[]; summary: SummaryArtifact }

export interface CondenseOptions {
  messages: ChatMessage[]
  keepFirst: number
  maxSize: number
  minimumProgress?: number
  tokenCount?: number
  tokenCap?: number
  force?: boolean
  summarizer?: string
  summarize: (forgotten: ChatMessage[]) => Promise<string>
}

// Group boundaries: an assistant message plus its following tool messages
// form one atomic group. Cuts land between groups only, never splitting a
// tool call from its result.
function groupEnds(messages: ChatMessage[]): number[] {
  const ends: number[] = []
  let index = 0
  while (index < messages.length) {
    let end = index + 1
    if (messages[index]?.role === 'assistant') {
      while (end < messages.length && messages[end]?.role === 'tool') end += 1
    }
    ends.push(end)
    index = end
  }
  return ends
}

export async function condense(options: CondenseOptions): Promise<CondenseResult> {
  const { messages, keepFirst, maxSize } = options
  const minimumProgress = options.minimumProgress ?? 0.1
  let reason: CondenseReason | undefined
  if (options.force) {
    reason = 'request'
  } else if (options.tokenCap !== undefined && (options.tokenCount ?? 0) > options.tokenCap) {
    reason = 'tokens'
  } else if (messages.length > maxSize) {
    reason = 'events'
  }
  if (!reason) return { needed: false }

  const ends = groupEnds(messages)
  // Forget a middle span, keeping the pinned head and a recent tail of at
  // least half the budget. Snap both edges to group boundaries.
  const tailTarget = Math.floor(maxSize / 2)
  let forgetEnd = messages.length
  let tailCount = 0
  for (let i = ends.length - 1; i >= 0; i--) {
    const start = i === 0 ? 0 : (ends[i - 1] as number)
    const size = (ends[i] as number) - start
    if (tailCount + size > tailTarget && tailCount > 0) break
    tailCount += size
    forgetEnd = start
  }
  let forgetStart = Math.min(keepFirst, forgetEnd)
  // Snap start forward to the next group boundary at or after keepFirst.
  for (const end of ends) {
    if (end <= keepFirst) forgetStart = end
    else break
  }
  if (forgetEnd - forgetStart < Math.max(1, Math.floor(messages.length * minimumProgress))) {
    throw new Error('condensation would make no progress: refusing trivial forget range')
  }
  const forgotten = messages.slice(forgetStart, forgetEnd)
  const summaryText = await options.summarize(forgotten)
  const coveredSeq = Math.max(0, ...forgotten.map((message) => message.contextSeq ?? 0))
  const view: ChatMessage[] = [
    ...messages.slice(0, forgetStart),
    { role: 'assistant', text: `Context summary (${forgotten.length} messages condensed): ${summaryText}`, ...(coveredSeq ? { contextSeq: coveredSeq } : {}) },
    ...messages.slice(forgetEnd),
  ]
  return {
    needed: true,
    view,
    summary: {
      ...(coveredSeq ? { coveredSeq } : {}),
      forgetStart,
      forgetEnd,
      summaryText,
      summarizer: options.summarizer ?? 'unit:compaction',
      reason,
    },
  }
}

// Per-unit usage ledger rolling up to run totals. Prices come from router
// routes; computed cost never trusts a vendor field.
export interface UnitTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cost: number
}

export class UnitLedger {
  private readonly totals = new Map<string, UnitTotals>()

  record(
    unit: string,
    usage: Usage,
    prices: { inputPricePerMTok: number; outputPricePerMTok: number },
  ): void {
    const current = this.totals.get(unit) ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cost: 0 }
    const cost =
      (usage.inputTokens / 1_000_000) * prices.inputPricePerMTok +
      (usage.outputTokens / 1_000_000) * prices.outputPricePerMTok
    this.totals.set(unit, {
      inputTokens: current.inputTokens + usage.inputTokens,
      outputTokens: current.outputTokens + usage.outputTokens,
      cacheReadTokens: current.cacheReadTokens + usage.cacheReadTokens,
      cost: current.cost + cost,
    })
  }

  forUnit(unit: string): UnitTotals | undefined {
    return this.totals.get(unit)
  }

  entries(): Record<string, UnitTotals> {
    const out: Record<string, UnitTotals> = {}
    for (const [unit, totals] of this.totals) out[unit] = { ...totals }
    return out
  }

  runTotal(): UnitTotals {
    const total: UnitTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cost: 0 }
    for (const entry of this.totals.values()) {
      total.inputTokens += entry.inputTokens
      total.outputTokens += entry.outputTokens
      total.cacheReadTokens += entry.cacheReadTokens
      total.cost += entry.cost
    }
    return total
  }
}
