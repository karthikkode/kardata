// Stage 5a plan tab (PL-01..09): header, glance, steps timeline,
// brief, empty/planning, versions, edit sheet, progress, intake review.
import { expect, test, type Page } from '@playwright/test'
import { serveApi, type ApiOptions } from '../support/api'
import { capture } from '../support/capture'
import { progressFor } from '../support/fixtures'

async function gotoPlan(page: Page, sectorId: string, api: ApiOptions = {}, ready: 'plan' | 'empty' = 'plan'): Promise<void> {
  await serveApi(page, api)
  await page.goto(`/?section=SectorChat&sector=${sectorId}`)
  const width = page.viewportSize()?.width ?? 1440
  if (width >= 768) {
    await expect(page.getByRole('tablist', { name: 'Session types' })).toBeVisible()
  } else {
    await expect(page.getByRole('button', { name: 'Open sessions' })).toBeVisible()
  }
  await expect(page.locator('main h1')).toBeVisible()
  await page.getByRole('tab', { name: /^Plan/ }).click()
  if (ready === 'plan') {
    await expect(page.getByRole('heading', { name: 'Research plan' })).toBeVisible()
  } else {
    await expect(page.getByText('No research plan yet')).toBeVisible()
  }
}

async function scrollToProgress(page: Page): Promise<void> {
  await page.getByRole('heading', { name: 'Progress' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible()
}

test('PL-01-planned', async ({ page }) => {
  await capture(page, 'PL-01', 'planned', () => gotoPlan(page, 'sector-plumbing', { data: { planVariant: 'legacy' } }))
})

test('PL-01-approved', async ({ page }) => {
  await capture(page, 'PL-01', 'approved', () => gotoPlan(page, 'sector-hvac'))
})

test('PL-01-blocked', async ({ page }) => {
  await capture(
    page, 'PL-01', 'blocked',
    () => gotoPlan(page, 'sector-plumbing', { data: { planVariant: 'legacy' } }),
    async () => {
      // Fail the next shared-context refresh: approval blocks while the
      // loaded plan stays visible (a loading global never reaches the
      // plan tab, because sessions wait for it).
      await page.route(
        '**/v1/sectors/sector-plumbing/global-context',
        async (route) => {
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'internal', message: 'Shared context failed on purpose.' } }) })
        },
        { times: 1 },
      )
      const width = page.viewportSize()?.width ?? 1440
      if (width < 1281) {
        await page.getByRole('button', { name: 'Open files and global context' }).click()
        await expect(page.getByRole('dialog', { name: 'Files and global context' })).toBeVisible()
      }
      const scope = width < 1281 ? page.getByRole('dialog', { name: 'Files and global context' }) : page
      await scope.getByRole('button', { name: /^Add .* to global context/ }).first().click()
      // The drawer is modal: close it before asserting on the plan header.
      if (width < 1281) {
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog', { name: 'Files and global context' })).toBeHidden()
      }
      await expect(page.getByRole('button', { name: 'Approve v2' })).toHaveAttribute('aria-disabled', 'true')
    },
  )
})

test('PL-02-default', async ({ page }) => {
  await capture(page, 'PL-02', 'default', () => gotoPlan(page, 'sector-electrical'))
})

test('PL-02-390', async ({ page }) => {
  await capture(page, 'PL-02', '390', () => gotoPlan(page, 'sector-electrical'), undefined, { widths: [390] })
})

test('PL-03-executable', async ({ page }) => {
  await capture(page, 'PL-03', 'executable', () => gotoPlan(page, 'sector-electrical'))
})

test('PL-03-running', async ({ page }) => {
  await capture(page, 'PL-03', 'running', () => gotoPlan(page, 'sector-electrical', { data: { progressVariant: 'running' } }))
})

test('PL-03-long-queries', async ({ page }) => {
  await capture(
    page, 'PL-03', 'long-queries',
    () => gotoPlan(page, 'sector-electrical'),
    async () => {
      await page.locator('[data-plan-step="direction-3"]').scrollIntoViewIfNeeded()
    },
  )
})

test('PL-03-390', async ({ page }) => {
  await capture(page, 'PL-03', '390', () => gotoPlan(page, 'sector-electrical'), undefined, { widths: [390] })
})

test('PL-04-brief', async ({ page }) => {
  await capture(page, 'PL-04', 'brief', () => gotoPlan(page, 'sector-plumbing', { data: { planVariant: 'legacy' } }))
})

test('PL-04-narrative-only', async ({ page }) => {
  await capture(
    page, 'PL-04', 'narrative-only',
    () => gotoPlan(page, 'sector-plumbing', { data: { planVariant: 'legacy' } }),
    async () => {
      await page.getByText('This plan has no executable search steps yet.').scrollIntoViewIfNeeded()
    },
  )
})

test('PL-04-new-format', async ({ page }) => {
  await capture(page, 'PL-04', 'new-format', () => gotoPlan(page, 'sector-electrical'))
})

test('PL-05-empty', async ({ page }) => {
  await capture(
    page, 'PL-05', 'empty',
    () => gotoPlan(page, 'sector-foods', { modes: { plan: 'empty', progress: 'empty' } }, 'empty'),
  )
})

test('PL-05-planning', async ({ page }) => {
  await capture(
    page, 'PL-05', 'planning',
    () => gotoPlan(page, 'sector-foods', { modes: { plan: 'empty', progress: 'empty', sectorMutations: 'loading' } }, 'empty'),
    async () => {
      await page.getByRole('tabpanel', { name: 'Plan' }).getByRole('button', { name: 'Create plan' }).click()
      await expect(page.getByText('Your research agent is drafting the plan.')).toBeVisible()
    },
  )
})

