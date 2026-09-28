// Thousand-scale UI proof: 1000 companies reachable through Show-more
// windows with truthful totals at every step. Route-stubbed; no backend,
// no keys, no network. Timing is logged for the perf record.
import { expect, test, type Page } from '@playwright/test'

const AT = '2026-09-27T00:00:00.000Z'

const SECTOR = {
  id: 'sec-scale-1',
  name: 'Scale sector 1',
  topic: 'Thousand-row proof',
  companiesFound: 1000,
  state: 'running',
  createdAt: AT,
  updatedAt: AT,
}

const COMPANIES = Array.from({ length: 1000 }, (_, i) => ({
  id: `scale-co-${i + 1}`,
  sectorId: 'sec-scale-1',
  sectorName: 'Scale sector 1',
  name: `Scale company ${i + 1}`,
  stage: 'Filter',
  state: 'running',
}))

const DETAIL = {
  ...SECTOR,
  companies: COMPANIES.slice(0, 100),
  companiesTotal: 1000,
  activity: [],
  activityTotal: 0,
}

async function serveScaleApi(page: Page): Promise<void> {
  await page.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url())
    let data: unknown = []
    if (url.pathname.endsWith('/v1/sectors')) data = [SECTOR]
    else if (url.pathname.endsWith('/v1/sectors/sec-scale-1')) data = DETAIL
    else if (url.pathname === '/v1/companies') {
      const limit = Number(url.searchParams.get('limit') ?? '100')
      const offset = Number(url.searchParams.get('offset') ?? '0')
      data = { companies: COMPANIES.slice(offset, offset + limit), total: COMPANIES.length }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  })
}

test('scale: 1000 companies walkable through Show more with truthful totals', async ({ page }) => {
  await serveScaleApi(page)
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  await page.getByRole('button', { name: 'Open Scale sector 1', exact: true }).click()
  await expect(page.getByText('Scale company 100')).toBeVisible()
  await expect(page.getByText('Showing 100 of 1000 companies')).toBeVisible()

  const started = Date.now()
  for (let shown = 100; shown < 1000; shown += 100) {
    await page.getByRole('button', { name: `Show more (${shown} of 1000)` }).click()
    await expect(page.getByText(`Scale company ${shown + 100}`)).toBeVisible()
    await expect(page.getByText(`Showing ${shown + 100} of 1000 companies`)).toBeVisible()
  }
  const walkMs = Date.now() - started
  // eslint-disable-next-line no-console
  console.log(`[scale-e2e] thousandWalkMs=${walkMs}`)
  await expect(page.getByText('Showing 1000 of 1000 companies')).toBeVisible()
  await expect(page.getByRole('button', { name: /Show more/ })).toHaveCount(0)
})
