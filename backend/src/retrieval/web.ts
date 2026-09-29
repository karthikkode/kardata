// Web retrieval for hound-grade discovery: real search, real fetch, real
// browser sessions. No stubs, no fixtures: search fails closed without a
// key, fetch enforces caps and SSRF guards, browser sessions need a local
// Chromium. Pure validation plus injectable fetch keep this unit-tested
// without network.
import { z } from 'zod'

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
  if (BLOCKED_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new RetrievalError('blocked', `refusing to fetch ${parsed.hostname}`)
  }
  return parsed
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
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
export async function webFetch(rawUrl: string, fetchImpl: FetchImpl = fetch): Promise<FetchResult> {
  const parsed = validatedUrl(rawUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetchImpl(parsed.toString(), { redirect: 'follow', signal: controller.signal })
  } catch (error) {
    throw new RetrievalError('fetch_failed', `fetch failed for ${parsed.hostname}: ${error instanceof Error ? error.message : 'unknown'}`)
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) throw new RetrievalError('fetch_failed', `fetch ${response.status} for ${parsed.toString()}`)
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (contentType && !contentType.startsWith('text/') && contentType !== 'application/xhtml+xml' && contentType !== 'application/xml') {
    throw new RetrievalError('blocked', `refusing non-text content: ${contentType || 'unknown'}`)
  }
  const buffer = new Uint8Array(await response.arrayBuffer())
  if (buffer.length > WEB_FETCH_MAX_BYTES) {
    throw new RetrievalError('fetch_failed', `page exceeds ${WEB_FETCH_MAX_BYTES} bytes`)
  }
  const body = new TextDecoder().decode(buffer)
  const text = contentType.includes('html') || contentType === '' ? stripHtml(body) : body.trim()
  return { url: parsed.toString(), status: response.status, contentType: contentType || 'text/plain', text, truncated: false }
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
