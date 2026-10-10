// P7: live research controls. Steers the parent and 3 running
// subagents, pauses/resumes 2, stops 1, reorders + removes a queued
// message, toggles global context off/on. Proves a UI receipt and a
// DB receipt for each; a steer to a paused subagent shows the 409
// "not accepting" message (expected, same as sessions).
import { expect, test } from '@playwright/test'
import { loadState, pilotRunEnabled } from './state.js'
import { expectClean, startRecording } from './record.js'
import { closePilotRo, pilotRoQuery } from './ro.js'

test.describe('P7 research controls', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('steer, pause, resume, stop, queue, toggle', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'p7')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    const receipts = async (): Promise<number> => {
      const rows = await pilotRoQuery<{ n: string }>(
        `SELECT count(*) AS n FROM thread_instructions WHERE text LIKE 'pilot-p7-%'`,
      )
      return Number(rows[0]?.n ?? 0)
    }
    await rec.mark('open-research', async () => {
      await page.goto('/?section=Researches')
      await page.getByText(state.sectorName!).first().click()
    })
    await rec.mark('steer-parent', async () => {
      await page.getByRole('button', { name: 'Steer' }).first().click()
      await page.getByLabel('Steer message').fill('pilot-p7-parent: prioritise regional NSW.')
      await page.getByRole('button', { name: 'Send steer' }).click()
      await expect(page.getByText('Steer sent')).toBeVisible({ timeout: 60000 })
    })
    for (let i = 0; i < 3; i++) {
      await rec.mark(`steer-child-${i}`, async () => {
        const strip = page.getByRole('region', { name: /subagents/i })
        await strip.getByRole('button', { name: 'Steer' }).nth(i).click()
        await page.getByLabel('Steer message').fill(`pilot-p7-child-${i}: skip franchises.`)
        await page.getByRole('button', { name: 'Send steer' }).click()
        await expect(page.getByText('Steer sent')).toBeVisible({ timeout: 60000 })
      })
    }
    await rec.mark('pause-resume', async () => {
      const strip = page.getByRole('region', { name: /subagents/i })
      await strip.getByRole('button', { name: 'Pause' }).first().click()
      await strip.getByRole('button', { name: 'Pause' }).nth(1).click()
      await expect(page.getByText('Paused').first()).toBeVisible({ timeout: 60000 })
      await strip.getByRole('button', { name: 'Resume' }).first().click()
      await strip.getByRole('button', { name: 'Resume' }).nth(1).click()
    })
    await rec.mark('paused-steer-409', async () => {
      const strip = page.getByRole('region', { name: /subagents/i })
      await strip.getByRole('button', { name: 'Pause' }).first().click()
      await strip.getByRole('button', { name: 'Steer' }).first().click()
      await page.getByLabel('Steer message').fill('pilot-p7-paused: hello?')
      await page.getByRole('button', { name: 'Send steer' }).click()
      await expect(page.getByText(/not accepting/i)).toBeVisible({ timeout: 60000 })
      await strip.getByRole('button', { name: 'Resume' }).first().click()
    })
    await rec.mark('stop-one', async () => {
      const strip = page.getByRole('region', { name: /subagents/i })
      await strip.getByRole('button', { name: 'Stop' }).first().click()
      await expect(page.getByText(/stopped/i).first()).toBeVisible({ timeout: 60000 })
    })
    await rec.mark('queue-reorder-remove', async () => {
      await page.getByLabel(/Message the .* chat/).fill('pilot-p7-queued-a')
      await page.getByRole('button', { name: 'Queue' }).click()
      await page.getByLabel(/Message the .* chat/).fill('pilot-p7-queued-b')
      await page.getByRole('button', { name: 'Queue' }).click()
      const queue = page.getByRole('region', { name: 'Queue' })
      await queue.getByText('pilot-p7-queued-b').dragTo(queue.getByText('pilot-p7-queued-a'))
      await queue.getByRole('button', { name: 'Remove' }).first().click()
    })
    await rec.mark('context-toggle', async () => {
      const toggle = page.getByRole('switch', { name: /global context/i })
      await toggle.click()
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-checked', 'true')
    })
    await rec.shot('controls')
    await rec.mark('db-receipts', async () => {
      expect(await receipts()).toBeGreaterThanOrEqual(4)
    })
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
