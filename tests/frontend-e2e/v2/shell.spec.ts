// Stage 2 shell (SH-01..06): page frame, sidebar, top bar, theme menu,
// palette and toaster in light+dark at 1440+390 (768 where the plan
// names it). SH-07 lands in Stage 6, SH-08 in motion.spec.ts.
import { expect, test, type Page } from '@playwright/test'
import { serveApi } from '../support/api'
import { capture } from '../support/capture'
import { shot } from '../support/shot'

async function gotoOverview(page: Page): Promise<void> {
  await serveApi(page)
  await page.goto('/')
  await expect(page.locator('h1:has-text("Overview")')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Research totals' })).toBeVisible()
}

test('SH-01-overview', async ({ page }) => {
  await gotoOverview(page)
  await shot(page, 'SH-01-overview', 'default', { anchors: ['h1:has-text("Overview")'] })
})

test('SH-01-researches', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=Researches')
  await expect(page.locator('h1:has-text("Researches")')).toBeVisible()
  await shot(page, 'SH-01-researches', 'default', { anchors: ['h1:has-text("Researches")'] })
})

test('SH-01-sector-detail', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=SectorDetail&sector=sector-electrical')
  await expect(page.locator('h1:has-text("Australian electrical contractors")')).toBeVisible()
  await shot(page, 'SH-01-sector-detail', 'default', { anchors: ['h1'] })
})

test('SH-01-agents', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=Agents')
  await expect(page.locator('h1:has-text("Agents")')).toBeVisible()
  await shot(page, 'SH-01-agents', 'default', { anchors: ['h1:has-text("Agents")'] })
})

test('SH-01-models', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=Models')
  await expect(page.locator('h1:has-text("Models")')).toBeVisible()
  await shot(page, 'SH-01-models', 'default', { anchors: ['h1:has-text("Models")'] })
})

test('SH-02-expanded', async ({ page }) => {
  await capture(page, 'SH-02', 'expanded', () => gotoOverview(page))
})

test('SH-02-collapsed', async ({ page }) => {
  // Idempotent: capture() replays prepare per theme and the collapse
  // persists in localStorage, so later replays start collapsed.
  const collapse = async () => {
    await gotoOverview(page)
    if ((await page.getByRole('button', { name: 'Expand sidebar' }).count()) === 0) {
      await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    }
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  }
  await capture(page, 'SH-02', 'collapsed', collapse, undefined, { widths: [1440] })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
})

test('SH-02-hover', async ({ page }) => {
  await capture(
    page, 'SH-02', 'hover',
    () => gotoOverview(page),
    () => page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Agents' }).hover(),
    { widths: [1440] },
  )
})

test('SH-02-focus', async ({ page }) => {
  await capture(
    page, 'SH-02', 'focus',
    () => gotoOverview(page),
    () => page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Agents' }).focus(),
    { widths: [1440] },
  )
})

test('SH-02-mobile', async ({ page }) => {
  await capture(page, 'SH-02', 'mobile', () => gotoOverview(page), undefined, { widths: [390] })
})

test('SH-03-default', async ({ page }) => {
  await gotoOverview(page)
  await shot(page, 'SH-03', 'default', { widths: [1440, 768, 390], anchors: ['h1:has-text("Overview")'] })
})

test('SH-04-open', async ({ page }) => {
  await capture(page, 'SH-04', 'open', async () => {
    await gotoOverview(page)
    await page.getByRole('button', { name: 'Theme' }).click()
    await expect(page.getByRole('menuitemradio', { name: 'System' })).toBeVisible()
  })
})

test('SH-04-behavior', async ({ page }) => {
  await gotoOverview(page)
  await page.getByRole('button', { name: 'Theme' }).click()
  await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  await expect(page.locator('html.dark')).toBeAttached()
  expect(await page.evaluate(() => window.localStorage.getItem('kardata-theme'))).toBe('dark')
  await page.getByRole('button', { name: 'Theme' }).click()
  await page.getByRole('menuitemradio', { name: 'System' }).click()
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html.dark')).toHaveCount(0)
})

async function openPalette(page: Page): Promise<void> {
  await gotoOverview(page)
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
}

test('SH-05-open', async ({ page }) => {
  await capture(page, 'SH-05', 'open', () => openPalette(page))
})

test('SH-05-filtered', async ({ page }) => {
  await capture(page, 'SH-05', 'filtered', () => openPalette(page), () =>
    page.getByPlaceholder('Search commands and sectors...').fill('Sydney').then(() => undefined),
  )
})

test('SH-05-empty', async ({ page }) => {
  await capture(page, 'SH-05', 'empty', () => openPalette(page), () =>
    page.getByPlaceholder('Search commands and sectors...').fill('zzz-no-such-thing').then(() => undefined),
  )
})

test('SH-06-success', async ({ page }) => {
  await capture(
    page, 'SH-06', 'success',
    () => gotoOverview(page),
    async () => {
      await page.evaluate(`import('/src/lib/toast.ts').then((m) => m.notify.success('Sector created'))`)
      await expect(page.getByText('Sector created')).toBeVisible()
    },
  )
})

test('SH-06-error', async ({ page }) => {
  await capture(
    page, 'SH-06', 'error',
    () => gotoOverview(page),
    async () => {
      await page.evaluate(`import('/src/lib/toast.ts').then((m) => m.notify.error('Upload failed', { label: 'Retry', onClick: () => undefined }))`)
      await expect(page.getByText('Upload failed')).toBeVisible()
    },
  )
})
