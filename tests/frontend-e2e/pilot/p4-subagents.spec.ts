// P4: subagent fan-out. Each brainstorming chat is asked to spawn at
// least 10 subagents; 2 more spawn from the UI button. Proves named
// subagents, readable transcripts, and results returning to parents.
import { expect, test } from '@playwright/test'
import { loadState, pilotRunEnabled } from './state.js'
import { expectClean, openWorkspace, startRecording, waitVisible } from './record.js'

test.describe('P4 subagents', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('spawn 10+ per chat plus 2 by button; transcripts readable', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'p4')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    await rec.mark('open-sector', async () => {
      await openWorkspace(page, state.sectorName!)
    })
    for (const key of ['icp', 'geo', 'sources']) {
      await rec.mark(`spawn-${key}`, async () => {
        // P2 renamed each chat pilot-<key>: open it by its session button.
        await page.getByRole('button', { name: `Open pilot-${key}` }).click()
        await page.getByLabel('Message this conversation').fill('Spawn at least 10 subagents to split this research.')
        await page.getByRole('button', { name: 'Send message' }).click()
        await waitVisible(page, page.getByText(/10 subagents|subagents (started|running)/i), {
          step: 'p4',
          ceilingMs: 1_800_000,
        })
      })
    }
    for (const name of ['pilot-alpha', 'pilot-beta']) {
      await rec.mark(`button-spawn-${name}`, async () => {
        await page.getByRole('button', { name: 'New subagent' }).click()
        const form = page.getByRole('form', { name: 'New subagent' })
        await form.getByLabel('Goal').fill(`Decompose the ${name} angle into verifiable sub-questions.`)
        await form.getByLabel('Name (optional)').fill(name)
        await page.getByRole('button', { name: 'Start subagent' }).click()
        await expect(form).toBeHidden({ timeout: 30000 })
      })
    }
    await rec.mark('transcripts', async () => {
      await page.getByRole('button', { name: /View all \d+/ }).click()
      const directory = page.getByRole('dialog', { name: 'Subagents' })
      const list = directory.getByRole('list', { name: 'Subagents' })
      for (let index = 0; index < 3; index++) {
        const open = list.getByRole('button', { name: /^Open / }).nth(index)
        await expect(open).toBeVisible({ timeout: 60000 })
        await open.click()
        await waitVisible(page, page.getByText(/subagent|Subagent|decompos|recommend/, { exact: false }), {
          step: 'p4',
          ceilingMs: 1_800_000,
        })
        await page.getByRole('button', { name: /View all \d+/ }).click()
      }
    })
    await rec.shot('subagents')
    rec.finish()
    expectClean(rec)
  })
})
