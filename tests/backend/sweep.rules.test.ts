// Pure sweep rules (Phase 6). No server, no database: template shaping
// and domain extraction run identically in the workflow and here.
import { describe, expect, it } from 'vitest'
import { buildQueryTemplates, extractNewDomains } from '../../backend/src/temporal/sweep-rules.js'

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
