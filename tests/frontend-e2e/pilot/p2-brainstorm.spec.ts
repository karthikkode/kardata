// P2: three brainstorming chats in parallel (prompts sent together so
// the agents research concurrently), then one md + one pdf upload.
// Proves every file lands in Files and is indexed (RO SQL units),
// and every findings file shows its author thread. Uploads carry no
// author (file-ingestion never stamps one; only agent artifacts do).
import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { loadState, logOccurrence, pilotRunEnabled, repoRoot, saveState } from './state.js'
import { expectClean, openChat, openChats, openResourceRail, openWorkspace, renameChat, startRecording } from './record.js'
import { closePilotRo, pilotRoQuery } from './ro.js'

const PROMPTS: Record<string, string> = {
  icp: 'Brainstorm the Kardata ICP for AU electrical, plumbing and HVAC trades. Research and write the findings to findings-icp.md.',
  geo: 'Brainstorm geography and filters for AU trades research. Research and write the findings to findings-geo.md.',
  sources: 'Brainstorm sources to mine for AU trades businesses. Research and write the findings to findings-sources.md.',
}

/** Nudge chats whose turn finished (IDLE + an agent reply on record)
 * without writing their findings doc. Sessions are event-sourced
 * (t.session.created/renamed carry sectorId + title); thread key is
 * the session id. Only IDLE threads are nudged — a working thread
 * must never be interrupted mid-turn (R0-2), and PAUSED needs a
 * resume, not a message. Max 2 nudges per chat, 10 min apart. */
async function nudgeIdleChats(page: Page, sectorName: string, missing: string[]): Promise<void> {
  const titles = missing.map((key) => `pilot-${key}`)
  // No WITH: the RO helper only admits statements starting with SELECT.
  const rows = await pilotRoQuery<{ title: string; status: string; last_agent_at: string | null }>(
    `SELECT COALESCE(r.title, '') AS title, t.status,
       (SELECT max(m.at) FROM thread_messages m WHERE m.thread_key = t.key
        AND m.kind = 'text'
        AND (m.payload::text LIKE '%"role": "agent"%' OR m.payload::text LIKE '%"role":"agent"%')) AS last_agent_at
     FROM (SELECT DISTINCT ON (payload->>'sessionId') payload->>'sessionId' AS id
           FROM events WHERE type = 't.session.created'
           AND payload->>'sectorId' = (SELECT id FROM sectors WHERE name = $1)
           ORDER BY payload->>'sessionId', at ASC) c
     JOIN threads t ON t.key = c.id
     LEFT JOIN (SELECT DISTINCT ON (payload->>'sessionId')
                  payload->>'sessionId' AS id, payload->>'title' AS title
                FROM events WHERE type = 't.session.renamed'
                ORDER BY payload->>'sessionId', at DESC) r ON r.id = c.id
     WHERE COALESCE(r.title, '') = ANY ($2)`,
    [sectorName, titles],
  )
  const state = loadState()
  const nudges = { ...state.p2nudges }
  for (const key of missing) {
    const row = rows.find((candidate) => candidate.title === `pilot-${key}`)
    if (!row || row.status !== 'IDLE' || !row.last_agent_at) continue
    const prior = nudges[key] ?? []
    if (prior.length >= 2 || (prior.length > 0 && Date.now() - prior[prior.length - 1]! < 600_000)) continue
    // The files dialog may cover the session rail; Escape is harmless
    // when nothing is open.
    await page.keyboard.press('Escape')
    await openChat(page, `pilot-${key}`)
    await page.getByLabel('Message this conversation').fill(
      `Web search is unavailable in this workspace — do not call web_search again. ` +
        `Research with the knowledge base and your own knowledge instead, then write ` +
        `findings-${key}.md now (mark unverified claims as such).`,
    )
    await page.getByRole('button', { name: 'Send message' }).click()
    logOccurrence('p2-brainstorm', 'nudge', `pilot-${key} IDLE with agent reply but no findings doc, nudge ${prior.length + 1}/2`)
    nudges[key] = [...prior, Date.now()]
  }
  saveState({ p2nudges: nudges })
}

