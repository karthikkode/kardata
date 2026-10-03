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
  for (const theme of themes) {
    await page.emulateMedia({ colorScheme: theme })
    for (const width of widths) {
      await page.setViewportSize({ width, height: HEIGHTS[width] ?? 800 })
      await prepare()
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
