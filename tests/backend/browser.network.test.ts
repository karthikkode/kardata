// Real isolated Chromium + existing backend listener. Only test transport maps
// admitted public fixtures to owned loopback peers; literal/private admission
// remains production code. No shared sidecar or research data is touched.
import Fastify from 'fastify'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { createServer, request, type IncomingMessage, type Server } from 'node:http'
import { connect, createServer as createTcpServer } from 'node:net'
import { once } from 'node:events'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { browserNavigate, browserClose, browserSnapshot, browserAct, BROWSER_NETWORK_FLAGS } from '../../backend/src/retrieval/browser.js'
import { resolvePublicSource } from '../../backend/src/retrieval/web.js'
import { registerBrowserProxy } from '../../backend/src/retrieval/proxy.js'
import { browserPoolStats } from '../../backend/src/browserPool/pool.js'

const enabled = process.env['KARDATA_BROWSER_TEST'] === '1'
describe.skipIf(!enabled)('isolated Chromium public-network boundary', () => {
  const app = Fastify({ logger: false })
  let publicSite: Server, privateSite: Server, privateTcp: ReturnType<typeof createTcpServer>
  let privateHits = 0, tcpHits = 0, privatePort: number, tcpPort: number
  const seenHeaders: Array<IncomingMessage['headers']> = []
  const open: string[] = []
  const proxyTargets: string[] = []
  beforeAll(async () => {
    privateSite = createServer((_req, res) => { privateHits++; res.end('TEST PRIVATE DATA MUST NOT BE READ') }).listen(0, '127.0.0.1')
    await once(privateSite, 'listening'); privatePort = (privateSite.address() as { port: number }).port
    privateTcp = createTcpServer((socket) => { tcpHits++; socket.destroy() }).listen(0, '127.0.0.1')
    await once(privateTcp, 'listening'); tcpPort = (privateTcp.address() as { port: number }).port
    publicSite = createServer((req, res) => {
      seenHeaders.push(req.headers)
      if (req.url === '/redirect-private') { res.writeHead(302, { location: `http://127.0.0.1:${privatePort}/secret` }); res.end(); return }
      if (req.url === '/site-auth') { res.writeHead(401, { 'www-authenticate': 'Basic realm="Kardata public browser"' }); res.end('TEST AUTH DENIED'); return }
      res.setHeader('content-type', 'text/html')
      res.end(`<h1>TEST PUBLIC SOURCE</h1><script>
      fetch('http://127.0.0.1:${privatePort}/fetch').catch(()=>{});
      const img=document.createElement('img');img.src='http://127.0.0.1:${privatePort}/image';document.body.append(img);
      const frame=document.createElement('iframe');frame.src='http://127.0.0.1:${privatePort}/frame';document.body.append(frame);
      const rtc=new RTCPeerConnection({iceServers:[{urls:'turn:127.0.0.1:${tcpPort}?transport=tcp',username:'TEST',credential:'TEST'}]});
      rtc.createDataChannel('TEST');rtc.createOffer().then(o=>rtc.setLocalDescription(o));
      setTimeout(()=>{rtc.close();const done=document.createElement('p');done.textContent='TEST RTC finished';document.body.append(done)},1500);
      </script><a id='private-popup' target='_blank' href='http://127.0.0.1:${privatePort}/popup'>TEST private popup</a><a href='http://guard-fixture.example/site-auth'>TEST site authentication</a>`)
    }).listen(0, '127.0.0.1')
    await once(publicSite, 'listening')
    const port = (publicSite.address() as { port: number }).port
    app.server.on('request', (req) => proxyTargets.push(req.url ?? ''))
    registerBrowserProxy(app, { secret: 'TEST_BROWSER_PROXY_SECRET_NOT_A_REAL_KEY', resolve: async (url) => {
      if (url.hostname === 'example.com' && process.env['KARDATA_RETRIEVAL_TEST'] === '1') return resolvePublicSource(url)
      if (!/^guard-fixture(-b)?\.example$/.test(url.hostname)) throw new Error('TEST unconfigured public destination')
      return [{ address: '93.184.215.14', family: 4 }]
    }, http: ((url: URL, options: Parameters<typeof request>[1], callback: Parameters<typeof request>[2]) => request({ ...(options as object), host: '127.0.0.1', hostname: '127.0.0.1', port, path: url.pathname + url.search, lookup: undefined }, callback)) as typeof request,
      connect: (address, destinationPort) => destinationPort === 443 && process.env['KARDATA_RETRIEVAL_TEST'] === '1' ? connect({ host: address, port: destinationPort }) : connect({ host: '127.0.0.1', port }),
    })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const proxyPort = (app.server.address() as { port: number }).port
    vi.stubEnv('KARDATA_CHROME_CDP_URL', '')
    vi.stubEnv('KARDATA_CHROME_PATH', chromium.executablePath())
    vi.stubEnv('KARDATA_MCP_TOKEN', 'TEST_BROWSER_PROXY_SECRET_NOT_A_REAL_KEY')
    vi.stubEnv('KARDATA_BROWSER_PROXY_URL', `http://127.0.0.1:${proxyPort}`)
  })
  afterAll(async () => {
    for (const id of open) await browserClose(id, 'TEST network')
    await app.close()
    for (const server of [publicSite, privateSite]) if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) }
    if (privateTcp) await new Promise<void>((resolve) => privateTcp.close(() => resolve()))
    vi.unstubAllEnvs()
  })
  it('denies page-generated private fetch/image/frame/TURN connections and keeps public content usable', async () => {
    const result = await browserNavigate('http://guard-fixture.example/', { caller: 'TEST network' }); open.push(result.sessionId)
    expect(result.snapshot).toContain('TEST PUBLIC SOURCE')
    // Negative traffic assertions wait beyond the fixture's own ICE-close marker.
    await new Promise<void>((resolve) => setTimeout(resolve, 2000))
    expect((await browserSnapshot(result.sessionId, 'TEST network')).snapshot).toContain('TEST RTC finished')
    await browserAct(result.sessionId, { kind: 'click', selector: '#private-popup' }, 'TEST network')
    await new Promise<void>((resolve) => setTimeout(resolve, 300))
    expect(proxyTargets.some((url) => url.includes(`/popup`))).toBe(true)
    expect(privateHits).toBe(0)
    expect(tcpHits).toBe(0)
    expect((await browserSnapshot(result.sessionId, 'TEST network')).snapshot).not.toContain('TEST PRIVATE DATA')
    expect(seenHeaders.every((headers) => headers['proxy-authorization'] === undefined)).toBe(true)
    await browserClose(result.sessionId, 'TEST network')
  }, 40_000)
  it('denies a redirect to private data instead of following outside the proxy', async () => {
    const before = browserPoolStats().active
    await expect(browserNavigate('http://guard-fixture.example/redirect-private', { caller: 'TEST network' })).rejects.toMatchObject({ code: 'fetch_failed' })
    expect(privateHits).toBe(0)
    expect(browserPoolStats().active).toBe(before)
  }, 40_000)
  it('does not disclose network credentials to a site authentication challenge', async () => {
    const result = await browserNavigate('http://guard-fixture.example/site-auth', { caller: 'TEST network' }); open.push(result.sessionId)
    expect(seenHeaders.every((headers) => headers.authorization === undefined && headers['proxy-authorization'] === undefined)).toBe(true)
    await browserClose(result.sessionId, 'TEST network')
  }, 40_000)
  it('closes one isolated CDP client without stopping another or the shared test process', async () => {
    const shared = await chromium.launch({ executablePath: chromium.executablePath(), headless: true, args: [...BROWSER_NETWORK_FLAGS, '--remote-debugging-port=0'] })
    let a: string | undefined, b: string | undefined
    try {
      const protocol = await shared.newBrowserCDPSession()
      const args = (await protocol.send('Browser.getBrowserCommandLine')).arguments
      const profile = args.find((arg) => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length)
      if (!profile) throw new Error('TEST owned Chromium profile missing')
      const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]
      vi.stubEnv('KARDATA_CHROME_CDP_URL', `http://127.0.0.1:${port}`)
      a = (await browserNavigate('http://guard-fixture.example/', { caller: 'TEST network' })).sessionId
      b = (await browserNavigate('http://guard-fixture-b.example/', { caller: 'TEST network' })).sessionId
      expect((await protocol.send('Target.getBrowserContexts')).browserContextIds).toHaveLength(2)
      await browserClose(a, 'TEST network'); a = undefined
      expect((await browserSnapshot(b, 'TEST network')).snapshot).toContain('TEST PUBLIC SOURCE')
      expect((await protocol.send('Target.getBrowserContexts')).browserContextIds).toHaveLength(1)
      await browserClose(b, 'TEST network'); b = undefined
      expect((await protocol.send('Target.getBrowserContexts')).browserContextIds).toHaveLength(0)
      expect(shared.isConnected()).toBe(true)
      await protocol.detach()
    } finally {
      if (a) await browserClose(a, 'TEST network')
      if (b) await browserClose(b, 'TEST network')
      vi.stubEnv('KARDATA_CHROME_CDP_URL', '')
      await shared.close()
    }
  }, 40_000)

  it.skipIf(process.env['KARDATA_RETRIEVAL_TEST'] !== '1')('loads a real public HTTPS source through authenticated CONNECT and Chromium TLS verification', async () => {
    const result = await browserNavigate('https://example.com/', { caller: 'TEST network' }); open.push(result.sessionId)
    expect(result.url).toBe('https://example.com/')
    expect(result.snapshot.length).toBeGreaterThan(0)
    await browserClose(result.sessionId, 'TEST network')
  }, 40_000)

  it('disposes an isolated CDP context when its owning process dies, preserving the shared browser', async () => {
    const shared = await chromium.launch({ executablePath: chromium.executablePath(), headless: true, args: [...BROWSER_NETWORK_FLAGS, '--remote-debugging-port=0'] })
    let owner: ReturnType<typeof spawn> | undefined
    try {
      const protocol = await shared.newBrowserCDPSession()
      const args = (await protocol.send('Browser.getBrowserCommandLine')).arguments
      const profile = args.find((arg) => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length)
      if (!profile) throw new Error('TEST owned Chromium profile missing')
      const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]
      const program = `import {chromium} from 'playwright-core'; const browser=await chromium.connectOverCDP(${JSON.stringify(`http://127.0.0.1:${port}`)}); const context=await browser.newContext(); await context.newPage(); console.log('TEST_OWNER_READY'); setInterval(()=>{},1000);`
      owner = spawn(process.execPath, ['--input-type=module','-e',program], { stdio: ['ignore','pipe','pipe'] })
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('TEST owning process startup deadline')), 15000)
        owner!.once('error', (error) => { clearTimeout(timer); reject(error) })
        owner!.once('exit', () => { clearTimeout(timer); reject(new Error('TEST owning process exited before readiness')) })
        owner!.stdout!.on('data', (data: Buffer) => { if (data.toString().includes('TEST_OWNER_READY')) { clearTimeout(timer); resolve() } })
      })
      // Inventory identifies exactly the isolated owner and one context before
      // the disruptive drill. No shared app/sidecar process is terminated.
      expect(owner.pid).toBeGreaterThan(0)
      expect((await protocol.send('Target.getBrowserContexts')).browserContextIds).toHaveLength(1)
      const exited = once(owner, 'exit')
      owner.kill('SIGKILL')
      await exited
      const deadline = Date.now() + 10000
      while ((await protocol.send('Target.getBrowserContexts')).browserContextIds.length && Date.now() < deadline) await new Promise<void>((resolve) => setTimeout(resolve, 50))
      expect((await protocol.send('Target.getBrowserContexts')).browserContextIds).toHaveLength(0)
      expect(shared.isConnected()).toBe(true)
      const next = await shared.newContext()
      await next.newPage()
      await next.close()
      await protocol.detach()
    } finally {
      if (owner && owner.exitCode === null && owner.signalCode === null) { const exited = once(owner, 'exit'); owner.kill('SIGKILL'); await exited }
      await shared.close()
    }
  }, 40000)

})
