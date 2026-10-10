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

/** Open the sector workspace: Researches → sector row link (v2
 * researches.spec.ts) → Open workspace → session rail ready. */
export async function openWorkspace(page: Page, sectorName: string): Promise<void> {
  await page.goto('/?section=Researches')
  await page.getByRole('table', { name: 'Sectors' }).getByRole('link', { name: sectorName }).first().click()
  await page.getByRole('button', { name: 'Open workspace' }).click()
  await expect(page.getByRole('tablist', { name: 'Session types' })).toBeVisible({ timeout: 15000 })
}

/** Select the Chats tab (v2 workspace.spec.ts openChats): 'New chat'
 * renders only under group 'normal' (SectorWorkspace sessionRail).
 * r0 hung an hour on the bare click (actionTimeout defaults to 0). */
export async function openChats(page: Page): Promise<void> {
  await page.getByRole('tab', { name: /^Chats/ }).click()
  // Ready = 'New chat' (renders empty and non-empty; the v2 list
  // assertion fails on the live empty rail: 'No chats yet' instead).
  await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible()
}

/** Open a rail chat and wait for the switch to land (aria-current):
 * instant reads after the bare click race the old chat's DOM (r0 P3
 * read icp's paused banner while opening geo). With sectorName, a
 * missing button gets one reload recovery: the rail can get stuck
 * with its rows rendered but unresolvable (r0c post-stop: 60s
 * not-found for a chat that opened fine minutes before, R0-14). */
export async function openChat(page: Page, title: string, sectorName?: string): Promise<void> {
  const open = page.getByRole('button', { name: `Open ${title}` })
  try {
    await open.click({ timeout: 30000 })
  } catch (error) {
    if (!sectorName) throw error
    await page.reload()
    await openWorkspace(page, sectorName)
    await openChats(page)
    await open.click()
  }
  await expect(open).toHaveAttribute('aria-current', 'page')
}

/** Open the resource rail dialog (Sector files + Global context).
 * The pilot runs at 1280px (Desktop Chrome), so the rail is always the
 * 'Files and global context' dialog (v2 context.spec.ts railScope). */
export async function openResourceRail(page: Page): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: 'Files and global context' })
  // Idempotent: P3's rewrite re-opens after a navigation that may or
  // may not have closed the rail (r0: already open → no Open button).
  if (await dialog.isVisible().catch(() => false)) return dialog
  await page.getByRole('button', { name: 'Open files and global context' }).click()
  await expect(dialog).toBeVisible()
  return dialog
}

/** Rename the current chat (Conversation options → Rename dialog). */
export async function renameChat(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Conversation options' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const dialog = page.getByRole('dialog', { name: 'Rename chat' })
  await dialog.getByLabel('Chat name').fill(title)
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
}

/** Poll a text getter until it differs from `before` (captured here
 * unless the caller passes one — needed when the action navigates and
 * the getter only works afterwards), or the ceiling. */
export async function waitTextChange(
  page: Page,
  get: () => Promise<string | null>,
  options: { step: string; ceilingMs: number; before?: string | null },
): Promise<string> {
  const before = options.before ?? (await get())
  const start = Date.now()
  for (;;) {
    const now = await get()
    if (now !== null && now !== before) return now
    if (Date.now() - start > options.ceilingMs) {
      throw new Error(`pilot ${options.step}: ceiling ${options.ceilingMs}ms reached; text still: ${before ?? 'unknown'}`)
    }
    await page.waitForTimeout(5000)
  }
}

/** Every step ends clean: no console errors, no failed /v1 calls —
 * except the documented idle-thread queue 404 (sector-workspace.ts:
 * "an idle thread simply has no queue"; the UI maps 404 to []). The
 * browser still logs the 404 as a console error, so both lists filter
 * exactly that one case. */
export function expectClean(record: StepRecord): void {
  const queue404 = (entry: string): boolean => entry.startsWith('404 ') && /\/v1\/threads\/[^/]+\/queue/.test(entry)
  const queue404Count = record.failedRequests.filter(queue404).length
  const failedRequests = record.failedRequests.filter((entry) => !queue404(entry))
  // The browser logs each failed load to the console too; forgive at
  // most one console 404 per recorded queue 404 (never the reverse:
  // an unlogged queue 404 must not fail, an extra 404 must).
  let budget = queue404Count
  const consoleErrors = record.consoleErrors.filter((message) => {
    if (budget > 0 && message.includes('404')) {
      budget -= 1
      return false
    }
    return true
  })
  expect(consoleErrors, `console errors: ${record.consoleErrors.join(' | ')}`).toEqual([])
  expect(failedRequests, `failed requests: ${record.failedRequests.join(' | ')}`).toEqual([])
}
