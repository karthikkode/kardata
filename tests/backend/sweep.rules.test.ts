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

describe('basic company-result screening', () => {
  it('does not admit keyword-matching directories, articles, ranked lists or jobs', () => {
    const junk = [
      { title: 'Australian plumbing directory', url: 'https://yellowpages.com.au/plumbers' },
      { title: 'Electrical jobs in Australia', url: 'https://seek.com.au/electrical-jobs' },
      { title: 'Top 20 Australian plumbing companies', url: 'https://trade-magazine.example/top-contractors' },
      { title: 'Plumbing tips in Australia', url: 'https://service.example/blog/plumbing-tips' },
      { title: 'Australian electrician news', url: 'https://trade-news.example/articles/electrician-market' },
      { title: 'Australian plumbing directory', url: 'https://unknown.example', snippet: 'Browse our directory of plumbers and electrical contractors.' },
    ]
    expect(extractNewDomains(junk, [], ['plumbing','electrical','electrician'], true)).toEqual([])
  })
  it('rejects non-HTTP search results but does not confuse host suffixes with platform domains', () => {
    const hits = [
      { title: 'Plumbing', url: 'ftp://plumber.example/services' },
      { title: 'Plumbing', url: 'https://jobs.linkedin.com/company/plumber' },
      { title: 'Plumbing', url: 'https://brightx.com/services' },
      { title: 'Plumbing', url: 'https://notgoogle.com/services' },
    ]
    expect(extractNewDomains(hits, [], ['plumbing'], true).map(({ domain }) => domain)).toEqual(['brightx.com', 'notgoogle.com'])
  })
  it('retains ordinary company/service pages without treating brand words as jobs or lists', () => {
    const hits = [
      { title: 'Best Plumbing Brisbane', url: 'https://best-plumbing.example/services', snippet: 'Our plumbing services and contact details.' },
      { title: 'Job Electrical Services', url: 'https://job-electrical.example/about-us', snippet: 'Electrical contractors serving Australia.' },
    ]
    expect(extractNewDomains(hits, [], ['plumbing','electrical'], true)).toHaveLength(2)
  })
  it('retains the recorded legacy extraction contract when basic screening was not selected', () => {
    const hit = { title: '10 Best Payment Processing', url: 'https://connectpay.com/blog/x' }
    expect(extractNewDomains([hit], [], ['payment'])).toHaveLength(1)
    expect(extractNewDomains([hit], [], ['payment'], true)).toHaveLength(0)
  })
  it('rejects article/guide/news/registration junk that matches signals (B4)', () => {
    const junk = [
      { title: 'SME : Meaning, Benefits & Examples Guide - Aditya Birla Capital', url: 'https://guides.example/sme-meaning-benefits' },
      { title: 'SME News: Latest News on SME Sector, Small and Medium-Sized Enterprises', url: 'https://smenews.example/latest-sme-news' },
      { title: 'Udyam Registration : Zero cost, No Fee and Free Registration for MSMEs', url: 'https://udyam.example/free-registration' },
      { title: 'TEST Electrical Licence Classes', url: 'https://licensing.example.gov/electrical' },
      { title: 'TEST Electrician Registration', url: 'https://trades.nic.in/electrician-registration' },
    ]
    // Every hit matches a signal, so only the screening rules can reject.
    expect(extractNewDomains(junk, [], ['sme', 'news', 'registration', 'electrical', 'electrician'], true)).toEqual([])
  })
  it('keeps realistic company names containing guide/news/portal/registration words (B4)', () => {
    const hits = [
      { title: "Sparky's Electrical Pty Ltd | Licensed Electricians Sydney", url: 'https://sparkys.example/services', snippet: 'Electrical contractors serving Sydney.' },
      { title: 'Guide Plumbing & Gas - Brisbane Plumbers', url: 'https://guide-plumbing.example/about', snippet: 'Plumbing and gas fitting across Brisbane.' },
      { title: 'Breaking Point HVAC | Air Conditioning Melbourne', url: 'https://breaking-point-hvac.example/', snippet: 'HVAC installation and repairs.' },
      { title: 'NewsAgency Supplies Co', url: 'https://newsagency-supplies.example/', snippet: 'Wholesale trade supplies.' },
      { title: 'Portal Doors and Windows Perth', url: 'https://portal-doors.example/', snippet: 'Door and window installation.' },
      { title: 'Apex Registration Plates Pty Ltd', url: 'https://apex-plates.example/', snippet: 'Number plate manufacturing.' },
    ]
    expect(extractNewDomains(hits, [], ['electrical', 'plumbing', 'hvac', 'supplies', 'doors', 'plates'], true)).toHaveLength(6)
  })
})
