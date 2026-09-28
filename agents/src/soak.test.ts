// Soak: hundreds of fake subagents, mass-stall injection, scheduling
// fairness, recovery timing. T10.2. Deterministic except the wall-clock bound
// on sweep latency, which is generous to avoid flakes.
import { describe, expect, it } from 'vitest'
import { frozenClock } from './clock.js'
import { FakeProvider } from './fake.js'
import { createRun, transition } from './loop.js'
import { BudgetTracker, RepetitionTracker, type BudgetLimits } from './budgets.js'
import { IdempotencyLog } from './epochs.js'
import { ToolRegistry } from './tools.js'
import { domainTools } from './domain.js'
import { runTurn } from './turn.js'
import { SubagentManager } from './subagents.js'
import { AuditLog, decide, HeartbeatMonitor, sweep } from './supervision.js'
import type { ChatMessage, ToolResult } from './providers.js'

function limits(): BudgetLimits {
  return {
    maxTurns: 10,
    maxToolCalls: 20,
    maxTokens: 100_000,
    maxCost: 10,
    maxWallMs: 60_000,
    maxStalledTurns: 5,
  }
}

describe('soak', () => {
  it('runs 200 subagents, detects a mass stall, recovers all', () => {
    const clock = frozenClock(0)
    const subagents = new SubagentManager({ maxDepth: 1, maxConcurrent: 200 }, clock)
    const monitor = new HeartbeatMonitor(clock)
    const ids: string[] = []
    for (let i = 0; i < 200; i++) {
      const child = subagents.launch(`research unit ${i}`)
      monitor.beat(child.id)
      subagents.noteActivity(child.id, 'hound.search')
      ids.push(child.id)
    }
    expect(subagents.list().filter((row) => row.status === 'running')).toHaveLength(200)

    // Mass stall: time passes with no beats and no activity.
    clock.advance(60_000)
    const findings = sweep(
      monitor,
      ids.map((id) => ({
        id,
        busy: true,
        stalledTurns: 5,
        maxStalledTurns: 5,
        budgetUsedRatio: 0.1,
        contextUsedRatio: 0.1,
      })),
      { idleStaleMs: 1_000, inToolStaleMs: 5_000, nearRatio: 0.9 },
    )
    expect(findings).toHaveLength(200)
    expect(findings.every((finding) => finding.kind === 'missing-heartbeat')).toBe(true)

    // Recovery: suspend every stalled child, record every decision, finish all.
    const started = Date.now()
    const audit = new AuditLog()
    for (const finding of findings) audit.record(decide(finding, clock))
    for (const id of ids) {
      subagents.cancel(id)
      subagents.finish(id, 'cancelled')
    }
    const elapsedMs = Date.now() - started
    expect(audit.list()).toHaveLength(200)
    expect(subagents.list().filter((row) => row.status === 'running')).toHaveLength(0)
    expect(subagents.recentCompletions()).toHaveLength(200)
    expect(elapsedMs).toBeLessThan(5_000)
  })

  it('drives 50 turn-loop bursts against the fake provider fairly', async () => {
    const registry = new ToolRegistry()
    for (const tool of domainTools()) registry.register(tool)
    let evidence = 0
    for (let burst = 0; burst < 50; burst++) {
      const provider = new FakeProvider([
        {
          text: 'go',
          toolCalls: [{ id: `c${burst}`, name: 'hound.search', args: { query: 'acme' } }],
        },
        { text: 'done' },
      ])
      const run = createRun()
      transition(run, 'RUNNING')
      const history: ChatMessage[] = [{ role: 'user', text: 'research' }]
      const clock = frozenClock(0)
      const context = {
        run,
        provider,
        registry,
        history,
        systemPrompt: 'sys',
        budgets: new BudgetTracker(limits(), clock),
        repetition: new RepetitionTracker(),
        executions: new IdempotencyLog(),
        results: new Map<string, ToolResult>(),
        clock,
      }
      const first = await runTurn(context)
      expect(first.turn.outcome).toBe('acted')
      if (first.turn.outcome === 'acted' && !first.turn.results[0]?.isError) evidence += 1
      const second = await runTurn(context)
      expect(second.turn.outcome).toBe('replied')
    }
    expect(evidence).toBe(50)
  })
})
