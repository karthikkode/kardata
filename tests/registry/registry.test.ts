// Lean feature registry gate (Phase 1). No hashes, no per-file review
// statuses: the YAML lists surfaces, tests carry [F:<id>] tags.
// Always fails on: a surface missing from the YAML, a tag naming an
// unknown id. With REGISTRY_ENFORCE=1 (default in Phase 7) it also fails
// on `todo` entries and entries lacking a tagged test per listed tier.
// Tier-by-content is a heuristic (documented in tierOfFile); exactness
// hardens in Phase 7.
import { describe, expect, it } from 'vitest'
import {
  checkRegistry,
  enumerateSurfaces,
  loadRegistry,
  mergeRegistry,
  scanTags,
  tierOfFile,
} from '../../scripts/registry-sync.mjs'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const ENFORCE = process.env['REGISTRY_ENFORCE'] === '1'

describe('registry gate', () => {
  it('lists every enumerated surface in features.yaml', () => {
    const surfaces = enumerateSurfaces(ROOT)
    expect(surfaces.length).toBeGreaterThan(50)
    const { missing } = checkRegistry(loadRegistry(ROOT), surfaces, [], { enforce: false })
    expect(missing).toEqual([])
  })

  it('resolves every [F:id] tag to a known entry', () => {
    const tags = scanTags(ROOT)
    const { unknown } = checkRegistry(loadRegistry(ROOT), [], tags, { enforce: false })
    expect(unknown).toEqual([])
  })

  it('prints counts per layer in report mode', () => {
    const entries = loadRegistry(ROOT)
    const layers = new Set(entries.map((entry) => entry.layer))
    expect(layers.size).toBeGreaterThan(3)
  })
})

describe('enforce logic (fixtures)', () => {
  const surfaces = [{ id: 'db.x.y', layer: 'db', surface: 'backend/src/db/x.ts' }]
  const tagged = [{ id: 'db.x.y', file: 'tests/backend/x.test.ts', tiers: ['unit', 'db'] }]

  it('passes a tier-covered entry and a [none]+why exclusion', () => {
    const entries = [
      { id: 'db.x.y', layer: 'db', surface: 'backend/src/db/x.ts', tiers: ['unit'], states: [] },
    ]
    expect(checkRegistry(entries, surfaces, tagged, { enforce: true })).toEqual({
      missing: [],
      unknown: [],
      todo: [],
      gaps: [],
    })
  })

  it('fails todo entries, unknown tags, and tier gaps under enforce', () => {
    const entries = [
      { id: 'db.x.y', layer: 'db', surface: 'backend/src/db/x.ts', tiers: ['todo'], states: [] },
    ]
    const badTags = [{ id: 'db.nope', file: 'tests/backend/x.test.ts', tiers: ['unit'] }]
    const result = checkRegistry(entries, surfaces, badTags, { enforce: true })
    expect(result.todo).toEqual(['db.x.y'])
    expect(result.unknown).toEqual([{ id: 'db.nope', file: 'tests/backend/x.test.ts' }])
    expect(result.gaps).toEqual([{ id: 'db.x.y', tier: 'todo' }])
  })

  it('fails a listed tier with no tagged test', () => {
    const entries = [
      { id: 'db.x.y', layer: 'db', surface: 'backend/src/db/x.ts', tiers: ['live'], states: [] },
    ]
    const result = checkRegistry(entries, surfaces, tagged, { enforce: true })
    expect(result.gaps).toEqual([{ id: 'db.x.y', tier: 'live' }])
  })
})

describe('registry sync merge', () => {
  const surfaces = [
    { id: 'a.one', layer: 'db', surface: 'f.ts' },
    { id: 'a.two', layer: 'db', surface: 'f.ts' },
  ]

  it('appends new surfaces as todo and reports removed ones', () => {
    const { entries, added, removed } = mergeRegistry([], surfaces)
    expect(added).toEqual(['a.one', 'a.two'])
    expect(removed).toEqual([])
    expect(entries).toEqual([
      { id: 'a.one', layer: 'db', surface: 'f.ts', tiers: ['todo'], states: [] },
      { id: 'a.two', layer: 'db', surface: 'f.ts', tiers: ['todo'], states: [] },
    ])
  })

  it('never rewrites hand-edited fields', () => {
    const old = [
      { id: 'a.one', layer: 'db', surface: 'f.ts', tiers: ['unit', 'db'], states: [] },
      { id: 'a.gone', layer: 'db', surface: 'f.ts', tiers: ['none'], why: 're-export', states: [] },
    ]
    const { entries, added, removed } = mergeRegistry(old, surfaces)
    expect(added).toEqual(['a.two'])
    expect(removed).toEqual(['a.gone'])
    expect(entries.find((entry) => entry.id === 'a.one')).toEqual(old[0])
    expect(entries.find((entry) => entry.id === 'a.gone')).toEqual(old[1])
  })
})

describe('tierOfFile', () => {
  it('maps content to exactly one tier', () => {
    expect(tierOfFile('tests/stress/x.test.ts', '')).toBe('stress')
    expect(tierOfFile('tests/fault/x.test.ts', '')).toBe('fault')
    expect(tierOfFile('tests/backend/live/x.test.ts', "process.env['KARDATA_LIVE_META']")).toBe('live')
    expect(tierOfFile('tests/frontend-e2e/x.live.spec.ts', 'KARDATA_LIVE_UI')).toBe('live')
    expect(tierOfFile('tests/backend/workflows.x.test.ts', 'KARDATA_TEMPORAL_TEST TEST_DATABASE_URL')).toBe('temporal')
    expect(tierOfFile('tests/backend/db.x.test.ts', 'TEST_DATABASE_URL')).toBe('db')
    expect(tierOfFile('tests/backend/api.x.test.ts', "from '../db-helper.js'")).toBe('db')
    expect(tierOfFile('tests/backend/api.x.test.ts', 'plain unit test')).toBe('unit')
    expect(tierOfFile('tests/frontend-e2e/x.spec.ts', 'playwright test')).toBe('e2e')
    expect(tierOfFile('agents/src/x.test.ts', '')).toBe('unit')
    expect(tierOfFile('tests/frontend/x.test.tsx', '')).toBe('unit')
  })
})
