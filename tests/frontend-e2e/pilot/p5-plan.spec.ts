// P5: research plan. A research chat @-mentions the 3 brainstorming
// chats and asks for a detailed plan (target 100, §3.4 filters); then
// "Yes, update the plan accordingly". Proves turn 1 advises without
// changing the plan and turn 2 writes executable JSON + criteria.
import { expect, test } from '@playwright/test'
import { loadState, pilotRunEnabled, saveState } from './state.js'
import { expectClean, openWorkspace, renameChat, startRecording, waitVisible } from './record.js'
import { closePilotRo, pilotRoQuery } from './ro.js'

test.describe('P5 research plan', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('advise first, write on confirmation', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'p5')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    await rec.mark('open-research-chat', async () => {
      await openWorkspace(page, state.sectorName!)
      await page.getByRole('button', { name: 'New chat' }).click()
      // P11 opens this chat by name.
      await renameChat(page, 'pilot-research')
    })
    await rec.mark('ask-plan', async () => {
      const box = page.getByLabel('Message this conversation')
      await box.fill('@icp @geo @sources Write a detailed research plan: target 100 AU electrical/plumbing/HVAC companies. Real operating business with site or verifiable listing; Australia; electrical/plumbing/HVAC primary; no directories, aggregators, franchise pages, job ads, articles or marketplaces; dedupe by domain then name+suburb; store one fetched source URL with timestamp per company.')
      await page.getByRole('button', { name: 'Send message' }).click()
      await waitVisible(page, page.getByText(/acceptance criteria|proposed plan/i), {
        step: 'p5',
        ceilingMs: 1_800_000,
      })
    })
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
    await rec.mark('turn1-advises', async () => {
      expect(await planWrites()).toBe(0)
    })
    await rec.mark('confirm-write', async () => {
      await page.getByLabel('Message this conversation').fill('Yes, update the plan accordingly.')
      await page.getByRole('button', { name: 'Send message' }).click()
      await waitVisible(page, page.getByText(/plan (updated|written|v1)/i), {
        step: 'p5',
        ceilingMs: 1_800_000,
      })
    })
    await rec.shot('plan')
    await rec.mark('turn2-writes', async () => {
      expect(await planWrites()).toBeGreaterThanOrEqual(1)
      const rows = await pilotRoQuery<{ payload: unknown }>(
        `SELECT payload FROM events WHERE partition = $1 AND type = 'sector.plan_written' ORDER BY seq DESC LIMIT 1`,
        [`sector:${await sectorId()}`],
      )
      expect(JSON.stringify(rows[0]?.payload)).toMatch(/100/)
    })
    saveState({ chats: { ...state.chats, research: 'plan chat' } })
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
