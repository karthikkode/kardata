// Matrix runner (P6.3): one code path for every (component, state) case.
// Each state asserts all seven checks: no horizontal overflow, 390
// containment, truncation titles, visible focus (focus state), zero console
// errors, zero serious axe violations, and a pixel shot (toHaveScreenshot
// by default; MATRIX_SHOTS=1 writes grading PNGs + manifest.jsonl, which
// scripts/ui-review.mjs assembles into manifest.json).
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type ConsoleMessage, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { serveApi, type RouteKey } from './api'
import { FIXED_NOW, matrixApiOptions, type MatrixDataState } from './factory'

export type MatrixEnvState = 'dark' | 'w1280' | 'w768' | 'w390' | 'focus' | 'reduced-motion'
export type MatrixState = MatrixDataState | MatrixEnvState

export interface MatrixAnchor {
  kind: 'role' | 'text' | 'css'
  role?: string
  name?: string
  text?: string
  css?: string
  /** Exact accessible-name/text match (default substring). Use when a
   * short name ('Retry') would also match longer siblings. */
  exact?: boolean
}

export interface MatrixSetup {
  click?: MatrixAnchor
  hover?: MatrixAnchor
  press?: string
}

export interface MatrixCase {
  id: string
  route: string
  anchors: MatrixAnchor[]
  setup?: MatrixSetup[]
  postAnchors?: MatrixAnchor[]
  /**
   * Gated surface (dock, dialog, tab panel): anchors describe the
   * pre-setup trigger and assert only before setup; postAnchors describe
   * the opened surface and assert only after. A modal dialog hides its
   * trigger, so asserting the trigger post-setup fails by design.
   */
  gated?: boolean
  emptyAnchors?: MatrixAnchor[]
  /** Focus-state subject (default anchors[0]); leaves focus directly. */
  focusSubject?: MatrixAnchor
  primary: RouteKey
  secondary?: RouteKey
  envBasis?: MatrixDataState
  /** Override the matrix sector state (state-gated UI like the plan editor). */
  sectorState?: 'planned' | 'approved' | 'paused' | 'running' | 'complete' | 'draft' | 'failed' | 'planning' | 'queued'
  /** Override the local-context fixture variant (blocked surfaces the rebuild review). */
  localVariant?: 'full' | 'empty' | 'blocked' | 'pending'
  /** P6-M4: repeated-row count for count states (selector from components.json). */
  expectedRows?: { selector: string; count: number }
  /** P6-M4: exact or substring texts (footers, toggle labels, long-text). */
  expectedTexts?: Array<{ text: string; exact?: boolean }>
}

const WIDTHS: Record<string, number> = { w1280: 1280, w768: 768, w390: 390 }
const HEIGHTS: Record<number, number> = { 1440: 900, 1280: 800, 768: 1024, 390: 844 }

const supportDir = dirname(fileURLToPath(import.meta.url))
const SHOTS_DIR = resolve(supportDir, '../../../frontend/test-results/ui-review')
const MANIFEST = resolve(SHOTS_DIR, 'manifest.jsonl')

function shotsMode(): boolean {
  return process.env.MATRIX_SHOTS === '1'
}

export function anchorLocator(page: Page, anchor: MatrixAnchor): Locator {
  if (anchor.kind === 'role') return page.getByRole(anchor.role as never, anchor.name ? { name: anchor.name, ...(anchor.exact ? { exact: true } : {}) } : undefined).first()
  if (anchor.kind === 'text') return page.getByText(anchor.text as string, anchor.exact ? { exact: true } : undefined).first()
  return page.locator(anchor.css as string).first()
}

/** Chromium's own noise for a request the harness faulted by design: the
 * browser logs "Failed to load resource: ..." as a console error naming
 * the faulted URL. Drop it for the faulted scope only (the case pattern in
 * the failures runner, mocked API URLs in faulted-state matrix runs).
 * App-chunk failures, other URLs, and real console.error calls still fail. */
