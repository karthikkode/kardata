// Tier 10: spawn 10 subagents from one chat in the pilot sector.
// Proves the strip shows all 10 running and ≥9 complete.
import { expect, test } from '@playwright/test'
import { loadState, pilotRunEnabled, saveState } from './state.js'
import { expectClean, openWorkspace, renameChat, startRecording, waitVisible } from './record.js'
import { closePilotRo, pilotRoQuery } from './ro.js'

test.describe('tier 10 subagents', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('10 spawn, strip shows 10, 9+ complete', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'tier-10')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    await rec.mark('spawn-10', async () => {
      await openWorkspace(page, state.sectorName!)
      await page.getByRole('button', { name: 'New chat' }).click()
      await renameChat(page, 'pilot-tier-10')
      await page.getByLabel('Message this conversation').fill('Spawn 10 subagents, one per Sydney trades suburb.')
      await page.getByRole('button', { name: 'Send message' }).click()
      // The strip shows the first 3; the directory lists all 10.
      await waitVisible(page, page.getByRole('button', { name: /View all \d+/ }), {
        step: 'tier-10',
        ceilingMs: 600000,
      })
    })
    await rec.mark('strip-10', async () => {
      await page.getByRole('button', { name: /View all \d+/ }).click()
      const list = page.getByRole('dialog', { name: 'Subagents' }).getByRole('list', { name: 'Subagents' })
      await expect(list.getByRole('button', { name: /^Open / })).toHaveCount(10, { timeout: 600000 })
      await rec.shot('strip-10')
    })
    await rec.mark('complete-9', async () => {
      // Finished children carry the Finished badge; 9th visible ⟹ ≥9 done.
      const finished = page.getByRole('dialog', { name: 'Subagents' }).getByText('Finished').nth(8)
      await waitVisible(page, finished, { step: 'tier-10', ceilingMs: 3_000_000 })
      const rows = await pilotRoQuery<{ done: string }>(
        `SELECT count(*) AS done FROM threads WHERE kind = 'subagent' AND status = 'FINISHED'`,
      )
      expect(Number(rows[0]?.done ?? 0)).toBeGreaterThanOrEqual(9)
    })
    saveState({ tiersDone: [...loadState().tiersDone, '10'] })
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
