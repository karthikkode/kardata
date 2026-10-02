// Hermes-pattern browser tools for agents: navigate, snapshot, act,
// screenshot, close over isolated Chromium sessions. Adopted pattern only
// (see third_party/manifest.yaml): accessibility-tree snapshots with ref
// ids, one session per task, idle reaping, on-demand screenshots for what
// snapshots cannot show. Chromium comes from the compose sidecar over CDP
// (KARDATA_CHROME_CDP_URL) or a local launch (KARDATA_CHROME_PATH or system
// chrome); sidecar sessions are unowned — close drops the context, never
// the shared browser process. The CDP client transport is disposed after
// confirmed context close. Without either, every call fails closed.
import type { Logger } from 'pino'
import { createHash, randomUUID } from 'node:crypto'
import { get as httpGetRaw } from 'node:http'
import { get as httpsGetRaw } from 'node:https'
import { z } from 'zod'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { acquireBrowserSlot, type BrowserSlot } from '../browserPool/pool.js'
import { browserProxyCredentials, configureBrowserProxyContext, BROWSER_PROXY_LIFETIME_MS } from './proxy.js'
import { RetrievalError, publicSourceUrl } from './web.js'
import { createLogger, logOp } from '../observability/logging.js'

/** Remote Chromium over CDP (the compose sidecar): heavy lifting stays in
 * containers, never the laptop. Local launch is the dev fallback. */
const CdpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine(
    (value) => {
      try {
        const parsed = new URL(value)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      } catch {
        return false
      }
    },
    'CDP URL must be an http(s) URL',
  )

function cdpUrl(): string | undefined {
  const raw = process.env['KARDATA_CHROME_CDP_URL']?.trim()
  if (!raw) return undefined
  if (!CdpUrlSchema.safeParse(raw).success) {
    throw new RetrievalError('validation_failed', 'KARDATA_CHROME_CDP_URL must be an http(s) URL')
  }
  return raw
}

const UrlSchema = z.string().trim().min(1).max(2000)
export const BROWSER_NETWORK_FLAGS = ['--enable-automation', '--disable-background-networking', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] as const

const RefSchema = z.string().trim().min(1).max(120)

/** Idle sessions die here: browser tabs are task-scoped, never pooled
 * across unrelated work. */
export const BROWSER_IDLE_TIMEOUT_MS = 5 * 60_000
/** One page has this long: hung sites fail, the sweep moves on. */
export const BROWSER_NAV_TIMEOUT_MS = 30_000

interface BrowserSession {
  id: string
  caller: string | undefined
  cleanupPending?: boolean
  actionPending?: boolean
  browser: Browser
  /** False for sidecar sessions: closing the browser would kill the
   * shared container; close disposes the task context and its CDP client transport. */
  owned: boolean
  context: BrowserContext
  page: Page
  lastUsedMs: number
  createdMs: number
  idleTimer?: ReturnType<typeof setTimeout>
  /** Pool slot held for the session lifetime: released on close or idle
   * reap, never while the session is active. */
  slot: BrowserSlot
}

const sessions = new Map<string, BrowserSession>()

function chromeTarget(): { executablePath?: string; channel?: 'chrome' } {
  const explicit = process.env['KARDATA_CHROME_PATH']?.trim()
  if (explicit) return { executablePath: explicit }
  return { channel: 'chrome' }
}

/** Sidecar discovery over container DNS. Chrome's DevTools server
 * rejects Host headers that are not an IP or loopback (DNS-rebinding
 * guard), and advertises an unroutable ws host — so discovery goes
 * through node:http with a loopback Host override, and the websocket
 * URL is rewritten to the sidecar hostname before connecting. */
