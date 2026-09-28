import { describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
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

function loadPack(name: string): ResearchPack {
  return JSON.parse(readFileSync(join(fixtures, name), 'utf8'))
}

function packNames(): string[] {
  // Directory glob, not a hardcoded list: every future research pack is
  // covered automatically, and an empty result fails loudly below.
  const names = readdirSync(fixtures).filter((name) => name.startsWith('research-') && name.endsWith('.json')).sort()
  if (names.length === 0) throw new Error('no research packs found in fixtures')
  return names
}

function registry(): ToolRegistry {
  const tools = new ToolRegistry()
  for (const tool of [...domainTools(), ...planTools(new PlanStore()), ...taskTools(new TaskLedger())]) {
    tools.register(tool)
  }
  return tools
}

describe('research pack cassette (record-once, replay-forever)', () => {
  it('replays the checked-in acme pack with the network cut: findings and report are byte-identical', async () => {
    const pack = loadPack('research-fintech-acme.json')
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
    const pack = loadPack('research-fintech-acme.json')
    const rebuilt = createResearchPack({
      scope: pack.scope,
      documents: pack.documents,
      findings: pack.findings.map(({ claim, docId, url, excerpt }) => ({ claim, docId, url, excerpt })),
      capturedAt: pack.capturedAt,
    })
    expect(rebuilt).toEqual(pack)
  })

  it('rejects tampered packs: version, scope hash, finding hash, report', () => {
    const pack = loadPack('research-fintech-acme.json')
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

  it('holds no secrets: every pack scans clean', () => {
    for (const name of packNames()) {
      const raw = readFileSync(join(fixtures, name), 'utf8')
      expect(raw).not.toMatch(/sk-ant-|sk-|ghp_|gho_|github_pat_|AKIA|BEGIN [A-Z ]*PRIVATE KEY/)
      expect(raw).not.toMatch(/"password"\s*:\s*"[^"]+"/)
    }
  })

  // Every checked-in pack replays hermetically: validate, serve every
  // document through the seam, and re-assemble the golden report from
  // scripted captures with the network cut. A pack that cannot replay
  // (stale golden, novel doc ids outside the stub fixtures) fails here,
  // never silently. Live-recorded packs join this loop for free.
  for (const name of packNames()) {
    it(`replays pack ${name} end to end with the network cut`, async () => {
      const pack = loadPack(name)
      expect(() => validateResearchPack(pack)).not.toThrow()
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network cut: cassettes only'))
      try {
        const retriever = new CassetteRetriever(pack)
        for (const doc of pack.documents) {
          const hits = await retriever.search(doc.title.split(' ')[0] ?? doc.id, 5)
          expect(hits.map((hit) => hit.id)).toContain(doc.id)
          const fetched = await retriever.fetch(doc.id)
          expect(fetched.body).toBe(doc.body)
        }
        await expect(retriever.fetch('no-such-doc')).rejects.toThrow("unknown document 'no-such-doc'")

        const steps = pack.findings.flatMap((finding, index) => [
          {
            text: 'searching',
            toolCalls: [{ id: `s${index}`, name: 'hound.search', args: { query: finding.docId } }],
          },
          {
            text: 'capturing',
            toolCalls: [{ id: `c${index}`, name: 'evidence.capture', args: { docId: finding.docId, excerpt: finding.excerpt } }],
          },
          { text: 'done' },
        ])
        const outcome = await runResearchWorkflow({
          scope: pack.scope,
          questions: pack.findings.map((_, index) => `q${index + 1}`),
          provider: new FakeProvider(steps),
          buildRegistry: registry,
          limits: { maxTurns: 10, maxToolCalls: 20, maxTokens: 100_000, maxCost: 10, maxWallMs: 60_000, maxStalledTurns: 5 },
          governor: { maxUnits: 8, maxReactTurns: 5, maxResultsPerQuery: 5, maxUnitWallMs: 60_000, maxRunWallMs: 600_000, maxFruitlessUnits: 8 },
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
  }
})
