// P4: subagent fan-out. The healthy brainstorm chat plus two fresh
// chats are asked to spawn at least 10 subagents each (pilot-icp and
// pilot-geo are bricked by R0-2: resume replays the conflicted call,
// so their turns crash forever); 2 more spawn from the UI button.
// Proves named subagents, readable transcripts, and results returning
// to parents.
import { expect, test, type Page } from '@playwright/test'
import { loadState, pilotRunEnabled, saveState } from './state.js'
import { expectClean, openChat, openChats, openWorkspace, renameChat, startRecording, waitVisible } from './record.js'

/** True when the SELECTED session's Subagents directory already lists
 * a child opened as `name`. Missing directory button (no children
 * yet) counts as absent. Closes the dialog before returning. */
async function spawnExists(page: Page, name: string): Promise<boolean> {
  const viewAll = page.getByRole('button', { name: /View all \d+/ })
  if ((await viewAll.count()) === 0) return false
  await viewAll.click()
  const directory = page.getByRole('dialog', { name: 'Subagents' })
  await expect(directory).toBeVisible({ timeout: 15000 })
  const found = (await directory.getByRole('button', { name: `Open ${name}` }).count()) > 0
  await page.keyboard.press('Escape')
  await expect(directory).toBeHidden({ timeout: 15000 })
  return found
}

test.describe('P4 subagents', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('spawn 10+ per chat plus 2 by button; transcripts readable', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'p4')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    await rec.mark('open-sector', async () => {
      await openWorkspace(page, state.sectorName!)
      await openChats(page)
    })
    // Resume tracking: each spawn mark records on completion, so a
    // re-run neither re-sends prompts nor duplicates button spawns.
    const done = new Set(loadState().p4done ?? [])
    const record = (mark: string): void => {
      done.add(mark)
      saveState({ p4done: [...done] })
    }
    await rec.mark('spawn-sources', async () => {
      if (done.has('spawn-sources')) return
      // P2 renamed each chat pilot-<key>: open it by its session button.
      await openChat(page, 'pilot-sources')
      await page.getByLabel('Message this conversation').fill('Spawn at least 10 subagents to split this research.')
      await page.getByRole('button', { name: 'Send message' }).click()
      await waitVisible(page, page.getByText(/10 subagents|subagents (started|running)/i), {
        step: 'p4',
        ceilingMs: 1_800_000,
      })
      record('spawn-sources')
    })
    for (const name of ['pilot-spawn-a', 'pilot-spawn-b']) {
      await rec.mark(`spawn-${name}`, async () => {
        if (done.has(`spawn-${name}`)) return
        // Fresh chats stand in for bricked icp/geo (R0-2): the spawn
        // prompt would queue behind their poisoned turns and never run.
        await page.getByRole('button', { name: 'New chat' }).click()
        await renameChat(page, name)
        await page.getByLabel('Message this conversation').fill('Spawn at least 10 subagents to split AU trades research.')
        await page.getByRole('button', { name: 'Send message' }).click()
        await waitVisible(page, page.getByText(/10 subagents|subagents (started|running)/i), {
          step: 'p4',
          ceilingMs: 1_800_000,
        })
        record(`spawn-${name}`)
      })
    }
    for (const name of ['pilot-alpha', 'pilot-beta']) {
      await rec.mark(`button-spawn-${name}`, async () => {
        if (done.has(`button-spawn-${name}`)) return
        // Deterministic parent: re-runs skip the spawn prompts, which
        // leaves selection at the default (r0: beta#2 landed in sources).
        await openChat(page, 'pilot-spawn-b')
        // Idempotent submit: an uncertain 500 (R0-3) may still have
        // landed the child; never submit a name that already exists.
        if (await spawnExists(page, name)) {
          record(`button-spawn-${name}`)
          return
        }
        await page.getByRole('button', { name: 'New subagent' }).click()
        const form = page.getByRole('form', { name: 'New subagent' })
        await form.getByLabel('Goal').fill(`Decompose the ${name} angle into verifiable sub-questions.`)
        await form.getByLabel('Name (optional)').fill(name)
        // Gate on enabled: Start reads goal from its render closure, so
        // a fill-then-immediate-click can no-op on stale state under
        // load (r0: beta's click sent no request). Enabled ⟺ fresh.
        const start = page.getByRole('button', { name: 'Start subagent' })
        await expect(start).toBeEnabled({ timeout: 30000 })
        await start.click()
        // The spawn POST polls delegation server-side (up to 30s+); the
        // form closes only after it returns. On an uncertain 500 the
        // form stays open: recover by checking whether the child
        // landed (re-run skips it) instead of failing blind.
        const closed = await form
          .waitFor({ state: 'hidden', timeout: 90000 })
          .then(
            () => true,
            () => false,
          )
        if (!closed) {
          await page.keyboard.press('Escape')
          await openChat(page, 'pilot-spawn-b')
          if (await spawnExists(page, name)) {
            record(`button-spawn-${name}`)
            return
          }
          throw new Error(`pilot p4: spawn POST for ${name} neither closed the form nor landed a child (R0-3 wall?)`)
        }
        record(`button-spawn-${name}`)
      })
    }
    await rec.mark('transcripts', async () => {
      // Deterministic scope: the directory lists the SELECTED session's
      // children (r0: default selection showed 2 of 25). Spawn-b holds
      // the button spawns plus its agent-spawned children.
      await openChat(page, 'pilot-spawn-b')
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
