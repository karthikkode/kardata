// Stage 2 Researches (RS-01..06): tabs, toolbar, sectors and companies
// tables, the New-sector dialog. Light+dark at 1440+390.
import { expect, test, type Page } from '@playwright/test'
import { serveApi } from '../support/api'
import { capture } from '../support/capture'
import { allSectors, type FixtureSector } from '../support/fixtures'
import { shot } from '../support/shot'

async function gotoSectors(page: Page): Promise<void> {
  await serveApi(page)
  await page.goto('/?section=Researches')
  await expect(page.locator('h1:has-text("Researches")')).toBeVisible()
  await expect(page.getByRole('table', { name: 'Sectors' })).toBeVisible()
}

async function gotoCompanies(page: Page): Promise<void> {
  await serveApi(page)
  await page.goto('/?section=Researches&tab=companies')
  await expect(page.locator('h1:has-text("Researches")')).toBeVisible()
  await expect(page.getByRole('table', { name: 'Companies' })).toBeVisible()
}

function manySectors(count: number): FixtureSector[] {
  return Array.from({ length: count }, (_, index) => {
    const base = allSectors[index % allSectors.length] as FixtureSector
    return { ...base, id: `sector-many-${index}`, name: `${base.name} ${index + 1}` }
  })
}

test('RS-02-sectors', async ({ page }) => {
  await gotoSectors(page)
  await shot(page, 'RS-02', 'sectors', { anchors: ['[role="tablist"]'] })
})

test('RS-02-companies', async ({ page }) => {
  await capture(
    page, 'RS-02', 'companies',
    () => gotoSectors(page),
    async () => {
      await page.getByRole('tab', { name: 'Companies' }).click()
      await expect(page.getByRole('table', { name: 'Companies' })).toBeVisible()
    },
  )
})

test('RS-03-default', async ({ page }) => {
  await gotoSectors(page)
  await shot(page, 'RS-03', 'default', { anchors: ['[placeholder="Search sectors"]'] })
})

test('RS-03-filtered', async ({ page }) => {
  await gotoSectors(page)
  await page.getByPlaceholder('Search sectors').fill('sydney')
  await expect(page).toHaveURL(/q=sydney/)
  await expect(page.getByText('2 sectors')).toBeVisible()
  await shot(page, 'RS-03', 'filtered', { anchors: ['[placeholder="Search sectors"]'] })
})

test('RS-04-default', async ({ page }) => {
  await gotoSectors(page)
  await shot(page, 'RS-04', 'default', { anchors: ['table[aria-label="Sectors"]'] })
})

test('RS-04-hover', async ({ page }) => {
  await capture(
    page, 'RS-04', 'hover',
    () => gotoSectors(page),
    () => page.getByRole('table', { name: 'Sectors' }).getByRole('link').first().hover(),
  )
})

test('RS-04-sorted', async ({ page }) => {
  // The stacked 390 layout hides the head (and its sort buttons) by
  // design; sort coverage is 1440-only, 390 stacks via RS-04-default.
  await capture(
    page, 'RS-04', 'sorted',
    () => gotoSectors(page),
    async () => {
      await page.getByRole('button', { name: 'Sort by Sector' }).click()
      await expect(page.getByRole('table', { name: 'Sectors' }).getByRole('link').first()).toContainText('Adelaide roofing')
    },
    { widths: [1440] },
  )
})

test('RS-04-empty', async ({ page }) => {
  await serveApi(page, { modes: { sectors: 'empty' } })
  await page.goto('/?section=Researches')
  await expect(page.getByText('No sectors yet')).toBeVisible()
  await shot(page, 'RS-04', 'empty', { anchors: ['text=No sectors yet'] })
})

test('RS-04-filtered-empty', async ({ page }) => {
  await gotoSectors(page)
  await page.getByPlaceholder('Search sectors').fill('zzz-no-match')
  await expect(page.getByText('No matching sectors.')).toBeVisible()
  await shot(page, 'RS-04', 'filtered-empty', { anchors: ['text=No matching sectors.'] })
})

test('RS-04-loading', async ({ page }) => {
  await serveApi(page, { modes: { sectors: 'loading' }, loadingMs: 30_000 })
  await page.goto('/?section=Researches')
  await expect(page.getByRole('status', { name: 'Sectors are loading' })).toBeVisible()
  await shot(page, 'RS-04', 'loading', { anchors: ['[aria-label="Sectors are loading"]'] })
})

test('RS-04-error', async ({ page }) => {
  await serveApi(page, { modes: { sectors: 'error' } })
  await page.goto('/?section=Researches')
  await expect(page.getByRole('table', { name: 'Sectors' }).getByRole('alert')).toBeVisible()
  await shot(page, 'RS-04', 'error', { anchors: ['table[aria-label="Sectors"] [role="alert"]'] })
})

test('RS-04-denied', async ({ page }) => {
  await serveApi(page, { modes: { sectors: 'denied' } })
  await page.goto('/?section=Researches')
  await expect(page.getByText('Access denied')).toBeVisible()
  await shot(page, 'RS-04', 'denied', { anchors: ['text=Access denied'] })
})

