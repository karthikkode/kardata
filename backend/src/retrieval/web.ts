// Web retrieval for hound-grade discovery: real search, real fetch, real
// browser sessions. No stubs, no fixtures: search fails closed without a
// key, fetch enforces caps and SSRF guards, browser sessions need a local
// Chromium. Pure validation plus injectable fetch keep this unit-tested
// without network.
import { z } from 'zod'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable, Transform, pipeline } from 'node:stream'
import { createLogger, logOp } from '../observability/logging.js'
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib'
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

// Built-in IP parsing covers IPv6 and normalized numeric IPv4 forms without
// another dependency. This is literal admission, not DNS/rebinding protection.
const nonPublicV4 = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) nonPublicV4.addSubnet(address, prefix)
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
const nonPublicV6 = new BlockList()
nonPublicV6.addSubnet('2001::', 23, 'ipv6')
nonPublicV6.addSubnet('2001:db8::', 32, 'ipv6')
nonPublicV6.addSubnet('2002::', 16, 'ipv6')

/** Shared syntactic/literal policy for source fetch and browser navigation. */
export function publicSourceUrl(raw: string): URL {
  if (!UrlSchema.safeParse(raw).success) throw new RetrievalError('validation_failed', 'url must be non-empty')
  let parsed: URL
  try { parsed = new URL(raw) }
  catch { throw new RetrievalError('validation_failed', 'Source URL is invalid') }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new RetrievalError('blocked', 'Only public http(s) sources are allowed')
  }
  if (parsed.username || parsed.password) throw new RetrievalError('blocked', 'Credential-bearing source URL denied')
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
  const family = isIP(hostname)
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'metadata.google.internal' ||
      (family === 4 && nonPublicV4.check(hostname)) ||
      (family === 6 && (!globalV6.check(hostname, 'ipv6') || nonPublicV6.check(hostname, 'ipv6')))) {
    throw new RetrievalError('blocked', 'Non-public source destination denied')
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

/** Resolve once and pin the connection, retaining the original Host/TLS name.
 * Merely checking DNS before ordinary fetch would permit a second lookup to
 * return a private address. Every redirect invokes this transport afresh. */
const sourceFetch: FetchImpl = async (input, init) => {
  const url = publicSourceUrl(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const family = isIP(host)
  const addresses = family ? [{ address: host, family }] : await lookup(host, { all: true, verbatim: true })
  if (!addresses.length) throw new RetrievalError('blocked', 'Source has no public DNS destination')
  for (const entry of addresses) {
    if (![4, 6].includes(entry.family) || isIP(entry.address) !== entry.family) throw new RetrievalError('blocked', 'Invalid source DNS destination')
    publicSourceUrl(`http://${entry.family === 6 ? `[${entry.address}]` : entry.address}/`)
  }
  if (init?.signal?.aborted) throw new RetrievalError('fetch_failed', 'Source fetch cancelled before connection')
  const selected = addresses[0]!
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, [selected])
    else callback(null, selected.address, selected.family)
  }
  return new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET', agent: false, lookup: pinnedLookup,
      ...(init?.signal ? { signal: init.signal } : {}),
      headers: { Accept: 'text/html,text/plain,application/xhtml+xml', 'Accept-Encoding': 'identity' },
    }, (incoming) => {
      const status = incoming.statusCode ?? 0
      const encoding = incoming.headers['content-encoding']?.toLowerCase()
      if (status < 200 || status > 599 || (encoding && !['identity', 'gzip', 'deflate', 'br'].includes(encoding))) {
        incoming.destroy()
        reject(new RetrievalError('blocked', 'Source response encoding or status unsupported'))
        return
      }
      const headers = new Headers()
      for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
      if (Number(incoming.headers['content-length'] ?? 0) > WEB_FETCH_MAX_BYTES) { incoming.destroy(); reject(new RetrievalError('fetch_failed', 'Source exceeds byte limit')); return }
      if ([204, 205, 304].includes(status)) {
        incoming.resume()
        resolve(new Response(null, { status, headers }))
      } else {
        let body: Readable = incoming
        if (encoding && encoding !== 'identity') {
          let rawBytes = 0
          const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
            rawBytes += chunk.length
            if (rawBytes > WEB_FETCH_MAX_BYTES) callback(new RetrievalError('fetch_failed', 'Encoded source exceeds byte limit'))
            else callback(null, chunk)
          } })
          const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'br' ? createBrotliDecompress() : createInflate()
          pipeline(incoming, limit, decoder, (error) => {
            if (error) fetchLogger.warn({ event: 'retrieval.fetch.decode.error', code: 'source_stream_failed' })
          })
          body = decoder
          headers.delete('content-encoding')
          headers.delete('content-length')
        }
        resolve(new Response(Readable.toWeb(body) as ReadableStream<Uint8Array>, { status, headers }))
      }
    })
    request.on('error', reject)
    request.end()
  })
}

/** Headers, redirect chain and streaming body share one deadline/byte budget. */
export async function webFetch(rawUrl: string, fetchImpl: FetchImpl = sourceFetch): Promise<FetchResult> {
  return logOp(fetchLogger, 'retrieval.fetch', async () => {
    let current = publicSourceUrl(rawUrl)
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
          current = publicSourceUrl(new URL(location, current).toString())
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
