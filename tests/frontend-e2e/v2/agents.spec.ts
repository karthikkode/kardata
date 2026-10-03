// Stage 6 agents (AG-01..03): header refresh, alerts current/history,
// runs table with cancel confirm. Polls re-request the same fixtures,
// so shots stay stable across the 5s refetch.
import { expect, test, type Page } from '@playwright/test'
import { serveApi, type ApiOptions } from '../support/api'
import { capture } from '../support/capture'

async function gotoAgents(page: Page, api: ApiOptions = {}): Promise<void> {
  await serveApi(page, api)
  await page.goto('/?section=Agents')
  await expect(page.locator('main h1')).toHaveText('Agents')
}

test('AG-01-refresh', async ({ page }) => {
  await capture(page, 'AG-01', 'refresh', () => gotoAgents(page), async () => {
    await expect(page.getByText('Runs and supervision alerts across your sessions.')).toBeVisible()
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.getByRole('tab', { name: 'Current' })).toBeVisible()
    await expect(page.getByText('25 of 25 runs')).toBeVisible()
  })
})

test('AG-02-current', async ({ page }) => {
  await capture(page, 'AG-02', 'current', () => gotoAgents(page), async () => {
    await expect(page.getByRole('tab', { name: 'Current' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open conversation' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open conversation' })).toHaveCount(3)
  })
})

test('AG-02-history', async ({ page }) => {
  await capture(page, 'AG-02', 'history', () => gotoAgents(page), async () => {
    await page.getByRole('tab', { name: 'History' }).click()
    await expect(page.getByRole('button', { name: 'Older alerts' })).toBeVisible()
    await expect(page.getByText('Heartbeat needs review').first()).toBeVisible()
  })
})

test('AG-02-empty', async ({ page }) => {
  await capture(page, 'AG-02', 'empty', () => gotoAgents(page, { modes: { alerts: 'empty' } }), async () => {
    await expect(page.getByText('All clear')).toBeVisible()
    await expect(page.getByText('No current warnings for your sessions.')).toBeVisible()
  })
})

test('AG-02-error', async ({ page }) => {
  await capture(page, 'AG-02', 'error', () => gotoAgents(page, { modes: { alerts: 'error' } }), async () => {
    await expect(page.getByRole('alert').first()).toBeVisible()
  })
})

test('AG-03-default', async ({ page }) => {
  await capture(page, 'AG-03', 'default', () => gotoAgents(page), async () => {
    await expect(page.getByRole('textbox', { name: 'Search runs' })).toBeVisible()
    await expect(page.getByText('25 of 25 runs')).toBeVisible()
    // Headers hide below sm (stacked cards), so assert the first row id
    // instead; headers are pinned by the 1440 screenshot.
    await expect(page.getByRole('table', { name: 'Agent runs' }).getByText('run-01-9').first()).toBeVisible()
    // The runs card sits below the alerts card; bring the whole card
    // (header first) into frame.
    await page.getByRole('region', { name: 'Runs' }).scrollIntoViewIfNeeded()
  })
})

test('AG-03-cancel-confirm', async ({ page }) => {
  await capture(page, 'AG-03', 'cancel-confirm', () => gotoAgents(page), async () => {
    await page.getByRole('button', { name: 'Cancel', exact: true }).first().click()
    const dialog = page.getByRole('alertdialog', { name: 'Cancel this run?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('The agent stops after its current step.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel run' })).toBeVisible()
  })
})

test('AG-03-cancelling', async ({ page }) => {
  await capture(page, 'AG-03', 'cancelling', () => gotoAgents(page), async () => {
    await page.getByText('Cancelling', { exact: true }).first().scrollIntoViewIfNeeded()
    await expect(page.getByText('Cancelling', { exact: true }).first()).toBeVisible()
  })
})

test('AG-03-empty', async ({ page }) => {
  await capture(page, 'AG-03', 'empty', () => gotoAgents(page, { modes: { runs: 'empty' } }), async () => {
    await expect(page.getByText('No runs yet', { exact: true })).toBeVisible()
    await page.getByRole('region', { name: 'Runs' }).scrollIntoViewIfNeeded()
  })
})

test('AG-03-390', async ({ page }) => {
  await capture(page, 'AG-03', '390', () => gotoAgents(page), async () => {
    await page.getByRole('region', { name: 'Runs' }).scrollIntoViewIfNeeded()
  }, { widths: [390] })
})
