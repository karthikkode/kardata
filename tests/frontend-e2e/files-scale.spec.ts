// Maintained browser proof over explicitly synthetic HTTP responses. This tests
// the production Files panel, not a live file server, DB, provider or agent.
import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
test.use({ video: 'on', trace: 'on' })
test.afterEach(async ({ page }, testInfo) => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const sources = ['frontend/src/components/workspace-parts.tsx', 'frontend/src/components/SectorWorkspace.tsx', 'tests/frontend-e2e/files-scale.spec.ts']
  const evidencePath = testInfo.outputPath('source-evidence.json')
  writeFileSync(evidencePath, JSON.stringify({ proof: 'synthetic HTTP fixture; no live DB, file server, provider or Temporal', records: 2005, viewport: page.viewportSize(), node: process.version, at: new Date().toISOString(), sourceHashes: Object.fromEntries(sources.map((path) => [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')])) }, null, 2))
  await testInfo.attach('files-scale-source-evidence', { contentType: 'application/json', path: evidencePath })
})

const at = '2026-10-01T00:00:00.000Z'
const sectorId = 'TEST-files-scale-sector'
const sessionId = 'TEST-files-scale-research'
const session = { id: sessionId, title: 'Research', kind: 'research', sectorId, createdAt: at, updatedAt: at }
const sector = { id: sectorId, name: 'TEST Files scale', topic: 'TEST synthetic library', state: 'approved', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: at, updatedAt: at }
const sections = { scope: 'TEST synthetic library scope', decisions: '', findings: '', questions: '' }
const longName = `TEST Generated ${'unbroken-filename-'.repeat(12)}.md`
const library = () => Array.from({ length: 2005 }, (_, index) => ({
  id: `TEST-scale-file-${index}`,
  filename: index === 0 ? longName : `TEST ${index % 2 ? 'Uploaded' : 'Generated'} file ${String(index).padStart(4, '0')}.md`,
  status: ['indexed', 'processing', 'failed', 'needs-ocr'][index < 4 ? index : 0],
  source: index % 2 ? 'Uploaded' : 'Research agent',
  hash: `TEST-version-${index}`, hidden: index === 4, included: false,
  kind: index % 2 ? 'document' : 'artifact',
}))
type FileState = 'ready' | 'loading' | 'empty' | 'error' | 'denied' | 'offline'

async function fixture(page: Page, initial: FileState = 'ready') {
  if (initial === 'offline') await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }))
  const files = library()
  let state = initial
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/v1/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
    if (path.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': TEST fixture\n\n' })
    let data: unknown = []
    if (path.endsWith('/files')) {
      if (state === 'loading') await held
      if (state === 'offline') return route.abort('internetdisconnected')
      if (state === 'error' || state === 'denied') return route.fulfill({ status: state === 'denied' ? 403 : 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: state === 'denied' ? 'permission_denied' : 'internal', message: 'TEST Files unavailable' } }) })
      data = state === 'empty' ? [] : files
    } else if (path.endsWith('/body')) {
      const file = files.find((entry) => path.includes(entry.id))!
      data = { filename: file.filename, mediaType: 'text/markdown', text: '# TEST exact preview\n\nSynthetic retained content.', originalAvailable: true, contentBase64: Buffer.from('TEST original bytes').toString('base64') }
    } else if (path.includes('/files/') && request.method() === 'PATCH') {
      const file = files.find((entry) => path.endsWith(entry.id))!
      file.hidden = request.postDataJSON().hidden
      data = file
    } else if (path === '/v1/sectors') data = [sector]
    else if (path === `/v1/sectors/${sectorId}`) data = sector
    else if (path.endsWith('/research-session')) data = session
    else if (path === '/v1/sessions') data = [session]
    else if (path.endsWith('/global-context')) data = { sectorId, version: 1, sections, markdown: '## Scope\n\nTEST synthetic library scope', researchSessionId: sessionId, changes: [] }
    else if (path.endsWith('/plan')) data = { sectorId, versions: [], latest: null, approvals: [], approvedVersion: null }
    else if (path.endsWith('/progress')) data = { sectorId, state: 'approved', planVersion: 0, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
    else if (path.endsWith('/threads')) data = [{ key: sessionId, sessionId, kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: at }]
    else if (path.endsWith('/steering-receipts')) data = { items: [], nextAfterId: null }
    else if (path.endsWith('/context')) data = { threadKey: sessionId, notes: '', summary: '', coveredSeq: 0, version: 0 }
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
  if (width < 1280) await page.getByRole('button', { name: 'Open files and global context' }).click()
  return page.getByRole('region', { name: 'Sector files' })
}

