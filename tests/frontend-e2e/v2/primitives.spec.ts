// Stage 1 primitives (F4): every adopted primitive shot on its real page
// location in hover/focus/open/disabled states, light+dark at 1440+390.
// Adopter-less primitives (menu, popover) stay unit-tested until SH-04
// (menu) and CP-03/CP-05 (popover) adopt them; see the handoff.

import { expect, test, type Page } from '@playwright/test'
import { serveApi } from '../support/api'
import { shot, shotPath, type ShotTheme } from '../support/shot'

const THEMES: ShotTheme[] = ['light', 'dark']
const WIDTHS = [1440, 390]
const HEIGHTS: Record<number, number> = { 1440: 900, 390: 844 }

/** Fresh navigation per theme x width, then interact, then shoot. */
async function capture(
  page: Page,
  id: string,
  state: string,
  prepare: () => Promise<void>,
  interact?: () => Promise<void>,
  settleMs = 400,
): Promise<void> {
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme })
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: HEIGHTS[width] ?? 800 })
      await prepare()
      await interact?.()
      await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined)
      await page.waitForTimeout(settleMs)
      await page.screenshot({ path: shotPath(id, state, theme, width), animations: 'disabled' })
    }
  }
}

async function gotoResearches(page: Page): Promise<void> {
  await serveApi(page)
  await page.goto('/?section=Researches')
  await expect(page.locator('h1:has-text("Researches")')).toBeVisible()
}

test('F4-buttons-default', async ({ page }) => {
  await gotoResearches(page)
  await shot(page, 'F4-buttons', 'default', { anchors: ['h1:has-text("Researches")'] })
})

test('F4-button-hover', async ({ page }) => {
  await capture(page, 'F4-button', 'hover', () => gotoResearches(page), () =>
    page.getByRole('button', { name: 'New sector' }).hover(),
  )
})

test('F4-button-focus', async ({ page }) => {
  await capture(page, 'F4-button', 'focus', () => gotoResearches(page), () =>
    page.getByRole('button', { name: 'New sector' }).focus(),
  )
})

test('F4-input-focus', async ({ page }) => {
  await capture(page, 'F4-input', 'focus', () => gotoResearches(page), () =>
    page.getByPlaceholder('Type to filter').focus(),
  )
})

test('F4-input-filled', async ({ page }) => {
  await capture(page, 'F4-input', 'filled', () => gotoResearches(page), () =>
    page.getByPlaceholder('Type to filter').fill('zzz-no-such-sector').then(() => undefined),
  )
})

test('F4-select-open', async ({ page }) => {
  await capture(page, 'F4-select', 'open', () => gotoResearches(page), () =>
    page.locator('[aria-labelledby="researches-state-label"]').click(),
  )
})

test('F4-tabs-sectors', async ({ page }) => {
  await gotoResearches(page)
  await shot(page, 'F4-tabs', 'sectors', { anchors: ['[role="tablist"]'] })
})

test('F4-tabs-companies', async ({ page }) => {
  await capture(page, 'F4-tabs', 'companies', () => gotoResearches(page), () =>
    page.getByRole('tab', { name: 'Companies' }).click(),
  )
})

test('F4-dialog-open', async ({ page }) => {
  await capture(page, 'F4-dialog', 'open', () => gotoResearches(page), async () => {
    await page.getByRole('button', { name: 'New sector' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })
})

test('F4-tooltip', async ({ page }) => {
  await serveApi(page)
  await capture(
    page, 'F4-tooltip', 'open',
    async () => {
      await page.goto('/')
      await expect(page.locator('h1:has-text("Overview")')).toBeVisible()
    },
    () => page.getByRole('button', { name: 'Open chat' }).hover(),
    800,
  )
})

test('F4-toast-success', async ({ page }) => {
  await capture(
    page, 'F4-toast', 'success',
    async () => {
      await serveApi(page)
      await page.goto('/')
      await expect(page.locator('h1:has-text("Overview")')).toBeVisible()
    },
    async () => {
      await page.evaluate(`import('/src/lib/toast.ts').then((m) => m.notify.success('Sector created'))`)
      await expect(page.getByText('Sector created')).toBeVisible()
    },
  )
})

test('F4-toast-error', async ({ page }) => {
  await capture(
    page, 'F4-toast', 'error',
    async () => {
      await serveApi(page)
      await page.goto('/')
      await expect(page.locator('h1:has-text("Overview")')).toBeVisible()
    },
    async () => {
      await page.evaluate(`import('/src/lib/toast.ts').then((m) => m.notify.error('Upload failed', { label: 'Retry', onClick: () => undefined }))`)
      await expect(page.getByText('Upload failed')).toBeVisible()
    },
  )
})

async function openPalette(page: Page): Promise<void> {
  await serveApi(page)
  await page.goto('/')
  await expect(page.locator('h1:has-text("Overview")')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
}

test('F4-palette-open', async ({ page }) => {
  await capture(page, 'F4-palette', 'open', () => openPalette(page))
})

test('F4-palette-filtered', async ({ page }) => {
  await capture(page, 'F4-palette', 'filtered', () => openPalette(page), () =>
    page.getByPlaceholder('Search commands and sectors...').fill('Sydney').then(() => undefined),
  )
})

test('F4-palette-empty', async ({ page }) => {
  await capture(page, 'F4-palette', 'empty', () => openPalette(page), () =>
    page.getByPlaceholder('Search commands and sectors...').fill('zzz-no-such-thing').then(() => undefined),
  )
})

test('F4-skeleton', async ({ page }) => {
  await capture(page, 'F4-skeleton', 'loading', async () => {
    await serveApi(page, { modes: { sectors: 'loading', companies: 'loading' } })
    await page.goto('/')
    await expect(page.locator('[role="status"]').first()).toBeVisible()
  })
})

test('F4-badge', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=Models')
  await expect(page.getByText('Configured').first()).toBeVisible()
  await shot(page, 'F4-badge', 'default', { anchors: ['text=Configured'] })
})

test('F4-models-controls', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=Models')
  await expect(page.locator('h1:has-text("Models")')).toBeVisible()
  await shot(page, 'F4-models-controls', 'default', { anchors: ['h1:has-text("Models")'] })
})

test('F4-collapsible', async ({ page }) => {
  await serveApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Open chat' }).click()
  await expect(page.getByRole('complementary', { name: 'Assistant chat' })).toBeVisible()
  const disclosure = page.getByRole('button', { name: /Reasoning|Activity/ }).first()
  if ((await disclosure.count()) === 0) test.skip(true, 'no settled tool/reasoning disclosure in the Karbot fixture thread')
  await shot(page, 'F4-collapsible', 'collapsed', { anchors: ['[aria-label="Assistant chat"]'] })
  await disclosure.click()
  await shot(page, 'F4-collapsible', 'expanded', { anchors: ['[aria-label="Assistant chat"]'] })
})

test('F4-progress', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=SectorChat&sector=sector-electrical')
  const planTab = page.getByRole('tab', { name: 'Plan' })
  if ((await planTab.count()) === 0) test.skip(true, 'no Plan tab in current workspace')
  await planTab.click()
  const progress = page.locator('[role="progressbar"]').first()
  if ((await progress.count()) === 0) test.skip(true, 'no progressbar on the current Plan tab')
  await shot(page, 'F4-progress', 'default', { anchors: ['[role="progressbar"]'] })
})

test('F4-send-disabled', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=SectorChat&sector=sector-electrical')
  const send = page.getByRole('button', { name: 'Send message' })
  await expect(send).toBeDisabled()
  await shot(page, 'F4-send', 'disabled', { anchors: ['h1'] })
})
