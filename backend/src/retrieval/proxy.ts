// Execution-only public browsing transport on the existing HTTP listener.
// No API/database authority travels on these short-lived network credentials.
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { connect, type Socket } from 'node:net'
import { request as httpRequest, type IncomingMessage, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Logger } from 'pino'
import type { BrowserContext, Page, CDPSession } from 'playwright-core'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createLogger, logOp } from '../observability/logging.js'
import { publicSourceUrl, resolvePublicSource, RetrievalError } from './web.js'

declare module 'fastify' { interface FastifyRequest { kardataBrowserProxy?: boolean } }

export const BROWSER_PROXY_LIFETIME_MS = 30 * 60_000
const Claims = z.object({ v: z.literal(1), at: z.number().int(), nonce: z.string().uuid(), caller: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const logger = createLogger({ op: 'browser.proxy' })
const DOMAIN = 'kardata-public-browser-proxy-v1:'
export interface ProxyEnvironment { KARDATA_BROWSER_PROXY_URL?: string; KARDATA_MCP_TOKEN?: string }

/** Called only by trusted browser execution; no model-selected configuration. */
export function browserProxyCredentials(caller: string | undefined, env: ProxyEnvironment = process.env, correlation?: Logger) {
  const secret = env.KARDATA_MCP_TOKEN
  if (!secret || secret.length < 16) throw new RetrievalError('unconfigured', 'Browser network signing is unconfigured')
  let url: URL
  try { url = new URL(env.KARDATA_BROWSER_PROXY_URL ?? '') }
  catch { throw new RetrievalError('unconfigured', 'Browser network proxy is unconfigured') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new RetrievalError('unconfigured', 'Browser network proxy configuration is invalid')
  const nonce = randomUUID(), callerHash = createHash('sha256').update(caller ?? 'internal-anonymous').digest('hex')
  const username = Buffer.from(JSON.stringify({ v: 1, at: Date.now(), nonce, caller: callerHash })).toString('base64url')
  const password = createHmac('sha256', secret).update(DOMAIN + username).digest('hex')
  correlation?.info({ event: 'browser.proxy.issued', capability: createHash('sha256').update(nonce).digest('hex'), caller: callerHash })
  return { server: url.origin, username, password, bypass: '<-loopback>' }
}

/** Authenticate only challenges from our actual proxy. Playwright's ordinary
 * proxy credential option also installs unscoped site HTTP credentials; using
 * that option would disclose the capability to a site's WWW-Authenticate. */
export function configureBrowserProxyContext(context: BrowserContext, proxy: ReturnType<typeof browserProxyCredentials>) {
  const pages = new WeakMap<Page, Promise<CDPSession>>()
  function attach(page: Page): Promise<CDPSession> {
    const existing = pages.get(page)
    if (existing) return existing
    const setup = (async () => {
      const session = await context.newCDPSession(page)
      const attempted = new Set<string>()
      const send = (method: 'Fetch.continueRequest' | 'Fetch.continueWithAuth', args: { requestId: string; authChallengeResponse?: { response: 'ProvideCredentials' | 'CancelAuth'; username?: string; password?: string } }) => {
        void session.send(method, args).catch(() => {
          logger.error({ event: 'browser.proxy.auth.error', code: 'browser_protocol_failed' })
          void page.close().catch(() => logger.error({ event: 'browser.proxy.auth.error', code: 'page_cleanup_uncertain' }))
        })
      }
      session.on('Fetch.requestPaused', (event) => send('Fetch.continueRequest', { requestId: event.requestId }))
      session.on('Fetch.authRequired', (event) => {
        const challenge = event.authChallenge
        let trusted: boolean
        try { const origin = new URL(challenge.origin); trusted = challenge.source === 'Proxy' && origin.origin === proxy.server && origin.pathname === '/' && !origin.username && !origin.password && !origin.search && !origin.hash }
        catch { trusted = false }
        const provide = trusted && !attempted.has(event.requestId)
        if (attempted.size >= 1024) { send('Fetch.continueWithAuth', { requestId: event.requestId, authChallengeResponse: { response: 'CancelAuth' } }); return }
        attempted.add(event.requestId)
        send('Fetch.continueWithAuth', { requestId: event.requestId, authChallengeResponse: provide ? { response: 'ProvideCredentials', username: proxy.username, password: proxy.password } : { response: 'CancelAuth' } })
      })
      await session.send('Fetch.enable', { handleAuthRequests: true, patterns: [{ urlPattern: '*' }] })
      return session
    })()
    pages.set(page, setup)
    return setup
  }
  context.on('page', (page) => {
    void attach(page).catch(() => {
      logger.error({ event: 'browser.proxy.auth.error', code: 'browser_auth_setup_failed' })
      void page.close().catch(() => logger.error({ event: 'browser.proxy.auth.error', code: 'page_cleanup_uncertain' }))
    })
  })
  return attach
}

function identity(header: string | undefined, secret: string | undefined): { nonce: string; caller: string } {
  if (!secret || secret.length < 16 || !header?.startsWith('Basic ') || header.length > 2048) throw new RetrievalError('blocked', 'Browser proxy authentication required')
  const decoded = Buffer.from(header.slice(6), 'base64').toString()
  const split = decoded.indexOf(':')
  const username = decoded.slice(0, split), signature = decoded.slice(split + 1)
  if (split < 1 || !/^[a-f0-9]{64}$/.test(signature)) throw new RetrievalError('blocked', 'Browser proxy authentication invalid')
  const expected = createHmac('sha256', secret).update(DOMAIN + username).digest()
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new RetrievalError('blocked', 'Browser proxy authentication invalid')
  let parsed: unknown
  try { parsed = JSON.parse(Buffer.from(username, 'base64url').toString()) }
  catch { throw new RetrievalError('blocked', 'Browser proxy authentication invalid') }
  const claims = Claims.safeParse(parsed)
  if (!claims.success || claims.data.at > Date.now() + 30_000 || Date.now() - claims.data.at >= BROWSER_PROXY_LIFETIME_MS) throw new RetrievalError('blocked', 'Browser proxy authentication expired')
  return { nonce: claims.data.nonce, caller: claims.data.caller }
}

export interface BrowserProxyOptions {
  secret?: string
  maxConnections?: number
  perCapability?: number
  connectMs?: number
  idleMs?: number
  lifetimeMs?: number
  maxBytes?: number
  /** Isolated tests may replace network legs, never HTTP/model arguments. */
  resolve?: typeof resolvePublicSource
  connect?: (address: string, port: number) => Socket
  http?: typeof httpRequest
}

/** HTTP and CONNECT share admission, limits and owned-resource supervision. */
export function registerBrowserProxy(app: FastifyInstance, options: BrowserProxyOptions = {}) {
  const limits = { max: options.maxConnections ?? 128, per: options.perCapability ?? 16, connect: options.connectMs ?? 15_000, idle: options.idleMs ?? 60_000, life: options.lifetimeMs ?? 120_000, bytes: options.maxBytes ?? 2 * 1024 * 1024 }
  if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1) || limits.max > 128 || limits.per > 16 || limits.bytes > 2 * 1024 * 1024) throw new RetrievalError('unconfigured', 'Browser proxy limits are invalid')
  const capabilities = new Map<string, number>()
  const operations = new Set<() => void>()
  const clients = new Set<Duplex>()
  const resolve = options.resolve ?? resolvePublicSource
  const socketConnect = options.connect ?? ((address, port) => connect({ host: address, port }))
  const secret = () => options.secret ?? process.env['KARDATA_MCP_TOKEN']
  let closing = false
  function reserve(id: string) {
    const used = capabilities.get(id) ?? 0
    if (closing || operations.size >= limits.max || used >= limits.per) throw new RetrievalError('overload', 'Browser proxy capacity exceeded')
    capabilities.set(id, used + 1)
    let released = false
    return () => { if (released) return; released = true; const next = (capabilities.get(id) ?? 1) - 1; if (next) capabilities.set(id, next); else capabilities.delete(id) }
  }
  function target(raw: string, tunnel: boolean) {
    const url = publicSourceUrl(tunnel ? `https://${raw}/` : raw)
    if (tunnel && (url.pathname !== '/' || url.search || url.hash)) throw new RetrievalError('blocked', 'Invalid browser tunnel authority')
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
    if (![80, 443].includes(port)) throw new RetrievalError('blocked', 'Browser destination port denied')
    if (!tunnel && url.protocol !== 'http:') throw new RetrievalError('blocked', 'HTTPS must use a browser tunnel')
    return { url, port }
  }
  async function operation(req: IncomingMessage, client: Duplex, response: ServerResponse | undefined, head: Buffer) {
    let abortTransport: ((error: Error) => void) | undefined
    client.on('error', () => {
      logger.error({ event: 'browser.proxy.client.error', code: 'client_socket_failed' })
      abortTransport?.(new RetrievalError('fetch_failed', 'Browser client socket failed'))
      client.destroy()
    })
    const clientClosed = new Promise<void>((resolve) => { if (client.destroyed) resolve(); else client.once('close', () => resolve()) })
    const refused = clients.size >= limits.max
    clients.add(client)
    let release: (() => void) | undefined
    let stop: (() => void) | undefined
    let replied = false
    let failure: unknown
    const failResponse = (status: number) => {
      if (replied || client.destroyed) return
      replied = true
      if (response) { response.writeHead(status, { 'Proxy-Authenticate': 'Basic realm="Kardata public browser"', Connection: 'close' }); response.end(() => client.destroy()) }
      else client.end(`HTTP/1.1 ${status} Proxy request refused\r\nProxy-Authenticate: Basic realm="Kardata public browser"\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => client.destroy())
    }
    try {
      if (refused) throw new RetrievalError('overload', 'Browser proxy connection capacity exceeded')
      const id = identity(typeof req.headers['proxy-authorization'] === 'string' ? req.headers['proxy-authorization'] : undefined, secret())
      release = reserve(id.nonce)
      await logOp(logger, 'browser.proxy.transport', () => new Promise<void>((complete, reject) => {
        let done = false, upstream: Socket | ReturnType<typeof httpRequest> | undefined, incoming: IncomingMessage | undefined
        let idle: ReturnType<typeof setTimeout>
        const finish = (error?: Error) => {
          if (done) return
          done = true
          clearTimeout(deadline); clearTimeout(lifetime); clearTimeout(idle)
          client.removeListener('close', cancelled)
          upstream?.destroy(); incoming?.destroy()
          if (error) { if (replied) client.destroy(); else failResponse(error instanceof RetrievalError && error.code === 'overload' ? 503 : 502); reject(error) }
          else complete()
        }
        abortTransport = finish
        const cancelled = () => finish(new RetrievalError('fetch_failed', 'Browser connection cancelled'))
        const tick = () => { clearTimeout(idle); idle = setTimeout(() => finish(new RetrievalError('fetch_failed', 'Browser connection idle deadline')), limits.idle) }
        const deadline = setTimeout(() => finish(new RetrievalError('fetch_failed', 'Browser connection deadline')), limits.connect)
        const lifetime = setTimeout(() => finish(new RetrievalError('fetch_failed', 'Browser connection lifetime exceeded')), limits.life)
        tick()
        stop = () => finish(new RetrievalError('fetch_failed', 'Browser proxy shutting down'))
        operations.add(stop)
        client.once('close', cancelled)
        if (client.destroyed) { cancelled(); return }
        if (head.length > limits.bytes) { finish(new RetrievalError('fetch_failed', 'Browser tunnel byte limit')); return }
        let destination: ReturnType<typeof target>
        try { destination = target(req.url ?? '', !response) }
        catch (error) { finish(error instanceof Error ? error : new RetrievalError('blocked', 'Invalid browser target')); return }
        void resolve(destination.url).then((addresses) => {
          if (done) return
          for (const address of addresses) publicSourceUrl(`http://${address.family === 6 ? `[${address.address}]` : address.address}/`)
          const checked = addresses[0]
          if (!checked) throw new RetrievalError('blocked', 'Browser destination unresolved')
          if (!response) {
            const socket = socketConnect(checked.address, destination.port)
            upstream = socket
            let received = 0, sent = head.length
            const count = (bytes: number, direction: 'in' | 'out') => {
              tick()
              if (direction === 'in') received += bytes; else sent += bytes
              if (received > limits.bytes || sent > limits.bytes) finish(new RetrievalError('fetch_failed', 'Browser tunnel byte limit'))
            }
            socket.once('error', (error) => finish(error))
            socket.once('connect', () => {
              if (done) { socket.destroy(); return }
              clearTimeout(deadline); replied = true
              client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
              if (head.length) socket.write(head)
              client.on('data', (chunk: Buffer) => count(chunk.length, 'out'))
              socket.on('data', (chunk: Buffer) => count(chunk.length, 'in'))
              client.pipe(socket); socket.pipe(client)
            })
            socket.once('close', () => { if (!done) { client.end(() => client.destroy()); finish() } })
          } else {
            const headers: IncomingHttpHeaders = { ...req.headers, host: destination.url.host, connection: 'close' }
            delete headers['proxy-authorization']; delete headers['proxy-connection']
            const request = (options.http ?? httpRequest)(destination.url, { method: req.method, headers, agent: false, lookup: (_host, opts, callback) => opts.all ? callback(null, [checked]) : callback(null, checked.address, checked.family) }, (body) => {
              if (done) { body.destroy(); return }
              incoming = body; clearTimeout(deadline)
              const outputHeaders = { ...body.headers, connection: 'close' }
              delete outputHeaders['proxy-authenticate']; delete outputHeaders['proxy-authorization']
              replied = true; response.writeHead(body.statusCode ?? 502, outputHeaders)
              let received = 0
              body.on('data', (chunk: Buffer) => { tick(); received += chunk.length; if (received > limits.bytes) finish(new RetrievalError('fetch_failed', 'Browser response byte limit')) })
              body.on('error', finish)
              body.once('end', () => { response.end(() => client.destroy()); finish() })
              body.pipe(response, { end: false })
            })
            upstream = request
            let sent = 0
            req.on('data', (chunk: Buffer) => { tick(); sent += chunk.length; if (sent > limits.bytes) finish(new RetrievalError('fetch_failed', 'Browser request byte limit')) })
            req.on('error', finish); request.on('error', finish)
            req.pipe(request)
          }
        }).catch((error: unknown) => finish(error instanceof Error ? error : new RetrievalError('fetch_failed', 'Browser transport failed')))
      }), { capability: createHash('sha256').update(id.nonce).digest('hex'), caller: id.caller })
    } catch (error) {
      failure = error
      failResponse(error instanceof RetrievalError && error.code === 'overload' ? 503 : 407)
      logger.warn({ event: 'browser.proxy.denied', code: error instanceof RetrievalError ? error.code : 'fetch_failed' })
    } finally {
      // CONNECT peers may keep their write half open after our FIN. Supervise
      // teardown and retain accounting until the actual client close receipt.
      const flush = setTimeout(() => client.destroy(), Math.min(limits.idle, 1000))
      await clientClosed
      clearTimeout(flush)
      clients.delete(client)
      if (stop) operations.delete(stop)
      release?.()
    }
    if (failure) throw failure
  }
  const transport = (req: IncomingMessage, socket: Duplex, response: ServerResponse | undefined, head: Buffer) => logOp(logger, 'browser.proxy.request', () => operation(req, socket, response, head)).catch(() => undefined) // Protocol boundary has already delivered refusal and closed its socket.
  const tunnel = (req: IncomingMessage, socket: Duplex, head: Buffer) => { void transport(req, socket, undefined, head) }
  app.server.on('connect', tunnel)
  app.addHook('onRequest', async (request, reply) => {
    if (!/^https?:\/\//i.test(request.raw.url ?? '')) return
    request.kardataBrowserProxy = true
    reply.hijack()
    await transport(request.raw, request.raw.socket, reply.raw, Buffer.alloc(0))
  })
  app.addHook('preClose', async () => { closing = true; for (const cancel of [...operations]) cancel(); for (const client of clients) client.destroy(); app.server.removeListener('connect', tunnel) })
  return { stats: () => ({ active: operations.size, connections: clients.size, capabilities: capabilities.size }) }
}
