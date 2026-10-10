// P3: global context decisions. Elicits proposals from pilot-icp,
// approves one, rejects one, adds 2 files, removes 1, compacts once,
// rewrites once with a direction. Proves history shows each and the
// rejection changed nothing (RO SQL before/after).
import { expect, test } from '@playwright/test'
import { loadState, logOccurrence, pilotRunEnabled } from './state.js'
import { expectClean, openChat, openChats, openResourceRail, openWorkspace, startRecording, waitTextChange, waitVisible } from './record.js'
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
      // No proposals exist until an agent proposes: elicit from
      // pilot-sources (icp and geo are bricked by R0-2). The rail is
      // modal, so the chat message goes out before opening it — and the
      // turn must COMPLETE first: approving mid-turn bumps the version
      // under the agent's next propose, which conflict-crashes the turn
      // (R0-2 mechanism). Idle ⟺ 'Send message' replaces 'Stop agent'.
      await openChats(page)
      await openChat(page, 'pilot-sources')
      // A crashed turn pauses the chat (R0-2: no auto-retry): resume so
      // the elicitation below starts a live turn instead of queueing.
      const pausedBanner = page.getByRole('status').filter({ hasText: 'This conversation is paused.' })
      if ((await pausedBanner.count()) > 0) {
        logOccurrence('p3-context', 'resume', 'pilot-sources paused after crashed turn, resumed before elicitation')
        await pausedBanner.getByRole('button', { name: 'Resume', exact: true }).click()
        await expect(pausedBanner).toBeHidden({ timeout: 60000 })
      }
      await page.getByLabel('Message this conversation').fill('Propose global context updates from your findings: set Findings and Open questions. Make one proposal per section.')
      await page.getByRole('button', { name: 'Send message' }).click()
      // Page-level: the composer sits outside <main>; the dock (which
      // reuses 'Send message') stays closed through P3. The live
      // composer names it 'Stop agent', not 'Stop reply' (r0 probe).
      await waitVisible(page, page.getByRole('button', { name: 'Stop agent' }).first(), {
        step: 'p3-turn-started',
        ceilingMs: 120000,
      })
      await waitVisible(page, page.getByRole('button', { name: 'Send message' }), {
        step: 'p3-turn-done',
        ceilingMs: 1_200_000,
      })
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
    // The history overlay lists every change (pending AND decided),
    // so an approval flips state without growing the count: the
    // approval proof is contextVersion + 1 plus an Approved badge.
    const historyShowsApproved = async (): Promise<void> => {
      await rail.getByRole('button', { name: 'Context history' }).click()
      const history = page.getByRole('dialog', { name: 'Context history' })
      await expect(history).toBeVisible()
      await expect(history.getByText('Approved').first()).toBeVisible({ timeout: 30000 })
      await history.getByRole('button', { name: 'Close Context history' }).click()
      await expect(history).toBeHidden({ timeout: 30000 })
    }
    await rec.mark('approve-pending', async () => {
      const before = await contextVersion()
      // The elicitation turn is DONE (idle gate above), so every
      // proposal is already pending; the short wait covers UI poll lag.
      // (No growth wait: nothing more is coming.)
      await waitVisible(page, rail.getByRole('button', { name: /^Review / }), {
        step: 'p3-proposals',
        ceilingMs: 120000,
      })
      // Approve exactly one FRESH proposal: each approval bumps the
      // version and stales same-base siblings (Approve disables). Stale
      // ones are skipped here and stay available for the reject proof.
      let skipped = 0
      let approved = 0
      for (let attempt = 0; attempt < 12 && approved === 0; attempt++) {
        const review = rail.getByRole('button', { name: /^Review / }).nth(skipped)
        if ((await review.count()) === 0) break
        await review.click()
        const dialog = page.getByRole('dialog', { name: 'Review context update' })
        await expect(dialog).toBeVisible()
        if ((await dialog.getByText(/based on v\d+; the current version is v\d+/).count()) > 0) {
          await dialog.getByRole('button', { name: 'Close Review context update' }).click()
          await expect(dialog).toBeHidden({ timeout: 30000 })
          skipped += 1
          continue
        }
        const approve = dialog.getByRole('button', { name: 'Approve', exact: true })
        await expect(approve).toBeEnabled({ timeout: 120000 })
        await approve.click()
        await expect(dialog).toBeHidden({ timeout: 30000 })
        approved += 1
      }
      if (approved !== 1) throw new Error(`pilot p3: approved ${approved}, want 1 (all stale leftovers?)`)
      expect(await contextVersion()).toBe(before + 1)
      await historyShowsApproved()
    })
    await rec.mark('reject-keeps-state', async () => {
      const before = await contextVersion()
      let review = rail.getByRole('button', { name: /^Review / }).first()
      if ((await review.count()) === 0) {
        // Wave 2: nothing left to reject, so elicit one more proposal
        // purely as a reject target (rail is modal: close, send, wait
        // idle, reopen — same mid-turn rule as the approve path).
        await rail.getByRole('button', { name: 'Close Files and global context' }).click()
        await page.getByLabel('Message this conversation').fill('Propose one more small global context update (any section).')
        await page.getByRole('button', { name: 'Send message' }).click()
        await waitVisible(page, page.getByRole('button', { name: 'Stop agent' }).first(), {
          step: 'p3-wave2-started',
          ceilingMs: 120000,
        })
        await waitVisible(page, page.getByRole('button', { name: 'Send message' }), {
          step: 'p3-wave2-done',
          ceilingMs: 1_200_000,
        })
        await openResourceRail(page)
        await waitVisible(page, rail.getByRole('button', { name: /^Review / }), {
          step: 'p3-reject-target',
          ceilingMs: 120000,
        })
        review = rail.getByRole('button', { name: /^Review / }).first()
      }
      await review.click()
      const dialog = page.getByRole('dialog', { name: 'Review context update' })
      await expect(dialog).toBeVisible()
      // Reject stays enabled on stale proposals (only Approve gates).
      await dialog.getByRole('button', { name: 'Reject' }).click()
      await expect(dialog).toBeHidden({ timeout: 30000 })
      expect(await contextVersion()).toBe(before)
    })
    await rec.mark('files-add-remove', async () => {
      const contextFiles = rail.getByRole('list', { name: 'Context files' })
      // File buttons carry status suffixes ('market-notes.md, summarizing');
      // anchor at the start so the Remove buttons (substring match) stay out.
      const fileButton = (filename: string): RegExp => new RegExp(`^${filename.replace('.', '\\.')}(,|$)`)
      for (const filename of ['market-notes.md', 'report.pdf']) {
        // Idempotent: a re-run finds report.pdf already added (Add toggles to Remove).
        if ((await contextFiles.getByRole('button', { name: fileButton(filename) }).count()) === 0) {
          await rail.getByRole('button', { name: `Add ${filename} to global context` }).click()
        }
        await expect(contextFiles.getByRole('button', { name: fileButton(filename) })).toBeVisible({ timeout: 60000 })
      }
      // Scoped: Remove renders twice (Sector files toggle + Context files row).
      await contextFiles.getByRole('button', { name: 'Remove market-notes.md from global context' }).click()
      await expect(contextFiles.getByRole('button', { name: fileButton('report.pdf') })).toBeVisible({ timeout: 60000 })
      await expect(contextFiles.getByRole('button', { name: fileButton('market-notes.md') })).toHaveCount(0)
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
      // Rewrite runs as an agent turn on a new session (the app
      // navigates there) and its proposal PENDS like any other: wait
      // idle (R0-2 rule), then approve the proposal carrying the
      // direction text — nothing auto-commits (r0: v12 never moved).
      await waitVisible(page, page.getByRole('button', { name: 'Stop agent' }).first(), {
        step: 'p3-rewrite-started',
        ceilingMs: 120000,
      })
      await waitVisible(page, page.getByRole('button', { name: 'Send message' }), {
        step: 'p3-rewrite-done',
        ceilingMs: 1_200_000,
      })
      const rail2 = await openResourceRail(page)
      let approvedRewrite = false
      const total = await rail2.getByRole('button', { name: /^Review / }).count()
      for (let index = 0; index < total && !approvedRewrite; index++) {
        const review = rail2.getByRole('button', { name: /^Review / }).nth(index)
        await review.click()
        const dialog = page.getByRole('dialog', { name: 'Review context update' })
        await expect(dialog).toBeVisible()
        const regional = (await dialog.getByText(/regional/i).count()) > 0
        const stale = (await dialog.getByText(/based on v\d+; the current version is v\d+/).count()) > 0
        if (regional && !stale) {
          const approve = dialog.getByRole('button', { name: 'Approve', exact: true })
          await expect(approve).toBeEnabled({ timeout: 120000 })
          await approve.click()
          await expect(dialog).toBeHidden({ timeout: 30000 })
          approvedRewrite = true
        } else {
          await dialog.getByRole('button', { name: 'Close Review context update' }).click()
          await expect(dialog).toBeHidden({ timeout: 30000 })
        }
      }
      if (!approvedRewrite) throw new Error('pilot p3: rewrite proposal (regional, fresh) not found')
      await waitTextChange(page, () => versionOf(rail2), { step: 'p3-rewrite', ceilingMs: 120000, before })
      // The direction landed in the live context (vacuous on re-runs
      // past the first rewrite, decisive on a fresh run).
      await expect(rail2.getByRole('region', { name: 'Global context' }).getByText(/regional/i).first()).toBeVisible()
    })
    await rec.shot('context')
    await closePilotRo()
    rec.finish()
    expectClean(rec)
  })
})
