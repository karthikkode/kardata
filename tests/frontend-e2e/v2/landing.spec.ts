// Stage 3 sector landing (SL-01..06): header, research status panel,
// progress dialog, companies section, not-found/denied. Light+dark at
// 1440+390.
import { expect, test, type Page } from '@playwright/test'
import { serveApi } from '../support/api'
import { capture } from '../support/capture'
import { shot, type ShotOptions } from '../support/shot'

async function gotoLanding(page: Page, sectorId: string): Promise<void> {
  await page.goto(`/?section=SectorDetail&sector=${sectorId}`)
  await expect(page.getByRole('region', { name: 'Research status' })).toBeVisible()
}

/** At 390 the subject sits below the fold: scroll it in below the sticky
 * 48px top bar. At 1440 reset to top, because scroll position persists
 * across the theme/width loop. */
function focusSubject(selector: string): ShotOptions['beforeShot'] {
  return async (page, width) => {
    if (width === 390) {
      await page
        .locator(selector)
        .first()
        .evaluate((el) => {
          window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 60, behavior: 'instant' as ScrollBehavior })
        })
    } else await page.evaluate(() => window.scrollTo(0, 0))
  }
}

test('SL-01-default', async ({ page }) => {
  await serveApi(page)
  await gotoLanding(page, 'sector-electrical')
  await expect(page.locator('h1:has-text("Australian electrical contractors")')).toBeVisible()
  await shot(page, 'SL-01', 'default', { anchors: ['h1'] })
})

test('SL-01-long-name', async ({ page }) => {
  await serveApi(page)
  await gotoLanding(page, 'sector-long')
  await shot(page, 'SL-01', 'long-name', { anchors: ['h1'] })
})

test('SL-01-loading', async ({ page }) => {
  await serveApi(page, { modes: { sector: 'loading' }, loadingMs: 30_000 })
  await page.goto('/?section=SectorDetail&sector=sector-electrical')
  await expect(page.getByRole('status', { name: 'Sector is loading' })).toBeVisible()
  await shot(page, 'SL-01', 'loading', { anchors: ['[aria-label="Sector is loading"]'] })
})

test('SL-02-draft', async ({ page }) => {
  await serveApi(page, { data: { progressVariant: 'empty' } })
  await gotoLanding(page, 'sector-foods')
  await expect(page.getByText('Not estimated yet')).toBeVisible()
  await shot(page, 'SL-02', 'draft', { anchors: ['section[aria-label="Research status"]'], beforeShot: focusSubject('section[aria-label="Research status"]') })
})

test('SL-02-planned', async ({ page }) => {
  await serveApi(page, { data: { progressVariant: 'empty' } })
  await gotoLanding(page, 'sector-plumbing')
  await expect(page.getByRole('button', { name: 'Review plan' })).toBeVisible()
  await shot(page, 'SL-02', 'planned', { anchors: ['section[aria-label="Research status"]'], beforeShot: focusSubject('section[aria-label="Research status"]') })
})

test('SL-02-running', async ({ page }) => {
  await serveApi(page)
  await gotoLanding(page, 'sector-electrical')
  await expect(page.getByText('62%')).toBeVisible()
  await shot(page, 'SL-02', 'running', { anchors: ['section[aria-label="Research status"]'], beforeShot: focusSubject('section[aria-label="Research status"]') })
})

test('SL-02-paused', async ({ page }) => {
  await serveApi(page)
  await gotoLanding(page, 'sector-solar')
  await expect(page.getByText('62%')).toBeVisible()
  await shot(page, 'SL-02', 'paused', { anchors: ['section[aria-label="Research status"]'], beforeShot: focusSubject('section[aria-label="Research status"]') })
})

test('SL-02-failed', async ({ page }) => {
  await serveApi(page, { data: { progressVariant: 'empty' } })
  await gotoLanding(page, 'sector-cleaning')
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible()
  await shot(page, 'SL-02', 'failed', { anchors: ['section[aria-label="Research status"]'], beforeShot: focusSubject('section[aria-label="Research status"]') })
})

test('SL-02-complete', async ({ page }) => {
  await serveApi(page, { data: { progressVariant: 'empty' } })
  await gotoLanding(page, 'sector-skincare')
  await expect(page.getByText('Finished', { exact: true })).toBeVisible()
  await shot(page, 'SL-02', 'complete', { anchors: ['section[aria-label="Research status"]'], beforeShot: focusSubject('section[aria-label="Research status"]') })
})

test('SL-02-progress-error', async ({ page }) => {
  await serveApi(page, { modes: { progress: 'error' } })
  await gotoLanding(page, 'sector-electrical')
  await expect(page.getByText('Unavailable')).toBeVisible()
  await shot(page, 'SL-02', 'progress-error', { anchors: ['section[aria-label="Research status"]'], beforeShot: focusSubject('section[aria-label="Research status"]') })
})

test('SL-03-open', async ({ page }) => {
  await serveApi(page)
  await capture(
    page, 'SL-03', 'open',
    () => gotoLanding(page, 'sector-electrical'),
    async () => {
      await page.getByRole('button', { name: 'View progress' }).click()
      await expect(page.getByRole('dialog', { name: 'Research progress' })).toBeVisible()
    },
  )
})

test('SL-03-scrolled', async ({ page }) => {
  await serveApi(page)
  await capture(
    page, 'SL-03', 'scrolled',
    () => gotoLanding(page, 'sector-electrical'),
    async () => {
      await page.getByRole('button', { name: 'View progress' }).click()
      await expect(page.getByRole('dialog', { name: 'Research progress' })).toBeVisible()
      await page.getByRole('button', { name: 'Show plan details' }).click()
      await expect(page.getByRole('button', { name: 'Hide plan details' })).toBeVisible()
    },
  )
})

