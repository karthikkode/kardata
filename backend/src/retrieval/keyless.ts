// Keyless search pool (hound-style fallback): no-key HTML search engines
// for the sweep's degraded leg. Direct HTTP to these endpoints is
// routinely challenged (bot walls, 403s, anomaly modals) — each engine is
// best-effort and skipped on any failure, and the sweep falls through to
// the real-Chromium browser leg when the pool yields nothing. Hits carry
// their engine so the ledger never mistakes them for keyed results.
import { z } from 'zod'
import {
  RetrievalError,
  WEB_FETCH_TIMEOUT_MS,
  type FetchImpl,
  type SearchHit,
} from './web.js'

const QuerySchema = z.string().trim().min(2).max(300)

/** Keyless hits name their engine; keyed hits leave it absent. */
export interface KeylessHit extends SearchHit {
  engine: string
}

/** Largest keyless body: result pages, never archives. */
export const KEYLESS_MAX_BYTES = 512 * 1024

const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const CHALLENGE = /anomaly-modal|captcha|challenge|cf-chl|enable js/i

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** DuckDuckGo wraps result hrefs: //duckduckgo.com/l/?...&uddg=<urlencoded>. */
function unwrapDdg(href: string): string {
  const direct = href.startsWith('//') ? `https:${href}` : href
  let parsed: URL
  try {
    parsed = new URL(direct)
  } catch {
    return href
  }
  if (!parsed.hostname.endsWith('duckduckgo.com')) return direct
  const uddg = parsed.searchParams.get('uddg')
  return uddg ?? direct
}

function hostOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return ''
  }
}

interface Engine {
  name: string
  internalHosts: string[]
  buildUrl: (query: string, offset: number) => string
  parse: (html: string) => Array<{ title: string; url: string; snippet: string }>
}

/** Ordered anchor/zip parse: result links in document order, snippets in
 * document order, zipped by position. Missing snippets stay empty. */
function zipAnchors(
  html: string,
  anchorPattern: RegExp,
  snippetPattern: RegExp,
  internalHosts: string[],
  limit: number,
): Array<{ title: string; url: string; snippet: string }> {
  const links: Array<{ title: string; url: string }> = []
  for (const match of html.matchAll(anchorPattern)) {
    const rawHref = (match[1] ?? '').replace(/&amp;/g, '&')
    const url = unwrapDdg(rawHref)
    if (!url.startsWith('http://') && !url.startsWith('https://')) continue
    if (internalHosts.some((host) => hostOf(url).endsWith(host))) continue
    const title = stripTags(match[2] ?? '').slice(0, 200)
    if (!title) continue
    if (links.some((link) => link.url === url)) continue
    links.push({ title, url })
    if (links.length >= limit) break
  }
  const snippets: string[] = []
  for (const match of html.matchAll(snippetPattern)) {
    snippets.push(stripTags(match[1] ?? '').slice(0, 600))
  }
  return links.map((link, index) => ({ ...link, snippet: snippets[index] ?? '' }))
}

const ENGINES: Engine[] = [
  {
    name: 'duckduckgo',
    internalHosts: ['duckduckgo.com'],
    buildUrl: (query, offset) =>
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}${offset > 0 ? `&s=${offset}` : ''}`,
    parse: (html) =>
      zipAnchors(
        html,
        /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
        /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi,
        ['duckduckgo.com'],
        20,
      ),
  },
  {
    name: 'duckduckgo-lite',
    internalHosts: ['duckduckgo.com', 'lite.duckduckgo.com'],
    buildUrl: (query) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    parse: (html) =>
      zipAnchors(
        html,
        /<a[^>]*rel="nofollow"[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
        /<td[^>]*class=['"]?result-snippet['"]?[^>]*>([\s\S]*?)<\/td>/gi,
        ['duckduckgo.com', 'lite.duckduckgo.com'],
        20,
      ),
  },
  {
    name: 'mojeek',
    internalHosts: ['mojeek.com', 'www.mojeek.com'],
    buildUrl: (query, offset) =>
      `https://www.mojeek.com/search?q=${encodeURIComponent(query)}${offset > 0 ? `&s=${offset}` : ''}`,
    parse: (html) =>
      zipAnchors(
        html,
        /<a[^>]*class="title"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
        /<p[^>]*class="s"[^>]*>([\s\S]*?)<\/p>/gi,
        ['mojeek.com', 'www.mojeek.com'],
        20,
      ),
  },
]

/** Best-effort keyless search across the engine pool. Returns the first
 * non-empty engine result; every engine is skipped on network failure,
 * non-HTML answers, challenge pages, or zero parsed hits. Throws only
 * when the whole pool yields nothing. fetchImpl is injectable so tests
 * run on fixtures, never the open internet. */
export async function keylessSearch(
  rawQuery: string,
  options: { count?: number; page?: number; fetchImpl?: FetchImpl } = {},
): Promise<KeylessHit[]> {
  const parsed = QuerySchema.safeParse(rawQuery)
  if (!parsed.success) throw new RetrievalError('validation_failed', 'query must be 2-300 characters')
  const query = parsed.data
  const count = Math.min(Math.max(options.count ?? 10, 1), 20)
  const offset = (options.page ?? 0) * count
  const fetchImpl = options.fetchImpl ?? fetch

  for (const engine of ENGINES) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS)
      let response: Response
      try {
        response = await fetchImpl(engine.buildUrl(query, offset), {
          headers: { Accept: 'text/html', 'User-Agent': BROWSER_UA },
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }
      if (!response.ok) continue
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
      if (contentType && !contentType.includes('html')) continue
      const buffer = new Uint8Array(await response.arrayBuffer())
      if (buffer.length > KEYLESS_MAX_BYTES) continue
      const html = new TextDecoder().decode(buffer)
      if (CHALLENGE.test(html)) continue
      const hits = engine
        .parse(html)
        .slice(0, count)
        .map((hit) => ({ ...hit, engine: engine.name }))
      if (hits.length > 0) return hits
    } catch {
      continue
    }
  }
  throw new RetrievalError(
    'fetch_failed',
    'keyless search returned no results (engines may be rate-limiting automated search)',
  )
}