export function isFaultedResourceNoise(msg: ConsoleMessage, scope: RegExp): boolean {
  if (msg.type() !== 'error') return false
  if (!msg.text().startsWith('Failed to load resource')) return false
  if (scope.test(msg.location().url)) return true
  // Older Chromium puts the URL in the text but not the location.
  const embedded = msg.text().match(/https?:\/\/[^\s'"]+/)
  return embedded !== null && scope.test(embedded[0])
}

/** Newer Chromium omits the URL from both the text and location() of a
 * resource error ("Failed to load resource: the server responded with a
 * status of 500 ..."). Returns that status so the caller can drop the
 * noise only when the faulted scope actually served it (a matching
 * response on the wire); anything else (app fallout requesting an
 * unmocked URL, load-time chunk failures) still fails. */
export function unattributedNoiseStatus(msg: ConsoleMessage): number | undefined {
  if (msg.type() !== 'error') return undefined
  if (!msg.text().startsWith('Failed to load resource')) return undefined
  if (msg.location().url !== '') return undefined
  if (/https?:\/\//.test(msg.text())) return undefined
  const status = msg.text().match(/status of (\d{3})/)
  return status ? Number(status[1]) : undefined
}

function isEnvState(state: MatrixState): state is MatrixEnvState {
  return state === 'dark' || state === 'w1280' || state === 'w768' || state === 'w390' || state === 'focus' || state === 'reduced-motion'
}

/** Page-level horizontal overflow plus every non-scroll container. Exported for the checker contract spec. */
export async function assertNoOverflow(page: Page): Promise<void> {
  const bad = await page.evaluate(() => {
    const out: string[] = []
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('page')
    for (const el of document.querySelectorAll('*')) {
      const html = el as HTMLElement
      if (!(html instanceof HTMLElement)) continue
      const style = getComputedStyle(html)
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue
      if (html.offsetParent === null && style.position !== 'fixed') continue
      // Not visible overflow: screen-reader-only content (Tailwind's
      // sr-only class or the 1px clipped pattern Radix renders inline),
      // Base UI 1.8 hidden inputs (clip-path inset(50%) paints nothing
      // regardless of box size), and ellipsis truncation (clipped by
      // definition; titles are checked separately). None can spill
      // visibly past its container.
      const rect = html.getBoundingClientRect()
      const visuallyHidden =
        html.classList.contains('sr-only') ||
        style.clipPath === 'inset(50%)' ||
        (rect.width <= 1 &&
          rect.height <= 1 &&
          (style.position === 'absolute' || style.position === 'fixed') &&
          (style.overflowX === 'hidden' || style.overflowX === 'clip'))
      if (visuallyHidden || style.textOverflow === 'ellipsis') continue
      if (html.scrollWidth > html.clientWidth + 1) {
        const text = String(html.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
        out.push(
          `${html.tagName.toLowerCase()}${html.id ? `#${html.id}` : ''}.${String(html.className).split(' ').slice(0, 2).join('.')} "${text}" sw=${html.scrollWidth} cw=${html.clientWidth}`,
        )
        if (out.length > 5) break
      }
    }
    return out
  })
  expect(bad, `horizontal overflow: ${bad.join(', ')}`).toEqual([])
}

/** Ellipsis-truncated text must expose its full copy via title or tooltip. */
async function assertTruncationTitles(page: Page): Promise<void> {
  const bad = await page.evaluate(() => {
    const out: string[] = []
    for (const el of document.querySelectorAll('*')) {
      const html = el as HTMLElement
      if (!(html instanceof HTMLElement) || html.offsetParent === null) continue
      const style = getComputedStyle(html)
      if (style.textOverflow !== 'ellipsis' || html.scrollWidth <= html.clientWidth + 1) continue
      const labelled =
        html.hasAttribute('title') ||
        html.hasAttribute('aria-label') ||
        html.hasAttribute('aria-describedby') ||
        html.closest('[title],[aria-label],[data-slot="tooltip-trigger"]') !== null
      if (!labelled) {
        out.push(`"${String(html.textContent).slice(0, 40)}"`)
        if (out.length > 5) break
      }
    }
    return out
  })
  expect(bad, `truncated without title: ${bad.join(', ')}`).toEqual([])
}

/** At 390px the subject anchors stay inside the viewport horizontally.
 * Gated cases assert postAnchors: the trigger is aria-hidden behind the
 * modal it opened, so its box is null by design.
 * Deliberately scrollable content (markdown tables) measures its scroll
 * container: the content box legitimately exceeds the viewport. */
async function assertContained(page: Page, anchors: MatrixAnchor[], postAnchors?: MatrixAnchor[]): Promise<void> {
  if (postAnchors && postAnchors.length > 0) anchors = postAnchors
  for (const anchor of anchors) {
    const handle = await anchorLocator(page, anchor).elementHandle()
    expect(handle, 'anchor has a box').not.toBeNull()
    const box = await page.evaluate((el) => {
      let node: HTMLElement | null = el as HTMLElement
      while (node && node !== document.body) {
        const style = getComputedStyle(node)
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') break
        node = node.parentElement
      }
      const rect = (node ?? (el as HTMLElement)).getBoundingClientRect()
      return { x: rect.x, width: rect.width }
    }, handle)
    expect(box.x).toBeGreaterThanOrEqual(-1)
    expect(box.x + box.width).toBeLessThanOrEqual(391)
  }
}

/**
 * Finite CSS enter/exit transitions settle before geometry checks.
 * Infinite indicators (spinners, shimmer) never finish and are skipped;
 * the wait is bounded so a stuck transition fails the checks, not the
 * wait. JS-driven Motion loops freeze under the harness fake clock and
 * are not measured here.
 */
async function waitForMotionSettled(page: Page): Promise<void> {
  await page.evaluate(() => {
    const finite = document.getAnimations().filter((animation) => {
      if (animation.playState !== 'running') return false
      const timing = (animation.effect as KeyframeEffect | null)?.getTiming?.()
      return timing !== undefined && timing.iterations !== Infinity
    })
    return Promise.race([
      Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ])
  }).catch(() => undefined)
}

/**
 * Keyboard focus reaches the subject and renders a visible indicator.
 * Every subject is reached by Tab like a keyboard user and must show an
 * outline or ring. A programmatic .focus() fast-path used to skip the
 * tab walk, but after a mouse setup click it never matches
 * :focus-visible, so it asserted an invisible ring on correct CSS.
 */
async function assertFocusVisible(page: Page, subject: Locator): Promise<void> {
  // Bounded attach wait first: a bare elementHandle() hangs to the test
  // timeout on aria-hidden subjects (modal backdrops), hiding the real
  // verdict. Attached (not visible) keeps backdrop subjects resolvable
  // so the tab walk below can report them unreachable instead.
  await subject.waitFor({ state: 'attached', timeout: 5000 })
  const handle = await subject.elementHandle()
  expect(handle, 'focus subject resolves').not.toBeNull()
  const isInside = () =>
    page.evaluate(
      (root) => root === document.activeElement || root.contains(document.activeElement),
      handle,
    )
  // Walk from the current position: blur() cannot reset the sequential
  // start (Chrome resumes past the blurred element), and tab order wraps,
  // so a full cycle reaches every stop. Budget 200 covers the longest
  // matrix walk (SectorChat log plus files rail: ~120 stops, probed).
  let inside = await isInside()
  let tabbed = false
  for (let i = 0; i < 200 && !inside; i++) {
    await page.keyboard.press('Tab')
    tabbed = true
    inside = await isInside()
  }
  expect(inside, 'focus reaches the subject').toBe(true)
  if (!tabbed) {
    // Focus arrived by mouse or script (a setup click on the subject,
    // dialog autofocus): :focus-visible never matches there, so step
    // out and back in via the keyboard before judging the ring.
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
  }
  const visible = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return 'nothing focused'
    const style = getComputedStyle(el)
    // Design-system focus is outline rings (focusRing*); any box-shadow
    // passes nothing (P6 minor: the old `|| ringed` admitted shadows).
    const outlined = style.outlineStyle !== 'none' && style.outlineWidth !== '0px'
    return outlined ? 'ok' : 'no visible indicator'
  })
  expect(visible).toBe('ok')
}

async function runAxe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze()
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(serious.map((v) => `${v.id}: ${v.nodes.length} nodes`), 'serious axe violations').toEqual([])
}

async function matrixShot(page: Page, id: string, state: MatrixState): Promise<void> {
  const shotName = `${fileSafe(id)}-${state}`
  // Pinned-font wait (repo convention): the bundled variable font must be
  // loaded before the shutter; time is already frozen by the harness clock.
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined)
  if (shotsMode()) {
    mkdirSync(SHOTS_DIR, { recursive: true })
    const file = resolve(SHOTS_DIR, `${shotName}.png`)
    await page.screenshot({ path: file, animations: 'disabled' })
    appendFileSync(MANIFEST, `${JSON.stringify({ file, id, state })}\n`)
    return
  }
  await expect(page).toHaveScreenshot(`${shotName}.png`, {
    maxDiffPixelRatio: 0.001,
    animations: 'disabled',
  })
}

