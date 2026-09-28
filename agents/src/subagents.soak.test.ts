// Subagent fleet soak: 100 children with mixed fates on a stepped clock.
// Launches 100, stalls 30 (no activity), cancels 10, steers all mid-run,
// then proves the supervisor sweep flags exactly the stalled ones while
// active children stay clean — and that parents only ever see summaries.
import { describe, expect, it } from 'vitest'
import { frozenClock } from './clock.js'
import { SubagentManager } from './subagents.js'
import { decide, HeartbeatMonitor, sweep, type RunStats } from './supervision.js'

describe('subagent fleet soak (100 children, mixed fates)', () => {
  it('detects the stalled subset, steers the running, and summarizes only', () => {
    const clock = frozenClock(0)
    const manager = new SubagentManager({ maxDepth: 1, maxConcurrent: 100 }, clock)
    const monitor = new HeartbeatMonitor(clock)
    const ids: string[] = []
    for (let i = 0; i < 100; i += 1) {
      const child = manager.launch(`research company ${i}`)
      ids.push(child.id)
      monitor.beat(child.id)
    }
    const stalled = new Set(ids.slice(0, 30))
    const cancelled = new Set(ids.slice(30, 40))
    const active = ids.slice(40)

    // Ten ticks of healthy activity for the 70 non-cancelled... minus the
    // 30 stalled: only the 60 active beat and record tool activity.
    for (let tick = 0; tick < 10; tick += 1) {
      clock.advance(1000)
      for (const id of active) {
        manager.noteActivity(id, 'db.kb_search')
        monitor.beat(id)
      }
    }
    for (const id of cancelled) manager.cancel(id)

    // Mid-run steer across the whole fleet.
    let queued = 0
    let rejected = 0
    for (const id of ids) {
      const verdict = manager.message(id, 'steer: focus on pricing evidence')
      if (verdict.delivered === 'queued') queued += 1
      else rejected += 1
    }
    // 90 running accept (60 active + 30 stalled-but-running); the 10
    // cancelled reject into missed steer, never relaunch.
    expect(queued).toBe(90)
    expect(rejected).toBe(10)

    // Idle past the staleness threshold: the 30 stalled stop beating here.
    clock.advance(60_000)
    for (const id of active) monitor.beat(id)

    const stats: RunStats[] = ids.map((id) => ({
      id,
      busy: false,
      stalledTurns: stalled.has(id) ? 3 : 0,
      maxStalledTurns: 3,
      budgetUsedRatio: 0.1,
      contextUsedRatio: 0.1,
    }))
    const findings = sweep(monitor, stats, { idleStaleMs: 30_000, inToolStaleMs: 120_000, nearRatio: 0.9 })
    const byId = new Map(findings.map((finding) => [finding.id, finding.kind]))
    for (const id of stalled) expect(byId.get(id)).toBe('missing-heartbeat')
    for (const id of active) expect(byId.has(id)).toBe(false)
    // Every stall maps to a recorded suspend response for checkpointed resume.
    for (const id of stalled) {
      const decision = decide({ id, kind: 'missing-heartbeat', detail: 'soak' }, clock)
      expect(decision.response).toBe('suspend')
    }

    // Finish the fleet: cancelled stay cancelled, the rest complete, and
    // every collected summary carries counts — never thread content.
    for (const id of cancelled) {
      const summary = manager.finish(id, 'cancelled')
      expect(summary.status).toBe('cancelled')
      expect(summary.missedSteer).toContain('steer: focus on pricing evidence')
    }
    for (const id of [...stalled, ...active]) {
      const summary = manager.collect(manager.finish(id, 'finished').id)
      expect(summary.status).toBe('finished')
      expect(Object.keys(summary)).toEqual(
        expect.arrayContaining(['id', 'goal', 'status', 'depth', 'mode', 'threadLength', 'missedSteer']),
      )
    }
    expect(manager.recentCompletions()).toHaveLength(100)
  })
})
