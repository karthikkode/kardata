// Maintained synthetic-HTTP UI proof. No live archive, DB, provider or Temporal.
import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
test.use({ video: 'on', trace: 'on' })
test.afterEach(async ({ page }, info) => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const paths = ['frontend/src/components/ExecutionInspector.tsx', 'frontend/src/components/workspace-parts.tsx', 'frontend/src/data/sector-workspace.ts', 'tests/frontend-e2e/execution-inspection.spec.ts']
  const evidencePath = info.outputPath('source-evidence.json')
  writeFileSync(evidencePath, JSON.stringify({ proof: 'synthetic HTTP UI only', viewport: page.viewportSize(), node: process.version, sourceHashes: Object.fromEntries(paths.map((path) => [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')])) }))
  await info.attach('execution-inspection-source-evidence', { contentType: 'application/json', path: evidencePath })
})
const sectorId = 'TEST-execution-sector', sessionId = 'TEST-execution-session'
const at = '2026-10-01T00:00:00Z'
const session = { id: sessionId, title: 'Research', kind: 'research', sectorId, createdAt: at, updatedAt: at }
const sector = { id: sectorId, name: 'TEST execution inspection', topic: 'TEST sources', state: 'approved', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: at, updatedAt: at }
const record = (seq: number) => ({ version: 1, provider: 'TEST adapter', model: 'TEST recorded model', round: Math.ceil(seq / 3), boundary: { contextVersion: 3, planVersion: 7, localVersion: 0 }, data: { prompt: '<script>window.executionInjected=true</script>\n' + 'TEST normalized source evidence\n'.repeat(5000) + 'TEST_END_OF_COMPLETE_RECORD' } })
const metadata = Array.from({ length: 23 }, (_, index) => ({ seq: index + 1, at, runKey: 'TEST original turn '.repeat(10), attemptLease: '7844274c-d10a-4c66-a65e-3bb171da2b60', round: Math.ceil((index + 1) / 3), kind: ['request', 'response', 'tool-result'][index % 3], workflowId: 'TEST actual workflow', executionId: 'TEST actual execution', ownerEpoch: '4583649e-c568-4d79-b4a5-8a411de7f42b', ref: { hash: createHash('sha256').update(JSON.stringify(record(index + 1))).digest('hex'), bytes: Buffer.byteLength(JSON.stringify(record(index + 1))) } }))
type State = 'ready' | 'loading' | 'empty' | 'denied' | 'error' | 'offline' | 'body-error'
async function fixtures(page: Page, initial: State = 'ready') {
  if (initial === 'offline') await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }))
  let state = initial
  let release: () => void = () => undefined
  const wait = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/v1/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
    if (path.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': TEST fixture\n\n' })
    let data: unknown = []
    if (path.endsWith('/execution-records')) {
      if (state === 'loading') await wait
      if (state === 'offline') return route.abort('internetdisconnected')
      if (state === 'denied' || state === 'error') return route.fulfill({ status: state === 'denied' ? 403 : 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: state === 'denied' ? 'permission_denied' : 'internal', message: 'TEST inspection unavailable' } }) })
      const after = Number(url.searchParams.get('afterSeq') ?? 0)
      const rows = state === 'empty' ? [] : metadata.filter((entry) => entry.seq > after)
      data = { records: rows.slice(0, 20), nextAfterSeq: rows.length > 20 ? rows[19]!.seq : null }
    } else if (path.includes('/execution-records/')) {
      if (state === 'body-error') return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'conflict', message: 'TEST archive missing or corrupt' } }) })
      data = { record: record(Number(path.split('/').at(-1))) }
    } else if (path === '/v1/sectors') data = [sector]
    else if (path === `/v1/sectors/${sectorId}`) data = sector
    else if (path.endsWith('/research-session')) data = session
    else if (path === '/v1/sessions') data = [session]
    else if (path.endsWith('/global-context')) data = { sectorId, version: 1, sections: { scope: 'TEST scope', decisions: '', findings: '', questions: '' }, markdown: '## Scope\nTEST scope', researchSessionId: sessionId, changes: [] }
    else if (path.endsWith('/plan')) data = { sectorId, versions: [], latest: null, approvals: [], approvedVersion: null }
    else if (path.endsWith('/progress')) data = { sectorId, state: 'approved', planVersion: 0, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
    else if (path.endsWith('/threads')) data = [{ key: sessionId, sessionId, kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: at }]
    else if (path.endsWith('/steering-receipts')) data = { items: [], nextAfterId: null }
    else if (path.endsWith('/context')) data = { threadKey: sessionId, notes: 'TEST draft persists', summary: 'TEST private memory', coveredSeq: 0, version: 1 }
    else if (path.startsWith('/v1/sessions/')) data = session
    else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [] }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  })
  return { ready: async () => { state = 'ready'; release(); if (initial === 'offline') await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })) } }
}
async function open(page: Page, width: number, dark = false) {
  await page.setViewportSize({ width, height: width < 768 ? 844 : 960 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`/?section=SectorChat&sector=${sectorId}&session=${sessionId}&thread=${sessionId}`)
  await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible()
  if (dark) {
    if (width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
    await page.getByRole('button', { name: 'Theme' }).click()
    await page.getByRole('menuitemradio', { name: 'Dark' }).click()
    if (width < 768) await page.keyboard.press('Escape')
  }
  await page.getByRole('button', { name: 'Local context', exact: true }).click()
  await page.getByRole('textbox', { name: 'Local notes' }).fill('TEST unsaved local draft')
  await page.getByRole('button', { name: 'Execution records', exact: true }).focus()
  await page.keyboard.press('Enter')
  return page.getByRole('dialog', { name: 'Execution records', exact: true })
}
for (const width of [1440, 390]) for (const dark of [false, true]) {
  test(`execution inspection ${width}px ${dark ? 'dark' : 'light'} pagination/long JSON/keyboard`, async ({ page }, info) => {
    await fixtures(page)
    const dialog = await open(page, width, dark)
    await expect(dialog.getByText(/20 entries/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Request · Round 1 · #1' }).focus()
    await page.keyboard.press('Enter')
    const json = dialog.getByLabel('Normalized execution JSON')
    await expect(json).toBeVisible()
    expect((await json.textContent())?.length).toBe(64000)
    await expect(json).not.toContainText('TEST_END_OF_COMPLETE_RECORD')
    await expect(dialog.getByText('Shared plan observed')).toBeVisible()
    expect(await page.evaluate(() => 'executionInjected' in window)).toBe(false)
    const download = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Download JSON' }).click()
    const saved = await download
    expect(saved.suggestedFilename()).toBe('execution-1.json')
    expect(readFileSync((await saved.path())!, 'utf8')).toBe(JSON.stringify(record(1)))
    await page.screenshot({ path: info.outputPath('long-record.png'), animations: 'disabled' })
    await dialog.getByRole('button', { name: 'Next records' }).click()
    await expect(dialog.getByText(/3 entries/)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Next records' })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Previous records' })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Previous records' }).click()
    await expect(dialog.getByText(/20 entries/)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Execution records', exact: true })).toBeFocused()
    await expect(page.getByRole('textbox', { name: 'Local notes' })).toHaveValue('TEST unsaved local draft')
  })
}
for (const state of ['loading', 'empty', 'denied', 'error', 'offline', 'body-error'] as const) {
  test(`execution inspection ${state} mobile state`, async ({ page }, info) => {
    const control = await fixtures(page, state)
    const dialog = await open(page, 390)
    if (state === 'body-error') {
      await dialog.getByRole('button', { name: 'Request · Round 1 · #1' }).click()
      await expect(dialog.getByRole('alert')).toContainText('TEST archive missing or corrupt')
      await expect(dialog.getByRole('alert')).toBeInViewport({ ratio: 1 })
      await expect(dialog.getByLabel('Normalized execution JSON')).toHaveCount(0)
    } else if (state === 'loading') await expect(dialog.getByRole('status', { name: 'Execution inspection is loading' })).toBeVisible()
    else if (state === 'empty') await expect(dialog.getByText('No execution records have been saved for this conversation.')).toBeVisible()
    else await expect(dialog.getByRole('alert')).toContainText(state === 'denied' ? 'Execution inspection is not shared' : state === 'offline' ? 'No connection' : 'TEST inspection unavailable')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`${state}.png`), animations: 'disabled' })
    await control.ready()
    if (['denied', 'error', 'offline'].includes(state)) await dialog.getByRole('button', { name: 'Try again' }).click()
    if (['denied', 'error', 'offline', 'loading'].includes(state)) await expect(dialog.getByText(/20 entries/)).toBeVisible()
  })
}
