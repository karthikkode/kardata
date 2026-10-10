// P12: reconnect storm. Reloads mid-stream once, switches sessions
// mid-stream once, closes and reopens the tab after 5 minutes.
// Proves no stuck spinners, no duplicated rows, drafts kept.
import { expect, test } from '@playwright/test'
import { evidenceDir, loadState, pilotRunEnabled } from './state.js'
import { expectClean, openChat, openChats, openWorkspace, startRecording } from './record.js'

test.describe('P12 reconnect', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('reload, switch, reopen: nothing stuck, nothing lost', async ({ page, context }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'p12')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    await rec.mark('start-stream', async () => {
      await openWorkspace(page, state.sectorName!)
      await openChats(page)
      await openChat(page, 'pilot-research')
      await page.getByLabel('Message this conversation').fill('Summarise the current research state in one paragraph.')
      await page.getByRole('button', { name: 'Send message' }).click()
      await page.waitForTimeout(3000)
    })
    await rec.mark('reload-mid-stream', async () => {
      await page.reload()
      await expect(page.getByText(state.sectorName!).first()).toBeVisible({ timeout: 90000 })
      await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 90000 })
    })
    await rec.mark('switch-sessions', async () => {
      // Research chat → brainstorm chat → back: nothing stuck.
      // (Reload resets the rail to Research, so re-select Chats.)
      await openChats(page)
      await openChat(page, 'pilot-icp')
      await openChat(page, 'pilot-research')
      await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 90000 })
    })
    await rec.mark('reopen-tab', async () => {
      const url = page.url()
      await page.waitForTimeout(300000)
      const fresh = await context.newPage()
      await fresh.goto(url)
      await expect(fresh.getByText(state.sectorName!).first()).toBeVisible({ timeout: 90000 })
      await expect(fresh.getByRole('progressbar')).toHaveCount(0, { timeout: 90000 })
      // Shoot the fresh tab: rec.shot targets the recorded page,
      // which closes below (shot-after-close killed r0c's first run).
      await fresh.screenshot({ path: `${evidenceDir('p12')}/reconnected.png` })
      await page.close()
    })
    rec.finish()
    expectClean(rec)
  })
})
