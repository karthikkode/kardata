// Stage 5c context surfaces (GC-01..07, LC-01..05): global context panel
// and dialogs in the resource rail, local context and execution sheets.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { serveApi, type ApiOptions } from '../support/api'
import { capture } from '../support/capture'
import { globalFor } from '../support/fixtures'

const SECTOR = 'sector-electrical'

async function gotoContext(page: Page, api: ApiOptions = {}): Promise<void> {
  await serveApi(page, api)
  await page.goto(`/?section=SectorChat&sector=${SECTOR}`)
  const width = page.viewportSize()?.width ?? 1440
  if (width >= 768) {
    await expect(page.getByRole('tablist', { name: 'Session types' })).toBeVisible({ timeout: 15000 })
  } else {
    await expect(page.getByRole('button', { name: 'Open sessions' })).toBeVisible({ timeout: 15000 })
  }
  await expect(page.locator('main h1')).toBeVisible({ timeout: 15000 })
}

/** Rail scope: the drawer dialog below 1281px, the page above. */
async function railScope(page: Page): Promise<Page | Locator> {
  const width = page.viewportSize()?.width ?? 1440
  if (width < 1281) {
    await page.getByRole('button', { name: 'Open files and global context' }).click()
    const dialog = page.getByRole('dialog', { name: 'Files and global context' })
    await expect(dialog).toBeVisible()
    return dialog
  }
  await expect(page.getByRole('region', { name: 'Global context' })).toBeVisible()
  return page
}

/** Open the Local context side sheet; returns its dialog scope. */
async function localSheet(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Local context', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Local context' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('GC-01-default', async ({ page }) => {
  await capture(page, 'GC-01', 'default', () => gotoContext(page), async () => {
    const scope = await railScope(page)
    await expect(scope.getByRole('heading', { name: 'Global context', exact: true })).toBeVisible()
    await expect(scope.getByRole('region', { name: 'Global context' }).getByText('v3', { exact: true })).toBeVisible()
  })
})

test('GC-02-expanded', async ({ page }) => {
  await capture(page, 'GC-02', 'expanded', async () => {
    await serveApi(page, {})
    await page.route(`**/v1/sectors/${SECTOR}/global-context`, async (route) => {
      if (route.request().method() !== 'GET') { await route.fallback(); return }
      const full = globalFor(SECTOR, 'full')
      const scope = `${full.sections.scope}\n\n${'Additional scope detail sentence. '.repeat(20)}`
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { ...full, sections: { ...full.sections, scope } } }) })
    })
    await page.goto(`/?section=SectorChat&sector=${SECTOR}`)
    await expect(page.locator('main h1')).toBeVisible()
  }, async () => {
    const scope = await railScope(page)
    await scope.getByRole('button', { name: 'Show more Scope' }).click()
    await expect(scope.getByRole('button', { name: 'Show less Scope' })).toBeVisible()
  })
})

test('GC-03-pending', async ({ page }) => {
  await capture(page, 'GC-03', 'pending', () => gotoContext(page), async () => {
    const scope = await railScope(page)
    await expect(scope.getByText('2 updates waiting for review')).toBeVisible()
    await expect(scope.getByRole('button', { name: 'Review File context inclusion' })).toBeVisible()
    await expect(scope.getByRole('button', { name: 'Review Shared context update' })).toBeVisible()
    // The pending list sits below the fold; the shutter captures the
    // viewport as-is, so bring the subject into frame.
    await scope.getByText('2 updates waiting for review').scrollIntoViewIfNeeded()
  })
})

