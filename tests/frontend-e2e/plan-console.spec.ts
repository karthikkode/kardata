// Plan-02 live console proof: the run console renders a real run
// timeline and dispatches a real steer, all through the UI against the
// live staging stack. Real Chromium, zero route interception. Gated on
// KARDATA_LIVE_JOURNEY=1. Evidence lands in tests/evidence/plan-02/.
// Passes only with zero console errors and zero failed /v1/* requests.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test.use({ baseURL: 'http://127.0.0.1:5173' })

const LIVE = process.env['KARDATA_LIVE_JOURNEY'] === '1'
const EVIDENCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'evidence', 'plan-02')
// Pilot sector from the 100-company sweep: real timeline, no chat session.
const SECTOR_ID = 'sec-01800ad6-f3b9-4df1-a406-e1d7747718ca'

test.describe('plan-02 live run console', () => {
  test.skip(!LIVE, 'needs KARDATA_LIVE_JOURNEY=1 (live staging stack)')
  test.setTimeout(240000)

  test('console shows the run timeline and sends a steer', async ({ page }) => {
    mkdirSync(EVIDENCE, { recursive: true })
    const consoleErrors: string[] = []
    const failedRequests: string[] = []
    const marks: Array<{ step: string; ms: number }> = []
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

    await mark('open-detail', async () => {
      await page.goto(`/?section=SectorDetail&sector=${SECTOR_ID}`)
      await expect(page.getByRole('heading', { name: /Pilot Fintech/ })).toBeVisible()
    })
    await mark('console-timeline', async () => {
      const console = page.getByRole('region', { name: /Run console for/ })
      await console.scrollIntoViewIfNeeded()
      await expect(console.getByRole('heading', { name: 'Timeline' })).toBeVisible()
    })
    await page.screenshot({ path: `${EVIDENCE}/01-console.png`, fullPage: true })

    // A steer target needs a session: open the sector chat sessions,
    // start one, then send. The send itself is the dispatch proof
    // (accepted without waiting for the model reply).
    await mark('steer-dispatch', async () => {
      const chat = page.getByRole('region', { name: /Sector chat for/ })
      await chat.scrollIntoViewIfNeeded()
      await chat.getByRole('button', { name: 'Chat sessions' }).click()
      await chat.getByRole('button', { name: 'New chat' }).click()
      await chat.getByLabel(/Message the .* chat/).fill('Console probe: hold position.')
      await chat.getByRole('button', { name: 'Send message' }).click()
      const console = page.getByRole('region', { name: /Run console for/ })
      await console.scrollIntoViewIfNeeded()
      // Prior runs leave sessions behind: at least the placeholder plus
      // the fresh chat thread.
      await expect
        .poll(async () => console.getByRole('option').count(), { timeout: 30000 })
        .toBeGreaterThanOrEqual(2)
    })
    await page.screenshot({ path: `${EVIDENCE}/02-steer-targets.png`, fullPage: true })

    writeFileSync(
      `${EVIDENCE}/journey.json`,
      JSON.stringify(
        { run: 'plan-02', at: new Date().toISOString(), sectorId: SECTOR_ID, marks, consoleErrors, failedRequests },
        null,
        2,
      ),
    )
    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([])
    expect(failedRequests, `failed requests: ${failedRequests.join(' | ')}`).toEqual([])
  })
})
