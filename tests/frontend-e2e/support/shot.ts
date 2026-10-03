// v2 screenshot helper: every shot in light+dark at 1440+390 by default.
// Output: frontend/test-results/v2/<ID>-<state>-<theme>-<width>.png

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

const supportDir = dirname(fileURLToPath(import.meta.url))
export const V2_OUT = resolve(supportDir, '../../../frontend/test-results/v2')
export const V2_AUDIT = resolve(V2_OUT, 'audit')

export type ShotTheme = 'light' | 'dark'

export interface ShotOptions {
  widths?: number[]
  heights?: Record<number, number>
  themes?: ShotTheme[]
  /** Selectors that must be visible before the shutter fires. */
  anchors?: string[]
  /** Extra settle time after anchors (ms). Default 400. */
  settleMs?: number
  /** Apply the theme. Default: emulateMedia (v2 system preference). */
  applyTheme?: (page: Page, theme: ShotTheme) => Promise<void>
  /** Runs after anchors settle, before the shutter (e.g. scroll the subject into view at 390). */
  beforeShot?: (page: Page, width: number, theme: ShotTheme) => Promise<void>
}

const DEFAULT_HEIGHTS: Record<number, number> = { 1440: 900, 1280: 800, 1279: 800, 1024: 768, 768: 1024, 767: 1024, 390: 844 }

async function defaultApplyTheme(page: Page, theme: ShotTheme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme })
  // React flips .dark asynchronously after the media change; shooting or
  // auditing before it settles mixes dark text with a light background.
  await page
    .waitForFunction((expected) => document.documentElement.classList.contains('dark') === (expected === 'dark'), theme, { timeout: 5000 })
    .catch(() => undefined)
}

/** Fail-loud theme settle for audits (contrast is meaningless mid-flip). */
export async function settleTheme(page: Page, theme: ShotTheme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme })
  await page.waitForFunction((expected) => document.documentElement.classList.contains('dark') === (expected === 'dark'), theme, {
    timeout: 5000,
  })
  // The class flips first; transition-colors finishes 120ms later. Audit
  // before that and text still computes the old endpoint (as oklab).
  await page.waitForTimeout(300)
}

export function shotPath(id: string, state: string, theme: ShotTheme, width: number): string {
  return resolve(V2_OUT, `${id}-${state}-${theme}-${width}.png`)
}

export async function shot(page: Page, id: string, state: string, options: ShotOptions = {}): Promise<string[]> {
  const widths = options.widths ?? [1440, 390]
  const themes = options.themes ?? ['light', 'dark']
  const applyTheme = options.applyTheme ?? defaultApplyTheme
  const files: string[] = []
  mkdirSync(V2_OUT, { recursive: true })
  for (const theme of themes) {
    await applyTheme(page, theme)
    for (const width of widths) {
      const height = options.heights?.[width] ?? DEFAULT_HEIGHTS[width] ?? 800
      await page.setViewportSize({ width, height })
      await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined)
      for (const anchor of options.anchors ?? []) {
        await page.locator(anchor).first().waitFor({ state: 'visible', timeout: 15_000 })
      }
      await page.waitForTimeout(options.settleMs ?? 400)
      await options.beforeShot?.(page, width, theme)
      const file = shotPath(id, state, theme, width)
      await page.screenshot({ path: file, animations: 'disabled' })
      files.push(file)
    }
  }
  return files
}
