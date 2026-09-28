import { describe, expect, it } from 'vitest'
import { frozenClock } from './clock.js'
import { domainTools } from './domain.js'
import { FakeProvider } from './fake.js'
import { ToolRegistry } from './tools.js'
import { planTools, PlanStore } from './planning.js'
import { taskTools, TaskLedger } from './tasks.js'
import type { BudgetLimits } from './budgets.js'
import {
  assembleReport,
  captureFinding,
  runResearchWorkflow,
  StubRetriever,
} from './research.js'

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

describe('captureFinding', () => {
  it('builds hashed findings and rejects claims without sources', () => {
    const finding = captureFinding({ claim: 'founded 2020', docId: 'doc-1', url: 'https://example.com/acme', excerpt: 'founded 2020' })
    expect(finding.contentHash).toHaveLength(64)
    expect(() => captureFinding({ claim: '', docId: 'd', url: 'u', excerpt: 'e' })).toThrow('without sources')
    expect(() => captureFinding({ claim: 'c', docId: '', url: 'u', excerpt: 'e' })).toThrow()
  })
})

describe('assembleReport', () => {
  it('dedupes by content hash and renders findings plus sources', () => {
    const finding = captureFinding({ claim: 'c', docId: 'd', url: 'u', excerpt: 'e' })
    const report = assembleReport([finding, finding])
    expect(report).toContain('## Findings')
    expect(report).toContain('- [c](u)')
    expect(report).toContain('## Sources')
    expect(report.match(/- \[c\]\(u\)/g)).toHaveLength(1)
  })
})

describe('StubRetriever', () => {
  it('splits search from fetch behind the seam', async () => {
    const retriever = new StubRetriever()
    const hits = await retriever.search('acme', 5)
    expect(hits.map((hit) => hit.id)).toEqual(['doc-1'])
    const doc = await retriever.fetch('doc-1')
    expect(doc.body).toContain('Acme Pay')
    await expect(retriever.fetch('missing')).rejects.toThrow()
  })
})

describe('runResearchWorkflow', () => {
  function base(overrides: Record<string, unknown> = {}) {
    return {
      scope: 'acme research',
      questions: ['q1', 'q2'],
      provider: new FakeProvider([]),
      buildRegistry: registry,
      limits: limits(),
      governor: { maxUnits: 3, maxReactTurns: 5, maxResultsPerQuery: 5, maxUnitWallMs: 60_000, maxRunWallMs: 600_000, maxFruitlessUnits: 2 },
      clock: frozenClock(0),
      policyVersion: 'pol1',
      ...overrides,
    }
  }

  it('reports findings with sources end to end on stubs', async () => {
    const provider = new FakeProvider([
      ...researcherSteps('doc-1', 'founded 2020'),
      ...researcherSteps('doc-2', 'ledger live'),
    ])
    const outcome = await runResearchWorkflow({ ...base(), provider })
    expect(outcome.outcome).toBe('reported')
    if (outcome.outcome !== 'reported') throw new Error('expected report')
    expect(outcome.findings).toHaveLength(2)
    expect(outcome.unitsRun).toBe(2)
    expect(outcome.report).toContain('## Sources')
    expect(outcome.report).toContain('https://example.com/acme')
  })

  it('honors a researcher systemPrompt override', async () => {
    const provider = new FakeProvider([
      ...researcherSteps('doc-1', 'founded 2020'),
      ...researcherSteps('doc-2', 'ledger live'),
    ])
    const outcome = await runResearchWorkflow({
      ...base(),
      provider,
      systemPrompt: 'KB-aware researcher: check the corpus first.',
    })
    expect(outcome.outcome).toBe('reported')
    expect(provider.calls[0]?.systemPrompt).toBe('KB-aware researcher: check the corpus first.')
  })

  it('caps fan-out at maxUnits', async () => {
    const provider = new FakeProvider([
      ...researcherSteps('doc-1', 'e1'),
      ...researcherSteps('doc-2', 'e2'),
    ])
    const outcome = await runResearchWorkflow({
      ...base(),
      provider,
      questions: ['q1', 'q2', 'q3', 'q4', 'q5'],
      governor: { maxUnits: 2, maxReactTurns: 5, maxResultsPerQuery: 5, maxUnitWallMs: 60_000, maxRunWallMs: 600_000, maxFruitlessUnits: 2 },
    })
    expect(outcome.outcome).toBe('reported')
    if (outcome.outcome !== 'reported') throw new Error('expected report')
    expect(outcome.unitsRun).toBe(2)
    expect(provider.remaining).toBe(0)
  })

  it('degrades partial failure: one dead unit does not kill the report', async () => {
    const provider = new FakeProvider([
      { error: 'provider down', retryable: true },
      ...researcherSteps('doc-1', 'surviving evidence'),
    ])
    const outcome = await runResearchWorkflow({ ...base(), provider })
    expect(outcome.outcome).toBe('reported')
    if (outcome.outcome !== 'reported') throw new Error('expected report')
    expect(outcome.findings).toHaveLength(1)
  })

  it('refuses to report on zero evidence', async () => {
    const provider = new FakeProvider([{ text: 'nothing found' }, { text: 'still nothing' }])
    const outcome = await runResearchWorkflow({ ...base(), provider })
    expect(outcome).toEqual({ outcome: 'refused', reason: 'zero evidence captured: refusing to report' })
  })

  it('blocks without preflight receipt conditions', async () => {
    const outcome = await runResearchWorkflow({ ...base(), scope: '  ' })
    expect(outcome.outcome).toBe('blocked')
  })
})
