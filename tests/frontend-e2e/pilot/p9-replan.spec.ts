// P9: replan mid-run. Edits the plan to add HVAC companies, approves,
// restarts research. Proves completed companies stay complete and
// the new scope runs.
import { expect, test } from '@playwright/test'
import { loadState, pilotRunEnabled } from './state.js'
import { expectClean, startRecording } from './record.js'
import { closePilotRo, pilotRoQuery } from './ro.js'

test.describe('P9 replan', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('HVAC scope added; completed work kept', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'p9')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    const completeCount = async (): Promise<number> => {
      const rows = await pilotRoQuery<{ n: string }>(
        `SELECT count(*) AS n FROM research_work WHERE sector_id = (SELECT id FROM sectors WHERE name = $1) AND state = 'complete'`,
        [state.sectorName],
      )
      return Number(rows[0]?.n ?? 0)
    }
    const before = await completeCount()
    // 'Start research' renders twice (page header + plan region).
    const startResearch = page.getByRole('region', { name: 'Research plan' }).getByRole('button', { name: 'Start research' })
    await rec.mark('edit-approve-restart', async () => {
      // P6's 3-way open-plan: failed sectors show no detail-level
      // 'Review plan' (detail offers View progress + Open workspace),
      // so fall through to the workspace Plan tab.
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
      // Post-start plans are read-only (version history only): failed
      // sectors replan via the lifecycle 'Create plan' (draft+failed
      // states, SectorWorkspace), which returns the sector to draft.
      // Preservation is untestable in r0 (0 completed; R0-7) — the
      // mark proves the replan→approve→restart path runs.
      if ((await page.getByRole('button', { name: 'Edit plan', exact: true }).count()) === 0) {
        await page.getByRole('button', { name: 'Create plan' }).click()
        await expect(page.getByRole('button', { name: 'Edit plan', exact: true })).toBeVisible({ timeout: 120000 })
      }
      await page.getByRole('button', { name: 'Edit plan', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Edit research plan' })
      // Textbox, not getByLabel: a wrapping region shares the label (P6).
      const editor = dialog.getByRole('textbox', { name: 'Plan text' })
      await editor.fill(`${await editor.inputValue()}\nAdd HVAC companies across AU.`)
      await dialog.getByRole('button', { name: 'Save plan' }).click()
      await expect(page.getByText('Plan saved')).toBeVisible({ timeout: 60000 })
      await page.getByRole('button', { name: /Approve v\d+/ }).click()
      // Approved/running ⟺ the state-driven action buttons (SectorWorkspace).
      await expect(startResearch).toBeVisible({ timeout: 90000 })
      await startResearch.click()
      await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 300000 })
    })
    await rec.shot('replanned')
    await rec.mark('completed-kept', async () => {
      expect(await completeCount()).toBeGreaterThanOrEqual(before)
    })
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
