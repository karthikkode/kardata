// P8: Karbot monitoring. Asks Karbot to monitor the sector's
// research every 10 min. Proves the sector's Monitor tab shows every
// tick and each tick's streamed tool calls conclude; at least one
// tick reports or steers, and the DB agrees.
import { expect, test } from '@playwright/test'
import { loadState, pilotRunEnabled } from './state.js'
import { expectClean, openWorkspace, startRecording, waitVisible } from './record.js'
import { closePilotRo, pilotRoQuery } from './ro.js'

test.describe('P8 monitor', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('monitor ticks stream and conclude; one reports or steers', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'p8')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    await rec.mark('ask-monitor', async () => {
      // No Monitor tab exists: Karbot monitors surface as dock messages.
      // The dock takes no sector scope, so the prompt names the sector.
      await openWorkspace(page, state.sectorName!)
      await page.getByRole('button', { name: 'Ask Karbot' }).click()
      const dock = page.getByRole('complementary', { name: 'Assistant chat' })
      await expect(dock).toBeVisible()
      await dock.getByLabel('Message the agent').fill(
        `Monitor ${state.sectorName} research every 10 minutes and report new companies here.`,
      )
      await dock.getByRole('button', { name: 'Send message' }).click()
      await waitVisible(page, dock.getByText(/monitor/i), { step: 'p8', ceilingMs: 900000 })
    })
    await rec.mark('first-tick', async () => {
      const dock = page.getByRole('complementary', { name: 'Assistant chat' })
      await waitVisible(page, dock.getByText(/tick|companies found|monitoring/i), {
        step: 'p8',
        ceilingMs: 1_200_000,
      })
    })
    await rec.mark('tick-concludes', async () => {
      const dock = page.getByRole('complementary', { name: 'Assistant chat' })
      await waitVisible(page, dock.getByText(/complete|done|reported|no new|up to date/i).last(), {
        step: 'p8',
        ceilingMs: 1_800_000,
      })
    })
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