test('RS-04-offline', async ({ page }) => {
  // Aborted fetch alone maps to error; the offline anatomy needs the
  // browser flag too (see apiErrorStatus), so refetch after going offline.
  await serveApi(page, { modes: { sectors: 'offline' } })
  await page.goto('/?section=Researches')
  await expect(page.getByRole('table', { name: 'Sectors' }).getByRole('alert')).toBeVisible()
  await page.context().setOffline(true)
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText('You are offline')).toBeVisible()
  await shot(page, 'RS-04', 'offline', { anchors: ['text=You are offline'] })
})

test('RS-04-many', async ({ page }) => {
  await serveApi(page, { data: { sectors: manySectors(132) } })
  await capture(
    page, 'RS-04', 'many',
    async () => {
      await page.goto('/?section=Researches')
      await expect(page.getByRole('table', { name: 'Sectors' })).toBeVisible()
      await page.getByRole('button', { name: 'Show more' }).click()
      await expect(page.getByText('Showing 100 of 132')).toBeVisible()
    },
    () => page.getByText('Showing 100 of 132').scrollIntoViewIfNeeded().then(() => undefined),
  )
})

test('RS-05-default', async ({ page }) => {
  await gotoCompanies(page)
  await shot(page, 'RS-05', 'default', { anchors: ['table[aria-label="Companies"]'] })
})

test('RS-05-paging', async ({ page }) => {
  await serveApi(page)
  await capture(
    page, 'RS-05', 'paging',
    async () => {
      await page.goto('/?section=Researches&tab=companies')
      await expect(page.getByRole('table', { name: 'Companies' })).toBeVisible()
      await page.getByRole('button', { name: 'Show more' }).click()
      await expect(page.getByText('Showing 200 of 2,000')).toBeVisible()
    },
    () => page.getByText('Showing 200 of 2,000').scrollIntoViewIfNeeded().then(() => undefined),
  )
})

test('RS-05-empty', async ({ page }) => {
  await serveApi(page, { modes: { companies: 'empty' } })
  await page.goto('/?section=Researches&tab=companies')
  await expect(page.getByText('No companies yet')).toBeVisible()
  await shot(page, 'RS-05', 'empty', { anchors: ['text=No companies yet'] })
})

test('RS-05-2000', async ({ page }) => {
  // 19 windowed appends to 2,000 rows: slow by design (test.slow), and
  // 1440-only (stacked 390 paging is covered by RS-05-paging; the
  // windowing logic is width-independent).
  test.slow()
  await serveApi(page)
  await capture(
    page, 'RS-05', '2000',
    async () => {
      await page.goto('/?section=Researches&tab=companies')
      await expect(page.getByRole('table', { name: 'Companies' })).toBeVisible()
      const more = page.getByRole('button', { name: 'Show more' })
      for (let shown = 200; shown <= 2000; shown += 100) {
        await more.click()
        await expect(page.getByText(`Showing ${shown.toLocaleString('en-US')} of 2,000`)).toBeVisible()
      }
      await expect(more).toHaveCount(0)
    },
    () => page.getByText('Showing 2,000 of 2,000').scrollIntoViewIfNeeded().then(() => undefined),
    { widths: [1440] },
  )
})

test('RS-05-more-error', async ({ page }) => {
  await serveApi(page, { companiesErrorOffset: 100 })
  await page.goto('/?section=Researches&tab=companies')
  await expect(page.getByRole('table', { name: 'Companies' })).toBeVisible()
  await page.getByRole('button', { name: 'Show more' }).click()
  await expect(page.getByText('More companies did not load.')).toBeVisible()
  await shot(page, 'RS-05', 'more-error', { anchors: ['text=More companies did not load.'] })
})

async function openNewSector(page: Page): Promise<void> {
  await gotoSectors(page)
  await page.getByRole('button', { name: 'New sector' }).first().click()
  await expect(page.getByRole('dialog', { name: 'New sector' })).toBeVisible()
}

test('RS-06-open', async ({ page }) => {
  await capture(page, 'RS-06', 'open', () => openNewSector(page))
})

test('RS-06-error', async ({ page }) => {
  await capture(
    page, 'RS-06', 'error',
    () => openNewSector(page),
    async () => {
      await page.getByRole('button', { name: 'Create sector' }).click()
      await expect(page.getByText('Name the sector first.')).toBeVisible()
    },
  )
})

test('RS-06-pending', async ({ page }) => {
  await serveApi(page, { modes: { sectorMutations: 'loading' }, loadingMs: 30_000 })
  await capture(
    page, 'RS-06', 'pending',
    async () => {
      await page.goto('/?section=Researches')
      await expect(page.locator('h1:has-text("Researches")')).toBeVisible()
      await page.getByRole('button', { name: 'New sector' }).first().click()
      await expect(page.getByRole('dialog', { name: 'New sector' })).toBeVisible()
    },
    async () => {
      await page.getByLabel('Name').fill('Adelaide fencing contractors')
      await page.getByRole('button', { name: 'Create sector' }).click()
      await expect(page.getByRole('button', { name: 'Creating…' })).toBeVisible()
    },
  )
})
