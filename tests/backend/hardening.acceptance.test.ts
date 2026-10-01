import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { TOOL_NAMES } from '../../backend/src/mcp/schemas.js'

const root = join(import.meta.dirname, '..', '..')
const file = join(root, 'docs/deep-checks/acceptance.json')
const text = z.string().trim().min(1)
const Status = z.enum(['pending', 'verified', 'blocked', 'legacy', 'planned', 'excluded'])
const Hash = z.string().regex(/^[a-f0-9]{64}$/)
const Tier = z.enum(['unit','contract','integration','browser','stress','live-provider','review'])
const Evidence = z.object({
  path: text.regex(/^(backend\/test-results\/|frontend\/test-results\/|tests\/evidence\/|docs\/deep-checks\/)/).refine((path) => !path.split('/').includes('..') && !path.includes('\\')),
  sha256: Hash, commit: z.string().regex(/^[a-f0-9]{40}$/), environment: text,
  observedAt: z.iso.datetime(), tier: Tier,
  sourceHashes: z.record(text, Hash),
}).strict()
const Matrix = z.object({
  version: z.literal(1), contract: text,
  features: z.array(z.object({
    id: text, module: text, behavior: text, authority: text, persistence: text,
    sources: z.array(text).min(1), status: Status,
    scenarios: z.array(z.object({ id: text, when: text, then: text, status: Status,
      requiredTiers: z.array(Tier).min(1).refine((tiers) => new Set(tiers).size === tiers.length),
      tests: z.array(text), evidence: z.array(Evidence), reason: text.optional(),
    }).strict()).min(1),
  }).strict()).min(1),
  surfaces: z.array(z.object({ id: text, source: text, kind: z.enum(['export', 'http', 'mcp', 'ui']),
    features: z.array(text), status: Status, reason: text.optional(),
  }).strict()),
}).strict()
type Matrix = z.infer<typeof Matrix>
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
function validateTiers(required: Array<z.infer<typeof Tier>>, evidence: Array<z.infer<typeof Evidence>>): void {
  for (const tier of required) if (!evidence.some((proof) => proof.tier === tier)) throw new Error(`Missing required evidence tier: ${tier}`)
}
function validateEvidence(evidence: z.infer<typeof Evidence>, sources: string[]): void {
  if (sha256(readFileSync(join(root, evidence.path))) !== evidence.sha256) throw new Error('Evidence artifact hash mismatch')
  for (const source of sources) {
    if (sha256(readFileSync(join(root, source))) !== evidence.sourceHashes[source]) throw new Error(`Evidence source hash mismatch: ${source}`)
    const historical = execFileSync('git', ['show', `${evidence.commit}:${source}`], { cwd: root, stdio: ['ignore','pipe','pipe'] })
    if (sha256(historical) !== evidence.sourceHashes[source]) throw new Error(`Evidence commit does not contain tested source: ${source}`)
  }
}

