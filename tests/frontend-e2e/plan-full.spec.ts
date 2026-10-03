// Plan-03 full lifecycle journey: create → plan → edit → approve →
// start → steer → pause → resume → complete, all through the UI against
// the live staging stack. Real Chromium, zero route interception. Gated
// on KARDATA_LIVE_JOURNEY=1. Evidence lands in tests/evidence/plan-03/.
// Passes only with zero console errors and zero failed /v1/* requests.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test.use({ baseURL: 'http://127.0.0.1:5173' })

const LIVE = process.env['KARDATA_LIVE_JOURNEY'] === '1'
const EVIDENCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'evidence', 'plan-03')

interface StepMark {
  step: string
  ms: number
  note?: string
}

test.describe('plan-03 full lifecycle journey', () => {
  test.skip(!LIVE, 'needs KARDATA_LIVE_JOURNEY=1 (live staging stack)')
  test.setTimeout(1500000)

  test('plan, approve, start, steer, pause, resume, and complete', async ({ page }) => {
    mkdirSync(EVIDENCE, { recursive: true })
    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    const marks: StepMark[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300))
    })
    page.on('pageerror', (error) => consoleErrors.push(String(error).slice(0, 300)))
    page.on('response', (response) => {
      if (response.url().includes('/v1/') && response.status() >= 400) {
        failedRequests.push(`${response.status()} ${response.url().slice(0, 160)}`)
      }
    })
    const mark = async (step: string, work: () => Promise<void>): Promise<void> => {
      const start = Date.now()
      await work()
      marks.push({ step, ms: Date.now() - start })
    }

    await mark('researches-first-paint', async () => {
      await page.goto('/?section=Researches')
      await expect(page.getByRole('heading', { name: 'Researches', exact: true })).toBeVisible()
    })

    const stamp = Date.now().toString(36)
    const name = `Journey Fintech ${stamp}`
    await mark('create-draft', async () => {
      const form = page.getByRole('form', { name: 'Create a sector draft' })
      await form.getByLabel('Name').fill(name)
      await form.getByLabel('Topic (optional)').fill('SME payments')
      await form.getByRole('button', { name: 'Create draft' }).click()
      await expect(page.getByText(name).first()).toBeVisible()
    })

    await mark('open-detail', async () => {
      await page.getByText(name).first().click()
      await expect(page.getByRole('button', { name: 'Back to Researches' })).toBeVisible()
    })

    await mark('start-planning', async () => {
      await page.getByRole('button', { name: 'Plan research' }).first().click()
      await expect(page.getByLabel('Research state: Planning')).toBeVisible({ timeout: 15000 })
    })

    await mark('wait-planned', async () => {
      await expect(page.getByLabel('Research state: Planned')).toBeVisible({ timeout: 240000 })
    })
    // The strip and the panel follow different polls: v1 lands up to ~12 s
    // after the strip flips (proven live on a settled sector). Exact
    // match: the Approve button label contains v1 as a substring.
    await expect(page.getByText('v1', { exact: true })).toBeVisible({ timeout: 60000 })
    await page.screenshot({ path: `${EVIDENCE}/01-planned.png` })

    // Owner edit from the panel: deterministic v2 (chat-asked edits are
    // best-effort — model compliance is recorded separately, not gated).
    await mark('edit-plan', async () => {
      const panel = page.getByRole('region', { name: `Research plan for ${name}` })
      await panel.getByLabel('Edit plan').fill('## scope\nJourney sector, owner-edited.\n## direction shards\nPayments.\n## query shapes\nSME payments.\n## budgets\nLow.\n## risks\nFew.\n## open questions\nNone.')
      await panel.getByRole('button', { name: 'Save plan edit' }).click()
      await expect(panel.getByText('v2', { exact: true })).toBeVisible({ timeout: 15000 })
    })

    await mark('approve-plan', async () => {
      const panel = page.getByRole('region', { name: `Research plan for ${name}` })
      await panel.getByRole('button', { name: 'Approve v2' }).click()
      await expect(page.getByLabel('Research state: Approved')).toBeVisible({ timeout: 15000 })
    })
    await page.screenshot({ path: `${EVIDENCE}/02-approved.png` })

    await mark('start-research', async () => {
      await page.getByRole('button', { name: 'Start research' }).click()
      await expect(page.getByLabel('Research state: In progress')).toBeVisible({ timeout: 90000 })
    })

    // Steer from the run console: needs a session, then dispatch.
    await mark('steer-run', async () => {
      const chat = page.getByRole('region', { name: /Sector chat for/ })
      await chat.scrollIntoViewIfNeeded()
      await chat.getByRole('button', { name: 'Chat sessions' }).click()
      await chat.getByRole('menuitem', { name: 'New chat' }).click()
      await chat.getByLabel(/Message the .* chat/).fill('Journey probe: hold position.')
      await chat.getByRole('button', { name: 'Send message' }).click()
      const panel = page.getByRole('region', { name: `Research plan for ${name}` })
      await panel.scrollIntoViewIfNeeded()
      const console = page.getByRole('region', { name: /Run console for/ })
      await console.scrollIntoViewIfNeeded()
      await expect
        .poll(async () => console.getByRole('option').count(), { timeout: 30000 })
        .toBeGreaterThanOrEqual(2)
    })
    await page.screenshot({ path: `${EVIDENCE}/03-console.png`, fullPage: true })

    await mark('pause-research', async () => {
      await page.getByRole('button', { name: 'Pause research' }).click()
      await expect(page.getByLabel('Research state: Paused')).toBeVisible({ timeout: 30000 })
    })

    await mark('resume-research', async () => {
      await page.getByRole('button', { name: 'Resume research' }).click()
      await expect(page.getByLabel('Research state: In progress')).toBeVisible({ timeout: 90000 })
    })

    await mark('wait-complete', async () => {
      await expect(page.getByLabel('Research state: Complete')).toBeVisible({ timeout: 900000 })
    })
    await page.screenshot({ path: `${EVIDENCE}/04-complete.png`, fullPage: true })

    writeFileSync(
      `${EVIDENCE}/journey.json`,
      JSON.stringify(
        { run: 'plan-03', at: new Date().toISOString(), sectorName: name, marks, consoleErrors, failedRequests },
        null,
        2,
      ),
    )
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([])
    expect(failedRequests, `failed requests: ${failedRequests.join(' | ')}`).toEqual([])
  })
})
