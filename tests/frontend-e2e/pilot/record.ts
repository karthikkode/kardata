// Pilot step recording: the pilot-live.spec.ts pattern as a helper.
// Each step records wall time, console errors, failed /v1 requests and
// screenshots into evidence/<step>/ plus a step.json. Long waits poll
// visible UI state with an explicit ceiling and fail naming the step
// and the last visible status.
import { writeFileSync } from 'node:fs'
import { expect, type Locator, type Page } from '@playwright/test'
import { evidenceDir } from './state.js'

export interface StepMark {
  step: string
  ms: number
}

export interface StepRecord {
  marks: StepMark[]
  consoleErrors: string[]
  failedRequests: string[]
  shot: (name: string) => Promise<void>
  mark: <T>(step: string, work: () => Promise<T>) => Promise<T>
  finish: () => void
}

export function startRecording(page: Page, step: string): StepRecord {
  const dir = evidenceDir(step)
  const marks: StepMark[] = []
  const consoleErrors: string[] = []
  const failedRequests: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300))
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error).slice(0, 300)))
  page.on('response', (response) => {
    if (response.url().includes('/v1/') && response.status() >= 400) {
      failedRequests.push(`${response.status()} ${response.url().slice(0, 160)}`)
    }
  })
  return {
    marks,
    consoleErrors,
    failedRequests,
    shot: async (name: string) => {
      await page.screenshot({ path: `${dir}/${name}.png` })
    },
    mark: async <T>(name: string, work: () => Promise<T>): Promise<T> => {
      const start = Date.now()
      const out = await work()
      marks.push({ step: name, ms: Date.now() - start })
      return out
    },
    finish: () => {
      writeFileSync(
        `${dir}/step.json`,
        JSON.stringify({ step, at: new Date().toISOString(), marks, consoleErrors, failedRequests }, null, 2),
      )
    },
  }
}

/** Poll a locator until visible or the ceiling; on timeout fail with
 * the step, the ceiling, and the last visible status text. */
export async function waitVisible(
  page: Page,
  locator: Locator,
  options: { step: string; ceilingMs: number; status?: Locator; timeout?: number },
): Promise<void> {
  const start = Date.now()
  for (;;) {
    if (await locator.count().then((n) => n > 0).catch(() => false)) {
      try {
        await locator.first().waitFor({ state: 'visible', timeout: 5000 })
        return
      } catch {
        // Not yet visible; fall through to the ceiling check.
      }
    }
    if (Date.now() - start > options.ceilingMs) {
      const last = options.status ? await options.status.first().textContent().catch(() => null) : null
      throw new Error(
        `pilot ${options.step}: ceiling ${options.ceilingMs}ms reached; last status: ${last ?? 'unknown'}`,
      )
    }
    await page.waitForTimeout(2000)
  }
}

/** Every step ends clean: no console errors, no failed /v1 calls. */
export function expectClean(record: StepRecord): void {
  expect(record.consoleErrors, `console errors: ${record.consoleErrors.join(' | ')}`).toEqual([])
  expect(record.failedRequests, `failed requests: ${record.failedRequests.join(' | ')}`).toEqual([])
}
