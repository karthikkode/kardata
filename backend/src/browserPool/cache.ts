// Browser-pool caches: query pages and fetched documents with TTLs.
// Why this answers the 100-subagent question: overlapping agents on one
// sector ask the same queries and re-read the same URLs. The first agent
// pays the leg; the other 99 hit memory. Pagination cursors
// (query + count + page) live here, never in a worker slot, so page 2
// never redoes page 1 and a released slot never takes progress with it.
// RAM is bounded: 500 entries per cache, FIFO eviction, no bodies held
// past TTL (query 5 min, document 10 min).
const BROWSER_QUERY_TTL_MS = 5 * 60_000
const BROWSER_DOC_TTL_MS = 10 * 60_000
const MAX_ENTRIES = 500

/** Search hit as cached: via/engine tags ride along so the ledger never
 * mistakes a cached fallback hit for a keyed one. */
export interface CachedSearchHit {
  title: string
  url: string
  snippet: string
  via?: 'keyed' | 'keyless' | 'browser'
  engine?: string
}

/** Fetched document as cached: the full leg result, so a cache hit is
 * indistinguishable from a fresh fetch (same url, status, content type). */
export interface CachedDoc {
  url: string
  status: number
  contentType: string
  text: string
  truncated: boolean
}

interface Entry<T> {
  value: T
  expiresAt: number
}

const queryCache = new Map<string, Entry<CachedSearchHit[]>>()
const docCache = new Map<string, Entry<CachedDoc>>()
const inflight = new Map<string, Promise<unknown>>()

function prune<T>(map: Map<string, Entry<T>>): void {
  while (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next()
    if (oldest.done) return
    map.delete(oldest.value)
  }
}

/** Query cursor key: normalized text + count + page. Page N never redoes
 * pages before it; each page caches independently. */
export function queryCacheKey(query: string, count: number, page: number): string {
  return `${query.trim().replace(/\s+/g, ' ').toLowerCase()}|${count}|${page}`
}

/** Normalize a URL for dedup: lowercase host, drop default ports and
 * tracking params, sort the rest, strip trailing slash and fragment.
 * Unparseable input keys on its trimmed text; legs still validate. */
export function normalizeBrowserUrl(raw: string): string {
  const trimmed = raw.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return trimmed
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return trimmed
  parsed.hostname = parsed.hostname.toLowerCase()
  if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = ''
  }
  const kept: Array<[string, string]> = []
  for (const [key, value] of parsed.searchParams) {
    const lower = key.toLowerCase()
    if (lower === 'fbclid' || lower === 'gclid' || lower === 'gclsrc' || lower === 'msclkid' || lower.startsWith('utm_')) continue
    kept.push([key, value])
  }
  kept.sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
  parsed.search = ''
  for (const [key, value] of kept) parsed.searchParams.append(key, value)
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) parsed.pathname = parsed.pathname.slice(0, -1)
  parsed.hash = ''
  return parsed.toString()
}

export function getCachedQuery(key: string, nowMs: number = Date.now()): CachedSearchHit[] | undefined {
  const entry = queryCache.get(key)
  if (!entry || entry.expiresAt <= nowMs) {
    if (entry) queryCache.delete(key)
    return undefined
  }
  return entry.value
}

export function setCachedQuery(key: string, hits: CachedSearchHit[], nowMs: number = Date.now(), ttlMs: number = BROWSER_QUERY_TTL_MS): void {
  queryCache.set(key, { value: hits, expiresAt: nowMs + ttlMs })
  prune(queryCache)
}

export function getCachedDoc(url: string, nowMs: number = Date.now()): CachedDoc | undefined {
  const normalized = normalizeBrowserUrl(url)
  const entry = docCache.get(normalized)
  if (!entry || entry.expiresAt <= nowMs) {
    if (entry) docCache.delete(normalized)
    return undefined
  }
  return entry.value
}

export function setCachedDoc(url: string, doc: CachedDoc, nowMs: number = Date.now(), ttlMs: number = BROWSER_DOC_TTL_MS): void {
  docCache.set(normalizeBrowserUrl(url), { value: doc, expiresAt: nowMs + ttlMs })
  prune(docCache)
}

/** In-flight dedup: concurrent identical requests share one leg call.
 * The entry clears on settle, so failures never poison later requests. */
export function dedupInflight<T>(key: string, work: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined
  if (running) return running
  const task = work().then(
    (value) => {
      if (inflight.get(key) === task) inflight.delete(key)
      return value
    },
    (error: unknown) => {
      if (inflight.get(key) === task) inflight.delete(key)
      throw error
    },
  )
  inflight.set(key, task)
  return task
}

/** Hermetic reset for tests. */
export function clearBrowserCacheForTests(): void {
  queryCache.clear()
  docCache.clear()
  inflight.clear()
}