async function connectSidecar(cdp: string): Promise<Browser> {
  const endpoint = new URL(cdp)
  const getRaw = endpoint.protocol === 'https:' ? httpsGetRaw : httpGetRaw
  const defaultPort = endpoint.protocol === 'https:' ? '443' : '80'
  const hostHeader = `127.0.0.1:${endpoint.port || defaultPort}`
  const raw = await new Promise<{ status?: number; data: string }>((resolve, reject) => {
    const request = getRaw(`${endpoint.origin}/json/version`, { headers: { Host: hostHeader } }, (response) => {
      const chunks: Buffer[] = []
      let bytes = 0
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > 64 * 1024) { request.destroy(new RetrievalError('unconfigured', 'Browser discovery response exceeds limit')); return }
        chunks.push(chunk)
      })
      response.on('error', (error) => { clearTimeout(timer); request.destroy(); reject(error) })
      response.on('end', () => { clearTimeout(timer); resolve({ status: response.statusCode, data: Buffer.concat(chunks).toString('utf8') }) })
    })
    const timer = setTimeout(() => request.destroy(new RetrievalError('unconfigured', 'Browser discovery deadline exceeded')), BROWSER_NAV_TIMEOUT_MS)
    request.on('error', (error) => { clearTimeout(timer); reject(error) })
  }).catch(() => {
    throw new RetrievalError('unconfigured', 'Browser sidecar discovery failed')
  })
  if (raw.status !== 200) {
    throw new RetrievalError('unconfigured', `browser sidecar discovery answered HTTP ${raw.status ?? 'unknown'}`)
  }
  let wsRaw: unknown
  try {
    wsRaw = (JSON.parse(raw.data) as { webSocketDebuggerUrl?: unknown }).webSocketDebuggerUrl
  } catch {
    wsRaw = undefined
  }
  if (typeof wsRaw !== 'string' || !wsRaw.startsWith('ws')) {
    throw new RetrievalError('unconfigured', 'browser sidecar discovery held no websocket URL')
  }
  let ws: URL
  try { ws = new URL(wsRaw) } catch { throw new RetrievalError('unconfigured', 'Browser discovery websocket invalid') }
  if (!['ws:', 'wss:'].includes(ws.protocol) || ws.username || ws.password || ws.search || ws.hash) throw new RetrievalError('unconfigured', 'Browser discovery websocket invalid')
  ws.hostname = endpoint.hostname
  ws.port = endpoint.port
  ws.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:'
  try {
    return await chromium.connectOverCDP(ws.toString(), { timeout: BROWSER_NAV_TIMEOUT_MS })
  } catch {
    throw new RetrievalError('unconfigured', 'Browser sidecar connection failed')
  }
}

async function launch(): Promise<{ browser: Browser; owned: boolean }> {
  const cdp = cdpUrl()
  if (cdp) return { browser: await connectSidecar(cdp), owned: false }
  try {
    const browser = await chromium.launch({ ...chromeTarget(), headless: true, args: [...BROWSER_NETWORK_FLAGS] })
    return { browser, owned: true }
  } catch (error) {
    throw new RetrievalError(
      'unconfigured',
      `browser unavailable (set KARDATA_CHROME_PATH to a Chromium binary): ${error instanceof Error ? error.message : 'unknown'}`,
    )
  }
}

/** Release a session: owned browsers close whole, sidecar sessions drop
 * their task context and client transport so the shared container survives. */
const browserLogger = createLogger({ op: 'retrieval.browser' })
/** Time out the caller without pretending an unresolved remote operation ended. */
async function boundedBrowserWork<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new RetrievalError('fetch_failed', 'Browser operation deadline exceeded; cleanup may be pending')), BROWSER_NAV_TIMEOUT_MS)
    })])
  } finally { if (timer) clearTimeout(timer) }
}

const contextCloseAttempts = new WeakSet<BrowserContext>()
const contextClosures = new WeakMap<BrowserContext, { receipt: Promise<void> }>()

function trackCdpContext(browser: Browser, context: BrowserContext): void {
  if (contextClosures.has(context)) return
  // Register at acquisition, not cleanup: a navigation/snapshot failure or
  // external closure may already have emitted the event before Close is called.
  const contextClosed = new Promise<void>((resolve) => context.once('close', () => resolve()))
  const receipt = contextClosed.then(() => browser.close())
  contextClosures.set(context, { receipt })
  void receipt.catch(() => browserLogger.error({ event: 'retrieval.browser.quarantined', code: 'client_disposal_uncertain' }))
}

