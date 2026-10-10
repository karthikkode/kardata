// P2: three brainstorming chats in parallel (prompts sent together so
// the agents research concurrently), then one md + one pdf upload.
// Proves every file lands in Files, is indexed (RO SQL), and shows
// its author thread.
import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { loadState, pilotRunEnabled, repoRoot, saveState } from './state.js'
import { expectClean, startRecording, waitVisible } from './record.js'
import { closePilotRo, pilotRoQuery } from './ro.js'

const PROMPTS: Record<string, string> = {
  icp: 'Brainstorm the Kardata ICP for AU electrical, plumbing and HVAC trades. Research and write a findings file.',
  geo: 'Brainstorm geography and filters for AU trades research. Research and write a findings file.',
  sources: 'Brainstorm sources to mine for AU trades businesses. Research and write a findings file.',
}

test.describe('P2 brainstorm chats', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('three chats research in parallel; uploads index with authors', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'p2')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    await rec.mark('open-sector', async () => {
      await page.goto('/?section=Researches')
      await page.getByText(state.sectorName!).first().click()
    })
    const chats: Record<string, string> = { ...state.chats }
    for (const [key, prompt] of Object.entries(PROMPTS)) {
      if (chats[key]) continue
      await rec.mark(`new-chat-${key}`, async () => {
        await page.getByRole('button', { name: 'New chat' }).click()
        await page.getByLabel(/Message the .* chat/).fill(prompt)
        await page.getByRole('button', { name: 'Send' }).click()
        chats[key] = prompt
      })
    }
    saveState({ chats })
    await rec.mark('findings-files', async () => {
      await page.getByRole('link', { name: 'Files' }).click()
      for (const key of Object.keys(PROMPTS)) {
        await waitVisible(page, page.getByText('findings', { exact: false }).or(page.getByText(key)), {
          step: 'p2',
          ceilingMs: 3_000_000,
        })
      }
    })
    await rec.mark('uploads', async () => {
      const chooser = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: 'Attach file' }).click()
      await (await chooser).setFiles([
        join(repoRoot(), 'tests', 'backend', 'live', 'fixtures', 'market-notes.md'),
        join(repoRoot(), 'tests', 'backend', 'live', 'fixtures', 'report.pdf'),
      ])
      await expect(page.getByText('market-notes.md')).toBeVisible({ timeout: 60000 })
      await expect(page.getByText('report.pdf')).toBeVisible({ timeout: 60000 })
    })
    await rec.shot('files')
    await rec.mark('ro-verify', async () => {
      const rows = await pilotRoQuery<{ filename: string; author_thread: string | null }>(
        `SELECT d.filename, d.author_thread FROM sector_documents d
         JOIN sectors s ON s.id = d.sector_id WHERE s.name = $1`,
        [state.sectorName],
      )
      const names = rows.map((row) => row.filename)
      expect(names).toContain('market-notes.md')
      expect(names).toContain('report.pdf')
      expect(rows.length).toBeGreaterThanOrEqual(5)
      for (const row of rows) expect(row.author_thread).toBeTruthy()
      await expect(page.getByText('market-notes.md')).toBeVisible()
    })
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