function expectedSurfaces(): Array<{ id: string; source: string; kind: 'export' | 'http' | 'mcp' | 'ui' }> {
  const catalogue = JSON.parse(readFileSync(join(root, 'docs/deep-checks/catalogue.json'), 'utf8')) as { files: Array<{ path: string; exports: string[] }> }
  const sources = catalogue.files.filter(({ path }) => /^(agents|backend|frontend)\/src\//.test(path) && !/\.test\.|\/fixtures\//.test(path))
  const exports = sources.flatMap(({ path, exports }) => exports.map((name) => ({ id: `${path}#${name}`, source: path, kind: 'export' as const })))
  const ui = sources.filter(({ path }) => path.startsWith('frontend/src/components/') && path.endsWith('.tsx')).map(({ path }) => ({ id: `ui:${path}`, source: path, kind: 'ui' as const }))
  const spec = parse(readFileSync(join(root, 'backend/openapi/v1.yaml'), 'utf8')) as { paths: Record<string, Record<string, { operationId?: string }>> }
  const http = Object.values(spec.paths).flatMap((methods) => Object.entries(methods).filter(([method]) => ['get','post','put','patch','delete','options','head'].includes(method)).map(([, operation]) => {
    if (!operation.operationId) throw new Error('Public HTTP operation missing operationId')
    return { id: `http:${operation.operationId}`, source: 'backend/openapi/v1.yaml', kind: 'http' as const }
  }))
  const mcp = TOOL_NAMES.map((name) => ({ id: `mcp:${name}`, source: 'backend/src/mcp/schemas.ts', kind: 'mcp' as const }))
  return [...exports, ...ui, ...http, ...mcp].sort((a, b) => a.id.localeCompare(b.id))
}

if (process.env['UPDATE_ACCEPTANCE_SURFACES'] === '1') {
  const current = Matrix.parse(JSON.parse(readFileSync(file, 'utf8')))
  const old = new Map(current.surfaces.map((surface) => [surface.id, surface]))
  current.surfaces = expectedSurfaces().map((surface) => ({ ...surface, features: old.get(surface.id)?.features ?? [], status: old.get(surface.id)?.status ?? 'pending', ...(old.get(surface.id)?.reason ? { reason: old.get(surface.id)?.reason } : {}) }))
  writeFileSync(file, JSON.stringify(current, null, 2) + '\n')
}
const matrix = Matrix.parse(JSON.parse(readFileSync(file, 'utf8')))
// Pin critical approved acceptance tiers independently of mutable status records.
const REQUIRED_TIER_FLOORS: Record<string, Array<z.infer<typeof Tier>>> = {
  'CONTEXT.cache.1': ['live-provider'],
  'CONTEXT.shared-approval.1': ['integration', 'browser', 'live-provider'],
  'CONTEXT.shared-approval.4': ['integration', 'browser', 'live-provider'],
  'AGENT.delegation-steering.1': ['integration', 'stress'],
  'UI.workspace.2': ['browser', 'review'],
  'TEST.release-evidence.3': ['integration', 'browser', 'stress', 'live-provider', 'review'],
}

describe('final functionality acceptance matrix', () => {
  it('rejects placeholder evidence, missing/tampered artifacts and source hashes inconsistent with the tested commit', () => {
    expect(Evidence.safeParse('passed').success).toBe(false)
    const source = 'agents/src/clock.ts'
    const proof: z.infer<typeof Evidence> = {
      path: 'docs/deep-checks/acceptance.json', sha256: sha256(readFileSync(file)),
      commit: execFileSync('git', ['rev-parse','HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      environment: 'TEST validation fixture, not execution proof', observedAt: '2026-10-01T00:00:00Z', tier: 'unit',
      sourceHashes: { [source]: sha256(readFileSync(join(root, source))) },
    }
    expect(() => validateEvidence(proof, [source])).not.toThrow()
    expect(() => validateEvidence({ ...proof, path: 'docs/deep-checks/TEST-missing-evidence.json' }, [source])).toThrow()
    expect(() => validateEvidence({ ...proof, sha256: '0'.repeat(64) }, [source])).toThrow('Evidence artifact hash mismatch')
    expect(() => validateEvidence({ ...proof, sourceHashes: { [source]: '0'.repeat(64) } }, [source])).toThrow('Evidence source hash mismatch')
    expect(() => validateEvidence({ ...proof, commit: 'f'.repeat(40) }, [source])).toThrow()
    expect(() => validateTiers(['browser','live-provider'], [proof])).toThrow('Missing required evidence tier: browser')
    expect(() => validateTiers(['unit'], [proof])).not.toThrow()
  })
  it('inventories every declared export, HTTP operation, MCP tool and UI component surface without claiming coverage', () => {
    expect(matrix.surfaces.map(({ id, source, kind }) => ({ id, source, kind }))).toEqual(expectedSurfaces())
    expect(new Set(matrix.surfaces.map((surface) => surface.id)).size).toBe(matrix.surfaces.length)
  })
  it('uses unique functionality/scenario IDs, concrete contracts and existing source/test links', () => {
    expect(new Set(matrix.features.map((feature) => feature.id)).size).toBe(matrix.features.length)
    const scenarios = matrix.features.flatMap((feature) => feature.scenarios)
    expect(new Set(scenarios.map((scenario) => scenario.id)).size).toBe(scenarios.length)
    const featureIds = new Set(matrix.features.map((feature) => feature.id))
    const byId = new Map(matrix.features.map((feature) => [feature.id, feature]))
    expect(readFileSync(join(root, matrix.contract), 'utf8')).toContain('2000')
    for (const feature of matrix.features) {
      for (const source of feature.sources) expect(readFileSync(join(root, source)).length, source).toBeGreaterThan(0)
      for (const scenario of feature.scenarios) {
        for (const tier of REQUIRED_TIER_FLOORS[scenario.id] ?? []) expect(scenario.requiredTiers, scenario.id).toContain(tier)
        for (const test of scenario.tests) expect(readFileSync(join(root, test)).length, test).toBeGreaterThan(0)
        if (scenario.status === 'verified') { expect(scenario.tests.length, scenario.id).toBeGreaterThan(0); expect(scenario.evidence.length, scenario.id).toBeGreaterThan(0) }
        if (scenario.status === 'excluded') expect(scenario.reason, scenario.id).toBeTruthy()
      }
    }
    for (const surface of matrix.surfaces) {
      for (const id of surface.features) expect(featureIds.has(id), `${surface.id}: ${id}`).toBe(true)
      if (surface.status === 'verified') {
        expect(surface.features.length, surface.id).toBeGreaterThan(0)
        expect(surface.features.some((id) => byId.get(id)?.sources.includes(surface.source)), `${surface.id}: reviewed feature must include its actual source`).toBe(true)
      }
      if (surface.status === 'excluded') expect(surface.reason, surface.id).toBeTruthy()
    }
    for (const id of Object.keys(REQUIRED_TIER_FLOORS)) expect(scenarios.some((scenario) => scenario.id === id), id).toBe(true)
  })
  it.skipIf(process.env['KARDATA_HARDENING_ACCEPTANCE'] !== '1')('blocks release on unreviewed surfaces or unverified acceptance scenarios', () => {
    expect(matrix.surfaces.filter((surface) => !['verified','excluded'].includes(surface.status)).map(({ id }) => id)).toEqual([])
    for (const feature of matrix.features) {
      expect(feature.status, feature.id).toBe('verified')
      expect(feature.scenarios.filter((scenario) => !['verified','excluded'].includes(scenario.status)).map(({ id }) => id), feature.id).toEqual([])
      for (const scenario of feature.scenarios.filter((scenario) => scenario.status === 'verified')) {
        validateTiers(scenario.requiredTiers, scenario.evidence)
        for (const evidence of scenario.evidence) validateEvidence(evidence, [...feature.sources, ...scenario.tests])
      }
    }
  })
})
