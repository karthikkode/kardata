import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { frozenClock } from './clock.js'
import { domainTools } from './domain.js'
import { FakeProvider } from './fake.js'
import { planTools, PlanStore } from './planning.js'
import { runResearchWorkflow } from './research.js'
import {
  CassetteRetriever,
  createResearchPack,
  validateResearchPack,
  type ResearchPack,
} from './researchPack.js'
import { taskTools, TaskLedger } from './tasks.js'
import { ToolRegistry } from './tools.js'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function loadPack(): ResearchPack {
  return JSON.parse(readFileSync(join(fixtures, 'research-fintech-acme.json'), 'utf8'))
}

function registry(): ToolRegistry {
  const tools = new ToolRegistry()
  for (const tool of [...domainTools(), ...planTools(new PlanStore()), ...taskTools(new TaskLedger())]) {
    tools.register(tool)
  }
  return tools
}

describe('research pack cassette (record-once, replay-forever)', () => {
  it('replays the checked-in pack with the network cut: findings and report are byte-identical', async () => {
    const pack = loadPack()
    expect(() => validateResearchPack(pack)).not.toThrow()

    // Network cut: any real fetch attempt fails the test loudly.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network cut: cassettes only'))
    try {
      const retriever = new CassetteRetriever(pack)
      const hits = await retriever.search('acme', 5)
      expect(hits.map((hit) => hit.id)).toEqual(['doc-1'])
      const doc = await retriever.fetch('doc-1')
      expect(doc.body).toContain('Acme Pay')
      await expect(retriever.fetch('no-such-doc')).rejects.toThrow("unknown document 'no-such-doc'")

      // End-to-end replay: scripted provider captures the pack's evidence,
      // workflow assembles the golden report without touching the network.
      const provider = new FakeProvider([
        {
          text: 'searching',
          toolCalls: [{ id: 'c1', name: 'hound.search', args: { query: 'acme' } }],
        },
        {
          text: 'capturing',
          toolCalls: [{ id: 'c2', name: 'evidence.capture', args: { docId: 'doc-1', excerpt: 'founded 2020' } }],
        },
        { text: 'done' },
        {
          text: 'searching',
          toolCalls: [{ id: 'c3', name: 'hound.search', args: { query: 'ledgerly' } }],
        },
        {
          text: 'capturing',
          toolCalls: [{ id: 'c4', name: 'evidence.capture', args: { docId: 'doc-2', excerpt: 'ledger live' } }],
        },
        { text: 'done' },
      ])
      const outcome = await runResearchWorkflow({
        scope: pack.scope,
        questions: ['q1', 'q2'],
        provider,
        buildRegistry: registry,
        limits: { maxTurns: 10, maxToolCalls: 20, maxTokens: 100_000, maxCost: 10, maxWallMs: 60_000, maxStalledTurns: 5 },
        governor: { maxUnits: 3, maxReactTurns: 5, maxResultsPerQuery: 5, maxUnitWallMs: 60_000, maxRunWallMs: 600_000, maxFruitlessUnits: 2 },
        clock: frozenClock(0),
        policyVersion: 'pol1',
      })
      expect(outcome.outcome).toBe('reported')
      if (outcome.outcome !== 'reported') throw new Error('expected report')
      expect(outcome.report).toBe(pack.report)
      expect(outcome.findings.map((finding) => finding.contentHash)).toEqual(
        pack.findings.map((finding) => finding.contentHash),
      )
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('round-trips through createResearchPack with identical hashes and report', () => {
    const pack = loadPack()
    const rebuilt = createResearchPack({
      scope: pack.scope,
      documents: pack.documents,
      findings: pack.findings.map(({ claim, docId, url, excerpt }) => ({ claim, docId, url, excerpt })),
      capturedAt: pack.capturedAt,
    })
    expect(rebuilt).toEqual(pack)
  })

  it('rejects tampered packs: version, scope hash, finding hash, report', () => {
    const pack = loadPack()
    expect(() => validateResearchPack({ ...pack, version: 2 as never })).toThrow('version')
    expect(() => validateResearchPack({ ...pack, scope: 'different scope' })).toThrow('scope hash')
    expect(() =>
      validateResearchPack({
        ...pack,
        findings: [{ ...pack.findings[0], excerpt: 'tampered excerpt' }],
      }),
    ).toThrow('content hash')
    expect(() => validateResearchPack({ ...pack, report: pack.report + '\n(tampered)' })).toThrow('report')
  })

  it('holds no secrets: pack bytes scan clean', () => {
    const raw = readFileSync(join(fixtures, 'research-fintech-acme.json'), 'utf8')
    expect(raw).not.toMatch(/sk-ant-|sk-|ghp_|gho_|github_pat_|AKIA|BEGIN [A-Z ]*PRIVATE KEY/)
    expect(raw).not.toMatch(/"password"\s*:\s*"[^"]+"/)
  })
})