async function discard(browser: Browser, owned: boolean, context?: BrowserContext, confirmed?: () => void): Promise<void> {
  await logOp(browserLogger, 'retrieval.browser.close', async () => {
    try {
      if (owned) {
        await boundedBrowserWork(browser.close().then(() => confirmed?.()))
      } else if (context) {
        const tracked = contextClosures.has(context)
        trackCdpContext(browser, context)
        const state = contextClosures.get(context)!
        // close() is invoked once; retries wait for the retained receipt.
        const attempt = contextCloseAttempts.has(context) ? undefined : context.close()
        if (!tracked) browserLogger.warn({ event: 'retrieval.browser.cleanup', code: 'late_receipt_registration' })
        contextCloseAttempts.add(context)
        // Repeated Playwright close() can resolve as a no-op while closing.
        // Only the original actual context close event confirms release.
        void state.receipt.then(() => confirmed?.(), () => undefined)
        await boundedBrowserWork(attempt ? Promise.race([attempt.then(() => state.receipt), state.receipt]) : state.receipt)
      } else throw new RetrievalError('fetch_failed', 'Missing browser context')
    } catch {
      browserLogger.error({ event: 'retrieval.browser.quarantined', code: 'cleanup_uncertain' })
      throw new RetrievalError('fetch_failed', 'Browser cleanup uncertain; capacity retained')
    }
  })
}

function armBrowserExpiry(session: BrowserSession): void {
  clearTimeout(session.idleTimer)
  const now = Date.now()
  const wait = Math.min(BROWSER_IDLE_TIMEOUT_MS - (now - session.lastUsedMs), BROWSER_PROXY_LIFETIME_MS - (now - session.createdMs))
  session.idleTimer = setTimeout(() => {
    session.cleanupPending = true
    void discard(session.browser, session.owned, session.context, () => { sessions.delete(session.id); session.slot.release() }).catch(() => {
      browserLogger.error({ event: 'retrieval.browser.quarantined', code: 'expiry_cleanup_uncertain' })
    })
  }, Math.max(1, wait))
  session.idleTimer.unref?.()
}

async function reapIdle(): Promise<void> {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (now - session.lastUsedMs > BROWSER_IDLE_TIMEOUT_MS || now - session.createdMs >= BROWSER_PROXY_LIFETIME_MS) {
      clearTimeout(session.idleTimer)
      session.cleanupPending = true
      await discard(session.browser, session.owned, session.context, () => { sessions.delete(id); session.slot.release() })
    }
  }
}

function take(id: string, caller?: string): BrowserSession {
  const session = sessions.get(id)
  if (!session) throw new RetrievalError('validation_failed', `unknown browser session ${id}`)
  if (session.caller !== caller) throw new RetrievalError('blocked', 'Browser session belongs to another execution')
  if (session.cleanupPending) throw new RetrievalError('fetch_failed', 'Browser cleanup pending; retry Close')
  if (session.actionPending) throw new RetrievalError('fetch_failed', 'Browser action completion pending; inspect after it settles or Close')
  session.lastUsedMs = Date.now()
  armBrowserExpiry(session)
  return session
}

function hostOfUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** Open a session on a URL. Returns the session id plus the first
 * accessibility snapshot so the agent can act immediately. Holds one
 * pool slot for the session lifetime: at saturation new navigations
 * reject with `overload` instead of evicting live sessions. */
