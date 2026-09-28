// Fleet metrics board shaped for the future control API. T9.2. Inputs are
// recorded observations and snapshots; the payload mirrors what overview
// screens will read. No external telemetry services.
import type { Clock } from './clock.js'
import { UnitLedger } from './condense.js'
import type { RunState } from './loop.js'

export interface ProviderObservation {
  provider: string
  latencyMs: number
  ok: boolean
}

export interface QueueSnapshot {
  threadId: string
  depth: number
  ageOldestMs: number
}

export interface RunSnapshot {
  id: string
  state: RunState
}

export interface FleetSnapshot {
  at: number
  runsByState: Record<RunState, number>
  queueDepth: number
  oldestQueueAgeMs: number
  providers: Record<string, { calls: number; errors: number; avgLatencyMs: number }>
  units: Record<string, { inputTokens: number; outputTokens: number; cost: number }>
  runCost: number
}

export class MetricsBoard {
  private readonly providerCalls: ProviderObservation[] = []

  constructor(private readonly clock: Clock) {}

  recordProviderCall(observation: ProviderObservation): void {
    this.providerCalls.push(observation)
  }

  snapshot(runs: RunSnapshot[], queues: QueueSnapshot[], units: UnitLedger): FleetSnapshot {
    const runsByState: Record<RunState, number> = {
      IDLE: 0,
      RUNNING: 0,
      PAUSED: 0,
      CANCELLING: 0,
      FINISHED: 0,
      ERROR: 0,
    }
    for (const run of runs) runsByState[run.state] += 1
    const totals = new Map<string, { calls: number; errors: number; latency: number }>()
    for (const call of this.providerCalls) {
      const entry = totals.get(call.provider) ?? { calls: 0, errors: 0, latency: 0 }
      entry.calls += 1
      if (!call.ok) entry.errors += 1
      entry.latency += call.latencyMs
      totals.set(call.provider, entry)
    }
    const providerSummary: FleetSnapshot['providers'] = {}
    for (const [name, entry] of totals) {
      providerSummary[name] = {
        calls: entry.calls,
        errors: entry.errors,
        avgLatencyMs: entry.calls === 0 ? 0 : entry.latency / entry.calls,
      }
    }
    return {
      at: this.clock.now(),
      runsByState,
      queueDepth: queues.reduce((sum, queue) => sum + queue.depth, 0),
      oldestQueueAgeMs: queues.reduce((max, queue) => Math.max(max, queue.ageOldestMs), 0),
      providers: providerSummary,
      units: units.entries(),
      runCost: units.runTotal().cost,
    }
  }
}
