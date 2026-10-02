// Plan-01 live journey: draft → Plan → planning → planned with a
// readable artifact, all through the UI against the live staging stack.
// Real Chromium, zero route interception. Gated on
// KARDATA_LIVE_JOURNEY=1 so CI stays hermetic. Evidence lands in
// tests/evidence/plan-01/ (shots + journey.json). Passes only with zero
// console errors, zero failed /v1/* requests, and every anchor visible.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test.use({ baseURL: 'http://127.0.0.1:5173' })

const LIVE = process.env['KARDATA_LIVE_JOURNEY'] === '1'
const EVIDENCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'evidence', 'plan-01')

interface StepMark {
  step: string
  ms: number
}

test.describe('plan-01 live plan journey', () => {
  test.skip(!LIVE, 'needs KARDATA_LIVE_JOURNEY=1 (live staging stack)')
  test.setTimeout(300000)

  test('plan a draft from the UI and read the artifact', async ({ page }) => {
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
    const name = `Plan Fintech ${stamp}`
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
    await page.screenshot({ path: `${EVIDENCE}/01-planning.png` })

    await mark('wait-planned', async () => {
      await expect(page.getByLabel('Research state: Planned')).toBeVisible({ timeout: 240000 })
    })
    await expect(page.getByText('v1')).toBeVisible({ timeout: 15000 })
    await page.screenshot({ path: `${EVIDENCE}/02-planned.png` })

    await page.getByRole('button', { name: 'Switch to dark theme' }).click()
    await page.screenshot({ path: `${EVIDENCE}/02b-planned-dark.png` })
    await page.getByRole('button', { name: 'Switch to light theme' }).click()

    writeFileSync(
      `${EVIDENCE}/journey.json`,
      JSON.stringify(
        { run: 'plan-01', at: new Date().toISOString(), sectorName: name, marks, consoleErrors, failedRequests },
        null,
        2,
      ),
    )
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([])
    expect(failedRequests, `failed requests: ${failedRequests.join(' | ')}`).toEqual([])
  })
})
