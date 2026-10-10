// Tier 100: upload a 100-suburb list, spawn 100, pause/resume/steer/
// cancel one each. Proves landing + subagent directory stay correct
// and ≥98 complete.
import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { evidenceDir, loadState, pilotRunEnabled, saveState } from './state.js'
import { expectClean, openChats, openResourceRail, openWorkspace, renameChat, startRecording, waitVisible } from './record.js'
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
      await openWorkspace(page, state.sectorName!)
      await openChats(page)
      await page.getByRole('button', { name: 'New chat' }).click()
      // Unique per attempt: reruns must not duplicate rail titles.
      await renameChat(page, `pilot-tier-100-${Date.now()}`)
      // Upload (Sector files), not Attach (which references indexed files).
      const rail = await openResourceRail(page)
      const chooser = page.waitForEvent('filechooser')
      await rail.getByRole('button', { name: 'Upload file' }).click()
      await (await chooser).setFiles([listFile])
      await expect(rail.getByRole('list', { name: 'Files' }).getByText('suburbs-100.md')).toBeVisible({ timeout: 120000 })
      await page.keyboard.press('Escape')
      // Batched: parallel delegates beyond ~5 starve the single
      // pilot worker into uncertain-poison (R0-3, tier-10 proof).
      await page.getByLabel('Message this conversation').fill(
        'Spawn one subagent per suburb in suburbs-100.md, five at a time: wait for each batch of five to confirm before spawning the next.',
      )
      await page.getByRole('button', { name: 'Send message' }).click()
      await waitVisible(page, page.getByRole('button', { name: /View all \d+/ }), {
        step: 'tier-100',
        ceilingMs: 900000,
      })
    })
    await rec.mark('controls', async () => {
      // Child buttons are `Pause/Resume/Stop <name>`; the space excludes
      // the bare sector buttons. Steer via the parent composer (v2 CV-11).
      await page.getByRole('button', { name: /^Pause / }).first().click()
      await expect(page.getByRole('button', { name: /^Resume / }).first()).toBeVisible({ timeout: 120000 })
      await page.getByRole('button', { name: /^Resume / }).first().click()
      await page.getByLabel('Message this conversation').fill('tier-100 probe steer: skip duplicates.')
      await page.getByRole('button', { name: 'Steer', exact: true }).click()
      await expect(page.getByText('Steering saved for your next turn')).toBeVisible({ timeout: 120000 })
      await page.getByRole('button', { name: /^Stop / }).first().click()
      await page.getByRole('dialog', { name: 'Stop this agent?' }).getByRole('button', { name: 'Stop agent' }).click()
      await expect(page.getByText(/paused|resumed|steering saved|stopped/i).first()).toBeVisible({ timeout: 120000 })
    })
    await rec.mark('directory-correct', async () => {
      await page.getByRole('button', { name: /View all \d+/ }).click()
      const dialog = page.getByRole('dialog', { name: 'Subagents' })
      // Virtualized at 50: the caption carries the true total.
      await expect(dialog.getByText(/Showing \d+ of (100|99)/)).toBeVisible({ timeout: 120000 })
      await rec.shot('directory-100')
    })
    await rec.mark('complete-98', async () => {
      // The directory virtualizes (~50 rows), so UI counting stops at
      // liveness: first Finished badge, then the scoped DB count proves
      // ≥98 (children carry the chat's session id).
      const dialog = page.getByRole('dialog', { name: 'Subagents' })
      await waitVisible(page, dialog.getByText('Finished').first(), {
        step: 'tier-100',
        ceilingMs: 3_000_000,
      })
      const start = Date.now()
      for (;;) {
        const rows = await pilotRoQuery<{ n: string }>(
          `SELECT count(*) AS n FROM threads WHERE kind = 'subagent' AND status = 'FINISHED'
           AND session_id = (SELECT payload->>'sessionId' FROM events WHERE type = 't.session.created'
             AND payload->>'title' = 'pilot-tier-100' ORDER BY seq DESC LIMIT 1)`,
        )
        if (Number(rows[0]?.n ?? 0) >= 98) break
        if (Date.now() - start > 3_000_000) throw new Error('pilot tier-100: ceiling reached before 98 finished')
        await page.waitForTimeout(30000)
      }
    })
    saveState({ tiersDone: [...loadState().tiersDone, '100'] })
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
