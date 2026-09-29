// Hermes-pattern browser tools for agents: navigate, snapshot, act,
// screenshot, close over isolated Chromium sessions. Adopted pattern only
// (see third_party/manifest.yaml): accessibility-tree snapshots with ref
// ids, one session per task, idle reaping, on-demand screenshots for what
// snapshots cannot show. Chromium comes from the compose sidecar over CDP
// (KARDATA_CHROME_CDP_URL) or a local launch (KARDATA_CHROME_PATH or system
// chrome); sidecar sessions are unowned — close drops the context, never
// the shared browser. Without either, every call fails closed.
import { createHash } from 'node:crypto'
import { get as httpGetRaw } from 'node:http'
import { get as httpsGetRaw } from 'node:https'
import { z } from 'zod'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { acquireBrowserSlot, type BrowserSlot } from '../browserPool/pool.js'
import { RetrievalError } from './web.js'

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
const RefSchema = z.string().trim().min(1).max(120)

/** Idle sessions die here: browser tabs are task-scoped, never pooled
 * across unrelated work. */
export const BROWSER_IDLE_TIMEOUT_MS = 5 * 60_000
/** One page has this long: hung sites fail, the sweep moves on. */
export const BROWSER_NAV_TIMEOUT_MS = 30_000

interface BrowserSession {
  id: string
  browser: Browser
  /** False for sidecar sessions: closing the browser would kill the
   * shared container, so only the context closes. */
  owned: boolean
  context: BrowserContext
  page: Page
  lastUsedMs: number
  /** Pool slot held for the session lifetime: released on close or idle
   * reap, never while the session is active. */
  slot: BrowserSlot
}

let counter = 0
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
      let data = ''
      response.on('data', (chunk) => {
        data += chunk
      })
      response.on('end', () => resolve({ status: response.statusCode, data }))
    })
    request.on('error', reject)
    request.setTimeout(BROWSER_NAV_TIMEOUT_MS, () => request.destroy(new Error('sidecar discovery timed out')))
  }).catch((error: unknown) => {
    throw new RetrievalError(
      'unconfigured',
      `browser sidecar unreachable at ${cdp}: ${error instanceof Error ? error.message : 'unknown'}`,
    )
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
  const ws = new URL(wsRaw)
  ws.hostname = endpoint.hostname
  try {
    return await chromium.connectOverCDP(ws.toString(), { timeout: BROWSER_NAV_TIMEOUT_MS })
  } catch (error) {
    throw new RetrievalError(
      'unconfigured',
      `browser sidecar unreachable at ${cdp}: ${error instanceof Error ? error.message : 'unknown'}`,
    )
  }
}

async function launch(): Promise<{ browser: Browser; owned: boolean }> {
  const cdp = cdpUrl()
  if (cdp) return { browser: await connectSidecar(cdp), owned: false }
  try {
    const browser = await chromium.launch({ ...chromeTarget(), headless: true })
    return { browser, owned: true }
  } catch (error) {
    throw new RetrievalError(
      'unconfigured',
      `browser unavailable (set KARDATA_CHROME_PATH to a Chromium binary): ${error instanceof Error ? error.message : 'unknown'}`,
    )
  }
}

/** Release a session: owned browsers close whole, sidecar sessions drop
 * only their context so the shared container survives. */
async function discard(browser: Browser, owned: boolean, context: BrowserContext): Promise<void> {
  if (owned) await browser.close().catch(() => undefined)
  else await context.close().catch(() => undefined)
}

function reapIdle(): void {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (now - session.lastUsedMs > BROWSER_IDLE_TIMEOUT_MS) {
      void discard(session.browser, session.owned, session.context)
      session.slot.release()
      sessions.delete(id)
    }
  }
}

function take(id: string): BrowserSession {
  const session = sessions.get(id)
  if (!session) throw new RetrievalError('validation_failed', `unknown browser session ${id}`)
  session.lastUsedMs = Date.now()
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
  opts: { caller?: string; timeoutMs?: number } = {},
): Promise<{ sessionId: string; url: string; snapshot: string }> {
  if (!UrlSchema.safeParse(rawUrl).success) throw new RetrievalError('validation_failed', 'url must be non-empty')
  reapIdle()
  const slot = await acquireBrowserSlot({ host: hostOfUrl(rawUrl), caller: opts.caller, timeoutMs: opts.timeoutMs })
  let browser: Browser
  let owned: boolean
  try {
    ;({ browser, owned } = await launch())
  } catch (error) {
    slot.release()
    throw error
  }
  // Always a fresh context, never the shared default: two sessions must
  // never land in one context on the sidecar, or closing one strands the
  // other's pages (verified leak 2026-09-27).
  let context: BrowserContext
  try {
    context = await browser.newContext()
  } catch (error) {
    if (owned) await browser.close().catch(() => undefined)
    slot.release()
    throw new RetrievalError('fetch_failed', `browser context failed: ${error instanceof Error ? error.message : 'unknown'}`)
  }
  const page = await context.newPage()
  try {
    await page.goto(rawUrl, { timeout: BROWSER_NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' })
  } catch (error) {
    await discard(browser, owned, context)
    slot.release()
    throw new RetrievalError('fetch_failed', `navigation failed: ${error instanceof Error ? error.message : 'unknown'}`)
  }
  counter += 1
  const id = `browser-${counter}`
  sessions.set(id, { id, browser, owned, context, page, lastUsedMs: Date.now(), slot })
  const snapshot = await page.locator('body').ariaSnapshot()
  return { sessionId: id, url: page.url(), snapshot }
}

/** Accessibility-tree snapshot with ref ids for click/type targets. */
export async function browserSnapshot(sessionId: string): Promise<{ url: string; snapshot: string }> {
  const session = take(sessionId)
  const snapshot = await session.page.locator('body').ariaSnapshot()
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
): Promise<{ url: string; snapshot: string }> {
  const session = take(sessionId)
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
  const snapshot = await session.page.locator('body').ariaSnapshot()
  return { url: session.page.url(), snapshot }
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
): Promise<{ url: string; mimeType: 'image/jpeg'; bytes: number; sha256: string; dataBase64: string }> {
  const session = take(sessionId)
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

/** Close a session (sidecar sessions drop only their context).
 * Idempotent: unknown ids are done. Releases the session's pool slot. */
export async function browserClose(sessionId: string): Promise<{ ok: true }> {
  const session = sessions.get(sessionId)
  if (session) {
    sessions.delete(sessionId)
    await discard(session.browser, session.owned, session.context)
    session.slot.release()
  }
  return { ok: true }
}
