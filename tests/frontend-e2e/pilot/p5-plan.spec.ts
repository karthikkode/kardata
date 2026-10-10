// P5: research plan. A research chat @-mentions the 3 brainstorming
// chats and asks for plan advice only (target 100, §3.4 filters,
// <6000 chars: R0-6); then "Yes, update the plan accordingly".
// Proves turn 1 advises without changing the plan and turn 2 writes
// executable JSON + criteria.
import { expect, test } from '@playwright/test'
import { loadState, pilotRunEnabled, saveState } from './state.js'
import { expectClean, openChat, openChats, openWorkspace, renameChat, startRecording, waitVisible } from './record.js'
import { closePilotRo, pilotRoQuery } from './ro.js'

test.describe('P5 research plan', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('advise first, write on confirmation', async ({ page }) => {
    // 2h: each plan turn reads across chats and takes ~30 min live.
    test.setTimeout(7_200_000)
    const rec = startRecording(page, 'p5')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    const done = new Set(state.p5done ?? [])
    const record = (mark: string): void => {
      done.add(mark)
      saveState({ p5done: [...done] })
    }
    // Turn-idle gates (Stop agent → Send message), not reply phrasing:
    // r0's advise reply never said 'acceptance criteria' or 'proposed
    // plan'. The proofs are the plan_written counts, not the words.
    const waitTurnDone = async (step: string, ceilingMs: number): Promise<void> => {
      await waitVisible(page, page.getByRole('button', { name: 'Stop agent' }).first(), {
        step: `${step}-started`,
        ceilingMs: 120000,
      })
      await waitVisible(page, page.getByRole('button', { name: 'Send message' }), {
        step: `${step}-done`,
        ceilingMs,
      })
    }
    await rec.mark('open-research-chat', async () => {
      await openWorkspace(page, state.sectorName!)
      await openChats(page)
      // Side chat for P7/P11/P12 (steer/report/reconnect need no plan
      // powers). Re-runs must not duplicate it (two 'pilot-research'
      // rows strict-fail opens).
      if (!state.chats['research']) {
        await page.getByRole('button', { name: 'New chat' }).click()
        await renameChat(page, 'pilot-research')
        saveState({ chats: { ...state.chats, research: 'steer/report chat' } })
      }
      // The plan turns run in the RESEARCH session: db.update_sector_plan
      // is gated to it ('Only the research conversation can change the
      // plan'). r0: pilot-research's turns filed+proposed, never wrote.
      await page.getByRole('tab', { name: 'Research' }).click()
      await openChat(page, 'Research')
    })
    const sectorState = async (): Promise<string> => {
      const rows = await pilotRoQuery<{ state: string }>(`SELECT state FROM sectors WHERE name = $1`, [state.sectorName])
      return rows[0]?.state ?? ''
    }
    const sectorId = async (): Promise<string> => {
      const rows = await pilotRoQuery<{ id: string }>(`SELECT id FROM sectors WHERE name = $1`, [state.sectorName])
      if (!rows[0]) throw new Error('pilot sector missing from DB')
      return rows[0].id
    }
    const planWrites = async (): Promise<number> => {
      const rows = await pilotRoQuery<{ n: string }>(
        `SELECT count(*) AS n FROM events WHERE partition = $1 AND type = 'sector.plan_written'`,
        [`sector:${await sectorId()}`],
      )
      return Number(rows[0]?.n ?? 0)
    }
    await rec.mark('ensure-planned', async () => {
      // update_sector_plan needs state planned: Create plan starts the
      // system plan run (draft → planning → planned + v1). Re-runs find
      // the button gone and poll through an in-flight run, if any.
      const create = page.getByRole('button', { name: 'Create plan', exact: true })
      if ((await create.count()) > 0) await create.click()
      const start = Date.now()
      for (;;) {
        const st = await sectorState()
        if (st === 'planned') break
        if (Date.now() - start > 1_200_000) throw new Error(`pilot p5: sector still ${st} 20 min after Create plan`)
        await page.waitForTimeout(5000)
      }
    })
    // Baseline-relative: the system plan run already wrote v1, so the
    // advise proof is "no NEW writes", and the write proof is growth.
    // Captured BEFORE ask-plan sends (else a turn-1 write hides).
    const baselineWrites = await planWrites()
    await rec.mark('ask-plan', async () => {
      if (done.has('ask')) return
      const box = page.getByLabel('Message this conversation')
      // Advice only, sized to fit: r0b's "write" prompt made turn 1
      // call update_sector_plan with >8000 chars → validation error
      // → uncertain poison → bricked Research thread (R0-6).
      await box.fill('@icp @geo @sources Propose a detailed research plan for discussion — do NOT update the plan yet, advice only, keep it under 6000 characters: target 100 AU electrical/plumbing/HVAC companies. Real operating business with site or verifiable listing; Australia; electrical/plumbing/HVAC primary; no directories, aggregators, franchise pages, job ads, articles or marketplaces; dedupe by domain then name+suburb; store one fetched source URL with timestamp per company.')
      await page.getByRole('button', { name: 'Send message' }).click()
      await waitTurnDone('p5-ask', 2_700_000)
    })
    await rec.mark('turn1-advises', async () => {
      if (done.has('ask')) return
      // A crashed turn also writes nothing: r0b passed this check
      // vacuously on a poisoned thread. The thread must be IDLE.
      const status = await pilotRoQuery<{ status: string }>(
        `SELECT t.status FROM threads t WHERE t.key = (
           SELECT payload->>'sessionId' FROM events
           WHERE type = 't.session.created' AND payload->>'title' = 'Research'
           AND payload->>'sectorId' = (SELECT id FROM sectors WHERE name = $1)
           ORDER BY at ASC LIMIT 1)`,
        [state.sectorName],
      )
      expect(status[0]?.status ?? 'unknown').toBe('IDLE')
      expect(await planWrites()).toBe(baselineWrites)
      record('ask')
    })
    await rec.mark('confirm-write', async () => {
      if (done.has('write')) return
      await page.getByLabel('Message this conversation').fill('Yes, update the plan accordingly (keep the plan markdown under 6000 characters).')
      await page.getByRole('button', { name: 'Send message' }).click()
      await waitTurnDone('p5-write', 1_800_000)
    })
    await rec.shot('plan')
    await rec.mark('turn2-writes', async () => {
      if (done.has('write')) return
      expect(await planWrites()).toBeGreaterThan(baselineWrites)
      const rows = await pilotRoQuery<{ payload: unknown }>(
        `SELECT payload FROM events WHERE partition = $1 AND type = 'sector.plan_written' ORDER BY seq DESC LIMIT 1`,
        [`sector:${await sectorId()}`],
      )
      expect(JSON.stringify(rows[0]?.payload)).toMatch(/100/)
      record('write')
    })
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
