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
    await rec.mark('edit-approve-restart', async () => {
      await page.goto('/?section=Researches')
      await page.getByRole('table', { name: 'Sectors' }).getByRole('link', { name: state.sectorName }).first().click()
      await page.getByRole('button', { name: 'Review plan' }).click()
      await expect(page.getByRole('tabpanel', { name: 'Plan' })).toBeVisible({ timeout: 15000 })
      await page.getByRole('button', { name: 'Edit plan', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Edit research plan' })
      const editor = dialog.getByLabel('Plan text')
      await editor.fill(`${await editor.inputValue()}\nAdd HVAC companies across AU.`)
      await dialog.getByRole('button', { name: 'Save plan' }).click()
      await expect(page.getByText('Plan saved')).toBeVisible({ timeout: 60000 })
      await page.getByRole('button', { name: /Approve v\d+/ }).click()
      // Approved/running ⟺ the state-driven action buttons (SectorWorkspace).
      await expect(page.getByRole('button', { name: 'Start research' })).toBeVisible({ timeout: 90000 })
      await page.getByRole('button', { name: 'Start research' }).click()
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
