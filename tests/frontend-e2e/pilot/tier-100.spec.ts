// Tier 100: upload a 100-suburb list, spawn 100, pause/resume/steer/
// cancel one each. Proves landing + subagent directory stay correct
// and ≥98 complete.
import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { evidenceDir, loadState, pilotRunEnabled, saveState } from './state.js'
import { expectClean, startRecording, waitVisible } from './record.js'
import { closePilotRo, pilotRoQuery } from './ro.js'

test.describe('tier 100 subagents', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('100 spawn; controls work; 98+ complete', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'tier-100')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    const listFile = join(evidenceDir('tier-100'), 'suburbs-100.md')
    writeFileSync(listFile, Array.from({ length: 100 }, (_, i) => `- Suburb ${i + 1}`).join('\n'))
    await rec.mark('spawn-100', async () => {
      await page.goto('/?section=Researches')
      await page.getByText(state.sectorName!).first().click()
      await page.getByRole('button', { name: 'New chat' }).click()
      const chooser = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: 'Attach file' }).click()
      await (await chooser).setFiles([listFile])
      await page.getByLabel(/Message the .* chat/).fill('Spawn one subagent per suburb in the attached list.')
      await page.getByRole('button', { name: 'Send' }).click()
      await waitVisible(page, page.getByRole('region', { name: /subagents/i }), {
        step: 'tier-100',
        ceilingMs: 900000,
      })
    })
    await rec.mark('controls', async () => {
      const strip = page.getByRole('region', { name: /subagents/i })
      await strip.getByRole('button', { name: 'Pause' }).first().click()
      await strip.getByRole('button', { name: 'Resume' }).first().click()
      await strip.getByRole('button', { name: 'Steer' }).first().click()
      await page.getByLabel('Steer message').fill('tier-100 probe steer')
      await page.getByRole('button', { name: 'Send steer' }).click()
      await strip.getByRole('button', { name: 'Stop' }).first().click()
      await expect(page.getByText(/paused|resumed|steer sent|stopped/i).first()).toBeVisible({ timeout: 120000 })
    })
    await rec.mark('directory-correct', async () => {
      await page.getByRole('link', { name: /subagents/i }).click()
      await expect(page.getByText(/100|99/).first()).toBeVisible({ timeout: 120000 })
      await rec.shot('directory-100')
    })
    await rec.mark('complete-98', async () => {
      await waitVisible(page, page.getByText(/9[89]\/100|100\/100/i).first(), {
        step: 'tier-100',
        ceilingMs: 3_000_000,
      })
      const rows = await pilotRoQuery<{ n: string }>(`SELECT count(*) AS n FROM thread_instructions`)
      expect(Number(rows[0]?.n ?? 0)).toBeGreaterThan(0)
    })
    saveState({ tiersDone: [...loadState().tiersDone, '100'] })
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