test.describe('P2 brainstorm chats', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('three chats research in parallel; uploads index with authors', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'p2')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    await rec.mark('open-sector', async () => {
      await openWorkspace(page, state.sectorName!)
      await openChats(page)
    })
    const chats: Record<string, string> = { ...state.chats }
    for (const [key, prompt] of Object.entries(PROMPTS)) {
      if (chats[key]) continue
      await rec.mark(`new-chat-${key}`, async () => {
        await page.getByRole('button', { name: 'New chat' }).click()
        // Deterministic titles: P4/P5 open chats by name.
        await renameChat(page, `pilot-${key}`)
        await page.getByLabel('Message this conversation').fill(prompt)
        await page.getByRole('button', { name: 'Send message' }).click()
        chats[key] = prompt
      })
    }
    saveState({ chats })
    await rec.mark('findings-files', async () => {
      // Ground truth is the DB, not the file list: per-name UI waits
      // false-match across chats (r0: 'findings' matched chat 1's file
      // while chat 3 was still writing). Poll for all 3 findings docs.
      // R0-5: a turn can end IDLE with no doc (r0b sources: web_search
      // fails closed without KARDATA_WEB_SEARCH_KEY, agent refused to
      // write). Nudge such chats once per 10 min (cap 2): a real pilot
      // operator would do the same.
      const start = Date.now()
      const ceilingMs = 2_400_000
      let lastNudgeCheck = 0
      for (;;) {
        const found = await pilotRoQuery<{ filename: string }>(
          `SELECT d.filename FROM sector_documents d
           JOIN sectors s ON s.id = d.sector_id WHERE s.name = $1
           AND d.filename NOT IN ('market-notes.md', 'report.pdf')`,
          [state.sectorName],
        )
        const names = new Set(found.map((row) => row.filename))
        const missing = Object.keys(PROMPTS).filter((key) => !names.has(`findings-${key}.md`))
        if (missing.length === 0) break
        if (Date.now() - start > ceilingMs) {
          throw new Error(`pilot p2: ceiling ${ceilingMs}ms reached; missing: ${missing.join(', ')}`)
        }
        if (Date.now() - lastNudgeCheck > 60_000) {
          lastNudgeCheck = Date.now()
          await nudgeIdleChats(page, state.sectorName!, missing)
        }
        await page.waitForTimeout(5000)
      }
    })
    await rec.mark('uploads', async () => {
      if (state.uploadsDone) return
      // Re-acquire: a nudge's Escape may have closed the rail dialog.
      logOccurrence('p2-brainstorm', 're-pick', 'rail dialog re-acquired after nudge Escape (uploads mark)')
      const uploadRail = await openResourceRail(page)
      // One file per Upload: the picker warns and takes the first on multi-pick.
      for (const filename of ['market-notes.md', 'report.pdf']) {
        const chooser = page.waitForEvent('filechooser')
        await uploadRail.getByRole('button', { name: 'Upload file' }).click()
        await (await chooser).setFiles([join(repoRoot(), 'tests', 'backend', 'live', 'fixtures', filename)])
        // .first(): the name renders twice (resources label + row button).
        await expect(uploadRail.getByRole('list', { name: 'Files' }).getByText(filename).first()).toBeVisible({ timeout: 60000 })
      }
      saveState({ uploadsDone: true })
    })
    await rec.shot('files')
    await rec.mark('ro-verify', async () => {
      // Indexing is async (r0b: report.pdf rowed but unit-less at
      // first read); poll until every doc has units or the ceiling.
      const indexStart = Date.now()
      let rows: { filename: string; author_thread: string | null; units: string }[] = []
      for (;;) {
        rows = await pilotRoQuery<{ filename: string; author_thread: string | null; units: string }>(
          `SELECT d.filename, d.author_thread,
             (SELECT count(*) FROM sector_document_units u WHERE u.document_id = d.id) AS units
           FROM sector_documents d
           JOIN sectors s ON s.id = d.sector_id WHERE s.name = $1`,
          [state.sectorName],
        )
        const pending = rows.filter((row) => Number(row.units) === 0).map((row) => row.filename)
        if (pending.length === 0) break
        if (Date.now() - indexStart > 600_000) {
          throw new Error(`pilot p2: indexing ceiling reached; unit-less: ${pending.join(', ')}`)
        }
        await page.waitForTimeout(5000)
      }
      const names = rows.map((row) => row.filename)
      expect(names).toContain('market-notes.md')
      expect(names).toContain('report.pdf')
      expect(rows.length).toBeGreaterThanOrEqual(5)
      const unindexed = rows.filter((row) => Number(row.units) === 0).map((row) => row.filename)
      expect(unindexed).toEqual([])
      // Every chat wrote findings: non-upload docs carry ≥3 distinct authors.
      const findingAuthors = new Set(
        rows
          .filter((row) => row.filename !== 'market-notes.md' && row.filename !== 'report.pdf')
          .map((row) => row.author_thread),
      )
      expect(findingAuthors.size).toBeGreaterThanOrEqual(3)
      const missingAuthor = rows
        .filter((row) => row.filename !== 'market-notes.md' && row.filename !== 'report.pdf' && !row.author_thread)
        .map((row) => row.filename)
      expect(missingAuthor).toEqual([])
      // Rail-scoped: the page renders the name twice (resources label + row button).
      const verifyRail = await openResourceRail(page)
      await expect(verifyRail.getByRole('list', { name: 'Files' }).getByText('market-notes.md').first()).toBeVisible()
    })
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
