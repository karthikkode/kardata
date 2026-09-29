// Pilot 01 live UI walk: real Chromium against the live staging stack
// (vite 5173 + compose backend), zero route interception. Gated on
// KARDATA_LIVE_JOURNEY=1 so CI stays hermetic; skipping is explicit.
// Every step records wall time, console errors, and failed requests into
// tests/evidence/pilot-01/ (shots + journey.json). A journey passes only
// with zero console errors, zero failed /v1/* requests, and every named
// anchor visible before its shot.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

test.use({ baseURL: 'http://127.0.0.1:5173' })

const LIVE = process.env['KARDATA_LIVE_JOURNEY'] === '1'
// Anchored at the repo (tests/frontend-e2e -> tests/evidence): evidence
// never escapes the repo no matter which cwd launches Playwright.
const EVIDENCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'evidence', 'pilot-01')

interface StepMark {
  step: string
  ms: number
}

test.describe('pilot-01 live UI walk', () => {
  test.skip(!LIVE, 'needs KARDATA_LIVE_JOURNEY=1 (live staging stack)')

  test('create a sector draft from the UI and read its detail', async ({ page }) => {
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
      await expect(page.getByRole('heading', { name: 'Researches' })).toBeVisible()
    })
    await page.screenshot({ path: `${EVIDENCE}/01-researches.png` })

    const stamp = Date.now().toString(36)
    const name = `Pilot Fintech ${stamp}`
    await mark('create-draft', async () => {
      const form = page.getByRole('form', { name: 'Create a sector draft' })
      await form.getByLabel('Name').fill(name)
      await form.getByLabel('Topic (optional)').fill('SME payments')
      await form.getByRole('button', { name: 'Create draft' }).click()
      await expect(page.getByText(name).first()).toBeVisible()
    })
    await page.screenshot({ path: `${EVIDENCE}/02-draft-created.png` })

    await mark('open-detail', async () => {
      await page.getByText(name).first().click()
      await expect(page.getByRole('button', { name: 'Back to Researches' })).toBeVisible()
    })
    await page.screenshot({ path: `${EVIDENCE}/03-sector-detail.png` })
    const startButtons = await page.getByRole('button', { name: /start research/i }).count()

    writeFileSync(
      `${EVIDENCE}/journey.json`,
      JSON.stringify(
        {
          run: 'pilot-01',
          at: new Date().toISOString(),
          sectorName: name,
          marks,
          consoleErrors,
          failedRequests,
          observations: {
            startButtons,
            startCopyDeadEnd: startButtons === 0,
          },
        },
        null,
        2,
      ),
    )
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([])
    expect(failedRequests, `failed requests: ${failedRequests.join(' | ')}`).toEqual([])
  })
})
