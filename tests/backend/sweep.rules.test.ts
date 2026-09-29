// Pure sweep rules (Phase 6). No server, no database: template shaping
// and domain extraction run identically in the workflow and here.
import { describe, expect, it } from 'vitest'
import { buildQueryTemplates, extractNewDomains, isSweepCancellation } from '../../backend/src/temporal/sweep-rules.js'

describe('buildQueryTemplates', () => {
  it('shapes a stable template order from name and topic', () => {
    const templates = buildQueryTemplates('Speciality foods', 'Artisanal packaged foods')
    expect(templates[0]).toBe('Artisanal packaged foods')
    expect(templates).toContain('Speciality foods companies')
    expect(templates.length).toBeGreaterThanOrEqual(4)
    expect(buildQueryTemplates('Speciality foods', 'Artisanal packaged foods')).toEqual(templates)
  })

  it('falls back to the name when the topic is empty', () => {
    expect(buildQueryTemplates('Pet care', '')[0]).toBe('Pet care')
  })

  it('qualifies templates with English-speaking regions by default', () => {
    const templates = buildQueryTemplates('Speciality foods', 'Artisanal packaged foods')
    for (const region of ['United States', 'United Kingdom', 'Canada', 'Australia']) {
      expect(templates).toContain(`Artisanal packaged foods ${region}`)
    }
    expect(templates[0]).toBe('Artisanal packaged foods')
    expect(templates.length).toBeLessThanOrEqual(30)
    expect(buildQueryTemplates('Speciality foods', 'Artisanal packaged foods')).toEqual(templates)
  })

  it('strips TEST scaffolding markers so test sectors search clean subjects', () => {
    const templates = buildQueryTemplates('TEST Sweep Proof', 'TEST DATA: keyless sweep proof; D2C specialty foods')
    expect(templates[0]).not.toMatch(/^TEST\b/i)
    expect(templates.join('\n')).not.toMatch(/TEST DATA/i)
    expect(templates).toContain('D2C specialty foods United States')
  })
})

describe('extractNewDomains', () => {
  const hits = [
    { title: 'Acme', url: 'https://www.acme.example/shop' },
    { title: 'Acme again', url: 'https://acme.example/other' },
    { title: 'Search', url: 'https://www.google.com/search?q=acme' },
    { title: 'Profile', url: 'https://linkedin.com/company/acme' },
    { title: 'Junk', url: 'not a url' },
    { title: '', url: 'https://noname.example' },
  ]

  it('normalizes domains, drops dupes and non-company hosts', () => {
    const fresh = extractNewDomains(hits, [])
    expect(fresh.map((company) => company.domain).sort()).toEqual(['acme.example', 'noname.example'])
    expect(fresh[0]).toMatchObject({ name: 'Acme', url: 'https://www.acme.example/shop' })
  })

  it('excludes already-seen domains case-insensitively', () => {
    expect(extractNewDomains(hits, ['ACME.EXAMPLE', 'noname.example'])).toEqual([])
  })
})

describe('isSweepCancellation', () => {
  it('recognizes bare and activity-wrapped cancellations, nothing else', () => {
    const bare = new Error('scope cancelled')
    bare.name = 'CancelledFailure'
    expect(isSweepCancellation(bare)).toBe(true)
    const wrapped = new Error('activity failed')
    wrapped.name = 'ActivityFailure'
    ;(wrapped as unknown as { cause: unknown }).cause = bare
    expect(isSweepCancellation(wrapped)).toBe(true)
    const plain = new Error('fetch failed')
    expect(isSweepCancellation(plain)).toBe(false)
    const activityOther = new Error('activity failed')
    activityOther.name = 'ActivityFailure'
    ;(activityOther as unknown as { cause: unknown }).cause = plain
    expect(isSweepCancellation(activityOther)).toBe(false)
    expect(isSweepCancellation(undefined)).toBe(false)
    expect(isSweepCancellation('cancelled')).toBe(false)
  })
})