function fileSafe(id: string): string {
  return id.replace(/^frontend\.src\.components\./, '').replace(/^frontend\.hook\./, 'hook-').replace(/\./g, '-')
}

export async function runMatrixState(page: Page, mc: MatrixCase, state: MatrixState): Promise<void> {
  if (mc.anchors.length === 0) throw new Error(`matrix case ${mc.id} needs at least one anchor`)
  const env = isEnvState(state)
  const dataState: MatrixDataState = env ? (mc.envBasis ?? 'typical') : state
  const width = typeof state === 'string' && WIDTHS[state] ? WIDTHS[state] : 1440
  // Error/denied/offline/partial states fault the mocked API by design,
  // so the browser's own resource errors for /v1/ URLs are expected there —
  // and only there. Healthy-state runs stay strict: an unmocked endpoint's
  // catch-all 404 must still trip the console assertion.
  const faultedApi = dataState === 'error' || dataState === 'denied' || dataState === 'offline' || dataState === 'partial' ||
    // Empty detail is a by-design 404 (sector-empty); other empties serve
    // 200s and stay strict so unmocked-endpoint 404s still trip.
    (dataState === 'empty' && mc.primary === 'sector')
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    if (faultedApi && isFaultedResourceNoise(msg, /\/v1\//)) return
    errors.push(msg.text().slice(0, 300))
  })
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 300)))

  await page.clock.install({ time: new Date(FIXED_NOW) })
  // Held-open stream: static's instant EOF leaves chat routes stuck on
  // "Reconnecting" (the tail treats clean EOF as a break), shifting the
  // log layout at a wall-clock-dependent moment — nondeterministic
  // screenshots. Live primes the same messages, then holds the socket
  // open like the real server, so pixel tests see a quiescent stream.
  await serveApi(page, { ...matrixApiOptions(dataState, mc.primary, mc.secondary, mc.sectorState, mc.localVariant), stream: 'live' })
  await page.setViewportSize({ width, height: HEIGHTS[width] ?? 800 })
  if (state === 'dark') await page.emulateMedia({ colorScheme: 'dark' })
  if (state === 'reduced-motion') await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(mc.route)
  // Navigate online (goto itself fails offline), then drop the network
  // and refetch into the offline anatomy, like the failures offline
  // specs: aborted fetch alone renders the error branch (navigator
  // still online), never the offline branch. Gated surfaces transition
  // after setup opens them (their retry lives inside the surface).
  async function goOffline() {
    await expect(page.getByRole('button', { name: 'Try again' }).first()).toBeVisible({ timeout: 15000 })
    await page.context().setOffline(true)
    await page.getByRole('button', { name: 'Try again' }).first().click()
  }
  if (dataState === 'offline' && !mc.gated) await goOffline()
  if (state === 'dark') await expect(page.locator('html.dark')).toBeAttached({ timeout: 5000 })
  if (state === 'reduced-motion') {
    const reduced = await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    expect(reduced).toBe(true)
  }

  for (const anchor of mc.anchors) await expect(anchorLocator(page, anchor)).toBeVisible({ timeout: 15000 })
  for (const step of mc.setup ?? []) {
    if (step.click) await anchorLocator(page, step.click).click()
    else if (step.hover) await anchorLocator(page, step.hover).hover()
    else if (step.press) await page.keyboard.press(step.press)
  }
  if (dataState === 'offline' && mc.gated) await goOffline()
  if (!mc.gated) {
    for (const anchor of mc.anchors) await expect(anchorLocator(page, anchor)).toBeVisible({ timeout: 15000 })
  }
  for (const anchor of mc.postAnchors ?? []) await expect(anchorLocator(page, anchor)).toBeVisible({ timeout: 15000 })
  if (mc.expectedRows) {
    await expect(page.locator(mc.expectedRows.selector)).toHaveCount(mc.expectedRows.count, { timeout: 15000 })
  }
  for (const want of mc.expectedTexts ?? []) {
    await expect(page.getByText(want.text, { exact: want.exact ?? false }).first()).toBeVisible({ timeout: 15000 })
  }

  // Geometry checks measure settled boxes: a setup click opens surfaces
  // behind 120-240ms enter transitions, and getBoundingClientRect mid
  // slide reads the translated box (the w390 dock measured 393px).
  await waitForMotionSettled(page)
  await assertNoOverflow(page)
  await assertTruncationTitles(page)
  if (state === 'w390') await assertContained(page, mc.anchors, mc.gated ? mc.postAnchors : undefined)
  if (state === 'focus') {
    const subject = mc.focusSubject ?? (mc.anchors[0] as MatrixAnchor)
    await assertFocusVisible(page, anchorLocator(page, subject))
  }
  await runAxe(page)
  await matrixShot(page, mc.id, state)
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([])
  if (dataState === 'offline') await page.context().setOffline(false)
}
