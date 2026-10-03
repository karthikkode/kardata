// Stage 6 models + emails (MO-01..04, EM-01): session binding,
// provider tiles, save flow, states, and the coming-soon page.
import { expect, test, type Page } from '@playwright/test'
import { serveApi, type ApiOptions } from '../support/api'
import { capture } from '../support/capture'

async function gotoModels(page: Page, api: ApiOptions = {}): Promise<void> {
  await serveApi(page, api)
  await page.goto('/?section=Models')
  await expect(page.locator('main h1')).toHaveText('Models')
}

test('MO-02-default', async ({ page }) => {
  await capture(page, 'MO-02', 'default', () => gotoModels(page), async () => {
    await expect(page.getByText('Choose the provider and model each session uses.')).toBeVisible()
    await expect(page.getByText('Browser chat uses Meta · Muse Spark 1.3 Contributor · High effort')).toBeVisible()
  })
})

test('MO-03-default', async ({ page }) => {
  await capture(page, 'MO-03', 'default', () => gotoModels(page), async () => {
    await expect(page.getByRole('heading', { name: 'Meta' })).toBeVisible()
    await expect(page.getByText('Key configured')).toBeVisible()
    await expect(page.getByText('Default', { exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Model' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Effort' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save to session' })).toBeVisible()
  })
})

test('MO-03-saving', async ({ page }) => {
  await capture(page, 'MO-03', 'saving', async () => {
    await gotoModels(page)
    // Hold the PATCH past the shutter so the pending label lands on the
    // shot; completion + toast are pinned by the unit save test instead.
    await page.route('**/v1/sessions/*/model', async (route) => {
      if (route.request().method() !== 'PATCH') { await route.fallback(); return }
      await new Promise((resolve) => setTimeout(resolve, 8000))
      await route.fallback()
    })
  }, async () => {
    await page.getByRole('button', { name: 'Save to session' }).click()
    await expect(page.getByRole('button', { name: 'Saving…' })).toBeVisible()
  })
})

test('MO-04-empty', async ({ page }) => {
  await capture(page, 'MO-04', 'empty', () => gotoModels(page, { modes: { providers: 'empty' } }), async () => {
    await expect(page.getByText('No providers listed. The catalog is empty on the server.')).toBeVisible()
  })
})

test('MO-04-error', async ({ page }) => {
  await capture(page, 'MO-04', 'error', () => gotoModels(page, { modes: { providers: 'error' } }), async () => {
    await expect(page.getByText('Models did not load.')).toBeVisible()
  })
})

test('MO-390', async ({ page }) => {
  await capture(page, 'MO-390', 'default', () => gotoModels(page), undefined, { widths: [390] })
})

test('EM-01', async ({ page }) => {
  await capture(page, 'EM-01', 'default', async () => {
    await serveApi(page)
    await page.goto('/?section=Emails')
    await expect(page.locator('main h1')).toHaveText('Emails')
  }, async () => {
    await expect(page.getByText('Email tracking is coming soon')).toBeVisible()
    await expect(page.getByText('Scheduled, sent and reply counts will appear here once email tracking is connected.')).toBeVisible()
  })
})
