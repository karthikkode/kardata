// P6: edit the plan once, approve, start research. Proves landing
// and plan views show identical progress.
import { expect, test } from '@playwright/test'
import { loadState, pilotCompanies, pilotRunEnabled } from './state.js'
import { expectClean, startRecording, waitVisible } from './record.js'

test.describe('P6 approve and start', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('edit, approve, start; progress matches everywhere', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'p6')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    await rec.mark('open-plan', async () => {
      // Landing (SectorDetail) → Review plan → plan tab. Approved+
      // states show no 'Review plan' (planned-only): go through the
      // workspace and open the Plan tab there instead.
      await page.goto('/?section=Researches')
      await page.getByRole('table', { name: 'Sectors' }).getByRole('link', { name: state.sectorName }).first().click()
      const review = page.getByRole('button', { name: 'Review plan' })
      if ((await review.count()) > 0) {
        await review.click()
      } else {
        await page.getByRole('button', { name: 'Open workspace' }).first().click()
        const wsReview = page.getByRole('button', { name: 'Review plan' })
        if ((await wsReview.count()) > 0) {
          await wsReview.click()
        } else {
          await page.getByRole('tablist', { name: 'Research views' }).getByRole('tab', { name: /^Plan/ }).click()
        }
      }
      await expect(page.getByRole('tabpanel', { name: 'Plan' })).toBeVisible({ timeout: 15000 })
    })
    await rec.mark('edit-once', async () => {
      await page.getByRole('button', { name: 'Edit plan', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Edit research plan' })
      // Textbox, not getByLabel: a wrapping region shares the label.
      await dialog.getByRole('textbox', { name: 'Plan text' }).fill(`Target ${pilotCompanies()} AU electrical, plumbing and HVAC companies.`)
      await dialog.getByRole('button', { name: 'Save plan' }).click()
      // Toast: 'Plan saved as v<N>. Review reopens.'
      await expect(page.getByText('Plan saved')).toBeVisible({ timeout: 60000 })
    })
    // 'Start research' renders twice (page header + plan region).
    const startResearch = page.getByRole('region', { name: 'Research plan' }).getByRole('button', { name: 'Start research' })
    await rec.mark('approve', async () => {
      await page.getByRole('button', { name: /Approve v\d+/ }).click()
      // Approved ⟺ the Start research button renders (SectorWorkspace).
      await expect(startResearch).toBeVisible({ timeout: 90000 })
    })
    await rec.mark('start', async () => {
      await startResearch.click()
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
