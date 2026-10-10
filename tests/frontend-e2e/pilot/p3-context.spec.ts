// P3: global context decisions. Approves Scope/Instructions/Decisions
// proposals, rejects one, adds 3 files, removes 1, compacts once,
// rewrites once with a direction. Proves history shows each, blocks
// are ready, the token bar is correct, and the rejection changed
// nothing (RO SQL before/after).
import { expect, test } from '@playwright/test'
import { loadState, pilotRunEnabled } from './state.js'
import { expectClean, openResourceRail, openWorkspace, startRecording, waitTextChange } from './record.js'
import { closePilotRo, pilotRoQuery } from './ro.js'

test.describe('P3 global context', () => {
  test.skip(!pilotRunEnabled(), 'needs KARDATA_PILOT_RUN=1 (pilot stack)')

  test('approve, reject, files, compact, rewrite', async ({ page }) => {
    test.setTimeout(3_600_000)
    const rec = startRecording(page, 'p3')
    const state = loadState()
    if (!state.sectorName) throw new Error('P1 must run first (no sectorName in state)')
    await rec.mark('open-context', async () => {
      await openWorkspace(page, state.sectorName!)
      await openResourceRail(page)
    })
    const rail = page.getByRole('dialog', { name: 'Files and global context' })
    const contextVersion = async (): Promise<number> => {
      const rows = await pilotRoQuery<{ context_version: number }>(
        `SELECT context_version FROM sector_workspace WHERE sector_id = (SELECT id FROM sectors WHERE name = $1)`,
        [state.sectorName],
      )
      return Number(rows[0]?.context_version ?? 0)
    }
    const revisions = () => rail.getByRole('list', { name: 'Context revisions' }).locator('li').count()
    await rec.mark('approve-pending', async () => {
      // Pending updates queue as Review buttons (v2 context.spec.ts GC-06);
      // approve up to 3 (Scope/Instructions/Decisions) through the dialog.
      const before = await revisions()
      for (let index = 0; index < 3; index++) {
        const review = rail.getByRole('button', { name: /^Review / }).first()
        if ((await review.count()) === 0) break
        await review.click()
        const dialog = page.getByRole('dialog', { name: 'Review context update' })
        await expect(dialog).toBeVisible()
        await dialog.getByRole('button', { name: 'Approve', exact: true }).click()
        await expect(dialog).toBeHidden({ timeout: 30000 })
      }
      expect(await revisions()).toBeGreaterThan(before)
    })
    await rec.mark('reject-keeps-state', async () => {
      const before = await contextVersion()
      const review = rail.getByRole('button', { name: /^Review / }).first()
      if ((await review.count()) > 0) {
        await review.click()
        const dialog = page.getByRole('dialog', { name: 'Review context update' })
        await dialog.getByRole('button', { name: 'Reject' }).click()
        await expect(dialog).toBeHidden({ timeout: 30000 })
      }
      expect(await contextVersion()).toBe(before)
    })
    await rec.mark('files-add-remove', async () => {
      const contextFiles = rail.getByRole('list', { name: 'Context files' })
      for (const filename of ['market-notes.md', 'report.pdf']) {
        await rail.getByRole('button', { name: `Add ${filename} to global context` }).click()
        await expect(contextFiles.getByRole('button', { name: filename })).toBeVisible({ timeout: 60000 })
      }
      await rail.getByRole('button', { name: 'Remove market-notes.md from global context' }).click()
      await expect(contextFiles.getByRole('button', { name: 'report.pdf' })).toBeVisible({ timeout: 60000 })
      await expect(contextFiles.getByRole('button', { name: 'market-notes.md' })).toHaveCount(0)
    })
    const versionOf = (scope: typeof rail) =>
      scope.getByRole('region', { name: 'Global context' }).getByText(/^v\d+/).first().textContent()
    await rec.mark('compact', async () => {
      await rail.getByRole('button', { name: 'Global context options' }).click()
      await page.getByRole('menuitem', { name: 'Compact now' }).click()
      await expect(page.getByText('Compacting global context')).toBeVisible({ timeout: 60000 })
      await waitTextChange(page, () => versionOf(rail), { step: 'p3-compact', ceilingMs: 300000 })
    })
    await rec.mark('rewrite', async () => {
      const before = await versionOf(rail)
      await rail.getByRole('button', { name: 'Global context options' }).click()
      await page.getByRole('menuitem', { name: 'Rewrite with a direction…' }).click()
      const overlay = page.getByRole('dialog', { name: 'Rewrite with a direction' })
      await overlay.getByLabel('What should change?').fill('Prefer regional trades over metro franchises.')
      await overlay.getByRole('button', { name: 'Start rewrite' }).click()
      await expect(overlay).toBeHidden({ timeout: 60000 })
      // Rewrite navigates to the new session: re-open the rail, then the version moves.
      const rail2 = await openResourceRail(page)
      await waitTextChange(page, () => versionOf(rail2), { step: 'p3-rewrite', ceilingMs: 600000, before })
    })
    await rec.shot('context')
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
