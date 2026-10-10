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
      await page.getByText(state.sectorName!).first().click()
      await page.getByRole('button', { name: 'Review plan' }).click()
      const editor = page.getByLabel('Edit plan')
      await editor.fill(`${await editor.inputValue()}\nAdd HVAC companies across AU.`)
      await page.getByRole('button', { name: 'Save plan' }).click()
      await page.getByRole('button', { name: /Approve v\d+/ }).click()
      await expect(page.getByLabel('Research state: Approved')).toBeVisible({ timeout: 90000 })
      await page.getByRole('button', { name: 'Start research' }).click()
      await expect(page.getByLabel('Research state: In progress')).toBeVisible({ timeout: 300000 })
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