test('GC-04-edit', async ({ page }) => {
  await capture(page, 'GC-04', 'edit', () => gotoContext(page), async () => {
    const scope = await railScope(page)
    await scope.getByRole('button', { name: 'Edit global context' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit global context' })
    await expect(dialog).toBeVisible()
    for (const name of ['Scope', 'Decisions', 'Findings', 'Open questions']) {
      await expect(dialog.getByRole('textbox', { name })).toBeVisible()
    }
    await expect(dialog.getByRole('button', { name: 'Save context' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
  })
})

test('GC-04-conflict', async ({ page }) => {
  // Four combos each wait out a 5s poll phase; the default 30s budget kills
  // combo 4 under parallel load.
  test.setTimeout(90000)
  // Stateful override: v3 until the editor opens, v4 after, so the next
  // 5s poll delivers the conflict regardless of combo timing.
  let bumped = false
  await capture(page, 'GC-04', 'conflict', async () => {
    bumped = false
    await gotoContext(page)
    await page.route(`**/v1/sectors/${SECTOR}/global-context`, async (route) => {
      if (route.request().method() !== 'GET') { await route.fallback(); return }
      const full = globalFor(SECTOR, 'full')
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { ...full, version: bumped ? 4 : 3 } }) })
    })
  }, async () => {
    const scope = await railScope(page)
    await scope.getByRole('button', { name: 'Edit global context' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit global context' })
    await expect(dialog).toBeVisible()
    bumped = true
    await expect(dialog.getByText(/Editing v3 · current is v4/)).toBeVisible({ timeout: 15000 })
  })
})

test('GC-05-history', async ({ page }) => {
  await capture(page, 'GC-05', 'history', () => gotoContext(page), async () => {
    const scope = await railScope(page)
    await scope.getByRole('button', { name: 'Context history' }).click()
    const dialog = page.getByRole('dialog', { name: 'Context history' })
    await expect(dialog).toBeVisible()
    await dialog.locator('li').first().getByRole('button').click()
    await expect(dialog.getByText('Licensed commercial electrical contractors serving Parramatta and nearby Ryde.')).toBeVisible()
  })
})

test('GC-06-review', async ({ page }) => {
  await capture(page, 'GC-06', 'review', () => gotoContext(page), async () => {
    const scope = await railScope(page)
    await scope.getByRole('button', { name: 'Review Shared context update' }).click()
    const dialog = page.getByRole('dialog', { name: 'Review context update' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Based on v2 · Current v3')).toBeVisible()
    await expect(dialog.getByText('Current', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Proposed', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Reject' })).toBeVisible()
    // Both fixture proposals predate v3, so approval stays disabled.
    await expect(dialog.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled()
    await expect(dialog.getByText('This update is based on v2; the current version is v3. Ask for a refreshed proposal.')).toBeVisible()
  })
})

test('GC-07-sources', async ({ page }) => {
  await capture(page, 'GC-07', 'sources', () => gotoContext(page), async () => {
    const scope = await railScope(page)
    await scope.getByRole('button', { name: 'Review File context inclusion' }).click()
    const dialog = page.getByRole('dialog', { name: 'Review context update' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Includes 1 file version and 14 source units')).toBeVisible()
    await dialog.getByRole('button', { name: /parramatta-crew-notes/ }).click()
    await expect(dialog.getByText('Source unit 1 from the crew notes.')).toBeVisible()
  })
})

test('LC-01-default', async ({ page }) => {
  await capture(page, 'LC-01', 'default', () => gotoContext(page), async () => {
    const dialog = await localSheet(page)
    await expect(dialog.getByText('48,210 of 100,000 tokens')).toBeVisible()
    await expect(dialog.getByText('Window 200,000')).toBeVisible()
    await expect(dialog.getByText('Summary of the Parramatta shortlist work so far.')).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Local notes' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Save notes' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Compact context' })).toBeVisible()
  })
})

test('LC-01-empty', async ({ page }) => {
  await capture(page, 'LC-01', 'empty', () => gotoContext(page, { data: { localVariant: 'empty' } }), async () => {
    const dialog = await localSheet(page)
    await expect(dialog.getByText('No stored summary yet')).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Local notes' })).toBeVisible()
  })
})

test('LC-02-pending', async ({ page }) => {
  await capture(page, 'LC-02', 'pending', () => gotoContext(page, { data: { localVariant: 'pending' } }), async () => {
    const dialog = await localSheet(page)
    await expect(dialog.getByText('2 operations need review')).toBeVisible()
    await expect(dialog.getByText('DB mark company found')).toBeVisible()
    await expect(dialog.getByText('DB set company stage')).toBeVisible()
  })
})

test('LC-02-receipt', async ({ page }) => {
  await capture(page, 'LC-02', 'receipt', () => gotoContext(page, { data: { localVariant: 'pending' } }), async () => {
    const dialog = await localSheet(page)
    await dialog.getByRole('button', { name: 'Inspect receipt' }).first().click()
    await expect(dialog.getByText('Result confirmed')).toBeVisible()
    await expect(dialog.getByText('Confirmed', { exact: true })).toBeVisible()
  })
})

test('LC-03-blocked', async ({ page }) => {
  await capture(page, 'LC-03', 'blocked', () => gotoContext(page, { data: { localVariant: 'blocked' } }), async () => {
    const dialog = await localSheet(page)
    await expect(dialog.getByText('Context needs source review')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Review safe rebuild' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Continue in a new conversation' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Compact context' })).toBeDisabled()
  })
})

test('LC-04-rebuild', async ({ page }) => {
  await capture(page, 'LC-04', 'rebuild', () => gotoContext(page, { data: { localVariant: 'blocked' } }), async () => {
    const dialog = await localSheet(page)
    await dialog.getByRole('button', { name: 'Review safe rebuild' }).click()
    const rebuild = page.getByRole('dialog', { name: 'Rebuild private context' })
    await expect(rebuild).toBeVisible()
    await rebuild.getByRole('textbox', { name: 'Independent replacement' }).fill('Reviewed objectives, completed work and open questions.')
    await expect(rebuild.getByRole('region', { name: 'Replacement preview' })).toBeVisible()
  })
})

test('LC-05-default', async ({ page }) => {
  await capture(page, 'LC-05', 'default', () => gotoContext(page), async () => {
    const dialog = await localSheet(page)
    await dialog.getByRole('button', { name: 'Execution records', exact: true }).click()
    const inspector = page.getByRole('dialog', { name: 'Execution records' })
    await expect(inspector).toBeVisible()
    await expect(inspector.getByText(/20 entries · updated /)).toBeVisible()
    await expect(inspector.getByRole('button', { name: 'Response · Round 1 · #1' })).toBeVisible()
  })
})

test('LC-05-selected', async ({ page }) => {
  await capture(page, 'LC-05', 'selected', () => gotoContext(page), async () => {
    const dialog = await localSheet(page)
    await dialog.getByRole('button', { name: 'Execution records', exact: true }).click()
    const inspector = page.getByRole('dialog', { name: 'Execution records' })
    await expect(inspector).toBeVisible()
    await inspector.getByRole('button', { name: 'Response · Round 1 · #1' }).click()
    await expect(inspector.getByText('Execution 1 · Response')).toBeVisible()
    await expect(inspector.getByLabel('Normalized execution JSON')).toBeVisible()
    await expect(inspector.getByRole('button', { name: 'Download JSON' })).toBeVisible()
  })
})

test('LC-05-empty', async ({ page }) => {
  await capture(page, 'LC-05', 'empty', () => gotoContext(page, { modes: { execution: 'empty' } }), async () => {
    const dialog = await localSheet(page)
    await dialog.getByRole('button', { name: 'Execution records', exact: true }).click()
    const inspector = page.getByRole('dialog', { name: 'Execution records' })
    await expect(inspector).toBeVisible()
    await expect(inspector.getByText('No execution records have been saved for this conversation.')).toBeVisible()
  })
})
