import { describe, expect, it } from 'vitest'
import { frozenClock } from './clock.js'
import { domainTools } from './domain.js'
import { FakeProvider } from './fake.js'
import type { ProviderAdapter, ProviderRequest, ProviderResponse, StreamEvent } from './providers.js'
import { ToolRegistry } from './tools.js'
import { planTools, PlanStore } from './planning.js'
import { taskTools, TaskLedger } from './tasks.js'
import type { BudgetLimits } from './budgets.js'
import type { ResearchGovernor } from './research.js'
import { runResearchWorkflow } from './research.js'

function limits(): BudgetLimits {
  return {
    maxTurns: 10,
    maxToolCalls: 20,
    maxTokens: 100_000,
    maxCost: 10,
    maxWallMs: 600_000,
    maxStalledTurns: 5,
  }
}

function governor(overrides: Partial<ResearchGovernor> = {}): ResearchGovernor {
  return {
    maxUnits: 4,
    maxReactTurns: 5,
    maxResultsPerQuery: 5,
    maxUnitWallMs: 60_000,
    maxRunWallMs: 600_000,
    maxFruitlessUnits: 3,
    ...overrides,
  }
}

function registry(): ToolRegistry {
  const tools = new ToolRegistry()
  for (const tool of [...domainTools(), ...planTools(new PlanStore()), ...taskTools(new TaskLedger())]) {
    tools.register(tool)
  }
  return tools
}

function researcherSteps(docId: string, excerpt: string) {
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

// Test-only decorator: every model call burns wall-clock time so budget paths
// trip deterministically on a frozen clock.
class AdvancingProvider implements ProviderAdapter {
  readonly providerName = 'advancing-fake'

  constructor(
    private readonly inner: FakeProvider,
    private readonly advance: (ms: number) => void,
    private readonly msPerCall: number,
  ) {}

  async chat(request: ProviderRequest): Promise<ProviderResponse> {
    this.advance(this.msPerCall)
    return this.inner.chat(request)
  }

  chatStream(request: ProviderRequest): AsyncIterable<StreamEvent> {
    return this.inner.chatStream(request)
  }
}

describe('research time budgets (A11.4)', () => {
  function base(provider: ProviderAdapter, clock: { now(): number }) {
    return {
      scope: 'acme research',
      questions: ['q1', 'q2'],
      provider,
      buildRegistry: registry,
      limits: limits(),
      governor: governor(),
      clock,
      policyVersion: 'pol1',
    }
  }

  it('a unit that burns past its wall-clock budget suspends at the cursor', async () => {
    const clock = frozenClock(0)
    const provider = new AdvancingProvider(
      new FakeProvider(researcherSteps('doc-1', 'founded 2020')),
      (ms) => clock.advance(ms),
      1_000,
    )
    const outcome = await runResearchWorkflow({
      ...base(provider, clock),
      governor: governor({ maxUnitWallMs: 1_500, maxRunWallMs: 600_000 }),
    })
    expect(outcome.outcome).toBe('suspended')
    if (outcome.outcome !== 'suspended') throw new Error('expected suspended')
    expect(outcome.reason).toContain('unit wall-clock budget')
    // The incomplete unit is not checkpointed: resume re-runs it whole.
    expect(outcome.checkpoint.completed).toEqual([])
    expect(outcome.findings).toEqual([])
  })

  it('a run that burns past its wall-clock budget suspends with completed stages kept', async () => {
    const clock = frozenClock(0)
    const provider = new AdvancingProvider(
      new FakeProvider([
        ...researcherSteps('doc-1', 'founded 2020'),
        ...researcherSteps('doc-2', 'ledger live'),
      ]),
      (ms) => clock.advance(ms),
      1_000,
    )
    const outcome = await runResearchWorkflow({
      ...base(provider, clock),
      governor: governor({ maxUnitWallMs: 60_000, maxRunWallMs: 2_500 }),
    })
    expect(outcome.outcome).toBe('suspended')
    if (outcome.outcome !== 'suspended') throw new Error('expected suspended')
    expect(outcome.reason).toContain('run wall-clock budget')
    expect(outcome.checkpoint.completed.map((stage) => stage.question)).toEqual(['q1'])
    expect(outcome.findings).toHaveLength(1)
    expect(outcome.checkpoint.elapsedMs).toBeGreaterThanOrEqual(2_500)
  })

  it('resume without an extended budget stays suspended; approved extension resumes from cursor', async () => {
    const clock = frozenClock(0)
    const first = new AdvancingProvider(
      new FakeProvider(researcherSteps('doc-1', 'founded 2020')),
      (ms) => clock.advance(ms),
      1_000,
    )
    const suspended = await runResearchWorkflow({
      ...base(first, clock),
      governor: governor({ maxUnitWallMs: 60_000, maxRunWallMs: 2_500 }),
    })
    if (suspended.outcome !== 'suspended') throw new Error('expected suspended')

    const retrySame = await runResearchWorkflow({
      ...base(new FakeProvider([]), clock),
      governor: governor({ maxUnitWallMs: 60_000, maxRunWallMs: 2_500 }),
      resumeFrom: suspended.checkpoint,
    })
    expect(retrySame.outcome).toBe('suspended')

    const resumed = await runResearchWorkflow({
      ...base(new FakeProvider(researcherSteps('doc-2', 'ledger live')), clock),
      governor: governor({ maxUnitWallMs: 60_000, maxRunWallMs: 600_000 }),
      resumeFrom: suspended.checkpoint,
    })
    expect(resumed.outcome).toBe('reported')
    if (resumed.outcome !== 'reported') throw new Error('expected report')
    expect(resumed.unitsRun).toBe(1)
    expect(resumed.findings).toHaveLength(2)
    expect(resumed.checkpoint.completed.map((stage) => stage.question)).toEqual(['q1', 'q2'])
  })
})
