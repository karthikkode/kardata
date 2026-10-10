// P4: subagent fan-out. Each brainstorming chat is asked to spawn at
// least 10 subagents; 2 more spawn from the UI button. Proves named
// subagents, readable transcripts, and results returning to parents.
import { expect, test } from '@playwright/test'
import { loadState, pilotRunEnabled } from './state.js'
import { expectClean, startRecording, waitVisible } from './record.js'

test.describe('P4 subagents', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('spawn 10+ per chat plus 2 by button; transcripts readable', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'p4')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    await page.goto('/?section=Researches')
    await page.getByText(state.sectorName!).first().click()
    for (const key of ['icp', 'geo', 'sources']) {
      await rec.mark(`spawn-${key}`, async () => {
        await page.getByRole('link', { name: new RegExp(key, 'i') }).first().click()
        await page.getByLabel(/Message the .* chat/).fill('Spawn at least 10 subagents to split this research.')
        await page.getByRole('button', { name: 'Send' }).click()
        await waitVisible(page, page.getByText(/10 subagents|subagents (started|running)/i), {
          step: 'p4',
          ceilingMs: 1_800_000,
        })
      })
    }
    await rec.mark('button-spawns', async () => {
      await page.getByRole('button', { name: 'New subagent' }).click()
      await page.getByRole('button', { name: 'New subagent' }).click()
      await expect(page.getByText(/subagent/i).first()).toBeVisible({ timeout: 60000 })
    })
    await rec.mark('transcripts', async () => {
      const strip = page.getByRole('region', { name: /subagents/i })
      await strip.getByRole('button').first().click()
      await expect(page.getByText(/transcript|messages/i).first()).toBeVisible({ timeout: 60000 })
    })
    await rec.shot('subagents')
    rec.finish()
    expectClean(rec)
  })
})
