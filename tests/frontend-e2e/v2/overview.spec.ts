// Stage 2 Overview (OV-01/02/04/05): stat tiles and recent panels in
// light+dark at 1440+390. OV-03 (email notice) was removed; the plan
// keeps its number vacant.
import { expect, test, type Page } from '@playwright/test'
import { serveApi } from '../support/api'
import { capture } from '../support/capture'
import { longSector } from '../support/fixtures'
import { shot } from '../support/shot'

async function gotoOverview(page: Page): Promise<void> {
  await serveApi(page)
  await page.goto('/')
  await expect(page.locator('h1:has-text("Overview")')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Research totals' })).toBeVisible()
}

test('OV-02-default', async ({ page }) => {
  await gotoOverview(page)
  await expect(page.getByRole('button', { name: /^Sectors: 10,/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Companies found: 2,000,/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Needs attention: 1,/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Awaiting approval: 1,/ })).toBeVisible()
  await shot(page, 'OV-02', 'default', { anchors: ['text=Awaiting approval'] })
})

test('OV-02-deep-link', async ({ page }) => {
  await gotoOverview(page)
  await page.getByRole('button', { name: /^Needs attention: 1,/ }).click()
  await expect(page).toHaveURL(/section=Researches/)
  await expect(page).toHaveURL(/state=failed/)
  await expect(page.getByRole('combobox', { name: 'Status: Failed' })).toBeVisible()
})

test('OV-02-loading', async ({ page }) => {
  await serveApi(page, { modes: { sectors: 'loading', companies: 'loading' }, loadingMs: 30_000 })
  await page.goto('/')
  await expect(page.getByRole('status', { name: 'Sectors is loading', exact: true })).toBeVisible()
  await shot(page, 'OV-02', 'loading', { anchors: ['[aria-label="Sectors is loading"]'] })
})

test('OV-02-error', async ({ page }) => {
  await serveApi(page, { modes: { sectors: 'error', companies: 'error' } })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Retry Sectors' })).toBeVisible()
  await shot(page, 'OV-02', 'error', { anchors: ['text=Could not load'] })
})

test('OV-04-default', async ({ page }) => {
  await gotoOverview(page)
  await shot(page, 'OV-04', 'default', { anchors: ['section[aria-label="Recent sectors"]'] })
})

test('OV-04-hover', async ({ page }) => {
  await capture(
    page, 'OV-04', 'hover',
    () => gotoOverview(page),
    () => page.getByRole('list', { name: 'Recent sectors' }).getByRole('button').first().hover(),
  )
})

test('OV-04-empty', async ({ page }) => {
  await serveApi(page, { modes: { sectors: 'empty' } })
  await page.goto('/')
  await expect(page.getByText('No sectors yet')).toBeVisible()
  await shot(page, 'OV-04', 'empty', { anchors: ['text=No sectors yet'] })
})

test('OV-04-loading', async ({ page }) => {
  await serveApi(page, { modes: { sectors: 'loading' }, loadingMs: 30_000 })
  await page.goto('/')
  await expect(page.getByRole('status', { name: 'Recent sectors is loading' })).toBeVisible()
  await shot(page, 'OV-04', 'loading', { anchors: ['[aria-label="Recent sectors is loading"]'] })
})

test('OV-04-error', async ({ page }) => {
  await serveApi(page, { modes: { sectors: 'error' } })
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Recent sectors' }).getByRole('alert')).toBeVisible()
  await shot(page, 'OV-04', 'error', { anchors: ['section[aria-label="Recent sectors"] [role="alert"]'] })
})

test('OV-04-long-names', async ({ page }) => {
  await serveApi(page, { data: { sectors: [longSector], companies: [] } })
  await page.goto('/')
  await expect(page.getByRole('list', { name: 'Recent sectors' }).getByRole('button').first()).toBeVisible()
  await shot(page, 'OV-04', 'long-names', { anchors: ['section[aria-label="Recent sectors"]'] })
})

test('OV-04-long-names-ellipsis', async ({ page }) => {
  await serveApi(page, { data: { sectors: [longSector], companies: [] } })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const row = page.getByRole('list', { name: 'Recent sectors' }).getByRole('button').first()
  await expect(row).toBeVisible()
  // Secondary meta steps aside below sm so the name keeps readable room
  // (regression: the name starved to ~1 char behind badge/count/age).
  await expect(row.getByText('companies')).toBeHidden()
  await expect(row.getByText('In progress')).toBeVisible()
  const name = row.getByText(longSector.name, { exact: true })
  const box = await name.evaluate((el) => ({
    overflows: el.scrollWidth > el.clientWidth + 1,
    textOverflow: getComputedStyle(el).textOverflow,
    whiteSpace: getComputedStyle(el).whiteSpace,
    title: el.getAttribute('title'),
    width: el.clientWidth,
  }))
  expect(box.overflows).toBe(true)
  expect(box.textOverflow).toBe('ellipsis')
  expect(box.whiteSpace).toBe('nowrap')
  expect(box.title).toBe(longSector.name)
  expect(box.width).toBeGreaterThan(80)
})

test('OV-05-default', async ({ page }) => {
  await gotoOverview(page)
  await shot(page, 'OV-05', 'default', { anchors: ['section[aria-label="Recent companies"]'] })
})

test('OV-05-hover', async ({ page }) => {
  await capture(
    page, 'OV-05', 'hover',
    () => gotoOverview(page),
    () => page.getByRole('list', { name: 'Recent companies' }).getByRole('button').first().hover(),
  )
})

test('OV-05-empty', async ({ page }) => {
  await serveApi(page, { modes: { companies: 'empty' } })
  await page.goto('/')
  await expect(page.getByText('No companies yet')).toBeVisible()
  await shot(page, 'OV-05', 'empty', { anchors: ['text=No companies yet'] })
})
