// Pure sweep rules (Phase 6): query shaping and domain extraction shared
// by the sectorSweep workflow. No server, no database, no workflow
// imports — unit-tested directly like the B2.6 guard matrix.

/** Test scaffolding must never pollute production queries: a leading
 * TEST marker (bare token on names, `TEST ... ;` clause on topics) is
 * stripped before shaping. The rest of the identity is kept verbatim —
 * only the marker goes. */
const TEST_MARKER_CLAUSE = /^\s*TEST\b[^;]*;\s*/i
const TEST_MARKER_TOKEN = /^\s*TEST\b[:\s-]*/i

function stripTestMarkers(value: string): string {
  return value.replace(TEST_MARKER_CLAUSE, '').replace(TEST_MARKER_TOKEN, '')
}

/** Query templates from sector identity (TEST markers stripped first).
 * Deterministic: the same sector always sweeps the same template order.
 *
 * English-speaking regions bound the discovery harness: every base
 * template fans out per region so one region's index can never stand
 * in for the whole market, and non-English results stay out by query
 * construction (never by silent post-filtering). Base order is stable
 * (regionals append after the base set, capped at 30); the optional
 * override exists for tests and future region-scoped runs, never for
 * live contraction. */
const ENGLISH_REGIONS: readonly string[] = [
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
  const subject = (stripTestMarkers(topic) || stripTestMarkers(name)).trim()
  const cleanName = stripTestMarkers(name).trim() || name.trim()
  const base = [
    subject,
    `${cleanName} companies`,
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
  /** Snippet when the leg provides one (keyed search); empty otherwise. */
  snippet?: string
}

/** Sector match signals for the relevance gate: lowercase topic tokens
 * (stopwords, numerics, and short glue dropped; plurals folded), capped
 * so one sector cannot match the whole web. The topic — never the name,
 * which may carry run stamps — is the vocabulary source.
 *
 * Deliberately unpruned: a live A/B (2026-09-30) showed pruning generic
 * tokens starves recall (1 company, 0 relevant) while the unpruned gate
 * keeps a workable candidate set the research verdicts then grade
 * precisely. The sweep is the recall stage; verdicts are the precision
 * stage. */
const SIGNAL_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'small', 'best', 'top', 'new',
  'all', 'our', 'your', 'plus', 'list',
])

function foldPlural(token: string): string {
  if (token.length <= 3 || !token.endsWith('s') || token.endsWith('ss')) return token
  return token.slice(0, -1)
}

export function sectorSignals(name: string, topic: string): string[] {
  const source = topic.trim() || name.trim()
  const seen = new Set<string>()
  for (const raw of source.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || SIGNAL_STOPWORDS.has(raw) || /^[0-9]+$/.test(raw)) continue
    seen.add(foldPlural(raw))
    if (seen.size >= 12) break
  }
  return [...seen]
}

/** A hit is sector-relevant when any signal matches the title, snippet,
 * URL, or domain tokens — in singular or plural form either side, so
 * "payments" meets "payment processing" and "food" meets "Acme Foods".
 * Brand-only hits with empty metadata and no signal drop: documented
 * recall cost — the sweep keeps evidenced candidates instead of
 * recording the whole index. */
function signalVariants(signal: string): string[] {
  return [...new Set([signal, foldPlural(signal), `${signal}s`])]
}

