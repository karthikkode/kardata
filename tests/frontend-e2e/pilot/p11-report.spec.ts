// P11: final report. Asks the research chat for a summary report of
// the 100 companies. Proves the report file is written, indexed,
// and readable from Files.
import { expect, test } from '@playwright/test'
import { loadState, pilotRunEnabled } from './state.js'
import { expectClean, openResourceRail, openWorkspace, startRecording, waitVisible } from './record.js'
import { closePilotRo, pilotRoQuery } from './ro.js'

test.describe('P11 final report', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('summary report written, indexed, readable', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'p11')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    await rec.mark('ask-report', async () => {
      await openWorkspace(page, state.sectorName!)
      // The research chat lives under the Chats tab; P5 named it.
      await page.getByRole('tab', { name: /Chats/ }).click()
      await page.getByRole('button', { name: 'Open pilot-research' }).click()
      await page.getByLabel('Message this conversation').fill('Write the final report as a file.')
      await page.getByRole('button', { name: 'Send message' }).click()
      await waitVisible(page, page.getByText(/report|summary|complete|done/i), {
        step: 'p11',
        ceilingMs: 1_800_000,
      })
    })
    await rec.mark('report-file', async () => {
      const rail = await openResourceRail(page)
      const files = rail.getByRole('list', { name: 'Files' }).getByRole('button', { name: /report|summary/i }).first()
      await expect(files).toBeVisible({ timeout: 300000 })
      await files.click()
      await expect(page.getByText(/100|companies/i).first()).toBeVisible({ timeout: 60000 })
    })
    await rec.mark('indexed', async () => {
      const rows = await pilotRoQuery<{ units: string }>(
        `SELECT count(*) AS units FROM sector_document_units WHERE document_id IN
         (SELECT id FROM sector_documents WHERE sector_id = (SELECT id FROM sectors WHERE name = $1) AND filename ILIKE '%report%')`,
        [state.sectorName],
      )
      expect(Number(rows[0]?.units ?? 0)).toBeGreaterThan(0)
    })
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
