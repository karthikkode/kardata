// A6 file blocks: numeric coverage and template validation (pure, no DB).
import { describe, expect, it } from 'vitest'
import {
  extractNumberTokens, findMissingNumbers, chunkDocumentUnits, normalizeSectionsJson, parseJsonObject, validateBlockTemplate,
} from '../../backend/src/db/context-files.js'

describe('extractNumberTokens', () => {
  it('matches the spec regex with length >= 2', () => {
    const text = 'Revenue 12,400 in 2024, up 50% on 3/4; a 7 x unit.'
    expect(extractNumberTokens(text)).toEqual(['12,400', '2024', '50%', '3/4'])
  })
  it('ignores single digits', () => {
    expect(extractNumberTokens('step 3 of 9')).toEqual([])
  })
})

describe('findMissingNumbers', () => {
  const source = 'Acme earned $12,400 in Q1 2024 across 20 sites.'
  it('reports source numbers absent from the summary with a source snippet', () => {
    const missing = findMissingNumbers(source, 'Acme earned money in Q1 2024.')
    expect(missing.map((entry) => entry.token)).toEqual(['12,400', '20'])
    expect(missing[0]?.snippet).toContain('12,400')
    expect(missing[0]?.snippet.length).toBeLessThanOrEqual(121 + '12,400'.length)
  })
  it('is empty when every number is preserved', () => {
    expect(findMissingNumbers(source, 'Acme earned $12,400 in Q1 2024 across 20 sites.')).toEqual([])
  })
})

describe('chunkDocumentUnits', () => {
  const count = (text: string): number => Math.ceil(text.length / 4)
  it('packs units into chunks of at most 12,000 estimated tokens', () => {
    const units = [
      { ord: 0, text: 'a'.repeat(40000) },
      { ord: 1, text: 'b'.repeat(40000) },
      { ord: 2, text: 'c'.repeat(100) },
    ]
    const chunks = chunkDocumentUnits(units, 12000, count)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.map((unit) => unit.ord)).toEqual([0])
    expect(chunks[1]?.map((unit) => unit.ord)).toEqual([1, 2])
  })
  it('keeps small inputs in one chunk', () => {
    expect(chunkDocumentUnits([{ ord: 0, text: 'hello' }], 12000, count)).toHaveLength(1)
  })
})

describe('parseJsonObject', () => {
  it('parses plain, fenced and prose-wrapped JSON', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 })
    expect(parseJsonObject('```json\n{"a":2}\n```')).toEqual({ a: 2 })
    expect(parseJsonObject('Here it is: {"a":3} done.')).toEqual({ a: 3 })
    expect(parseJsonObject('no json here')).toBeUndefined()
  })
})

describe('normalizeSectionsJson', () => {
  it('joins array values into strings and leaves strings alone', () => {
    expect(normalizeSectionsJson({ decisions: ['a', 'b'], findings: 'x', questions: [] }))
      .toEqual({ decisions: 'a\nb', findings: 'x', questions: '' })
    expect(normalizeSectionsJson('nope')).toBe('nope')
  })
})

describe('validateBlockTemplate', () => {
  const good = [
    '### market-notes.md (MD)',
    '**Overview.** Two sentences here.',
    '**Key facts**',
    '- fact one',
    '**Entities**',
    '- Companies: Acme ; People: Ann ; Places: Oslo',
    '**Tables and data**',
    'None',
    '**Gaps or unclear parts**',
    '- None',
    'Source: full original in Files ▸ market-notes.md',
  ].join('\n')
  it('accepts a summary with all headings in order', () => {
    expect(validateBlockTemplate(good)).toEqual([])
  })
  it('reports missing and out-of-order headings', () => {
    const bad = '**Key facts**\n- x\n**Overview.** oops\nSource: full original in Files ▸ f'
    const issues = validateBlockTemplate(bad)
    expect(issues.some((issue) => issue.includes('###'))).toBe(true)
    expect(issues.some((issue) => issue.includes('Key facts') && issue.includes('order'))).toBe(true)
  })
})
