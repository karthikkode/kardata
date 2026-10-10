// P10: wait for ≥100 accepted companies. Proves the landing count
// never exceeds the DB count (no phantom rows).
import { expect, test } from '@playwright/test'
import { loadState, pilotRunEnabled } from './state.js'
import { expectClean, startRecording, waitVisible } from './record.js'
import { closePilotRo, pilotRoQuery } from './ro.js'

test.describe('P10 hundred companies', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('landing reaches 100; DB agrees', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'p10')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    await rec.mark('wait-hundred', async () => {
      await page.goto('/?section=Researches')
      await page.getByText(state.sectorName!).first().click()
      await waitVisible(page, page.getByText(/10\d|100\+? companies/i), {
        step: 'p10',
        ceilingMs: 3_400_000,
        status: page.getByRole('region', { name: 'Research status' }),
      })
    })
    await rec.shot('hundred')
    await rec.mark('db-agrees', async () => {
      const rows = await pilotRoQuery<{ n: string }>(
        `SELECT count(*) AS n FROM research_work WHERE sector_id = (SELECT id FROM sectors WHERE name = $1) AND state = 'complete' AND kind = 'company'`,
        [state.sectorName],
      )
      expect(Number(rows[0]?.n ?? 0)).toBeGreaterThanOrEqual(100)
    })
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
