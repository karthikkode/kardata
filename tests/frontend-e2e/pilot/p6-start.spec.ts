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
      // Landing (SectorDetail) → Review plan → plan tab.
      await page.goto('/?section=Researches')
      await page.getByRole('table', { name: 'Sectors' }).getByRole('link', { name: state.sectorName }).first().click()
      await page.getByRole('button', { name: 'Review plan' }).click()
      await expect(page.getByRole('tabpanel', { name: 'Plan' })).toBeVisible({ timeout: 15000 })
    })
    await rec.mark('edit-once', async () => {
      await page.getByRole('button', { name: 'Edit plan', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Edit research plan' })
      await dialog.getByLabel('Plan text').fill('Target 100 AU electrical, plumbing and HVAC companies.')
      await dialog.getByRole('button', { name: 'Save plan' }).click()
      // Toast: 'Plan saved as v<N>. Review reopens.'
      await expect(page.getByText('Plan saved')).toBeVisible({ timeout: 60000 })
    })
    await rec.mark('approve', async () => {
      await page.getByRole('button', { name: /Approve v\d+/ }).click()
      // Approved ⟺ the Start research button renders (SectorWorkspace).
      await expect(page.getByRole('button', { name: 'Start research' })).toBeVisible({ timeout: 90000 })
    })
    await rec.mark('start', async () => {
      await page.getByRole('button', { name: 'Start research' }).click()
      // Running ⟺ the Pause button renders (SectorWorkspace).
      await waitVisible(page, page.getByRole('button', { name: 'Pause', exact: true }), {
        step: 'p6',
        ceilingMs: 600000,
      })
    })
    await rec.mark('progress-matches', async () => {
      const planProgress = await page.getByRole('region', { name: 'Research progress' }).textContent()
      await page.goto('/?section=Researches')
      await page.getByRole('table', { name: 'Sectors' }).getByRole('link', { name: state.sectorName }).first().click()
      const landingProgress = await page.getByRole('region', { name: 'Research status' }).textContent()
      expect(planProgress).toBeTruthy()
      expect(landingProgress).toContain((planProgress ?? '').match(/\d+/)?.[0] ?? '###no-number###')
    })
    await rec.shot('research-running')
    rec.finish()
    expectClean(rec)
  })
})