for (const width of [1440, 390]) for (const dark of [false, true]) {
  test(`files scale: 2005 mixed records, ${width}px ${dark ? 'dark' : 'light'}, reduced motion`, async ({ page }, testInfo) => {
    await fixture(page)
    const files = await open(page, width, dark)
    await expect(files.getByRole('button', { name: longName, exact: true })).toBeVisible()
    // The initial focus/DOM window stays bounded independently of library size.
    expect(await files.getByRole('button', { name: /^TEST (Generated|Uploaded)/ }).count()).toBeLessThanOrEqual(50)
    await expect(files.getByText('Showing 50 of 2,004 files', { exact: true })).toBeVisible()
    await expect(files.getByRole('button', { name: 'Upload file' })).toBeVisible()
    await expect(files.getByRole('button', { name: 'Upload file' })).toBeInViewport()
    await expect(files.getByRole('button', { name: `Hide ${longName} from agents`, exact: true })).toBeVisible()
    await expect(files.getByRole('button', { name: `Add ${longName} to global context`, exact: true })).toBeVisible()
    await expect(files.getByRole('button', { name: `Hide ${longName} from agents`, exact: true })).toBeInViewport()
    await expect(files.getByRole('button', { name: `Add ${longName} to global context`, exact: true })).toBeInViewport()
    await expect(files.getByText('Processing', { exact: true })).toBeVisible()
    await expect(files.getByText('Failed', { exact: true })).toBeVisible()
    await expect(files.getByText('Needs OCR', { exact: true })).toBeVisible()
    const contextHeading = page.getByRole('heading', { name: 'Global context', exact: true })
    const contextPosition = (await contextHeading.boundingBox())!.y
    await files.getByRole('button', { name: 'TEST Generated file 0050.md', exact: true }).scrollIntoViewIfNeeded()
    await expect(files.getByRole('button', { name: 'TEST Generated file 0050.md', exact: true })).toBeInViewport()
    expect((await contextHeading.boundingBox())!.y).toBe(contextPosition)
    await files.getByRole('button', { name: longName, exact: true }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('initial-window.png'), animations: 'disabled' })
    const more = files.getByRole('button', { name: 'Show more', exact: true })
    await more.scrollIntoViewIfNeeded()
    await more.focus()
    await page.keyboard.press('Enter')
    await expect(files.getByText('Showing 100 of 2,004 files', { exact: true })).toBeVisible()
    await files.getByRole('textbox', { name: 'Search files' }).fill('file 2004')
    const lastName = 'TEST Generated file 2004.md'
    await expect(files.getByRole('button', { name: lastName, exact: true })).toBeVisible()
    await expect(files.getByText('Showing 1 of 1 files', { exact: true })).toBeVisible()
    await files.getByRole('button', { name: lastName, exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'File preview' }).getByRole('heading', { name: 'TEST exact preview' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(files.getByRole('button', { name: lastName, exact: true })).toBeFocused()
    await files.getByRole('textbox', { name: 'Search files' }).fill('no TEST filename matches')
    await expect(files.getByText('No matching files.', { exact: true })).toBeVisible()
    await files.getByRole('textbox', { name: 'Search files' }).fill('file 0004')
    await files.getByRole('button', { name: 'Show hidden files', exact: true }).click()
    const hiddenName = 'TEST Generated file 0004.md'
    await expect(files.getByRole('button', { name: hiddenName, exact: true })).toBeDisabled()
    await files.getByRole('button', { name: `Reveal ${hiddenName} to agents`, exact: true }).click()
    await expect(files.getByRole('button', { name: hiddenName, exact: true })).toBeEnabled()
    await files.getByRole('textbox', { name: 'Search files' }).fill('')
    await expect(files.getByText('Showing 50 of 2,005 files', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('search-and-reveal.png'), animations: 'disabled' })
    if (width < 1280) {
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: 'Open files and global context' })).toBeFocused()
    }
  })
}

for (const width of [1440, 390]) for (const state of ['loading', 'empty', 'error', 'denied', 'offline'] as const) {
  test(`files state: ${state}, ${width}px`, async ({ page }, testInfo) => {
    const controller = await fixture(page, state)
    const files = await open(page, width)
    if (state === 'loading') await expect(files.getByRole('status', { name: 'Files is loading' })).toBeVisible()
    else if (state === 'empty') await expect(files.getByText('Upload PDFs, documents or data')).toBeVisible()
    else await expect(files.getByRole('alert')).toContainText(state === 'denied' ? 'Files is not shared with this key.' : state === 'offline' ? 'No connection' : 'TEST Files unavailable')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${state}.png`), animations: 'disabled' })
    await controller.ready()
    if (['error', 'denied', 'offline'].includes(state)) await files.getByRole('button', { name: 'Try again', exact: true }).click()
    if (state !== 'empty') await expect(files.getByRole('button', { name: longName, exact: true })).toBeVisible()
  })
}
