// Matrix runner (P6.3): one code path for every (component, state) case.
// Each state asserts all seven checks: no horizontal overflow, 390
// containment, truncation titles, visible focus (focus state), zero console
// errors, zero serious axe violations, and a pixel shot (toHaveScreenshot
// by default; MATRIX_SHOTS=1 writes grading PNGs + manifest.jsonl, which
// scripts/ui-review.mjs assembles into manifest.json).
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Locator, type Page } from '@playwright/test'
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
  emptyAnchors?: MatrixAnchor[]
  /** Focus-state subject (default anchors[0]); leaves focus directly. */
  focusSubject?: MatrixAnchor
  primary: RouteKey
  secondary?: RouteKey
  envBasis?: MatrixDataState
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
  if (anchor.kind === 'role') return page.getByRole(anchor.role as never, anchor.name ? { name: anchor.name } : undefined).first()
  if (anchor.kind === 'text') return page.getByText(anchor.text as string).first()
  return page.locator(anchor.css as string).first()
}

function isEnvState(state: MatrixState): state is MatrixEnvState {
  return state === 'dark' || state === 'w1280' || state === 'w768' || state === 'w390' || state === 'focus' || state === 'reduced-motion'
}

/** Page-level horizontal overflow plus every non-scroll container. */
async function assertNoOverflow(page: Page): Promise<void> {
  const bad = await page.evaluate(() => {
    const out: string[] = []
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('page')
    for (const el of document.querySelectorAll('*')) {
      const html = el as HTMLElement
      if (!(html instanceof HTMLElement)) continue
      const style = getComputedStyle(html)
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue
      if (html.offsetParent === null && style.position !== 'fixed') continue
      if (html.scrollWidth > html.clientWidth + 1) {
        out.push(`${html.tagName.toLowerCase()}${html.id ? `#${html.id}` : ''}.${String(html.className).split(' ').slice(0, 2).join('.')}`)
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

/** At 390px the subject anchors stay inside the viewport horizontally. */
async function assertContained(page: Page, anchors: MatrixAnchor[]): Promise<void> {
  for (const anchor of anchors) {
    const box = await anchorLocator(page, anchor).boundingBox()
    expect(box, 'anchor has a box').not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(-1)
    expect(box!.x + box!.width).toBeLessThanOrEqual(391)
  }
}

/**
 * Keyboard focus reaches the subject and renders a visible indicator.
 * Focusable leaves focus directly; containers tab in from the top like a
 * keyboard user; both must show an outline or ring.
 */
async function assertFocusVisible(page: Page, subject: Locator): Promise<void> {
  const handle = await subject.elementHandle()
  expect(handle, 'focus subject resolves').not.toBeNull()
  await subject.focus().catch(() => undefined)
  let inside = await page.evaluate(
    (root) => root === document.activeElement || root.contains(document.activeElement),
    handle,
  )
  for (let i = 0; i < 30 && !inside; i++) {
    await page.keyboard.press('Tab')
    inside = await page.evaluate(
      (root) => root === document.activeElement || root.contains(document.activeElement),
      handle,
    )
  }
  expect(inside, 'focus reaches the subject').toBe(true)
  const visible = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return 'nothing focused'
    const style = getComputedStyle(el)
    const outlined = style.outlineStyle !== 'none' && style.outlineWidth !== '0px'
    const ringed = style.boxShadow !== 'none'
    return outlined || ringed ? 'ok' : 'no visible indicator'
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
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text().slice(0, 300))
  })
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 300)))

  await page.clock.install({ time: new Date(FIXED_NOW) })
  await serveApi(page, { ...matrixApiOptions(dataState, mc.primary, mc.secondary), stream: 'static' })
  await page.setViewportSize({ width, height: HEIGHTS[width] ?? 800 })
  if (state === 'dark') await page.emulateMedia({ colorScheme: 'dark' })
  if (state === 'reduced-motion') await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(mc.route)
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
  for (const anchor of mc.anchors) await expect(anchorLocator(page, anchor)).toBeVisible({ timeout: 15000 })
  for (const anchor of mc.postAnchors ?? []) await expect(anchorLocator(page, anchor)).toBeVisible({ timeout: 15000 })

  await assertNoOverflow(page)
  await assertTruncationTitles(page)
  if (state === 'w390') await assertContained(page, mc.anchors)
  if (state === 'focus') {
    const subject = mc.focusSubject ?? (mc.anchors[0] as MatrixAnchor)
    await assertFocusVisible(page, anchorLocator(page, subject))
  }
  await runAxe(page)
  await matrixShot(page, mc.id, state)
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([])
}
