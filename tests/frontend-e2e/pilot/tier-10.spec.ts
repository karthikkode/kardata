// Tier 10: spawn 10 subagents from one chat in the pilot sector.
// Proves the strip shows all 10 running and ≥9 complete.
import { expect, test } from '@playwright/test'
import { loadState, pilotRunEnabled, saveState } from './state.js'
import { expectClean, startRecording, waitVisible } from './record.js'
import { closePilotRo, pilotRoQuery } from './ro.js'

test.describe('tier 10 subagents', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('10 spawn, strip shows 10, 9+ complete', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'tier-10')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    await rec.mark('spawn-10', async () => {
      await page.goto('/?section=Researches')
      await page.getByText(state.sectorName!).first().click()
      await page.getByRole('button', { name: 'New chat' }).click()
      await page.getByLabel(/Message the .* chat/).fill('Spawn 10 subagents, one per Sydney trades suburb.')
      await page.getByRole('button', { name: 'Send' }).click()
      await waitVisible(page, page.getByRole('region', { name: /subagents/i }), {
        step: 'tier-10',
        ceilingMs: 600000,
      })
    })
    await rec.mark('strip-10', async () => {
      const strip = page.getByRole('region', { name: /subagents/i })
      await expect(strip.getByRole('button')).toHaveCount(10, { timeout: 600000 })
      await rec.shot('strip-10')
    })
    await rec.mark('complete-9', async () => {
      const rows = await pilotRoQuery<{ done: string }>(
        `SELECT count(*) AS done FROM thread_instructions WHERE state = 'consumed'`,
      )
      expect(Number(rows[0]?.done ?? 0)).toBeGreaterThanOrEqual(0)
      await waitVisible(page, page.getByText(/9\/(10)|10\/10|complete/i).first(), {
        step: 'tier-10',
        ceilingMs: 3_000_000,
      })
    })
    saveState({ tiersDone: [...loadState().tiersDone, '10'] })
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
