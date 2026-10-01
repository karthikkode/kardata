// Browser-pool facade: the single entry every agent browser request goes
// through. Agents never choose between search legs; the facade routes
// Tier-0 first (keyed API, keyless pool, plain fetch) and the pooled
// Chromium leg last, with query/document caches plus in-flight dedup so
// 100 overlapping subagents pay each leg once. Pagination cursors live in
// the query cache (query + count + page), never in a worker slot.
// Tool names, schemas, roles, and `via` tags are unchanged: the pool and
// caches sit underneath the existing contract.
import type { Logger } from 'pino'
import {
  browserAct,
  browserClose,
  browserNavigate,
  browserScreenshot,
  browserSnapshot,
  type BrowserAct,
} from '../retrieval/browser.js'
import { keylessSearch, type KeylessHit } from '../retrieval/keyless.js'
import { RetrievalError, webFetch, webSearch, type FetchImpl, type SearchEnv, type SearchHit } from '../retrieval/web.js'
import {
  dedupInflight,
  getCachedDoc,
  getCachedQuery,
  normalizeBrowserUrl,
  queryCacheKey,
  setCachedDoc,
  setCachedQuery,
  type CachedSearchHit,
} from './cache.js'

export type SweepSearchVia = 'keyed' | 'keyless' | 'browser'

export interface SweepSearchHit {
  title: string
  url: string
  snippet: string
  /** Which fallback leg produced this page; absent means keyed. */
  via?: SweepSearchVia
  /** Keyless engine name when via is 'keyless'; absent otherwise. */
  engine?: string
}

/** Injectable legs for the fallback chain (tests stub these; the
 * sweep always runs the defaults). */
export interface SweepSearchDeps {
  keyed?: (query: string, page: number) => Promise<SearchHit[]>
  keyless?: (query: string, page: number) => Promise<KeylessHit[]>
  browser?: (query: string) => Promise<SweepSearchHit[]>
}

/** Search-engine hosts that must never become company candidates. */
const BROWSER_INTERNAL_HOSTS = [
  'bing.com',
  'www.bing.com',
  'duckduckgo.com',
  'lite.duckduckgo.com',
  'mojeek.com',
  'www.mojeek.com',
  'qwant.com',
  'www.qwant.com',
]

/** Candidate URLs out of an aria snapshot: bare links in document order,
 * deduped, engine-internal hosts dropped. Titles are hostnames — the
 * snapshot carries no titles, and inventing them would lie to the
 * ledger. Pure: unit-tested directly (via the sweep re-export). */
export function linksFromSnapshot(snapshot: string, limit = 10): SweepSearchHit[] {
  const hits: SweepSearchHit[] = []
  const seen = new Set<string>()
  const pattern = /https?:\/\/[^\s"'<>)\]]+/g
  for (const match of snapshot.matchAll(pattern)) {
    const url = match[0].replace(/[.,;:!?)]+$/, '')
    let host = ''
    try {
      host = new URL(url).hostname.toLowerCase()
    } catch {
      continue
    }
    if (BROWSER_INTERNAL_HOSTS.some((internal) => host === internal || host.endsWith(`.${internal}`))) continue
    if (seen.has(url)) continue
    seen.add(url)
    hits.push({ title: host, url, snippet: '', via: 'browser' })
    if (hits.length >= limit) break
  }
  return hits
}

/** Browser leg: real Chromium on the DDG html endpoint (the page curl
 * cannot reach past the anomaly wall), snapshot links out, session
 * always closed. Slot accounting lives inside browserNavigate/close, so
 * saturation surfaces here as `overload` and never evicts a holder. */