export async function browserNavigate(
  rawUrl: string,
  opts: { caller?: string; timeoutMs?: number; logger?: Logger } = {},
): Promise<{ sessionId: string; url: string; snapshot: string }> {
  if (!UrlSchema.safeParse(rawUrl).success) throw new RetrievalError('validation_failed', 'url must be non-empty')
  rawUrl = publicSourceUrl(rawUrl).toString()
  cdpUrl() // Validate trusted CDP configuration before acquiring resources.
  const proxy = browserProxyCredentials(opts.caller, process.env, opts.logger ?? browserLogger)
  await reapIdle()
  const slot = await acquireBrowserSlot({ host: hostOfUrl(rawUrl), caller: opts.caller, timeoutMs: opts.timeoutMs })
  let browser: Browser
  let owned: boolean
  try {
    ;({ browser, owned } = await launch())
  } catch (error) {
    slot.release()
    throw error
  }
  try {
    const protocol = await boundedBrowserWork(browser.newBrowserCDPSession())
    try {
      const command = await boundedBrowserWork(protocol.send('Browser.getBrowserCommandLine'))
      const unsafe = ['--disable-web-security', '--allow-file-access-from-files', '--ignore-certificate-errors', '--no-proxy-server']
      if (unsafe.some((flag) => command.arguments.some((arg) => arg === flag || arg.startsWith(flag + '=')))) throw new RetrievalError('unconfigured', 'Unsafe browser network policy flags')
      if (BROWSER_NETWORK_FLAGS.some((flag) => !command.arguments.includes(flag))) throw new RetrievalError('unconfigured', 'Browser network policy flags missing')
    } finally { await boundedBrowserWork(protocol.detach()) }
  } catch (error) {
    // This handle belongs to this launch/connection, never another caller.
    await boundedBrowserWork(browser.close().then(() => slot.release()))
    if (error instanceof RetrievalError) throw error
    throw new RetrievalError('unconfigured', 'Browser network policy could not be verified')
  }
  // Always a fresh context, never the shared default: two sessions must
  // never land in one context on the sidecar, or closing one strands the
  // other's pages (verified leak 2026-09-27).
  let context: BrowserContext
  try {
    const pendingContext = browser.newContext({ proxy: { server: proxy.server, bypass: proxy.bypass }, serviceWorkers: 'block' }).then((created) => {
      if (!owned) trackCdpContext(browser, created)
      return created
    })
    try { context = await boundedBrowserWork(pendingContext) }
    catch (error) {
      if (!owned) {
        // CDP cannot close the shared browser. Retain the slot until a late
        // context arrives and its own close is confirmed.
        void pendingContext.then((late) => discard(browser, false, late, () => slot.release())).catch(() => {
          browserLogger.error({ event: 'retrieval.browser.quarantined', code: 'context_cleanup_uncertain' })
        })
      }
      throw error
    }
  } catch (error) {
    if (owned) await discard(browser, owned, undefined, () => slot.release())
    throw new RetrievalError('fetch_failed', `browser context failed: ${error instanceof Error ? error.message : 'unknown'}`)
  }
  try {
    const authenticate = configureBrowserProxyContext(context, proxy)
    const page = await boundedBrowserWork(context.newPage())
    await boundedBrowserWork(authenticate(page))
    await page.goto(rawUrl, { timeout: BROWSER_NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' })
    const snapshot = await page.locator('body').ariaSnapshot({ timeout: BROWSER_NAV_TIMEOUT_MS })
    const id = `browser-${randomUUID()}`
    const session: BrowserSession = { id, caller: opts.caller, browser, owned, context, page, lastUsedMs: Date.now(), createdMs: Date.now(), slot }
    sessions.set(id, session)
    armBrowserExpiry(session)
    return { sessionId: id, url: page.url(), snapshot }
  } catch {
    await discard(browser, owned, context, () => slot.release())
    throw new RetrievalError('fetch_failed', 'Browser open failed')
  }
}

/** Accessibility-tree snapshot with ref ids for click/type targets. */
export async function browserSnapshot(sessionId: string, caller?: string): Promise<{ url: string; snapshot: string }> {
  const session = take(sessionId, caller)
  const snapshot = await session.page.locator('body').ariaSnapshot({ timeout: BROWSER_NAV_TIMEOUT_MS })
  return { url: session.page.url(), snapshot }
}

export type BrowserAct =
  | { kind: 'click'; selector: string }
  | { kind: 'fill'; selector: string; text: string }
  | { kind: 'press'; key: string }
  | { kind: 'scroll'; direction: 'up' | 'down'; pixels?: number }

/** One act on the page (snapshot first to pick selectors), then the fresh
 * snapshot so the agent sees what changed. Selectors are CSS: the snapshot
 * names roles and text, the agent addresses the matching element. */
export async function browserAct(
  sessionId: string,
  act: BrowserAct,
  caller?: string,
): Promise<{ url: string; snapshot: string }> {
  const session = take(sessionId, caller)
  session.actionPending = true
  const work = (async () => {
    try {
      if (act.kind === 'click' || act.kind === 'fill') {
        if (!RefSchema.safeParse(act.selector).success) {
          throw new RetrievalError('validation_failed', `${act.kind} needs a selector`)
        }
        const locator = session.page.locator(act.selector).first()
        if (act.kind === 'click') await locator.click({ timeout: BROWSER_NAV_TIMEOUT_MS })
        else {
          if (!act.text.trim()) throw new RetrievalError('validation_failed', 'fill needs text')
          await locator.fill(act.text, { timeout: BROWSER_NAV_TIMEOUT_MS })
        }
      } else if (act.kind === 'press') {
        await session.page.keyboard.press(act.key, { delay: 0 })
      } else {
        await session.page.mouse.wheel(0, act.direction === 'up' ? -(act.pixels ?? 600) : (act.pixels ?? 600))
      }
    } catch (error) {
      if (error instanceof RetrievalError) throw error
      throw new RetrievalError('fetch_failed', `browser act failed: ${error instanceof Error ? error.message : 'unknown'}`)
    }
    const snapshot = await session.page.locator('body').ariaSnapshot({ timeout: BROWSER_NAV_TIMEOUT_MS })
    return { url: session.page.url(), snapshot }
  })().finally(() => { session.actionPending = false })
  try { return await boundedBrowserWork(work) }
  catch (error) {
    if (session.actionPending) browserLogger.error({ event: 'retrieval.browser.quarantined', code: 'action_completion_uncertain' })
    throw error
  }
}

/** Largest screenshot: viewport JPEGs stay small; full pages balloon. */
export const BROWSER_SCREENSHOT_MAX_BYTES = 400 * 1024

/** On-demand pixels for what the aria snapshot cannot show (visual
 * layout, canvas/WebGL, maps, CAPTCHA state) plus sha256 page-state
 * receipts ("screenshot, act, screenshot, compare hashes" is a verdict
 * the model can consume as text). Viewport JPEG by default; full pages
 * are capped and refused over budget with a retry-viewport error.
 * Snapshots stay the default: screenshots ride history as base64, so
 * each one costs context on every later turn until compacted. */
export async function browserScreenshot(
  sessionId: string,
  options: { fullPage?: boolean } = {},
  caller?: string,
): Promise<{ url: string; mimeType: 'image/jpeg'; bytes: number; sha256: string; dataBase64: string }> {
  const session = take(sessionId, caller)
  let buffer: Buffer
  try {
    buffer = await session.page.screenshot({
      type: 'jpeg',
      quality: 55,
      fullPage: options.fullPage ?? false,
      timeout: BROWSER_NAV_TIMEOUT_MS,
    })
  } catch (error) {
    throw new RetrievalError(
      'fetch_failed',
      `browser screenshot failed: ${error instanceof Error ? error.message : 'unknown'}`,
    )
  }
  if (buffer.length > BROWSER_SCREENSHOT_MAX_BYTES) {
    throw new RetrievalError(
      'fetch_failed',
      `screenshot ${buffer.length} bytes over the ${BROWSER_SCREENSHOT_MAX_BYTES} cap: retry viewport-only`,
    )
  }
  return {
    url: session.page.url(),
    mimeType: 'image/jpeg',
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    dataBase64: buffer.toString('base64'),
  }
}

/** Close a session (CDP sessions dispose their context and client transport).
 * Idempotent: unknown ids are done. Releases the session's pool slot. */
export async function browserClose(sessionId: string, caller?: string): Promise<{ ok: true }> {
  const session = sessions.get(sessionId)
  if (session) {
    if (session.caller !== caller) throw new RetrievalError('blocked', 'Browser session belongs to another execution')
    session.cleanupPending = true
    clearTimeout(session.idleTimer)
    await discard(session.browser, session.owned, session.context, () => { sessions.delete(sessionId); session.slot.release() })
  }
  return { ok: true }
}
