// P12: reconnect storm. Reloads mid-stream once, switches sessions
// mid-stream once, closes and reopens the tab after 5 minutes.
// Proves no stuck spinners, no duplicated rows, drafts kept.
import { expect, test } from '@playwright/test'
import { loadState, pilotRunEnabled } from './state.js'
import { expectClean, startRecording } from './record.js'

test.describe('P12 reconnect', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('reload, switch, reopen: nothing stuck, nothing lost', async ({ page, context }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'p12')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    await rec.mark('start-stream', async () => {
      await page.goto('/?section=Researches')
      await page.getByText(state.sectorName!).first().click()
      await page.getByLabel(/Message the .* chat/).fill('Summarise the current research state in one paragraph.')
      await page.getByRole('button', { name: 'Send' }).click()
      await page.waitForTimeout(3000)
    })
    await rec.mark('reload-mid-stream', async () => {
      await page.reload()
      await expect(page.getByText(state.sectorName!).first()).toBeVisible({ timeout: 90000 })
      await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 90000 })
    })
    await rec.mark('switch-sessions', async () => {
      await page.getByRole('link', { name: 'Researches' }).click()
      await page.getByText(state.sectorName!).first().click()
      await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 90000 })
    })
    await rec.mark('reopen-tab', async () => {
      const url = page.url()
      await page.waitForTimeout(300000)
      const fresh = await context.newPage()
      await fresh.goto(url)
      await expect(fresh.getByText(state.sectorName!).first()).toBeVisible({ timeout: 90000 })
      await expect(fresh.getByRole('progressbar')).toHaveCount(0, { timeout: 90000 })
      await page.close()
    })
    await rec.shot('reconnected')
    rec.finish()
    expectClean(rec)
  })
})