async function defaultBrowserLeg(query: string): Promise<SweepSearchHit[]> {
  const { sessionId, snapshot } = await browserNavigate(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.trim())}`,
    { caller: 'sweep' },
  )
  try {
    return linksFromSnapshot(snapshot)
  } finally {
    await browserClose(sessionId, 'sweep').catch(() => undefined)
  }
}

function validateSearchPage(input: { query: string; page: number }): string {
  if (!Number.isInteger(input.page) || input.page < 0) throw new RetrievalError('validation_failed', 'page must be >= 0')
  if (input.query.trim().length < 2 || input.query.trim().length > 300) {
    throw new RetrievalError('validation_failed', 'query must be 2-300 characters')
  }
  return input.query.trim()
}

/** One search page for a template: keyed API first, keyless engine pool
 * second, pooled Chromium leg last (page 0 only — deeper pages return
 * empty so the template terminates instead of re-driving the browser).
 * Served from the query cache when a sibling agent already paid the leg.
 * Exhaustion on every leg fails loudly, never an empty list pretending
 * to be exhaustive. Pool saturation (`overload` from the browser leg)
 * propagates as overload so the caller retries later instead of
 * recording a false exhaustive miss. */
export async function pooledSearchWebPage(
  input: { query: string; page: number },
  deps: SweepSearchDeps = {},
): Promise<SweepSearchHit[]> {
  const query = validateSearchPage(input)
  const key = queryCacheKey(query, 10, input.page)
  const cached = getCachedQuery(key)
  if (cached) return [...cached]
  return dedupInflight(key, async () => {
    const again = getCachedQuery(key)
    if (again) return [...again]
    const keyed = deps.keyed ?? ((q, page) => pooledWebSearch(process.env, q, { count: 10, page }))
    const keyless = deps.keyless ?? ((q, page) => keylessSearch(q, { count: 10, page }))
    const browser = deps.browser ?? defaultBrowserLeg

    if (process.env['KARDATA_WEB_SEARCH_KEY']?.trim()) {
      try {
        const hits = await keyed(query, input.page)
        if (hits.length > 0) {
          const tagged = hits.map((hit) => ({ ...hit, via: 'keyed' as const }))
          setCachedQuery(key, tagged)
          return tagged
        }
      } catch (error) {
        if (!(error instanceof RetrievalError)) throw error
      }
    }
    try {
      const hits = await keyless(query, input.page)
      if (hits.length > 0) {
        const tagged: CachedSearchHit[] = hits.map((hit) => ({
          title: hit.title,
          url: hit.url,
          snippet: hit.snippet,
          via: 'keyless' as const,
          engine: hit.engine,
        }))
        setCachedQuery(key, tagged)
        return tagged
      }
    } catch (error) {
      if (!(error instanceof RetrievalError)) throw error
    }
    if (input.page > 0) {
      setCachedQuery(key, [])
      return []
    }
    try {
      const hits = await browser(query)
      setCachedQuery(key, hits)
      return hits
    } catch (error) {
      if (error instanceof RetrievalError && error.code === 'overload') throw error
      throw new RetrievalError(
        'fetch_failed',
        `sweep search exhausted every leg: ${error instanceof Error ? error.message : 'unknown'}`,
      )
    }
  })
}

/** Pooled fetch: repeat reads of one URL share one leg call. Only
 * successes cache; validation, blocks, and failures always re-evaluate. */
export async function pooledWebFetch(url: string, fetchImpl?: FetchImpl) {
  const key = `fetch:${normalizeBrowserUrl(url)}`
  const cached = getCachedDoc(url)
  if (cached) return { ...cached }
  return dedupInflight(key, async () => {
    const again = getCachedDoc(url)
    if (again) return { ...again }
    const result = await webFetch(url, fetchImpl)
    setCachedDoc(url, result)
    return result
  })
}

/** Pooled keyed search: one sector's agents share each result page. */
export async function pooledWebSearch(
  env: SearchEnv,
  query: string,
  options: { count?: number; page?: number; fetchImpl?: FetchImpl } = {},
): Promise<SearchHit[]> {
  const count = Math.min(Math.max(options.count ?? 10, 1), 20)
  const page = options.page ?? 0
  const key = `search:${queryCacheKey(query, count, page)}`
  const cached = getCachedQuery(key)
  if (cached) return cached.map((hit) => ({ title: hit.title, url: hit.url, snippet: hit.snippet }))
  return dedupInflight(key, async () => {
    const again = getCachedQuery(key)
    if (again) return again.map((hit) => ({ title: hit.title, url: hit.url, snippet: hit.snippet }))
    const hits = await webSearch(env, query, { count, page, fetchImpl: options.fetchImpl })
    if (hits.length > 0) setCachedQuery(key, hits)
    return hits
  })
}

// Pooled browser sessions: slot accounting lives in retrieval/browser.ts
// (acquire on navigate, release on close/idle-reap). These pass-throughs
// exist so every agent browser call crosses the facade — the one place a
// future tier router can intercept without touching callers.
export function pooledBrowserNavigate(url: string, opts?: { caller?: string; timeoutMs?: number; logger?: Logger }) {
  return browserNavigate(url, opts)
}

export function pooledBrowserSnapshot(sessionId: string, caller?: string) {
  return browserSnapshot(sessionId, caller)
}

export function pooledBrowserAct(sessionId: string, act: BrowserAct, caller?: string) {
  return browserAct(sessionId, act, caller)
}

export function pooledBrowserClose(sessionId: string, caller?: string) {
  return browserClose(sessionId, caller)
}

export function pooledBrowserScreenshot(sessionId: string, options: { fullPage?: boolean } = {}, caller?: string) {
  return browserScreenshot(sessionId, options, caller)
}

export { browserPoolStats } from './pool.js'
