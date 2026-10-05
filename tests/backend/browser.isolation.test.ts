import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => {
  const page = { goto: vi.fn().mockResolvedValue(undefined), url: () => 'https://example.com/', locator: () => ({ ariaSnapshot: vi.fn().mockResolvedValue('Public page') }), screenshot: vi.fn().mockResolvedValue(Buffer.from('image')), keyboard: { press: vi.fn() }, mouse: { wheel: vi.fn() } }
  const context = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined) }
  const makeContext = () => {
    const listeners: Array<() => void> = []
    const emitClose = () => { for (const listener of listeners.splice(0)) listener() }
    return { on: vi.fn(), newCDPSession: vi.fn().mockResolvedValue({ on: vi.fn(), send: vi.fn().mockResolvedValue({}) }), newPage: context.newPage, close: () => context.close().then(emitClose), once: (_event: string, listener: () => void) => { listeners.push(listener) }, emitClose }
  }
  const protocol = { send: vi.fn().mockResolvedValue({ arguments: ['--enable-automation', '--disable-background-networking', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] }), detach: vi.fn().mockResolvedValue(undefined) }
  const browser = { newBrowserCDPSession: vi.fn().mockResolvedValue(protocol), newContext: vi.fn().mockImplementation(async () => makeContext()), close: vi.fn().mockResolvedValue(undefined) }
  return { page, context, browser, makeContext, protocol }
})
vi.mock('playwright-core', () => ({ chromium: { launch: vi.fn().mockResolvedValue(fake.browser), connectOverCDP: vi.fn().mockResolvedValue(fake.browser) } }))
import { browserNavigate, browserSnapshot, browserAct, browserScreenshot, browserClose } from '../../backend/src/retrieval/browser.js'
import { invokeTool } from '../../backend/src/mcp/tools.js'
import { type McpToolContext } from '../../backend/src/mcp/tools-types.js'
import { browserPoolStats } from '../../backend/src/browserPool/pool.js'
let sidecar: Server | undefined
const opened: Array<{ id: string; owner: string }> = []
beforeEach(() => { vi.stubEnv('KARDATA_MCP_TOKEN', 'TEST_BROWSER_PROXY_SECRET_NOT_A_REAL_KEY'); vi.stubEnv('KARDATA_BROWSER_PROXY_URL', 'http://127.0.0.1:9999') })
afterEach(async () => {
  for (const item of opened.splice(0)) await browserClose(item.id, item.owner)
  vi.useRealTimers()
  if (sidecar) { await new Promise<void>((resolve, reject) => sidecar!.close((error) => error ? reject(error) : resolve())); sidecar = undefined }
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
describe('browser owner isolation and failed-open recovery', () => {
  it('automatically expires an idle published session without another navigation', async () => {
    const before = browserPoolStats().active
    const result = await browserNavigate('https://example.com', { caller: 'idle-owner' })
    opened.push({ id: result.sessionId, owner: 'idle-owner' })
    // The timer must be created under the stepped clock for deterministic expiry.
    vi.useFakeTimers()
    await browserSnapshot(result.sessionId, 'idle-owner')
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1)
    expect(browserPoolStats().active).toBe(before)
    await expect(browserSnapshot(result.sessionId, 'idle-owner')).rejects.toMatchObject({ code: 'validation_failed' })
    vi.useRealTimers()
  })
  it('denies another execution and missing ownership on every session operation', async () => {
    const result = await browserNavigate('https://example.com', { caller: 'parent' })
    opened.push({ id: result.sessionId, owner: 'parent' })
    for (const owner of ['child', undefined]) {
      await expect(browserSnapshot(result.sessionId, owner)).rejects.toMatchObject({ code: 'blocked' })
      await expect(browserAct(result.sessionId, { kind: 'press', key: 'End' }, owner)).rejects.toMatchObject({ code: 'blocked' })
      await expect(browserScreenshot(result.sessionId, {}, owner)).rejects.toMatchObject({ code: 'blocked' })
      await expect(browserClose(result.sessionId, owner)).rejects.toMatchObject({ code: 'blocked' })
    }
    expect(await browserSnapshot(result.sessionId, 'parent')).toMatchObject({ snapshot: 'Public page' })
    expect(result.sessionId).toMatch(/^browser-[0-9a-f-]{36}$/)
  })
  it('binds every MCP browser operation to server scope and key identity', async () => {
    const ctx = { pool: {}, role: 'operator', keyId: 'owner', scope: { tenantId: 'tenant', projectId: null } } as McpToolContext
    const result = await invokeTool('browser_navigate', ctx, { url: 'https://example.com' }) as { sessionId: string }
    const owner = JSON.stringify(['tenant', null, 'owner', null])
    opened.push({ id: result.sessionId, owner })
    for (const other of [{ ...ctx, keyId: 'other' }, { ...ctx, scope: { tenantId: 'other', projectId: null } }]) {
      for (const [name, args] of [
        ['browser_snapshot', {}], ['browser_act', { kind: 'press', key: 'End' }],
        ['browser_screenshot', {}], ['browser_close', {}],
      ] as const) {
        await expect(invokeTool(name, other, { sessionId: result.sessionId, ...args })).rejects.toMatchObject({ code: 'blocked' })
      }
    }
    expect(await invokeTool('browser_snapshot', ctx, { sessionId: result.sessionId })).toMatchObject({ snapshot: 'Public page' })
    expect(await invokeTool('browser_close', ctx, { sessionId: result.sessionId })).toEqual({ ok: true })
  })
  it.each([
    ['session', undefined], ['subagent', undefined], ['session', 'sector'], ['subagent', 'sector'],
  ] as const)('allows own browser operations for a verified %s execution in %s', async (kind, sector) => {
    const pool = { query: async (sql: string, params: unknown[]) => {
      if (sql.includes('SELECT * FROM threads')) return { rowCount: 1, rows: [{ key: params[0], session_id: 'parent-session', kind, status: 'running', accepting_steer: true, queue_depth: 0, updated_at: new Date() }] }
      if (sql.includes('FROM created') && params[0] === 'parent-session') return { rowCount: 1, rows: [{ id: 'parent-session', title: 'TEST parent', sector, created_at: new Date(), updated_at: new Date() }] }
      return { rowCount: 0, rows: [] }
    } } as unknown as McpToolContext['pool']
    const ctx: McpToolContext = { pool, role: 'operator', keyId: 'shared-worker-key', scope: { tenantId: 'tenant', projectId: null }, executionThread: 'own-thread' }
    const result = await invokeTool('browser_navigate', ctx, { url: 'https://example.com' }) as { sessionId: string }
    opened.push({ id: result.sessionId, owner: JSON.stringify(['tenant', null, ctx.keyId, ctx.executionThread]) })
    for (const [name, args] of [
      ['browser_snapshot', {}], ['browser_act', { kind: 'press', key: 'End' }], ['browser_screenshot', {}],
    ] as const) {
      await expect(invokeTool(name, ctx, { sessionId: result.sessionId, ...args })).resolves.toHaveProperty('url')
      await expect(invokeTool(name, { ...ctx, executionThread: 'other-thread' }, { sessionId: result.sessionId, ...args })).rejects.toMatchObject({ code: 'blocked' })
    }
    await expect(invokeTool('browser_close', { ...ctx, executionThread: 'other-thread' }, { sessionId: result.sessionId })).rejects.toMatchObject({ code: 'blocked' })
    await expect(invokeTool('browser_close', ctx, { sessionId: result.sessionId })).resolves.toEqual({ ok: true })
  })
  it('retains capacity after uncertain cleanup and releases after confirmed retry', async () => {
    const before = browserPoolStats().active
    const result = await browserNavigate('https://example.com', { caller: 'close-fail' })
    fake.browser.close.mockRejectedValueOnce(new Error('cleanup failed'))
    await expect(browserClose(result.sessionId, 'close-fail')).rejects.toMatchObject({ code: 'fetch_failed' })
    expect(browserPoolStats().active).toBe(before + 1)
    await expect(browserSnapshot(result.sessionId, 'close-fail')).rejects.toMatchObject({ code: 'fetch_failed' })
    await expect(browserClose(result.sessionId, 'close-fail')).resolves.toEqual({ ok: true })
    expect(browserPoolStats().active).toBe(before)
  })
  it.each(['press', 'scroll'] as const)('bounds hung %s and prevents overlapping actions until late completion', async (kind) => {
    const result = await browserNavigate('https://example.com', { caller: 'hung-action' })
    opened.push({ id: result.sessionId, owner: 'hung-action' })
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    if (kind === 'press') fake.page.keyboard.press.mockImplementationOnce(() => pending)
    else fake.page.mouse.wheel.mockImplementationOnce(() => pending)
    vi.useFakeTimers()
    const act = kind === 'press' ? { kind, key: 'End' } as const : { kind, direction: 'down' } as const
    const failure = expect(browserAct(result.sessionId, act, 'hung-action')).rejects.toMatchObject({ code: 'fetch_failed' })
    await vi.advanceTimersByTimeAsync(30_001)
    await failure
    await expect(browserAct(result.sessionId, act, 'hung-action')).rejects.toMatchObject({ code: 'fetch_failed' })
    finish()
    await vi.advanceTimersByTimeAsync(0)
    await expect(browserSnapshot(result.sessionId, 'hung-action')).resolves.toHaveProperty('snapshot')
    vi.useRealTimers()
  })
  it('bounds hung context creation and confirms owned-browser cleanup before release', async () => {
    vi.useFakeTimers()
    const before = browserPoolStats().active
    fake.browser.newContext.mockImplementationOnce(() => new Promise(() => undefined))
    const failure = expect(browserNavigate('https://example.com', { caller: 'hung-context' })).rejects.toMatchObject({ code: 'fetch_failed' })
    await vi.advanceTimersByTimeAsync(30_001)
    await failure
    expect(browserPoolStats().active).toBe(before)
    vi.useRealTimers()
  })
  it('clears the discovery deadline and slot after headers plus a truncated JSON response', async () => {
    sidecar = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': '1000' })
      response.flushHeaders(); response.write('{"TEST":')
      setTimeout(() => response.socket?.destroy(), 20)
    }).listen(0, '127.0.0.1')
    await once(sidecar, 'listening')
    const port = (sidecar.address() as { port: number }).port
    vi.stubEnv('KARDATA_CHROME_CDP_URL', `http://127.0.0.1:${port}`)
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const nativeSet = globalThis.setTimeout, nativeClear = globalThis.clearTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
      const timer = nativeSet(callback, delay, ...args)
      if (delay === 30_000) timers.add(timer)
      return timer
    })
    vi.spyOn(globalThis, 'clearTimeout').mockImplementation((timer) => { timers.delete(timer as ReturnType<typeof setTimeout>); nativeClear(timer) })
    const before = browserPoolStats().active
    await expect(browserNavigate('https://example.com', { caller: 'truncated-discovery' })).rejects.toMatchObject({ code: 'unconfigured' })
    expect(browserPoolStats().active).toBe(before)
    expect(timers.size).toBe(0)
  })
  async function fakeSidecar() {
    sidecar = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1:9/devtools/browser/TEST' }))
    }).listen(0, '127.0.0.1')
    await once(sidecar, 'listening')
    const address = sidecar.address()
    if (!address || typeof address === 'string') throw new Error('TEST sidecar address missing')
    vi.stubEnv('KARDATA_CHROME_CDP_URL', `http://127.0.0.1:${address.port}`)
  }
  it('retains a timed-out CDP context slot until late context cleanup is confirmed', async () => {
    await fakeSidecar()
    let finish!: (value: ReturnType<typeof fake.makeContext>) => void
    const pending = new Promise<ReturnType<typeof fake.makeContext>>((resolve) => { finish = resolve })
    fake.browser.newContext.mockImplementationOnce(() => pending)
    const before = browserPoolStats().active
    const wholeBrowserCloses = fake.browser.close.mock.calls.length
    const contextCloses = fake.context.close.mock.calls.length
    vi.useFakeTimers()
    const opening = browserNavigate('https://example.com', { caller: 'cdp-late-context' })
    // Discovery uses a real owned loopback HTTP fixture; Chromium is mocked.
    await vi.waitFor(() => expect(fake.browser.newContext.mock.results.at(-1)?.value).toBe(pending))
    const failure = expect(opening).rejects.toMatchObject({ code: 'fetch_failed' })
    await vi.advanceTimersByTimeAsync(30_001)
    await failure
    expect(browserPoolStats().active).toBe(before + 1)
    finish(fake.makeContext())
    await vi.advanceTimersByTimeAsync(0)
    expect(browserPoolStats().active).toBe(before)
    expect(fake.context.close.mock.calls.length).toBe(contextCloses + 1)
    expect(fake.browser.close.mock.calls.length).toBe(wholeBrowserCloses + 1)
    vi.useRealTimers()
  })
  it('quarantines failed CDP context cleanup and disposes its client after a real receipt', async () => {
    await fakeSidecar()
    const before = browserPoolStats().active
    const wholeBrowserCloses = fake.browser.close.mock.calls.length
    const result = await browserNavigate('https://example.com', { caller: 'cdp-close-fail' })
    opened.push({ id: result.sessionId, owner: 'cdp-close-fail' })
    fake.context.close.mockRejectedValueOnce(new Error('TEST context close failed'))
    await expect(browserClose(result.sessionId, 'cdp-close-fail')).rejects.toMatchObject({ code: 'fetch_failed' })
    expect(browserPoolStats().active).toBe(before + 1)
    const closingContext = await fake.browser.newContext.mock.results.at(-1)?.value as ReturnType<typeof fake.makeContext>
    closingContext.emitClose()
    await expect(browserClose(result.sessionId, 'cdp-close-fail')).resolves.toEqual({ ok: true })
    expect(browserPoolStats().active).toBe(before)
    expect(fake.browser.close.mock.calls.length).toBe(wholeBrowserCloses + 1)
  })
  it('retains a CDP close receipt emitted before the owner first requests Close', async () => {
    await fakeSidecar()
    const before = browserPoolStats().active
    const result = await browserNavigate('https://example.com', { caller: 'cdp-already-closed' })
    opened.push({ id: result.sessionId, owner: 'cdp-already-closed' })
    const actualContext = await fake.browser.newContext.mock.results.at(-1)?.value as ReturnType<typeof fake.makeContext>
    actualContext.emitClose()
    await expect(browserClose(result.sessionId, 'cdp-already-closed')).resolves.toEqual({ ok: true })
    expect(browserPoolStats().active).toBe(before)
  })
  it('does not release CDP capacity on a repeated close no-op without the original close receipt', async () => {
    await fakeSidecar()
    const before = browserPoolStats().active
    const result = await browserNavigate('https://example.com', { caller: 'cdp-closing-noop' })
    opened.push({ id: result.sessionId, owner: 'cdp-closing-noop' })
    const closingContext = await fake.browser.newContext.mock.results.at(-1)?.value as ReturnType<typeof fake.makeContext>
    const callsBefore = fake.context.close.mock.calls.length
    fake.context.close.mockImplementationOnce(() => new Promise(() => undefined))
    vi.useFakeTimers()
    for (let attempt = 0; attempt < 2; attempt++) {
      const failure = expect(browserClose(result.sessionId, 'cdp-closing-noop')).rejects.toMatchObject({ code: 'fetch_failed' })
      await vi.advanceTimersByTimeAsync(30_001)
      await failure
      expect(browserPoolStats().active).toBe(before + 1)
    }
    // A second SDK call would resolve its default no-op; it must never occur.
    expect(fake.context.close.mock.calls.length).toBe(callsBefore + 1)
    closingContext.emitClose()
    await vi.advanceTimersByTimeAsync(0)
    expect(browserPoolStats().active).toBe(before)
    vi.useRealTimers()
  })
  it('bounds a hung newPage and cleans up the owned browser', async () => {
    vi.useFakeTimers()
    const before = browserPoolStats().active
    fake.context.newPage.mockImplementationOnce(() => new Promise(() => undefined))
    const failure = expect(browserNavigate('https://example.com', { caller: 'hung-page' })).rejects.toMatchObject({ code: 'fetch_failed' })
    await vi.advanceTimersByTimeAsync(30_001)
    await failure
    expect(browserPoolStats().active).toBe(before)
    vi.useRealTimers()
  })
  it('bounds hung cleanup, retains capacity, and releases it after late confirmation', async () => {
    const before = browserPoolStats().active
    const result = await browserNavigate('https://example.com', { caller: 'hung-close' })
    opened.push({ id: result.sessionId, owner: 'hung-close' })
    let finish!: () => void
    fake.browser.close.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    vi.useFakeTimers()
    const failure = expect(browserClose(result.sessionId, 'hung-close')).rejects.toMatchObject({ code: 'fetch_failed' })
    await vi.advanceTimersByTimeAsync(30_001)
    await failure
    expect(browserPoolStats().active).toBe(before + 1)
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(browserPoolStats().active).toBe(before)
    vi.useRealTimers()
  })
  it('releases the slot and browser when newPage fails', async () => {
    const before = browserPoolStats().active
    fake.context.newPage.mockRejectedValueOnce(new Error('page failed'))
    await expect(browserNavigate('https://example.com', { caller: 'failed-open' })).rejects.toMatchObject({ code: 'fetch_failed' })
    expect(browserPoolStats().active).toBe(before)
    expect(fake.browser.close).toHaveBeenCalled()
  })
  it('does not publish a session or leak its slot when the initial snapshot fails', async () => {
    const before = browserPoolStats().active
    vi.spyOn(fake.page, 'locator').mockReturnValueOnce({ ariaSnapshot: vi.fn().mockRejectedValue(new Error('snapshot failed')) })
    await expect(browserNavigate('https://example.com', { caller: 'failed-snapshot' })).rejects.toMatchObject({ code: 'fetch_failed' })
    expect(browserPoolStats().active).toBe(before)
  })
})
