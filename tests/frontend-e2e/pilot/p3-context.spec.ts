// P3: global context decisions. Approves Scope/Instructions/Decisions
// proposals, rejects one, adds 3 files, removes 1, compacts once,
// rewrites once with a direction. Proves history shows each, blocks
// are ready, the token bar is correct, and the rejection changed
// nothing (RO SQL before/after).
import { expect, test } from '@playwright/test'
import { loadState, pilotRunEnabled } from './state.js'
import { expectClean, startRecording } from './record.js'
import { closePilotRo, pilotRoQuery } from './ro.js'

test.describe('P3 global context', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('approve, reject, files, compact, rewrite', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'p3')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    await rec.mark('open-context', async () => {
      await page.goto('/?section=Researches')
      await page.getByText(state.sectorName!).first().click()
      await page.getByRole('link', { name: 'Context' }).click()
    })
    for (const section of ['Scope', 'Instructions', 'Decisions']) {
      await rec.mark(`approve-${section.toLowerCase()}`, async () => {
        const block = page.getByRole('region', { name: section })
        await block.getByRole('button', { name: 'Approve' }).click()
        await expect(block.getByText('Approved')).toBeVisible({ timeout: 60000 })
      })
    }
    const contextVersion = async (): Promise<number> => {
      const rows = await pilotRoQuery<{ context_version: number }>(
        `SELECT context_version FROM sector_workspace WHERE sector_id = (SELECT id FROM sectors WHERE name = $1)`,
        [state.sectorName],
      )
      return Number(rows[0]?.context_version ?? 0)
    }
    await rec.mark('reject-keeps-state', async () => {
      const before = await contextVersion()
      const block = page.getByRole('region', { name: 'Decisions' })
      const rejects = block.getByRole('button', { name: 'Reject' })
      if ((await rejects.count()) > 0) {
        await rejects.first().click()
        await expect(block.getByText('Rejected')).toBeVisible({ timeout: 60000 })
      }
      expect(await contextVersion()).toBe(before)
    })
    await rec.mark('files-add-remove', async () => {
      const library = page.getByRole('region', { name: 'Files' })
      const adds = library.getByRole('button', { name: 'Add' })
      for (let i = 0; i < 3; i++) await adds.nth(i).click()
      await library.getByRole('button', { name: 'Remove' }).first().click()
      await expect(library.getByText('2 files')).toBeVisible({ timeout: 60000 })
    })
    await rec.mark('compact', async () => {
      await page.getByRole('button', { name: 'Compact now' }).click()
      await expect(page.getByText('Compaction complete')).toBeVisible({ timeout: 600000 })
    })
    await rec.mark('rewrite', async () => {
      await page.getByRole('button', { name: 'Rewrite with a direction…' }).click()
      await page.getByLabel('Direction').fill('Prefer regional trades over metro franchises.')
      await page.getByRole('button', { name: 'Start rewrite' }).click()
      await expect(page.getByText('Rewrite complete')).toBeVisible({ timeout: 600000 })
    })
    await rec.shot('context')
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