test('PL-06-open', async ({ page }) => {
  await capture(
    page, 'PL-06', 'open',
    () => gotoPlan(page, 'sector-electrical'),
    async () => {
      await page.getByRole('button', { name: /Version history/ }).click()
      await expect(page.getByRole('list', { name: 'Plan versions' }).getByText('Approved')).toBeVisible()
    },
  )
})

test('PL-07-open', async ({ page }) => {
  await capture(
    page, 'PL-07', 'open',
    () => gotoPlan(page, 'sector-hvac'),
    async () => {
      await page.getByRole('button', { name: 'Edit plan', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Edit research plan' })).toBeVisible()
    },
  )
})

test('PL-07-errors', async ({ page }) => {
  await capture(
    page, 'PL-07', 'errors',
    () => gotoPlan(page, 'sector-hvac'),
    async () => {
      await page.getByRole('button', { name: 'Edit plan', exact: true }).click()
      await page.getByLabel('Company limit').fill('')
      await page.getByRole('button', { name: 'Save plan' }).click()
      await expect(page.getByText('Fix this field before saving.')).toBeVisible()
    },
  )
})

test('PL-07-discard-confirm', async ({ page }) => {
  await capture(
    page, 'PL-07', 'discard-confirm',
    () => gotoPlan(page, 'sector-hvac'),
    async () => {
      await page.getByRole('button', { name: 'Edit plan', exact: true }).click()
      await page.getByRole('textbox', { name: 'Plan text' }).press('End')
      await page.getByRole('textbox', { name: 'Plan text' }).type(' with owner edits')
      await page.getByRole('button', { name: 'Cancel' }).click()
      await expect(page.getByRole('alertdialog', { name: 'Discard changes?' })).toBeVisible()
    },
  )
})

test('PL-07-390', async ({ page }) => {
  await capture(
    page, 'PL-07', '390',
    () => gotoPlan(page, 'sector-hvac'),
    async () => {
      await page.getByRole('button', { name: 'Edit plan', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Edit research plan' })).toBeVisible()
    },
    { widths: [390] },
  )
})

test('PL-08-running', async ({ page }) => {
  await capture(
    page, 'PL-08', 'running',
    () => gotoPlan(page, 'sector-electrical'),
    () => scrollToProgress(page),
  )
})

test('PL-08-complete', async ({ page }) => {
  await capture(
    page, 'PL-08', 'complete',
    () => gotoPlan(page, 'sector-skincare', { data: { progressVariant: 'complete' } }),
    () => scrollToProgress(page),
  )
})

test('PL-08-attention', async ({ page }) => {
  await capture(
    page, 'PL-08', 'attention',
    () => gotoPlan(page, 'sector-electrical'),
    async () => {
      await page.getByText('Failed', { exact: true }).first().scrollIntoViewIfNeeded()
    },
  )
})

test('PL-08-empty', async ({ page }) => {
  await capture(
    page, 'PL-08', 'empty',
    () => gotoPlan(page, 'sector-foods', { modes: { plan: 'empty', progress: 'empty' } }, 'empty'),
    () => scrollToProgress(page),
  )
})

test('PL-08-filtered-empty', async ({ page }) => {
  await capture(
    page, 'PL-08', 'filtered-empty',
    () => gotoPlan(page, 'sector-electrical'),
    async () => {
      await scrollToProgress(page)
      await page.getByLabel('Search work items').fill('zzz-no-such-work')
      await expect(page.getByText('No matching work items.')).toBeVisible()
    },
  )
})

test('PL-08-many', async ({ page }) => {
  await capture(
    page, 'PL-08', 'many',
    () => gotoPlan(page, 'sector-electrical', { data: { progressVariant: 'large' } }),
    () => scrollToProgress(page),
  )
})

test('PL-09-open', async ({ page }) => {
  await capture(
    page, 'PL-09', 'open',
    () => gotoPlan(page, 'sector-solar'),
    async () => {
      await scrollToProgress(page)
      await page.getByRole('button', { name: 'Review', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Review candidate intake' })).toBeVisible()
    },
  )
})

test('PL-09-stale', async ({ page }) => {
  await capture(
    page, 'PL-09', 'stale',
    () => gotoPlan(page, 'sector-solar'),
    async () => {
      await scrollToProgress(page)
      await page.getByRole('button', { name: 'Review', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Review candidate intake' })).toBeVisible()
      await page.getByLabel('Owner reason').fill('Recheck the coverage page before retrying.')
      const alt = progressFor('sector-solar', 'running')
      alt.items = alt.items.map((item) => (item.receiptVersion ? { ...item, receiptVersion: 'b'.repeat(64) } : item))
      await page.route(
        '**/v1/sectors/sector-solar/progress',
        async (route) => {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { ...alt, state: 'paused' } }) })
        },
        { times: 1 },
      )
      await page.getByRole('button', { name: 'Reload latest' }).click()
      await expect(page.getByText('Work changed.')).toBeVisible()
    },
  )
})

test('PL-09-390', async ({ page }) => {
  await capture(
    page, 'PL-09', '390',
    () => gotoPlan(page, 'sector-solar'),
    async () => {
      await scrollToProgress(page)
      await page.getByRole('button', { name: 'Review', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Review candidate intake' })).toBeVisible()
    },
    { widths: [390] },
  )
})
