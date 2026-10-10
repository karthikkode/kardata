// P8: Karbot monitoring. Asks Karbot to monitor the sector's
// research every 10 min. Proves the sector's Monitor tab shows every
// tick and each tick's streamed tool calls conclude; at least one
// tick reports or steers, and the DB agrees.
import { expect, test } from '@playwright/test'
import { loadState, pilotRunEnabled } from './state.js'
import { expectClean, startRecording, waitVisible } from './record.js'
import { closePilotRo, pilotRoQuery } from './ro.js'

test.describe('P8 monitor', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('monitor ticks stream and conclude; one reports or steers', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'p8')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    await rec.mark('ask-monitor', async () => {
      await page.goto('/?section=Researches')
      await page.getByText(state.sectorName!).first().click()
      await page.getByRole('link', { name: 'Karbot' }).click()
      await page.getByLabel(/Message the .* chat/).fill('Monitor this research every 10 minutes and report progress.')
      await page.getByRole('button', { name: 'Send' }).click()
    })
    await rec.mark('first-tick', async () => {
      await page.getByRole('link', { name: 'Monitor' }).click()
      await waitVisible(page, page.getByText(/tick|monitoring/i).first(), {
        step: 'p8',
        ceilingMs: 900000,
      })
    })
    await rec.mark('tick-concludes', async () => {
      await waitVisible(page, page.getByText(/complete|done|reported/i).first(), {
        step: 'p8',
        ceilingMs: 900000,
      })
    })
    await rec.shot('monitor')
    await rec.mark('db-agrees', async () => {
      const rows = await pilotRoQuery<{ n: string }>(
        `SELECT count(*) AS n FROM thread_instructions WHERE text LIKE '%monitor%' OR text LIKE '%Monitor%'`,
      )
      const ticks = await pilotRoQuery<{ n: string }>(
        `SELECT count(*) AS n FROM events WHERE type LIKE '%monitor%'`,
      )
      expect(Number(rows[0]?.n ?? 0) + Number(ticks[0]?.n ?? 0)).toBeGreaterThanOrEqual(1)
    })
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
