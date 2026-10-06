// Failure-matrix harness (P6.4): one flow per (endpoint, fault). The fault
// route registers BEFORE serveApi with an armed flag (Playwright runs
// matching routes in registration order; unarmed falls through to the ok
// backend). Verified cases: load ok -> draft -> arm -> refetch -> designed
// error/denied UI + retry + draft kept -> heal -> retry -> content back.
// Unverified cases (no proven error UI): chrome intact + console clean +
// shot for grading, then reload-heal. Silent cases (skills): the fault is
// armed before load and the surface must work regardless.
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page, type Route } from '@playwright/test'
import { serveApi, type ApiData } from './api'
import { makeCompanies, makeRuns, makeSessions, matrixSector } from './factory'
import { anchorLocator, isFaultedResourceNoise, unattributedNoiseStatus, type MatrixAnchor, type MatrixSetup } from './matrix'

export type FaultKind =
  | 'f500' | 'f401' | 'f403' | 'f404' | 'f409' | 'f429'
  | 'timeout' | 'abort' | 'malformed'

export const FAULTS: FaultKind[] = [
  'f500', 'f401', 'f403', 'f404', 'f409', 'f429',
  'timeout', 'abort', 'malformed',
]

const STATUS: Partial<Record<FaultKind, number>> = {
  f500: 500, f401: 401, f403: 403, f404: 404, f409: 409, f429: 429,
}

export interface FailuresFill {
  fill: MatrixAnchor
  text: string
}

export type RefetchStep = MatrixSetup | FailuresFill

export interface FaultCase {
  /** Registry component id, for the [F:] tag. */
  id: string
  label: string
  method: string
  /** Matches the endpoint's requests (tight: must not swallow siblings). */
  pattern: RegExp
  route: string
  setup?: MatrixSetup[]
  /** Designed error UI for 5xx/404/409/429/timeout/abort/malformed. */
  errorAnchors?: MatrixAnchor[]
  /** Designed denied UI for 401/403. */
  deniedAnchors?: MatrixAnchor[]
  /** Asserted visible during the fault but allowed to persist after heal
   * (draft echoes, retained form text). Never hidden-checked. */
  errorContent?: MatrixAnchor[]
  /** Content anchors proving heal + the ok baseline. */
  healAnchors: MatrixAnchor[]
  retry?: MatrixAnchor
  deniedRetry?: MatrixAnchor
  /** Asserted hidden after heal (error UI gone, not just content back). */
  healAbsent?: MatrixAnchor[]
  /** Heal by re-running the trigger steps (mutations without retry UI). */
  healRetrigger?: boolean
  draftFill?: MatrixAnchor
  draftText?: string
  /** Refetch after arming: reload, or in-page steps (no reload). Drafts ride
   * refetch flows only: a reload clears React-state input by design. A fill
   * step updates the expected draft value. */
  refetch: { reload: true } | { steps: RefetchStep[] }
  /** No proven error UI: assert chrome + console + shot, reload-heal. */
  unverified?: boolean
  /** Fixture-data override, merged into the serveApi data (e.g. a local
   * variant with pending operations so the trigger exists). */
  apiData?: Partial<ApiData>
  /** Arm before load; the surface must work regardless of the fault. */
  silent?: boolean
}

const supportDir = dirname(fileURLToPath(import.meta.url))
const FAILURES_DIR = resolve(supportDir, '../../../frontend/test-results/failures')

function fileSafe(label: string): string {
  return label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
}

async function fulfillFault(route: Route, fault: FaultKind): Promise<void> {
  const status = STATUS[fault]
  if (status !== undefined) {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: { code: 'fault', message: `injected ${status}` } }),
    })
    return
  }
  if (fault === 'timeout') {
    // Past the 30s client budget; the late ok lands after the UI already
    // failed honestly, and the heal path re-fetches anyway.
    await new Promise((resolve) => setTimeout(resolve, 32_000))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: [] }) })
    return
  }
  if (fault === 'abort') {
    await route.abort('internetdisconnected')
    return
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: 'this is not json{{{' })
}

async function runSetup(page: Page, setup: MatrixSetup[] | undefined): Promise<void> {
  for (const step of setup ?? []) {
    if (step.click) await anchorLocator(page, step.click).click()
    else if (step.hover) await anchorLocator(page, step.hover).hover()
    else if (step.press) await page.keyboard.press(step.press)
  }
}

async function runRefetch(page: Page, fc: FaultCase, expected: { draft: string | null }): Promise<void> {
  const steps = 'steps' in fc.refetch ? fc.refetch.steps : []
  for (const step of steps) {
    if ('fill' in step) {
      await anchorLocator(page, step.fill).fill(step.text)
      expected.draft = step.text
    } else if (step.click) await anchorLocator(page, step.click).click()
    else if (step.hover) await anchorLocator(page, step.hover).hover()
    else if (step.press) await page.keyboard.press(step.press)
  }
}