test('SL-05-default', async ({ page }) => {
  await serveApi(page)
  await gotoLanding(page, 'sector-electrical')
  await expect(page.getByRole('table', { name: 'Companies' })).toBeVisible()
  await shot(page, 'SL-05', 'default', { anchors: ['table[aria-label="Companies"]'], beforeShot: focusSubject('section[aria-label="Companies"]') })
})

test('SL-05-stacked-cards-do-not-overlap', async ({ page }) => {
  await serveApi(page)
  await gotoLanding(page, 'sector-electrical')
  await page.setViewportSize({ width: 390, height: 844 })
  // Settle the 180ms sidebar transition: boxes measured mid-flight mix
  // narrow and wide layouts and fake an overlap (see audit.spec.ts).
  await page.waitForTimeout(250)
  const rows = page.locator('table[aria-label="Companies"] tbody tr')
  await expect(rows.first()).toBeVisible()
  const boxes = []
  for (let i = 0; i < 3; i++) boxes.push(await rows.nth(i).boundingBox())
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i]!.y).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.height - 1)
  }
})

test('SL-05-filtered', async ({ page }) => {
  await serveApi(page)
  await gotoLanding(page, 'sector-electrical')
  await page.getByPlaceholder('Search companies').fill('harbour')
  await expect(page.getByText(/Showing \d+ of \d+/).first()).toBeVisible()
  await shot(page, 'SL-05', 'filtered', { anchors: ['[placeholder="Search companies"]'], beforeShot: focusSubject('section[aria-label="Companies"]') })
})

test('SL-05-empty-running', async ({ page }) => {
  await serveApi(page, { modes: { companies: 'empty' } })
  await gotoLanding(page, 'sector-electrical')
  await expect(page.getByText('No companies yet')).toBeVisible()
  await shot(page, 'SL-05', 'empty-running', { anchors: ['text=No companies yet'], beforeShot: focusSubject('section[aria-label="Companies"]') })
})

test('SL-05-empty-finished', async ({ page }) => {
  await serveApi(page, { modes: { companies: 'empty' } })
  await gotoLanding(page, 'sector-skincare')
  await expect(page.getByText('No companies found')).toBeVisible()
  await shot(page, 'SL-05', 'empty-finished', { anchors: ['text=No companies found'], beforeShot: focusSubject('section[aria-label="Companies"]') })
})

test('SL-05-1000', async ({ page }) => {
  // Nine growing table renders take 16s+ on a fast machine; slow CI
  // runners need headroom (PR #37 triage). The counts stay exact;
  // only the clock is relaxed.
  test.setTimeout(90_000)
  await serveApi(page)
  await capture(
    page, 'SL-05', '1000',
    async () => {
      await gotoLanding(page, 'sector-skincare')
      const more = page.getByRole('button', { name: 'Show more' })
      for (let shown = 200; shown <= 1000; shown += 100) {
        await more.click()
        await expect(page.getByText(`Showing ${shown.toLocaleString('en-US')} of 1,240`)).toBeVisible({ timeout: 15_000 })
      }
    },
    () => page.getByText('Showing 1,000 of 1,240').scrollIntoViewIfNeeded().then(() => undefined),
  )
})

test('SL-05-error', async ({ page }) => {
  await serveApi(page, { modes: { companies: 'error' } })
  await gotoLanding(page, 'sector-electrical')
  await expect(page.getByRole('table', { name: 'Companies' }).getByRole('alert')).toBeVisible()
  await shot(page, 'SL-05', 'error', { anchors: ['table[aria-label="Companies"] [role="alert"]'], beforeShot: focusSubject('section[aria-label="Companies"]') })
})

test('SL-05-denied', async ({ page }) => {
  await serveApi(page, { modes: { companies: 'denied' } })
  await gotoLanding(page, 'sector-electrical')
  await expect(page.getByText('Access denied')).toBeVisible()
  await shot(page, 'SL-05', 'denied', { anchors: ['text=Access denied'], beforeShot: focusSubject('section[aria-label="Companies"]') })
})

test('SL-05-more-error', async ({ page }) => {
  await serveApi(page, { companiesErrorOffset: 100 })
  await gotoLanding(page, 'sector-electrical')
  await page.getByRole('button', { name: 'Show more' }).click()
  await expect(page.getByText('More companies did not load.')).toBeVisible()
  await shot(page, 'SL-05', 'more-error', {
    anchors: ['text=More companies did not load.'],
    beforeShot: (page) =>
      page
        .getByRole('button', { name: 'Try again' })
        .evaluate((el) => el.scrollIntoView({ block: 'end' }))
        .then(() => undefined),
  })
})

test('SL-06-not-found', async ({ page }) => {
  await serveApi(page)
  await page.goto('/?section=SectorDetail&sector=sector-removed')
  await expect(page.getByRole('button', { name: 'Back to researches' })).toBeVisible()
  await shot(page, 'SL-06', 'not-found', { anchors: ['text=This sector may have been removed.'], beforeShot: focusSubject('text=This sector may have been removed.') })
})

test('SL-06-denied', async ({ page }) => {
  await serveApi(page, { modes: { sector: 'denied' } })
  await page.goto('/?section=SectorDetail&sector=sector-electrical')
  await expect(page.getByText('Access denied')).toBeVisible()
  await shot(page, 'SL-06', 'denied', { anchors: ['text=Access denied'], beforeShot: focusSubject('[role="alert"]') })
})
