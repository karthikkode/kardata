import { describe, expect, it } from 'vitest'
import { frozenClock } from './clock.js'
import { domainTools } from './domain.js'
import { FakeProvider } from './fake.js'
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

function briefedTexts(provider: FakeProvider): string[] {
  return provider.calls.flatMap((call) => call.messages.map((message) => message.text ?? ''))
}

describe('research checkpoints and resume (A11.1/A11.2)', () => {
  it('carries a checkpoint of completed stages on the reported outcome', async () => {
    const provider = new FakeProvider([
      ...researcherSteps('doc-1', 'founded 2020'),
      ...researcherSteps('doc-2', 'ledger live'),
    ])
    const outcome = await runResearchWorkflow({
      scope: 'acme research',
      questions: ['q1', 'q2'],
      provider,
      buildRegistry: registry,
      limits: limits(),
      governor: governor(),
      clock: frozenClock(0),
      policyVersion: 'pol1',
    })
    expect(outcome.outcome).toBe('reported')
    if (outcome.outcome !== 'reported') throw new Error('expected report')
    expect(outcome.checkpoint.version).toBe(1)
    expect(outcome.checkpoint.scope).toBe('acme research')
    expect(outcome.checkpoint.completed.map((stage) => stage.question)).toEqual(['q1', 'q2'])
  })

  it('resume skips settled stages and keeps their outputs byte-identical', async () => {
    const first = new FakeProvider([
      ...researcherSteps('doc-1', 'founded 2020'),
      ...researcherSteps('doc-2', 'ledger live'),
    ])
    const initial = await runResearchWorkflow({
      scope: 'acme research',
      questions: ['q1', 'q2'],
      provider: first,
      buildRegistry: registry,
      limits: limits(),
      governor: governor(),
      clock: frozenClock(0),
      policyVersion: 'pol1',
    })
    if (initial.outcome !== 'reported') throw new Error('expected report')

    const resumedProvider = new FakeProvider([
      ...researcherSteps('doc-1', 'new line one'),
      ...researcherSteps('doc-2', 'new line two'),
    ])
    const resumed = await runResearchWorkflow({
      scope: 'acme research',
      questions: ['q1', 'q2', 'q3', 'q4'],
      provider: resumedProvider,
      buildRegistry: registry,
      limits: limits(),
      governor: governor(),
      clock: frozenClock(0),
      policyVersion: 'pol1',
      resumeFrom: initial.checkpoint,
    })
    expect(resumed.outcome).toBe('reported')
    if (resumed.outcome !== 'reported') throw new Error('expected report')
    // Only the two unsettled stages ran.
    expect(resumed.unitsRun).toBe(2)
    expect(resumedProvider.remaining).toBe(0)
    // Zero provider calls reference the settled questions: no re-verification.
    const texts = briefedTexts(resumedProvider)
    expect(texts.some((text) => text.includes(']: q1') || text.includes(']: q2'))).toBe(false)
    expect(texts.some((text) => text.includes(']: q3'))).toBe(true)
    expect(texts.some((text) => text.includes(']: q4'))).toBe(true)
    // Settled findings come first and are byte-identical to the checkpoint.
    expect(resumed.findings.slice(0, 2)).toEqual(initial.checkpoint.completed.flatMap((stage) => stage.findings))
    expect(resumed.findings).toHaveLength(4)
    expect(resumed.checkpoint.completed.map((stage) => stage.question)).toEqual(['q1', 'q2', 'q3', 'q4'])
  })

  it('resume with a mismatched scope blocks instead of mixing work', async () => {
    const outcome = await runResearchWorkflow({
      scope: 'other scope',
      questions: ['q1'],
      provider: new FakeProvider([]),
      buildRegistry: registry,
      limits: limits(),
      governor: governor(),
      clock: frozenClock(0),
      policyVersion: 'pol1',
      resumeFrom: { version: 1, scope: 'acme research', completed: [], elapsedMs: 0 },
    })
    expect(outcome.outcome).toBe('blocked')
    if (outcome.outcome !== 'blocked') throw new Error('expected blocked')
    expect(outcome.reasons[0]).toContain('scope mismatch')
  })
})
