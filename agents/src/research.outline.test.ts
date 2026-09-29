// Research outline + uncertain findings (Phase A1-A3 adoption).
// Failing-first: this file defines the contract before the implementation.
import { describe, expect, it } from 'vitest'
import {
  assembleReport,
  buildOutline,
  captureFinding,
  validateFindingsCoverage,
  type ResearchFieldDef,
} from './research.js'

const FIELDS: ResearchFieldDef[] = [
  { name: 'scale_signal', description: 'Recorded scale evidence', detailLevel: 'brief' },
  { name: 'problem_mechanism', description: 'Specific improvable mechanism', detailLevel: 'moderate' },
]

describe('buildOutline', () => {
  it('builds a versioned outline with items, fields, and batch config', () => {
    const outline = buildOutline({
      topic: 'Speciality foods',
      items: [{ name: 'Acme Foods', description: 'D2C pantry brand' }],
      fields: FIELDS,
      batch: { batchSize: 2, itemsPerAgent: 1 },
    })
    expect(outline.version).toBe(1)
    expect(outline.topic).toBe('Speciality foods')
    expect(outline.items).toHaveLength(1)
    expect(outline.fields.map((field) => field.name)).toEqual(['scale_signal', 'problem_mechanism'])
    expect(outline.batch).toEqual({ batchSize: 2, itemsPerAgent: 1 })
  })

  it('rejects empty items, bad batch config, and unknown shapes loudly', () => {
    expect(() => buildOutline({ topic: 't', items: [], fields: FIELDS, batch: { batchSize: 1, itemsPerAgent: 1 } })).toThrow()
    expect(() => buildOutline({ topic: 't', items: [{ name: 'x' }], fields: FIELDS, batch: { batchSize: 0, itemsPerAgent: 1 } })).toThrow()
    expect(() => buildOutline({ topic: '', items: [{ name: 'x' }], fields: FIELDS, batch: { batchSize: 1, itemsPerAgent: 1 } })).toThrow()
    expect(() => buildOutline({ topic: 't', items: [{ name: '' }], fields: FIELDS, batch: { batchSize: 1, itemsPerAgent: 1 } })).toThrow()
    expect(() =>
      buildOutline({ topic: 't', items: [{ name: 'x' }], fields: [{ name: '', description: '', detailLevel: 'brief' }], batch: { batchSize: 1, itemsPerAgent: 1 } }),
    ).toThrow()
  })
})

describe('uncertain findings', () => {
  it('carries uncertain marks without changing the content hash', () => {
    const plain = captureFinding({ claim: 'founded 2020', docId: 'd', url: 'u', excerpt: 'founded 2020' })
    const marked = captureFinding({ claim: 'founded 2020', docId: 'd', url: 'u', excerpt: 'founded 2020', uncertain: ['founding_year'] })
    expect(marked.contentHash).toBe(plain.contentHash)
    expect(marked.uncertain).toEqual(['founding_year'])
    expect(plain.uncertain).toBeUndefined()
  })

  it('lists uncertain claims in their own report section', () => {
    const sure = captureFinding({ claim: 'sells jam', docId: 'd', url: 'u', excerpt: 'sells jam' })
    const unsure = captureFinding({ claim: 'founded 2020', docId: 'd', url: 'u', excerpt: 'founded 2020', uncertain: ['founding_year'] })
    const report = assembleReport([sure, unsure])
    expect(report).toContain('## Findings')
    expect(report).toContain('- [sells jam](u)')
    expect(report).toContain('## Uncertain')
    expect(report).toMatch(/## Uncertain[\s\S]*founded 2020/)
  })

  it('keeps certain-only reports byte-identical to before', () => {
    const finding = captureFinding({ claim: 'c', docId: 'd', url: 'u', excerpt: 'e' })
    expect(assembleReport([finding, finding])).toBe('## Findings\n- [c](u)\n\n## Sources\n- u (d)')
  })
})

describe('validateFindingsCoverage', () => {
  it('requires every field covered unless marked uncertain, never passing vacuously', () => {
    const fields: ResearchFieldDef[] = [
      { name: 'scale_signal', description: 's', detailLevel: 'brief' },
      { name: 'problem_mechanism', description: 'm', detailLevel: 'moderate' },
    ]
    const covered = [
      captureFinding({ claim: 'scale', docId: 'd', url: 'u', excerpt: 'scale', field: 'scale_signal' }),
      captureFinding({ claim: 'mech', docId: 'd', url: 'u', excerpt: 'mech', field: 'problem_mechanism' }),
    ]
    expect(() => validateFindingsCoverage(covered, fields)).not.toThrow()
    const missing = [captureFinding({ claim: 'scale', docId: 'd', url: 'u', excerpt: 'scale', field: 'scale_signal' })]
    expect(() => validateFindingsCoverage(missing, fields)).toThrow('problem_mechanism')
    expect(() => validateFindingsCoverage([], fields)).toThrow()
  })

  it('honors explicit required markers as opt-in', () => {
    const fields: ResearchFieldDef[] = [
      { name: 'scale_signal', description: 's', detailLevel: 'brief', required: true },
      { name: 'optional_color', description: 'o', detailLevel: 'brief', required: false },
    ]
    const onlyRequired = [captureFinding({ claim: 'scale', docId: 'd', url: 'u', excerpt: 'scale', field: 'scale_signal' })]
    expect(() => validateFindingsCoverage(onlyRequired, fields)).not.toThrow()
    expect(() => validateFindingsCoverage([], fields)).toThrow('scale_signal')
  })
})
