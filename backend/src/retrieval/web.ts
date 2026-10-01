// Web retrieval for hound-grade discovery: real search, real fetch, real
// browser sessions. No stubs, no fixtures: search fails closed without a
// key, fetch enforces caps and SSRF guards, browser sessions need a local
// Chromium. Pure validation plus injectable fetch keep this unit-tested
// without network.
import { z } from 'zod'
import { createLogger, logOp } from '../observability/logging.js'
import { sourceHtmlText } from './html.js'

export type RetrievalCode = 'validation_failed' | 'unconfigured' | 'blocked' | 'fetch_failed' | 'overload'

/** Retrieval failure: the MCP invoker maps the code into the isError
 * envelope so agents see actionable text, never a throw. */
export class RetrievalError extends Error {
  readonly code: RetrievalCode
  constructor(code: RetrievalCode, message: string) {
    super(message)
    this.code = code
  }
}

export interface SearchHit {
  title: string
  url: string
  snippet: string
}

const QuerySchema = z.string().trim().min(2).max(300)
const UrlSchema = z.string().trim().min(1).max(2000)

export type FetchImpl = typeof fetch

/** Largest fetched body: discovery reads pages, not archives. */
export const WEB_FETCH_MAX_BYTES = 2 * 1024 * 1024
/** Per-fetch deadline: slow hosts fail fast, the sweep moves on. */
export const WEB_FETCH_TIMEOUT_MS = 15_000

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.169.254',
  'metadata.google.internal',
])

function validatedUrl(raw: string): URL {
  if (!UrlSchema.safeParse(raw).success) throw new RetrievalError('validation_failed', 'url must be non-empty')
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new RetrievalError('validation_failed', `not a URL: ${raw}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new RetrievalError('blocked', `only http(s) fetch, not ${parsed.protocol}`)
  }
  if (parsed.username || parsed.password) throw new RetrievalError('blocked', 'credential-bearing URLs are not public source requests')
  if (BLOCKED_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new RetrievalError('blocked', `refusing to fetch ${parsed.hostname}`)
  }
  return parsed
}


export interface FetchResult {
  url: string
  status: number
  contentType: string
  text: string
  truncated: boolean
}

/** Real HTTP fetch with caps and guards. fetchImpl is injectable so tests
 * run against a local server-shaped double, never the open internet. */
const fetchLogger = createLogger({ op: 'retrieval.fetch' })
function discardBody(response: Response): void {
  if (response.body) void response.body.cancel().catch(() => fetchLogger.warn({ event: 'retrieval.fetch.cleanup.error', code: 'body_cancel_failed' }))
}

/** Headers, redirect chain and streaming body share one deadline/byte budget. */
export async function webFetch(rawUrl: string, fetchImpl: FetchImpl = fetch): Promise<FetchResult> {
  return logOp(fetchLogger, 'retrieval.fetch', async () => {
    let current = validatedUrl(rawUrl)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS)
    let rejectAbort: (() => void) | undefined
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(new RetrievalError('fetch_failed', 'Public source fetch deadline exceeded'))
      controller.signal.addEventListener('abort', rejectAbort, { once: true })
    })
    try {
      for (let redirects = 0; redirects <= 5; redirects++) {
        const headers = fetchImpl(current.toString(), { redirect: 'manual', signal: controller.signal }).then((response) => {
          if (controller.signal.aborted) discardBody(response)
          return response
        })
        const response = await Promise.race([headers, aborted])
        if ([301,302,303,307,308].includes(response.status)) {
          discardBody(response)
          if (redirects === 5) throw new RetrievalError('fetch_failed', 'Source redirect limit exceeded')
          const location = response.headers.get('location')
          if (!location) throw new RetrievalError('fetch_failed', 'Source redirect missing destination')
          current = validatedUrl(new URL(location, current).toString())
          continue
        }
        if (!response.ok) { discardBody(response); throw new RetrievalError('fetch_failed', `Source returned HTTP ${response.status}`) }
        const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
        if (contentType && !contentType.startsWith('text/') && contentType !== 'application/xhtml+xml' && contentType !== 'application/xml') {
          discardBody(response)
          throw new RetrievalError('blocked', 'Source is not text content')
        }
        const declaredBytes = Number(response.headers.get('content-length') ?? 0)
        if (declaredBytes > WEB_FETCH_MAX_BYTES) { discardBody(response); throw new RetrievalError('fetch_failed', 'Source exceeds byte limit') }
        const reader = response.body?.getReader()
        const chunks: Uint8Array[] = []
        let bytes = 0
        if (reader) {
          try {
            for (;;) {
              const chunk = await Promise.race([reader.read(), aborted])
              if (chunk.done) break
              bytes += chunk.value.byteLength
              if (bytes > WEB_FETCH_MAX_BYTES) throw new RetrievalError('fetch_failed', 'Source exceeds byte limit')
              chunks.push(chunk.value)
            }
          } catch (error) {
            void reader.cancel().catch(() => fetchLogger.warn({ event: 'retrieval.fetch.cleanup.error', code: 'body_cancel_failed' }))
            throw error
          } finally { reader.releaseLock() }
        }
        const buffer = new Uint8Array(bytes)
        let offset = 0
        for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength }
        const body = new TextDecoder().decode(buffer)
        const text = contentType.includes('html') || contentType === '' ? sourceHtmlText(body) : body.trim()
        return { url: current.toString(), status: response.status, contentType: contentType || 'text/plain', text, truncated: false }
      }
      throw new RetrievalError('fetch_failed', 'Source redirect limit exceeded')
    } catch (error) {
      if (error instanceof RetrievalError) throw error
      throw new RetrievalError('fetch_failed', 'Public source fetch failed')
    } finally {
      clearTimeout(timer)
      if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort)
      controller.abort()
    }
  })
}

export interface SearchEnv {
  KARDATA_WEB_SEARCH_KEY?: string
  KARDATA_WEB_SEARCH_URL?: string
}

/** Brave-compatible web search. Fails closed without a key (same posture
 * as the Meta provider probe): agents see `unconfigured`, never an empty
 * list pretending to be exhaustive. */
export async function webSearch(
  env: SearchEnv,
  query: string,
  options: { count?: number; page?: number; fetchImpl?: FetchImpl } = {},
): Promise<SearchHit[]> {
  if (!QuerySchema.safeParse(query).success) {
    throw new RetrievalError('validation_failed', 'query must be 2-300 characters')
  }
  const key = env.KARDATA_WEB_SEARCH_KEY?.trim()
  if (!key) throw new RetrievalError('unconfigured', 'web search unconfigured: set KARDATA_WEB_SEARCH_KEY')
  const endpoint = env.KARDATA_WEB_SEARCH_URL?.trim() || 'https://api.search.brave.com/res/v1/web/search'
  const count = Math.min(Math.max(options.count ?? 10, 1), 20)
  const offset = (options.page ?? 0) * count
  const url = `${endpoint}?q=${encodeURIComponent(query.trim())}&count=${count}&offset=${offset}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS)
  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': key },
      signal: controller.signal,
    })
  } catch (error) {
    throw new RetrievalError('fetch_failed', `search failed: ${error instanceof Error ? error.message : 'unknown'}`)
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) throw new RetrievalError('fetch_failed', `search answered ${response.status}`)
  const body = (await response.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> }
  }
  return (body.web?.results ?? []).flatMap((result) => {
    if (!result.url || !result.title) return []
    return [{ title: result.title, url: result.url, snippet: result.description ?? '' }]
  })
}
