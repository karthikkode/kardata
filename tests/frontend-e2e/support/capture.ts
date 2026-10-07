// v2 state capture: fresh navigation per theme x width, then an
// interaction, then the shutter. Interactions (hover/focus/open) do not
// survive the viewport/theme loop inside shot(), so state shots replay
// prepare + interact for every combo.
import type { Page } from '@playwright/test'
import { shotPath, type ShotTheme } from './shot'

export const CAPTURE_THEMES: ShotTheme[] = ['light', 'dark']
export const CAPTURE_WIDTHS = [1440, 390]
const HEIGHTS: Record<number, number> = { 1440: 900, 1280: 800, 1279: 800, 768: 1024, 767: 1024, 390: 844 }

export interface CaptureOptions {
  themes?: ShotTheme[]
  widths?: number[]
  settleMs?: number
}

export async function capture(
  page: Page,
  id: string,
  state: string,
  prepare: () => Promise<void>,
  interact?: () => Promise<void>,
  options: CaptureOptions = {},
): Promise<void> {
  const themes = options.themes ?? CAPTURE_THEMES
  const widths = options.widths ?? CAPTURE_WIDTHS
  // Flake signal: gotoDock's first click intermittently sees no shell
  // for 30 s (random victim per run). Collect the page-side evidence
  // so the next occurrence names its cause instead of just timing out.
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300))
  })
  page.on('pageerror', (error) => {
    pageErrors.push(String(error).slice(0, 300))
  })
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url().slice(0, 160)} ${(request.failure()?.errorText ?? '').slice(0, 80)}`)
  })
  for (const theme of themes) {
    await page.emulateMedia({ colorScheme: theme })
    for (const width of widths) {
      await page.setViewportSize({ width, height: HEIGHTS[width] ?? 800 })
      // One setup retry: box network flaps (ERR_NETWORK_CHANGED) blank
      // the shell on a random combo per run. Prepare is pure setup
      // (serveApi + navigate + open); interact assertions never retry,
      // and a deterministic product failure still fails twice with its
      // signal logged on both attempts, never masked.
      const signal = (tag: string): void => {
        console.log(`[capture ${id}/${state} ${theme}/${width} ${tag}] consoleErrors=${JSON.stringify(consoleErrors)} pageErrors=${JSON.stringify(pageErrors)} failedRequests=${JSON.stringify(failedRequests)}`)
      }
      // Try 1 runs on a 15 s action budget: a flap-blanked page fails
      // fast instead of burning the whole 30 s test timeout (which
      // closes the page and dooms any retry). Try 2 restores the
      // default budget on the healed network; interact is untouched.
      page.setDefaultTimeout(15_000)
      page.setDefaultNavigationTimeout(15_000)
      try {
        await prepare()
      } catch (error) {
        signal('try1-failed')
        consoleErrors.length = 0
        pageErrors.length = 0
        failedRequests.length = 0
        page.setDefaultTimeout(0)
        page.setDefaultNavigationTimeout(0)
        try {
          await prepare()
        } catch (retryError) {
          signal('try2-failed')
          throw retryError
        }
      } finally {
        page.setDefaultTimeout(0)
        page.setDefaultNavigationTimeout(0)
      }
      // React flips .dark asynchronously after the media change; the
      // wait keeps dark text off a light background (see shot.ts).
      await page
        .waitForFunction((expected) => document.documentElement.classList.contains('dark') === (expected === 'dark'), theme, { timeout: 5000 })
        .catch(() => undefined)
      await interact?.()
      await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined)
      await page.waitForTimeout(options.settleMs ?? 400)
      await page.screenshot({ path: shotPath(id, state, theme, width), animations: 'disabled' })
    }
  }
}
