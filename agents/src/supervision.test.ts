import { describe, expect, it } from 'vitest'
import { frozenClock } from './clock.js'
import { emptyUsage } from './providers.js'
import { UnitLedger } from './condense.js'
import { MetricsBoard } from './metrics.js'
import {
  AuditLog,
  decide,
  HeartbeatMonitor,
  sweep,
  type SweepThresholds,
} from './supervision.js'

function thresholds(): SweepThresholds {
  return { idleStaleMs: 1_000, inToolStaleMs: 5_000, nearRatio: 0.9 }
}

describe('HeartbeatMonitor', () => {
  it('backfills stored beats so table ages drive the same thresholds', () => {
    const clock = frozenClock(10_000)
    const monitor = new HeartbeatMonitor(clock)
    monitor.beatAt('old-run', 0)
    monitor.beatAt('fresh-run', 9_500)
    expect(monitor.ageMs('old-run')).toBe(10_000)
    expect(monitor.ageMs('fresh-run')).toBe(500)
    expect(monitor.staleIds(thresholds())).toEqual(['old-run'])
  })

  it('flags idle and busy runs past their thresholds', () => {
    const clock = frozenClock(0)
    const monitor = new HeartbeatMonitor(clock)
    monitor.beat('idle-1')
    monitor.beat('busy-1', true)
    clock.advance(999)
    expect(monitor.staleIds(thresholds())).toEqual([])
    clock.advance(1)
    expect(monitor.staleIds(thresholds())).toEqual(['idle-1'])
    clock.advance(4_000)
    expect(monitor.staleIds(thresholds())).toEqual(['idle-1', 'busy-1'])
    expect(monitor.ageMs('missing')).toBeUndefined()
  })
})

describe('sweep and decide', () => {
  it('detects every stall class and records a response per finding', () => {
    const clock = frozenClock(0)
    const monitor = new HeartbeatMonitor(clock)
    monitor.beat('healthy')
    monitor.beat('looper')
    monitor.beat('stuck')
    monitor.beat('hot')
    monitor.beat('full')
    clock.advance(100)
    const findings = sweep(
      monitor,
      [
        { id: 'healthy', busy: false, stalledTurns: 0, maxStalledTurns: 3, budgetUsedRatio: 0.1, contextUsedRatio: 0.1 },
        { id: 'ghost', busy: false, stalledTurns: 0, maxStalledTurns: 3, budgetUsedRatio: 0, contextUsedRatio: 0 },
        { id: 'looper', busy: true, stalledTurns: 0, maxStalledTurns: 3, lastRepeatVerdict: 'blocked', budgetUsedRatio: 0.2, contextUsedRatio: 0.2 },
        { id: 'stuck', busy: true, stalledTurns: 3, maxStalledTurns: 3, budgetUsedRatio: 0.2, contextUsedRatio: 0.2 },
        { id: 'hot', busy: false, stalledTurns: 0, maxStalledTurns: 3, budgetUsedRatio: 0.95, contextUsedRatio: 0.2 },
        { id: 'full', busy: false, stalledTurns: 0, maxStalledTurns: 3, budgetUsedRatio: 0.2, contextUsedRatio: 0.95 },
      ],
      thresholds(),
    )
    const byId = new Map(findings.map((finding) => [finding.id, finding.kind]))
    expect(byId.get('ghost')).toBe('missing-heartbeat')
    expect(byId.get('looper')).toBe('repeated-calls')
    expect(byId.get('stuck')).toBe('no-progress')
    expect(byId.get('hot')).toBe('budget-near')
    expect(byId.get('full')).toBe('context-near')
    expect(byId.has('healthy')).toBe(false)

    const audit = new AuditLog()
    for (const finding of findings) audit.record(decide(finding, clock))
    const decisions = audit.list()
    expect(decisions.length).toBe(findings.length)
    const responses = new Map(decisions.map((decision) => [decision.id, decision.response]))
    expect(responses.get('ghost')).toBe('suspend')
    expect(responses.get('looper')).toBe('retry')
    expect(responses.get('hot')).toBe('alert')
  })
})

describe('MetricsBoard', () => {
  it('builds an accurate dashboard-shape snapshot from a scripted fleet', () => {
    const clock = frozenClock(9_000)
    const board = new MetricsBoard(clock)
    board.recordProviderCall({ provider: 'openai-compat', latencyMs: 100, ok: true })
    board.recordProviderCall({ provider: 'openai-compat', latencyMs: 300, ok: false })
    board.recordProviderCall({ provider: 'meta', latencyMs: 200, ok: true })
    const units = new UnitLedger()
    units.record('research', { ...emptyUsage(), inputTokens: 1_000_000 }, { inputPricePerMTok: 2, outputPricePerMTok: 8 })
    const snapshot = board.snapshot(
      [
        { id: 'r1', state: 'RUNNING' },
        { id: 'r2', state: 'PAUSED' },
        { id: 'r3', state: 'FINISHED' },
      ],
      [
        { threadId: 't1', depth: 2, ageOldestMs: 400 },
        { threadId: 't2', depth: 0, ageOldestMs: 0 },
      ],
      units,
    )
    expect(snapshot.at).toBe(9_000)
    expect(snapshot.runsByState).toMatchObject({ RUNNING: 1, PAUSED: 1, FINISHED: 1, ERROR: 0 })
    expect(snapshot.queueDepth).toBe(2)
    expect(snapshot.oldestQueueAgeMs).toBe(400)
    expect(snapshot.providers['openai-compat']).toMatchObject({ calls: 2, errors: 1, avgLatencyMs: 200 })
    expect(snapshot.providers['meta']).toMatchObject({ calls: 1, errors: 0, avgLatencyMs: 200 })
    expect(snapshot.units['research']?.inputTokens).toBe(1_000_000)
    expect(snapshot.runCost).toBeCloseTo(2)
  })
})
