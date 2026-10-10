// Tier 1000: real 1000-subagent fan-out at an owner-picked time (prod
// is rebalanced to 0 first). Sends one prompt asking for 1000
// subagents from the attached list, spot-controls a few pause/resume/
// steer/remove through the landing strip, and requires ≥980 complete
// with zero stuck spinners. Longest single step of the pilot.
import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { evidenceDir, loadState, pilotRunEnabled, repoRoot, saveState } from './state.js'
import { expectClean, openResourceRail, openWorkspace, renameChat, startRecording, waitVisible } from './record.js'
import { closePilotRo, pilotRoQuery } from './ro.js'

test.describe('tier 1000 subagents', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('1000 spawn; spot controls; 980+ complete', async ({ page }) => {
    test.setTimeout(3_600_000)
    // B7 ceiling: without a measurement this tier is a shakedown; with
    // one below 1000 it degrades to an explicit skip, never a surprise.
    const ceilingFile = join(repoRoot(), 'var', 'pilot', 'meta-ceiling.json')
    if (existsSync(ceilingFile)) {
      const ceiling = JSON.parse(readFileSync(ceilingFile, 'utf8')) as { maxSustainable?: number }
      test.skip(
        typeof ceiling.maxSustainable === 'number' && ceiling.maxSustainable < 1000,
        `B7 ceiling ${ceiling.maxSustainable} < 1000: full tier deferred`,
      )
    }
    const rec = startRecording(page, 'tier-1000')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    const listFile = join(evidenceDir('tier-1000'), 'suburbs-1000.md')
    writeFileSync(listFile, Array.from({ length: 1000 }, (_, i) => `- Locality ${i + 1}`).join('\n'))
    await rec.mark('spawn-1000', async () => {
      await openWorkspace(page, state.sectorName!)
      await page.getByRole('button', { name: 'New chat' }).click()
      await renameChat(page, 'pilot-tier-1000')
      const rail = await openResourceRail(page)
      const chooser = page.waitForEvent('filechooser')
      await rail.getByRole('button', { name: 'Upload file' }).click()
      await (await chooser).setFiles([listFile])
      await expect(rail.getByRole('list', { name: 'Files' }).getByText('suburbs-1000.md')).toBeVisible({ timeout: 120000 })
      await page.keyboard.press('Escape')
      await page.getByLabel('Message this conversation').fill('Spawn one subagent per locality in suburbs-1000.md.')
      await page.getByRole('button', { name: 'Send message' }).click()
      await waitVisible(page, page.getByRole('button', { name: /View all \d+/ }), {
        step: 'tier-1000',
        ceilingMs: 1_800_000,
      })
    })
    await rec.mark('spot-controls', async () => {
      await page.getByRole('button', { name: /^Pause / }).first().click()
      await expect(page.getByRole('button', { name: /^Resume / }).first()).toBeVisible({ timeout: 180000 })
      await page.getByRole('button', { name: /^Resume / }).first().click()
      await page.getByLabel('Message this conversation').fill('tier-1000 probe steer: skip duplicates.')
      await page.getByRole('button', { name: 'Steer', exact: true }).click()
      await expect(page.getByText(/paused|resumed|steering saved/i).first()).toBeVisible({ timeout: 180000 })
      await rec.shot('strip-1000')
    })
    await rec.mark('complete-980', async () => {
      // Virtualized directory: UI proves liveness (first Finished) and
      // stillness (no spinners); the scoped DB count proves ≥980.
      await page.getByRole('button', { name: /View all \d+/ }).click()
      const dialog = page.getByRole('dialog', { name: 'Subagents' })
      await waitVisible(page, dialog.getByText('Finished').first(), {
        step: 'tier-1000',
        ceilingMs: 3_300_000,
      })
      const start = Date.now()
      for (;;) {
        const rows = await pilotRoQuery<{ n: string }>(
          `SELECT count(*) AS n FROM threads WHERE kind = 'subagent' AND status = 'FINISHED'
           AND session_id = (SELECT payload->>'sessionId' FROM events WHERE type = 't.session.created'
             AND payload->>'title' = 'pilot-tier-1000' ORDER BY seq DESC LIMIT 1)`,
        )
        if (Number(rows[0]?.n ?? 0) >= 980) break
        if (Date.now() - start > 3_300_000) throw new Error('pilot tier-1000: ceiling reached before 980 finished')
        await page.waitForTimeout(60000)
      }
      await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 300000 })
    })
    saveState({ tiersDone: [...loadState().tiersDone, '1000'] })
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
