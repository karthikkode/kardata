// P11: final report. Asks the research chat for a summary report of
// the 100 companies. Proves the report file is written, indexed,
// and readable from Files.
import { expect, test } from '@playwright/test'
import { loadState, pilotRunEnabled } from './state.js'
import { expectClean, openChat, openChats, openResourceRail, openWorkspace, startRecording } from './record.js'
import { closePilotRo, pilotRoQuery } from './ro.js'

test.describe('P11 final report', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('summary report written, indexed, readable', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'p11')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    // Unique filename per attempt: the fixed prompt + generic
    // /report|summary/i matchers passed in 3.1s on a stale report.pdf
    // without any agent turn (r0c). The pinned name proves THIS run
    // wrote, listed, previewed, and indexed a fresh file.
    const filename = `pilot-p11-report-${Date.now()}.md`
    let docId = ''
    await rec.mark('ask-report', async () => {
      await openWorkspace(page, state.sectorName!)
      // The research chat lives under the Chats tab; P5 named it.
      await openChats(page)
      await openChat(page, 'pilot-research')
      const box = page.getByLabel('Message this conversation')
      const send = page.getByRole('button', { name: 'Send message' })
      await box.fill(`Write the final report as a file named ${filename}.`)
      await send.click()
      // Resolve the chat's thread for freshness reads (session
      // threads carry key == session id; the renamed event names it).
      const sessions = await pilotRoQuery<{ id: string }>(
        `SELECT payload->>'sessionId' AS id FROM events WHERE type = 't.session.renamed'
         AND payload->>'title' = 'pilot-research' ORDER BY at DESC LIMIT 1`,
      )
      const threadKey = sessions[0]?.id ?? ''
      if (!threadKey) throw new Error('pilot p11: pilot-research session not found')
      const start = Date.now()
      let nudges = 0
      for (;;) {
        const rows = await pilotRoQuery<{ id: string }>(
          `SELECT id FROM sector_documents WHERE sector_id = (SELECT id FROM sectors WHERE name = $1) AND filename = $2`,
          [state.sectorName, filename],
        )
        if (rows[0]?.id) {
          docId = rows[0].id
          break
        }
        if (Date.now() - start > 1_800_000) throw new Error(`pilot p11: report ${filename} never written`)
        // Nudge (P2 pattern, R0-16): the agent can narrate progress
        // ("pulling the last evidence") then halt without the write.
        // Stale thread + missing doc + IDLE turn state → one follow-up
        // per 3 idle minutes, max 2.
        const fresh = await pilotRoQuery<{ at: string }>(
          `SELECT max(at) AS at FROM thread_messages WHERE thread_key = $1`,
          [threadKey],
        )
        const status = await pilotRoQuery<{ status: string }>(`SELECT status FROM threads WHERE key = $1`, [threadKey])
        const idleMs = Date.now() - new Date(fresh[0]?.at ?? start).getTime()
        if (idleMs > 180000 && status[0]?.status === 'IDLE' && nudges < 2) {
          nudges++
          await box.fill(`Write the file ${filename} now with the evidence gathered so far.`)
          await send.click()
        }
        await page.waitForTimeout(10000)
      }
    })
    await rec.mark('report-file', async () => {
      const rail = await openResourceRail(page)
      const files = rail.getByRole('list', { name: 'Files' }).getByRole('button', { name: filename }).first()
      await expect(files).toBeVisible({ timeout: 300000 })
      await files.click()
      await expect(page.getByText(/100|companies/i).first()).toBeVisible({ timeout: 60000 })
    })
    await rec.mark('indexed', async () => {
      const start = Date.now()
      for (;;) {
        const rows = await pilotRoQuery<{ units: string }>(
          `SELECT count(*) AS units FROM sector_document_units WHERE document_id = $1`,
          [docId],
        )
        if (Number(rows[0]?.units ?? 0) > 0) break
        if (Date.now() - start > 600000) throw new Error(`pilot p11: report ${filename} never indexed`)
        await page.waitForTimeout(10000)
      }
    })
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
