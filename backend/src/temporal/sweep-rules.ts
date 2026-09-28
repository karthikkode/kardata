// Pure sweep rules (Phase 6): query shaping and domain extraction shared
// by the sectorSweep workflow. No server, no database, no workflow
// imports — unit-tested directly like the B2.6 guard matrix.

/** Query templates from sector identity. Deterministic: the same sector
 * always sweeps the same template order.
 *
 * English-speaking regions bound the discovery harness: every base
 * template fans out per region so one region's index can never stand
 * in for the whole market, and non-English results stay out by query
 * construction (never by silent post-filtering). Base order is stable
 * (regionals append after the base set, capped at 30); the optional
 * override exists for tests and future region-scoped runs, never for
 * live contraction. */
export const ENGLISH_REGIONS: readonly string[] = [
  'United States',
  'United Kingdom',
  'Canada',
  'Australia',
]

export function buildQueryTemplates(
  name: string,
  topic: string,
  regions: readonly string[] = ENGLISH_REGIONS,
): string[] {
  const subject = (topic || name).trim()
  const base = [
    subject,
    `${name} companies`,
    `${subject} startups vendors`,
    `${subject} list directory`,
    `best ${subject} companies`,
    `${subject} new entrants`,
  ]
  const regional = regions.flatMap((region) => base.map((template) => `${template} ${region}`))
  const templates = [...base, ...regional]
  return [...new Set(templates.map((template) => template.trim()).filter((template) => template.length > 1))].slice(0, 30)
}

export interface CandidateHit {
  title: string
  url: string
}

export interface CandidateCompany {
  domain: string
  name: string
  url: string
}

/** Normalize hit URLs to registrable domains, dropping seen ones plus
 * non-company hosts (search engines, social profiles, encyclopedias). */
/** Sandbox-safe host parse: no URL global (workflow isolates restrict
 * web APIs), just scheme://host splitting. */
function hostOf(rawUrl: string): string | undefined {
  const match = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/:?#]+)/.exec(rawUrl.trim())
  if (!match) return undefined
  const host = (match[1] ?? '').toLowerCase()
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : undefined
}

export function extractNewDomains(hits: CandidateHit[], alreadySeen: string[]): CandidateCompany[] {
  const seen = new Set(alreadySeen.map((domain) => domain.toLowerCase()))
  const fresh: CandidateCompany[] = []
  for (const hit of hits) {
    const host = hostOf(hit.url)
    if (!host) continue
    const domain = host.startsWith('www.') ? host.slice(4) : host
    if (seen.has(domain)) continue
    if (
      domain.endsWith('google.com') ||
      domain.endsWith('bing.com') ||
      domain.endsWith('linkedin.com') ||
      domain.endsWith('facebook.com') ||
      domain.endsWith('twitter.com') ||
      domain.endsWith('x.com') ||
      domain.endsWith('youtube.com') ||
      domain.endsWith('wikipedia.org')
    ) {
      continue
    }
    seen.add(domain)
    fresh.push({ domain, name: hit.title.slice(0, 200) || domain, url: hit.url })
  }
  return fresh
}