export async function runFault(page: Page, fc: FaultCase, fault: FaultKind): Promise<void> {
  const errors: string[] = []
  // The faulted scope proves itself on the wire by status: unattributed
  // resource noise drops only when the scope actually served that status.
  // Aborts and malformed bodies serve no error status, so their noise
  // (app fallout requesting something unmocked) still fails by design.
  const faultedStatuses = new Set<number>()
  page.on('response', (response) => {
    if (fc.pattern.test(response.url())) faultedStatuses.add(response.status())
  })
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    // The faulted request makes Chromium itself log a resource error naming
    // the faulted URL; drop that noise for the faulted pattern only.
    if (isFaultedResourceNoise(msg, fc.pattern)) return
    const noiseStatus = unattributedNoiseStatus(msg)
    if (noiseStatus !== undefined && faultedStatuses.has(noiseStatus)) return
    errors.push(msg.text().slice(0, 300))
  })
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 300)))

  // Route order matters: Playwright matches page.route handlers
  // last-registered-first, so the fault route goes AFTER serveApi and
  // falls back to it for everything outside the faulted scope.
  await serveApi(page, {
    stream: 'static',
    data: {
      sectors: [matrixSector()],
      companies: makeCompanies(8),
      sessions: makeSessions(8),
      runs: makeRuns(8),
      ...fc.apiData,
    },
  })
  let armed = fc.silent === true
  await page.route(fc.pattern, async (route) => {
    // Dev-asset guard: patterns match URL substrings, and vite names
    // code-split chunks after their modules (api/artifacts.ts ships as
    // /assets/artifacts-*.js). Only the staging API carries /v1/.
    if (!route.request().url().includes('/v1/') || route.request().method() !== fc.method || !armed) {
      await route.fallback()
      return
    }
    await fulfillFault(route, fault)
  })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(fc.route)
  await runSetup(page, fc.setup)
  for (const anchor of fc.healAnchors) await expect(anchorLocator(page, anchor)).toBeVisible({ timeout: 15000 })

  if (fc.silent) {
    // The fault was armed from load: the surface works regardless.
    mkdirSync(FAILURES_DIR, { recursive: true })
    await page.screenshot({ path: resolve(FAILURES_DIR, `${fileSafe(fc.label)}-${fault}.png`), animations: 'disabled' })
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([])
    return
  }

  const expected: { draft: string | null } = { draft: null }
  if (fc.draftFill && fc.draftText) {
    await anchorLocator(page, fc.draftFill).fill(fc.draftText)
    expected.draft = fc.draftText
  }
  armed = true
  if ('reload' in fc.refetch && fc.refetch.reload) {
    await page.reload()
    await runSetup(page, fc.setup)
  } else {
    await runRefetch(page, fc, expected)
  }

  if (fc.unverified) {
    for (const anchor of fc.healAnchors) await expect(anchorLocator(page, anchor)).toBeVisible({ timeout: 45000 })
  } else {
    const denied = fault === 'f401' || fault === 'f403'
    const wanted = denied ? fc.deniedAnchors : fc.errorAnchors
    if (!wanted) throw new Error(`${fc.label}: missing ${denied ? 'denied' : 'error'} anchors`)
    for (const anchor of wanted) await expect(anchorLocator(page, anchor)).toBeVisible({ timeout: 45000 })
    const retry = denied ? (fc.deniedRetry ?? fc.retry) : fc.retry
    if (retry) await expect(anchorLocator(page, retry)).toBeVisible({ timeout: 15000 })
    for (const anchor of fc.errorContent ?? []) {
      await expect(anchorLocator(page, anchor)).toBeVisible({ timeout: 15000 })
    }
  }
  if (fc.draftFill && expected.draft !== null) {
    await expect(anchorLocator(page, fc.draftFill)).toHaveValue(expected.draft)
  }
  mkdirSync(FAILURES_DIR, { recursive: true })
  await page.screenshot({ path: resolve(FAILURES_DIR, `${fileSafe(fc.label)}-${fault}.png`), animations: 'disabled' })

  // Heal: retry when the UI offers one, re-trigger for mutations, else
  // reload into the healed backend.
  await page.unroute(fc.pattern)
  const denied = fault === 'f401' || fault === 'f403'
  const retry = denied ? (fc.deniedRetry ?? fc.retry) : fc.retry
  if (!fc.unverified && retry && !fc.healRetrigger) {
    await anchorLocator(page, retry).click()
  } else if (!fc.unverified && fc.healRetrigger) {
    await runRefetch(page, fc, expected)
  } else {
    await page.reload()
    await runSetup(page, fc.setup)
  }
  for (const anchor of fc.healAnchors) await expect(anchorLocator(page, anchor)).toBeVisible({ timeout: 15000 })
  if (!fc.unverified) {
    for (const anchor of [...(fc.errorAnchors ?? []), ...(fc.deniedAnchors ?? []), ...(fc.healAbsent ?? [])]) {
      await expect(anchorLocator(page, anchor)).not.toBeVisible({ timeout: 15000 })
    }
  }
  if (fc.draftFill && expected.draft !== null) {
    await expect(anchorLocator(page, fc.draftFill)).toHaveValue(expected.draft)
  }
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([])
}
