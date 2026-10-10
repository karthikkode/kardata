// P6: edit the plan once, approve, start research. Proves landing
// and plan views show identical progress.
import { expect, test } from '@playwright/test'
import { loadState, pilotRunEnabled } from './state.js'
import { expectClean, startRecording, waitVisible } from './record.js'

test.describe('P6 approve and start', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('edit, approve, start; progress matches everywhere', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'p6')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    await rec.mark('open-plan', async () => {
      await page.goto('/?section=Researches')
      await page.getByText(state.sectorName!).first().click()
      await page.getByRole('button', { name: 'Review plan' }).click()
    })
    await rec.mark('edit-once', async () => {
      await page.getByLabel('Edit plan').fill('Target 100 AU electrical, plumbing and HVAC companies.')
      await page.getByRole('button', { name: 'Save plan' }).click()
      await expect(page.getByText('Plan saved')).toBeVisible({ timeout: 60000 })
    })
    await rec.mark('approve', async () => {
      await page.getByRole('button', { name: /Approve v\d+/ }).click()
      await expect(page.getByLabel('Research state: Approved')).toBeVisible({ timeout: 90000 })
    })
    await rec.mark('start', async () => {
      await page.getByRole('button', { name: 'Start research' }).click()
      await waitVisible(page, page.getByLabel('Research state: In progress'), {
        step: 'p6',
        ceilingMs: 600000,
      })
    })
    await rec.mark('progress-matches', async () => {
      const planProgress = await page.getByRole('region', { name: 'Research status' }).textContent()
      await page.getByRole('button', { name: 'Back to researches' }).click()
      const landingProgress = await page.getByText(state.sectorName!).first().textContent()
      expect(planProgress).toBeTruthy()
      expect(landingProgress).toContain((planProgress ?? '').match(/\d+/)?.[0] ?? '###no-number###')
    })
    await rec.shot('research-running')
    rec.finish()
    expectClean(rec)
  })
})
