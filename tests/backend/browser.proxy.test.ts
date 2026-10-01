import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, request, type Server } from 'node:http'
import { connect, type Socket } from 'node:net'
import { once } from 'node:events'
import { browserProxyCredentials, registerBrowserProxy, type BrowserProxyOptions } from '../../backend/src/retrieval/proxy.js'
const secret = 'TEST_BROWSER_PROXY_SECRET_NOT_A_REAL_KEY'
const resources: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of resources.splice(0).reverse()) await close(); vi.useRealTimers() })
async function fixture(body = 'TEST PUBLIC SOURCE') {
  const hits: string[] = []
  const server = createServer((req, res) => { hits.push(req.url ?? ''); res.end(body) }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  resources.push(() => closeServer(server))
  return { server, hits, port: (server.address() as { port: number }).port }
}
function closeServer(server: Server) { server.closeAllConnections(); return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
async function proxy(options: BrowserProxyOptions = {}) {
  const app = Fastify({ logger: false })
  const guard = registerBrowserProxy(app, { secret, ...options })
  app.get('/healthz', async () => ({ ok: true }))
  await app.listen({ port: 0, host: '127.0.0.1' })
  resources.push(() => app.close())
  const port = (app.server.address() as { port: number }).port
  const credentials = browserProxyCredentials('TEST caller', { KARDATA_MCP_TOKEN: secret, KARDATA_BROWSER_PROXY_URL: `http://127.0.0.1:${port}` })
  return { app, guard, port, auth: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}` }
}
async function get(port: number, path: string, authorization?: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: authorization ? { 'proxy-authorization': authorization } : {} }, (res) => {
      let body = ''; res.on('data', (chunk) => { body += String(chunk) }); res.on('end', () => resolve({ status: res.statusCode ?? 0, body })); res.on('error', reject)
    }); req.on('error', reject); req.end()
  })
}
function mappedHttp(upstreamPort: number): typeof request {
  return ((url: URL, options: Parameters<typeof request>[1], callback: Parameters<typeof request>[2]) => {
    // Only the test transport maps a checked public address into our owned fixture.
    return request({ ...(options as object), host: '127.0.0.1', hostname: '127.0.0.1', port: upstreamPort, path: url.pathname + url.search, lookup: undefined }, callback)
  }) as typeof request
}
describe('browser proxy production listener and admission', () => {
  it('keeps normal routes reachable and denies missing/tampered transport credentials', async () => {
    const resolve = vi.fn()
    const service = await proxy({ resolve })
    expect((await get(service.port, '/healthz')).status).toBe(200)
    expect((await get(service.port, 'http://public.example/')).status).toBe(407)
    expect((await get(service.port, 'http://public.example/', service.auth + 'bad')).status).toBe(407)
    expect(resolve).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(service.guard.stats()).toEqual({ active: 0, connections: 0, capabilities: 0 }))
  })
  it.each(['http://127.0.0.1/', 'http://[::1]/', 'http://192.168.2.3/', 'http://2130706433/', 'http://public.example:5432/'])('denies %s before outbound connection', async (url) => {
    const resolve = vi.fn()
    const service = await proxy({ resolve })
    expect((await get(service.port, url, service.auth)).status).toBeGreaterThanOrEqual(400)
    expect(resolve).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(service.guard.stats().active).toBe(0))
  })
  it('denies mixed/private DNS answers even before an injected connector', async () => {
    const connector = vi.fn()
    const service = await proxy({ resolve: async () => [{ address: '93.184.215.14', family: 4 }, { address: '10.0.0.1', family: 4 }], connect: connector })
    const req = request({ host: '127.0.0.1', port: service.port, method: 'CONNECT', path: 'public.example:443', headers: { 'proxy-authorization': service.auth } })
    const response = new Promise<number>((resolve, reject) => { req.on('connect', (res, socket) => { socket.destroy(); resolve(res.statusCode ?? 0) }); req.on('error', reject) })
    req.end()
    expect(await response).toBe(502)
    expect(connector).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(service.guard.stats().active).toBe(0))
  })
  it('forwards an admitted plain HTTP request without proxy credentials at the destination', async () => {
    const upstream = await fixture()
    const seen: string[] = []
    upstream.server.on('request', (req) => { expect(req.headers['proxy-authorization']).toBeUndefined(); seen.push(req.headers.host ?? '') })
    const service = await proxy({ resolve: async () => [{ address: '93.184.215.14', family: 4 }], http: mappedHttp(upstream.port) })
    const result = await get(service.port, 'http://public.example/evidence', service.auth)
    expect(result).toEqual({ status: 200, body: 'TEST PUBLIC SOURCE' })
    expect(upstream.hits).toEqual(['/evidence'])
    expect(seen).toEqual(['public.example'])
    await vi.waitFor(() => expect(service.guard.stats()).toEqual({ active: 0, connections: 0, capabilities: 0 }))
  })
  it('bounds a hung DNS admission and never connects when it later resolves', async () => {
    let finish!: (addresses: Array<{ address: string; family: number }>) => void
    const http = vi.fn()
    const service = await proxy({ connectMs: 30, http, resolve: () => new Promise((resolve) => { finish = resolve }) })
    expect((await get(service.port, 'http://public.example/', service.auth)).status).toBe(502)
    finish([{ address: '93.184.215.14', family: 4 }])
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(http).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(service.guard.stats()).toEqual({ active: 0, connections: 0, capabilities: 0 }))
  })
  it('closes refused raw CONNECT server sockets even if the peer keeps its write half open', async () => {
    const service = await proxy({ idleMs: 100 })
    let accepted!: Socket
    const closed = new Promise<void>((resolve) => service.app.server.once('connection', (socket) => { accepted = socket; socket.once('close', resolve) }))
    const socket = connect({ host: '127.0.0.1', port: service.port, allowHalfOpen: true })
    socket.on('error', () => undefined); socket.resume()
    resources.push(async () => { socket.destroy() })
    await once(socket, 'connect')
    socket.write('CONNECT public.example:443 HTTP/1.1\r\nHost: public.example\r\n\r\n')
    await closed
    expect(accepted.destroyed).toBe(true)
    await vi.waitFor(() => expect(service.guard.stats().connections).toBe(0))
    await vi.waitFor(() => expect(service.guard.stats().active).toBe(0))
  })

  it('supervises errors on accepted CONNECT sockets before and during transport work', async () => {
    const service = await proxy({ resolve: () => new Promise(() => undefined) })
    let accepted!: Socket
    const serverClosed = new Promise<void>((resolve) => service.app.server.once('connection', (socket) => { accepted = socket; socket.once('close', resolve) }))
    service.app.server.once('connect', () => {
      expect(() => accepted.emit('error', new Error('TEST accepted socket reset'))).not.toThrow()
    })
    const peer = connect({ host: '127.0.0.1', port: service.port, allowHalfOpen: true })
    peer.on('error', () => undefined); peer.resume()
    resources.push(async () => { peer.destroy() })
    await once(peer, 'connect')
    peer.write(`CONNECT public.example:443 HTTP/1.1\r\nHost: public.example\r\nProxy-Authorization: ${service.auth}\r\n\r\n`)
    await serverClosed
    await vi.waitFor(() => expect(service.guard.stats()).toEqual({ active: 0, connections: 0, capabilities: 0 }))
    expect(() => accepted.emit('error', new Error('TEST late socket error'))).not.toThrow()
  })

  it('rejects an expired capability before DNS admission', async () => {
    const resolve = vi.fn()
    const service = await proxy({ resolve })
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60_000)
    expect((await get(service.port, 'http://public.example/', service.auth)).status).toBe(407)
    expect(resolve).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
  it('bounds an oversized response and closes its client instead of reporting completion', async () => {
    const upstream = await fixture('x'.repeat(4096))
    const service = await proxy({ maxBytes: 128, resolve: async () => [{ address: '93.184.215.14', family: 4 }], http: mappedHttp(upstream.port) })
    await expect(get(service.port, 'http://public.example/', service.auth)).rejects.toBeInstanceOf(Error)
    await vi.waitFor(() => expect(service.guard.stats()).toEqual({ active: 0, connections: 0, capabilities: 0 }))
  })
  it('parks overload without opening more connections and releases after cancellation', async () => {
    const upstream = createServer((_req, _res) => undefined).listen(0, '127.0.0.1')
    await once(upstream, 'listening'); resources.push(() => closeServer(upstream))
    const port = (upstream.address() as { port: number }).port
    const http = vi.fn(mappedHttp(port))
    const service = await proxy({ maxConnections: 2, perCapability: 1, http: http as typeof request, resolve: async () => [{ address: '93.184.215.14', family: 4 }] })
    const peer = request({ host: '127.0.0.1', port: service.port, path: 'http://public.example/', headers: { 'proxy-authorization': service.auth } })
    peer.on('error', () => undefined); peer.end(); resources.push(async () => { peer.destroy() })
    await vi.waitFor(() => expect(service.guard.stats().active).toBe(1))
    expect((await get(service.port, 'http://public.example/', service.auth)).status).toBe(503)
    expect(http).toHaveBeenCalledTimes(1)
    peer.destroy()
    await vi.waitFor(() => expect(service.guard.stats()).toEqual({ active: 0, connections: 0, capabilities: 0 }))
  })

})
