// P7: live research controls. Steers the parent and 3 running
// subagents, pauses/resumes 2, stops 1, reorders + removes a queued
// message, toggles global context off/on. Proves a UI receipt and a
// DB receipt for each; a steer to a paused subagent shows the 409
// "not accepting" message (expected, same as sessions).
import { expect, test } from '@playwright/test'
import { loadState, pilotRunEnabled } from './state.js'
import { expectClean, openWorkspace, startRecording } from './record.js'
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
      await openWorkspace(page, state.sectorName!)
    })
    await rec.mark('steer-parent', async () => {
      // Steer shows only mid-reply (v2 conversation.spec.ts CV-11 sends
      // first): open the research parent, start a turn, then steer it.
      await page.getByRole('button', { name: 'Open pilot-research' }).click()
      await page.getByLabel('Message this conversation').fill('Pilot steer probe: keep digging, more depth please.')
      await page.getByRole('button', { name: 'Send message' }).click()
      await expect(page.getByRole('button', { name: 'Steer', exact: true })).toBeVisible({ timeout: 120000 })
      await page.getByLabel('Message this conversation').fill('pilot-p7-parent: prioritise regional NSW.')
      await page.getByRole('button', { name: 'Steer', exact: true }).click()
      await expect(page.getByText('Steering saved for your next turn')).toBeVisible({ timeout: 60000 })
    })
    await rec.mark('steer-children', async () => {
      // No per-row steer: open each child chat, then steer its composer.
      await page.getByRole('button', { name: /View all \d+/ }).click()
      const directory = page.getByRole('dialog', { name: 'Subagents' })
      const list = directory.getByRole('list', { name: 'Subagents' })
      for (let index = 0; index < 3; index++) {
        const open = list.getByRole('button', { name: /^Open / }).nth(index)
        await expect(open).toBeVisible({ timeout: 60000 })
        await open.click()
        await page.getByLabel('Message this conversation').fill(`pilot-p7-child-${index}: skip franchises.`)
        await page.getByRole('button', { name: 'Steer', exact: true }).click()
        await expect(page.getByText('Steering saved for your next turn')).toBeVisible({ timeout: 60000 })
        // TODO(r0): confirm the back path from a child chat (Back to sector summary?).
        await page.getByRole('button', { name: 'Back to sector summary' }).click()
        await page.getByRole('button', { name: /View all \d+/ }).click()
      }
    })
    await rec.mark('pause-resume', async () => {
      // Child buttons are `Pause/Resume <name>`; the leading-space regex
      // excludes the bare sector Pause/Resume buttons.
      for (let index = 0; index < 2; index++) {
        await page.getByRole('button', { name: /^Pause / }).first().click()
      }
      await expect(page.getByRole('button', { name: /^Resume / }).nth(1)).toBeVisible({ timeout: 60000 })
      for (let index = 0; index < 2; index++) {
        await page.getByRole('button', { name: /^Resume / }).first().click()
      }
      await expect(page.getByRole('button', { name: /^Pause / }).nth(1)).toBeVisible({ timeout: 60000 })
    })
    await rec.mark('paused-steer-409', async () => {
      await page.getByRole('button', { name: /^Pause / }).first().click()
      await expect(page.getByRole('button', { name: /^Resume / }).first()).toBeVisible({ timeout: 60000 })
      // Steer the paused child: backend 409 ('not accepting steer')
      // surfaces as the chat error.
      const directory = page.getByRole('dialog', { name: 'Subagents' })
      const list = page.getByRole('list', { name: 'Subagents' })
      await page.getByRole('button', { name: /View all \d+/ }).click()
      await list.getByRole('button', { name: /^Open / }).first().click()
      await expect(directory).toBeHidden({ timeout: 15000 })
      await page.getByLabel('Message this conversation').fill('pilot-p7-paused: hello?')
      await page.getByRole('button', { name: 'Steer', exact: true }).click()
      await expect(page.getByText(/not accepting/i)).toBeVisible({ timeout: 60000 })
      await page.getByRole('button', { name: 'Back to sector summary' }).click()
      await page.getByRole('button', { name: /^Resume / }).first().click()
    })
    await rec.mark('stop-one', async () => {
      await page.getByRole('button', { name: /^Stop / }).first().click()
      // Scoped to the confirm: a live reply also shows Stop agent.
      await page.getByRole('dialog', { name: 'Stop this agent?' }).getByRole('button', { name: 'Stop agent' }).click()
      await expect(page.getByText(/stopped/i).first()).toBeVisible({ timeout: 60000 })
    })
    await rec.mark('queue-reorder-remove', async () => {
      // Queue shows only mid-reply: send a probe unless already replying.
      const send = page.getByRole('button', { name: 'Send message' })
      if (await send.isVisible()) {
        await page.getByLabel('Message this conversation').fill('Pilot queue probe: narrate slowly.')
        await send.click()
      }
      await expect(page.getByRole('button', { name: 'Queue', exact: true })).toBeVisible({ timeout: 120000 })
      // Rows reorder via Move up/down and remove via Remove <text> (no drag handle).
      for (const text of ['pilot-p7-queued-a', 'pilot-p7-queued-b']) {
        await page.getByLabel('Message this conversation').fill(text)
        await page.getByRole('button', { name: 'Queue', exact: true }).click()
      }
      await page.getByRole('button', { name: 'Move pilot-p7-queued-b up' }).click()
      await page.getByRole('button', { name: 'Remove pilot-p7-queued-a' }).click()
      await expect(page.getByRole('button', { name: 'Queued (1)' })).toBeVisible({ timeout: 60000 })
    })
    await rec.mark('context-toggle', async () => {
      await page.getByRole('button', { name: 'Local context' }).click()
      const toggle = page.getByRole('switch', { name: 'Use global context' })
      await expect(toggle).toBeVisible()
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 30000 })
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 30000 })
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
