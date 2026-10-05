import { describe, expect, it } from 'vitest'
import { frozenClock } from './clock.js'
import { domainTools } from './domain.js'
import { FakeProvider } from './fake.js'
import { ToolRegistry } from './tools.js'
import { planTools, PlanStore } from './planning.js'
import { taskTools, TaskLedger } from './tasks.js'
import type { BudgetLimits } from './budgets.js'
import type { ResearchGovernor } from './research.js'
import { runResearchWorkflow, StageMonitor } from './research.js'

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

function governor(): ResearchGovernor {
  return {
    maxUnits: 4,
    maxReactTurns: 5,
    maxResultsPerQuery: 5,
    maxUnitWallMs: 60_000,
    maxRunWallMs: 600_000,
    maxFruitlessUnits: 2,
  }
}

function registry(): ToolRegistry {
  const tools = new ToolRegistry()
  for (const tool of [...domainTools(), ...planTools(new PlanStore()), ...taskTools(new TaskLedger())]) {
    tools.register(tool)
  }
  return tools
}

// Same evidence twice: the model re-captures what it already has instead of
// advancing. No new content hash means no new evidence.
function repeatSteps() {
  return [
    {
      text: 'searching again',
      toolCalls: [{ id: 'c1', name: 'hound.search', args: { query: 'acme' } }],
    },
    {
      text: 'capturing again',
      toolCalls: [{ id: 'c2', name: 'evidence.capture', args: { docId: 'doc-1', excerpt: 'founded 2020' } }],
    },
    { text: 'done' },
  ]
}

function freshSteps(docId: string, excerpt: string) {
  return [
    {
      text: 'searching',
      toolCalls: [{ id: 'c1', name: 'hound.search', args: { query: 'acme' } }],
    },
    {
      text: 'capturing',
      toolCalls: [{ id: 'c2', name: 'evidence.capture', args: { docId, excerpt } }],
    },
    { text: 'done' },
  ]
}

describe('StageMonitor [F:agents.research.StageMonitor]', () => {
  it('blocks after maxFruitlessUnits acting-but-fruitless units', () => {
    const monitor = new StageMonitor(2)
    expect(monitor.noteUnit(2, 1)).toBe('ok')
    expect(monitor.noteUnit(2, 0)).toBe('ok')
    expect(monitor.noteUnit(2, 0)).toBe('blocked')
  })

  it('resets on new evidence and ignores units that never act', () => {
    const monitor = new StageMonitor(2)
    expect(monitor.noteUnit(2, 0)).toBe('ok')
    expect(monitor.noteUnit(2, 1)).toBe('ok')
    expect(monitor.noteUnit(0, 0)).toBe('ok')
    expect(monitor.noteUnit(2, 0)).toBe('ok')
    expect(monitor.noteUnit(2, 0)).toBe('blocked')
  })
})

describe('research loop detection (A11.3)', () => {
  function base(provider: FakeProvider) {
    return {
      scope: 'acme research',
      questions: ['q1', 'q2', 'q3'],
      provider,
      buildRegistry: registry,
      limits: limits(),
      governor: governor(),
      clock: frozenClock(0),
      policyVersion: 'pol1',
    }
  }

  it('blocks a verify loop that revisits covered ground without new evidence', async () => {
    const provider = new FakeProvider([...freshSteps('doc-1', 'founded 2020'), ...repeatSteps(), ...repeatSteps()])
    const outcome = await runResearchWorkflow(base(provider))
    expect(outcome.outcome).toBe('blocked')
    if (outcome.outcome !== 'blocked') throw new Error('expected blocked')
    expect(outcome.reasons[0]).toContain('research loop')
  })

  it('does not block when later units bring genuinely new evidence', async () => {
    const provider = new FakeProvider([
      ...freshSteps('doc-1', 'founded 2020'),
      ...repeatSteps(),
      ...freshSteps('doc-2', 'ledger live'),
    ])
    const outcome = await runResearchWorkflow(base(provider))
    expect(outcome.outcome).toBe('reported')
    if (outcome.outcome !== 'reported') throw new Error('expected report')
    expect(outcome.findings).toHaveLength(2)
  })
})
