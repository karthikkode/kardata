// Stage 1 style audit on Overview: every state x theme x 1440/390.
// Desktop 390 skips `targets` (fine pointer, 32px floor); the 40px touch
// floor is enforced in a coarse-pointer mobile context instead. `alignment`
// is page-owned: Stage 2 enables it once SH-01 lands.

import { devices, expect, test, type Browser, type Page } from '@playwright/test'
import { serveApi, type ApiOptions } from '../support/api'
import { auditPage, formatViolations, writeAuditReport } from '../support/audit'
import { settleTheme, shot, shotPath, type ShotTheme } from '../support/shot'

const BASE = `http://127.0.0.1:${process.env.KARDATA_E2E_PORT ?? 5174}`
const THEMES: ShotTheme[] = ['light', 'dark']

async function auditOverview(
  page: Page,
  browser: Browser,
  state: string,
  options: ApiOptions,
  anchors: string | string[],
): Promise<void> {
  // Anchors must prove the state SETTLED: h1 alone is visible during
  // loading, which once let an empty-mode hang pass as "empty".
  const anchorList = Array.isArray(anchors) ? anchors : [anchors]
  const anchor = anchorList[0] as string
  await serveApi(page, { ...options, loadingMs: 20_000 })
  await page.goto('/')
  for (const settled of anchorList) await expect(page.locator(settled)).toBeVisible()
  await shot(page, `OV-audit-${state}`, 'default', { anchors: anchorList })

  for (const theme of THEMES) {
    await settleTheme(page, theme)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 })
      if (state === 'loading') {
        await page.goto('/')
        await expect(page.locator(anchor)).toBeVisible()
        await settleTheme(page, theme)
      }
      const skip = width === 390 ? ['targets', 'alignment'] : ['alignment']
      const result = await auditPage(page, { skip })
      const report = await writeAuditReport(`overview-${state}-${theme}-${width}`, result)
      expect(result.violations, `${report}\n${formatViolations(result)}`).toEqual([])
    }
  }

  // A real device descriptor: hand-rolled { has_touch, is_mobile } does
  // NOT match (pointer: coarse) in headless Chromium, the descriptor does.
  const context = await browser.newContext({ ...devices['iPhone 12'], baseURL: BASE })
  const mpage = await context.newPage()
  try {
    await serveApi(mpage, { ...options, loadingMs: 20_000 })
    for (const theme of THEMES) {
      await mpage.emulateMedia({ colorScheme: theme })
      await mpage.goto('/')
      await expect(mpage.locator(anchor)).toBeVisible()
      await settleTheme(mpage, theme)
      const coarse = await mpage.evaluate(() => window.matchMedia('(pointer: coarse)').matches)
      expect(coarse, 'mobile context must emulate a coarse pointer').toBe(true)
      await mpage.screenshot({ path: shotPath(`OV-audit-${state}`, 'mobile', theme, 390), animations: 'disabled' })
      const result = await auditPage(mpage, { skip: ['alignment'] })
      const report = await writeAuditReport(`overview-${state}-${theme}-390-mobile`, result)
      expect(result.violations, `${report}\n${formatViolations(result)}`).toEqual([])
    }
  } finally {
    await context.close()
  }
}

test('audit-overview-default', async ({ page, browser }) => {
  await auditOverview(page, browser, 'default', {}, [
    'button:has-text("View all 10 sector researches")',
    'button:has-text("View all 2000 company researches")',
  ])
})

test('audit-overview-loading', async ({ page, browser }) => {
  await auditOverview(
    page, browser, 'loading',
    { modes: { sectors: 'loading', companies: 'loading' } },
    [
      'div[aria-label="Sector researches are loading"]',
      'div[aria-label="Company researches are loading"]',
    ],
  )
})

test('audit-overview-empty', async ({ page, browser }) => {
  await auditOverview(
    page, browser, 'empty',
    { modes: { sectors: 'empty', companies: 'empty' } },
    [
      'button:has-text("Start a sector research") >> nth=0',
      'button:has-text("Start a sector research") >> nth=1',
    ],
  )
})

test('audit-overview-error', async ({ page, browser }) => {
  await auditOverview(
    page, browser, 'error',
    { modes: { sectors: 'error', companies: 'error' } },
    ['text=Sector researches did not load.', 'text=Company researches did not load.'],
  )
})

test('audit-overview-denied', async ({ page, browser }) => {
  await auditOverview(
    page, browser, 'denied',
    { modes: { sectors: 'denied', companies: 'denied' } },
    [
      'text=Sector researches are not shared with this key.',
      'text=Company researches are not shared with this key.',
    ],
  )
})
