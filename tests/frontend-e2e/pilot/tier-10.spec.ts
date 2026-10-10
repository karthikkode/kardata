// Tier 10: spawn 10 subagents from one chat in the pilot sector.
// Proves the strip shows all 10 running and ≥9 complete.
import { expect, test } from '@playwright/test'
import { loadState, pilotRunEnabled, saveState } from './state.js'
import { expectClean, openChat, openChats, openWorkspace, renameChat, startRecording, waitVisible } from './record.js'
import { closePilotRo, pilotRoQuery } from './ro.js'

test.describe('tier 10 subagents', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('10 spawn, strip shows 10, 9+ complete', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'tier-10')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    // Unique per attempt: a poisoned parent leaves its chat behind,
    // and a fixed name would duplicate rail titles across reruns.
    const tierName = `pilot-tier-10-${Date.now()}`
    await rec.mark('spawn-10', async () => {
      await openWorkspace(page, state.sectorName!)
      await openChats(page)
      await page.getByRole('button', { name: 'New chat' }).click()
      await renameChat(page, tierName)
      // Sequential: any parallel delegates risk the 30s confirm wall
      // (10 at once: 5 ok + 5 uncertain → bricked; 5 at once: 4 ok +
      // 1 uncertain → bricked). One at a time cannot starve itself.
      // Spawn-next-immediately: without it the agent "holds" after
      // each confirm (health polls, then halt) instead of continuing.
      await page.getByLabel('Message this conversation').fill(
        'Spawn 10 subagents, one per Sydney trades suburb, strictly one at a time. ' +
          'Spawn the next immediately after each delegate call returns done: do not wait for children to finish and do not poll their health. ' +
          'Do not spawn in parallel.',
      )
      await page.getByRole('button', { name: 'Send message' }).click()
      // The strip shows the first 3; the directory lists all 10.
      await waitVisible(page, page.getByRole('button', { name: /View all \d+/ }), {
        step: 'tier-10',
        ceilingMs: 600000,
      })
    })
    await rec.mark('strip-10', async () => {
      // Drive to 10: the agent halts between spawns (R0-16 family).
      // The View-all count is the live census; nudge while DB-quiet
      // (IDLE + no new messages for 60s), max 10 — never on Send
      // visibility: ghost Steer blocked nudging for 10 min while the
      // parent sat IDLE (R0-12). A poisoned parent (recovery failed)
      // can never continue: fail fast so a rerun starts a fresh chat.
      const viewAll = page.getByRole('button', { name: /View all \d+/ })
      const send = page.getByRole('button', { name: 'Send message' })
      const box = page.getByLabel('Message this conversation')
      const parents = await pilotRoQuery<{ id: string }>(
        `SELECT payload->>'sessionId' AS id FROM events WHERE type = 't.session.renamed'
         AND payload->>'title' = $1 ORDER BY at DESC LIMIT 1`,
        [tierName],
      )
      const parentKey = parents[0]?.id ?? ''
      let nudges = 0
      const start = Date.now()
      for (;;) {
        const count = Number((await viewAll.textContent().catch(() => ''))?.match(/\d+/)?.[0] ?? 0)
        if (count >= 10) break
        if (Date.now() - start > 900000) throw new Error(`pilot tier-10: only ${count} children after 15 min`)
        if (parentKey) {
          const poisoned = await pilotRoQuery<{ n: string }>(
            `SELECT count(*) AS n FROM thread_messages WHERE thread_key = $1
             AND kind = 'tool' AND payload::text LIKE '%operation.recovery%'
             AND payload::text LIKE '%"state": "failed"%'`,
            [parentKey],
          )
          if (Number(poisoned[0]?.n ?? 0) > 0) {
            throw new Error(`pilot tier-10: parent poisoned at ${count} children (recovery failed) — rerun starts a fresh chat`)
          }
        }
        const fresh = parentKey
          ? await pilotRoQuery<{ at: string }>(`SELECT max(at) AS at FROM thread_messages WHERE thread_key = $1`, [parentKey])
          : []
        const status = parentKey
          ? await pilotRoQuery<{ status: string }>(`SELECT status FROM threads WHERE key = $1`, [parentKey])
          : []
        const quiet = Date.now() - new Date(fresh[0]?.at ?? start).getTime() > 60000 && status[0]?.status === 'IDLE'
        if (nudges < 10 && quiet) {
          nudges++
          // Ghost Steer can hide Send while IDLE: reload to server
          // truth first, then send.
          if ((await send.count()) === 0) {
            await page.reload()
            await openWorkspace(page, state.sectorName!)
            await openChats(page)
            await openChat(page, tierName, state.sectorName!)
          }
          await box.fill(`Continue: ${count} of 10 spawned. Spawn the next one NOW; do not wait for running children.`)
          // Forced: a success toast can overlay the composer for a
          // minute and intercept the click (r0c).
          await send.click({ force: true })
        }
        await page.waitForTimeout(15000)
      }
      await viewAll.click()
      const list = page.getByRole('dialog', { name: 'Subagents' }).getByRole('list', { name: 'Subagents' })
      await expect(list.getByRole('button', { name: /^Open / })).toHaveCount(10, { timeout: 60000 })
      await rec.shot('strip-10')
    })
    await rec.mark('complete-9', async () => {
      // Finished children carry the Finished badge; 9th visible ⟹ ≥9 done.
      const finished = page.getByRole('dialog', { name: 'Subagents' }).getByText('Finished').nth(8)
      await waitVisible(page, finished, { step: 'tier-10', ceilingMs: 3_000_000 })
      const rows = await pilotRoQuery<{ done: string }>(
        `SELECT count(*) AS done FROM threads WHERE kind = 'subagent' AND status = 'FINISHED'`,
      )
      expect(Number(rows[0]?.done ?? 0)).toBeGreaterThanOrEqual(9)
    })
    saveState({ tiersDone: [...loadState().tiersDone, '10'] })
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