function hitMatchesSignals(hit: CandidateHit, signals: readonly string[]): boolean {
  const haystacks = [hit.title, hit.snippet ?? '', hit.url].map((text) => text.toLowerCase())
  const host = hostOf(hit.url) ?? ''
  const domainTokens = host.toLowerCase().split(/[^a-z0-9]+/)
  return signals.some((signal) =>
    signalVariants(signal).some(
      (variant) =>
        haystacks.some((haystack) => haystack.includes(variant)) || domainTokens.includes(variant),
    ),
  )
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

export function extractNewDomains(
  hits: CandidateHit[],
  alreadySeen: string[],
  signals: readonly string[] = [],
  basicFiltering = false,
): CandidateCompany[] {
  const seen = new Set(alreadySeen.map((domain) => domain.toLowerCase()))
  const fresh: CandidateCompany[] = []
  for (const hit of hits) {
    const host = hostOf(hit.url)
    if (!host) continue
    const domain = host.startsWith('www.') ? host.slice(4) : host
    if (seen.has(domain)) continue
    if (basicFiltering && !basicCompanyHit(hit, domain)) continue
    if (
      !basicFiltering && (
      domain.endsWith('google.com') ||
      domain.endsWith('bing.com') ||
      domain.endsWith('linkedin.com') ||
      domain.endsWith('facebook.com') ||
      domain.endsWith('twitter.com') ||
      domain.endsWith('x.com') ||
      domain.endsWith('youtube.com') ||
      domain.endsWith('wikipedia.org'))
    ) {
      continue
    }
    // Relevance gate: with signals, only evidenced candidates land.
    // Without signals the extraction stays unfiltered (back-compat).
    if (signals.length > 0 && !hitMatchesSignals(hit, signals)) continue
    seen.add(domain)
    fresh.push({ domain, name: hit.title.slice(0, 200) || domain, url: hit.url })
  }
  return fresh
}

const NON_COMPANY_DOMAINS = [
  'google.com', 'bing.com', 'duckduckgo.com', 'linkedin.com', 'facebook.com',
  'twitter.com', 'x.com', 'youtube.com', 'wikipedia.org', 'seek.com.au',
  'indeed.com', 'glassdoor.com', 'yellowpages.com.au', 'truelocal.com.au',
  'hotfrog.com.au', 'yelp.com', 'yelp.com.au', 'tripadvisor.com',
]

/** Government and reference hosts: never a trading company. */
const NON_COMPANY_SUFFIXES = [
  '.gov', '.gov.au', '.gov.in', '.nic.in', '.gov.uk',
]

/** Article/guide/news/registration shapes that real junk arrives in
 * (B4). Each must read as editorial content, never a company name:
 * negative controls pin the near-misses. */
const ARTICLE_TITLE_RULES = [
  /\b(meaning|definition)\b.*\b(benefits|examples|guide|types)\b/i,
  /^\s*(what is|what are|how to|why)\b/i,
  /\b(latest news|news updates?|breaking news)\b/i,
  /^\s*[^:|]{0,40}\bnews\s*[:|]/i,
  /\b(registration|apply online|government scheme|yojana|portal)\b.*\b(free|online|apply|scheme)\b/i,
  /\b(examples? guide|ultimate guide|complete guide|beginner'?s guide)\b/i,
]

/** Metadata screening only, not a deep-research verdict or geographic proof.
 * Keep legacy callers unchanged for durable workflow replay. */
function basicCompanyHit(hit: CandidateHit, domain: string): boolean {
  const authority = /^https?:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(hit.url.trim())?.[1]
  if (!authority || !/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(authority)) return false
  const port = authority.split(':')[1]
  if (port && (Number(port) < 1 || Number(port) > 65535)) return false
  if (NON_COMPANY_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`))) return false
  if (NON_COMPANY_SUFFIXES.some((suffix) => domain === suffix.slice(1) || domain.endsWith(suffix))) return false
  const path = /^https?:\/\/[^/?#]+([^?#]*)/i.exec(hit.url.trim())?.[1] ?? ''
  if (/\/(?:blogs?|news|articles?|careers?|jobs?|vacancies|directory|directories|listings?)(?:[/.?#-]|$)/i.test(path)) return false
  if (/\b(?:top|best)\s+\d+\b|\b\d+\s+(?:top|best)\b|\bdirectory\b|\bjob\s+(?:board|listings?)\b|\bjobs\s+(?:in|for)\b|\bvacancies\b/i.test(hit.title)) return false
  if (/\bdirectory of\b|\bbrowse\b.{0,50}\blistings\b|\bjob vacancies\b/i.test(hit.snippet ?? '')) return false
  const copy = `${hit.title}\n${hit.snippet ?? ''}`
  if (ARTICLE_TITLE_RULES.some((rule) => rule.test(copy))) return false
  return true
}

/** Cancellation shapes for the sweep workflow (mirrors the two shapes
 * documented in workflows/run.ts: a bare scope cancellation, or an
 * activity failure wrapping one). Name-checked instead of instanceof so
 * the rule stays SDK-free and shared with fast unit tests. A cancelled
 * sweep must leave sector state alone: the pause route already recorded
 * `paused`, and a `failed` write would overwrite it. */
export function isSweepCancellation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: unknown }).name
  if (name === 'CancelledFailure') return true
  if (name === 'ActivityFailure') {
    const cause = (error as { cause?: unknown }).cause
    return !!cause && typeof cause === 'object' && (cause as { name?: unknown }).name === 'CancelledFailure'
  }
  return false
}
