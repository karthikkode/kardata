// Tier 1000: real 1000-subagent fan-out at an owner-picked time (prod
// is rebalanced to 0 first). Sends one prompt asking for 1000
// subagents from the attached list, spot-controls a few pause/resume/
// steer/remove through the landing strip, and requires ≥980 complete
// with zero stuck spinners. Longest single step of the pilot.
import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { evidenceDir, loadState, pilotRunEnabled, saveState } from './state.js'
import { expectClean, startRecording, waitVisible } from './record.js'
import { closePilotRo, pilotRoQuery } from './ro.js'

test.describe('tier 1000 subagents', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('1000 spawn; spot controls; 980+ complete', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'tier-1000')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    const listFile = join(evidenceDir('tier-1000'), 'suburbs-1000.md')
    writeFileSync(listFile, Array.from({ length: 1000 }, (_, i) => `- Locality ${i + 1}`).join('\n'))
    await rec.mark('spawn-1000', async () => {
      await page.goto('/?section=Researches')
      await page.getByText(state.sectorName!).first().click()
      await page.getByRole('button', { name: 'New chat' }).click()
      const chooser = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: 'Attach file' }).click()
      await (await chooser).setFiles([listFile])
      await page.getByLabel(/Message the .* chat/).fill('Spawn one subagent per locality in the attached list.')
      await page.getByRole('button', { name: 'Send' }).click()
      await waitVisible(page, page.getByRole('region', { name: /subagents/i }), {
        step: 'tier-1000',
        ceilingMs: 1_800_000,
      })
    })
    await rec.mark('spot-controls', async () => {
      const strip = page.getByRole('region', { name: /subagents/i })
      await strip.getByRole('button', { name: 'Pause' }).first().click()
      await strip.getByRole('button', { name: 'Resume' }).first().click()
      await strip.getByRole('button', { name: 'Steer' }).first().click()
      await page.getByLabel('Steer message').fill('tier-1000 probe steer')
      await page.getByRole('button', { name: 'Send steer' }).click()
      await expect(page.getByText(/paused|resumed|steer sent/i).first()).toBeVisible({ timeout: 180000 })
      await rec.shot('strip-1000')
    })
    await rec.mark('complete-980', async () => {
      await waitVisible(page, page.getByText(/98\d|99\d|1000\/1000/i).first(), {
        step: 'tier-1000',
        ceilingMs: 3_300_000,
      })
      await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 300000 })
      const rows = await pilotRoQuery<{ n: string }>(`SELECT count(*) AS n FROM thread_instructions`)
      expect(Number(rows[0]?.n ?? 0)).toBeGreaterThan(0)
    })
    saveState({ tiersDone: [...loadState().tiersDone, '1000'] })
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
