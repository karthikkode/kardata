// Pure sweep rules (Phase 6). No server, no database: template shaping
// and domain extraction run identically in the workflow and here.
import { describe, expect, it } from 'vitest'
import { buildQueryTemplates, extractNewDomains, isSweepCancellation, sectorSignals } from '../../backend/src/temporal/sweep-rules.js'

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

describe('sectorSignals', () => {
  it('derives clean match signals from the topic, never the name stamp', () => {
    expect(sectorSignals('Pilot Fintech mumghjr3', 'SME payments')).toEqual(['sme', 'payment'])
    expect(sectorSignals('Speciality foods sweep', 'Artisanal packaged foods')).toEqual([
      'artisanal',
      'packaged',
      'food',
    ])
    // Generic-only sectors keep it all: pruning was measured to starve
    // recall (live A/B 2026-09-30), so the gate never prunes.
    expect(sectorSignals('X', 'Small business')).toEqual(['business'])
    expect(sectorSignals('X', '')).toEqual([])
  })
})

describe('extractNewDomains relevance gate', () => {
  const signals = ['sme', 'payments']
  it('keeps signaled candidates across title, snippet, url, and domain tokens', () => {
    const hits = [
      { title: '10 Best Payment Processing', url: 'https://connectpay.com/blog/x', snippet: '' },
      { title: 'Helcim', url: 'https://helcim.com', snippet: 'Helcim offers payment processing' },
      { title: 'SMEPay', url: 'https://smepay.io', snippet: '' },
    ]
    expect(extractNewDomains(hits, [], signals).map((c) => c.domain)).toEqual([
      'connectpay.com',
      'helcim.com',
      'smepay.io',
    ])
  })

  it('drops spam with no sector signal anywhere', () => {
    const hits = [
      { title: 'DP BOSS - KALYAN SATTA MATKA LIVE RESULT', url: 'https://dpboss.in', snippet: '' },
      { title: 'Watch Vishwanath Full Movie Online', url: 'https://moviefone.example', snippet: '' },
      { title: 'Printers - HP Support Community', url: 'https://hp.example/support', snippet: '' },
    ]
    expect(extractNewDomains(hits, [], signals)).toEqual([])
  })

  it('stays unfiltered without signals (back-compat)', () => {
    const hits = [{ title: 'Anything', url: 'https://anything.example', snippet: '' }]
    expect(extractNewDomains(hits, [])).toHaveLength(1)
  })
})
