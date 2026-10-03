# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: files-scale.spec.ts >> files scale: 2005 mixed records, 390px light, reduced motion
- Location: ../tests/frontend-e2e/files-scale.spec.ts:89:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('region', { name: 'Sector files' }).getByText('Showing 50 of 2004 files', { exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('region', { name: 'Sector files' }).getByText('Showing 50 of 2004 files', { exact: true }) with timeout 5000ms
  - waiting for getByRole('region', { name: 'Sector files' }).getByText('Showing 50 of 2004 files', { exact: true })

```

```yaml
- main:
  - tabpanel "Chat":
    - log "Conversation messages":
      - heading "Ask about this research" [level=3]
      - paragraph: Questions, comparisons, and review requests stay in this thread.
      - button "Summarize progress so far"
      - button "Which companies were found?"
      - button "What needs my review?"
      - status:
        - text: Reconnecting. Your conversation is saved.
        - button "Reconnect now"
- region "Notifications alt+T"
- dialog "Files and global context":
  - heading "Files and global context" [level=2]
  - button "Close Files and global context"
  - region "Sector files":
    - heading "Files" [level=2]
    - text: 2,004 files
    - button "Upload file"
    - button "Show hidden files"
    - textbox "Search files"
    - list "Files":
      - listitem:
        - button "TEST Generated unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-.md": TEST Generated unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-.md MD · Research agent
        - button "Add TEST Generated unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-.md to global context"
        - button "Hide TEST Generated unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-unbroken-filename-.md from agents"
      - listitem:
        - button "TEST Uploaded file 0001.md": TEST Uploaded file 0001.md Processing MD · Uploaded
        - button "Hide TEST Uploaded file 0001.md from agents"
      - listitem:
        - button "TEST Generated file 0002.md": TEST Generated file 0002.md Failed MD · Research agent
        - button "Hide TEST Generated file 0002.md from agents"
      - listitem:
        - button "TEST Uploaded file 0003.md": TEST Uploaded file 0003.md Needs OCR MD · Uploaded
        - button "Hide TEST Uploaded file 0003.md from agents"
      - listitem:
        - button "TEST Uploaded file 0005.md": TEST Uploaded file 0005.md MD · Uploaded
        - button "Add TEST Uploaded file 0005.md to global context"
        - button "Hide TEST Uploaded file 0005.md from agents"
      - listitem:
        - button "TEST Generated file 0006.md": TEST Generated file 0006.md MD · Research agent
        - button "Add TEST Generated file 0006.md to global context"
        - button "Hide TEST Generated file 0006.md from agents"
      - listitem:
        - button "TEST Uploaded file 0007.md": TEST Uploaded file 0007.md MD · Uploaded
        - button "Add TEST Uploaded file 0007.md to global context"
        - button "Hide TEST Uploaded file 0007.md from agents"
      - listitem:
        - button "TEST Generated file 0008.md": TEST Generated file 0008.md MD · Research agent
        - button "Add TEST Generated file 0008.md to global context"
        - button "Hide TEST Generated file 0008.md from agents"
      - listitem:
        - button "TEST Uploaded file 0009.md": TEST Uploaded file 0009.md MD · Uploaded
        - button "Add TEST Uploaded file 0009.md to global context"
        - button "Hide TEST Uploaded file 0009.md from agents"
      - listitem:
        - button "TEST Generated file 0010.md": TEST Generated file 0010.md MD · Research agent
        - button "Add TEST Generated file 0010.md to global context"
        - button "Hide TEST Generated file 0010.md from agents"
      - listitem:
        - button "TEST Uploaded file 0011.md": TEST Uploaded file 0011.md MD · Uploaded
        - button "Add TEST Uploaded file 0011.md to global context"
        - button "Hide TEST Uploaded file 0011.md from agents"
      - listitem:
        - button "TEST Generated file 0012.md": TEST Generated file 0012.md MD · Research agent
        - button "Add TEST Generated file 0012.md to global context"
        - button "Hide TEST Generated file 0012.md from agents"
      - listitem:
        - button "TEST Uploaded file 0013.md": TEST Uploaded file 0013.md MD · Uploaded
        - button "Add TEST Uploaded file 0013.md to global context"
        - button "Hide TEST Uploaded file 0013.md from agents"
      - listitem:
        - button "TEST Generated file 0014.md": TEST Generated file 0014.md MD · Research agent
        - button "Add TEST Generated file 0014.md to global context"
        - button "Hide TEST Generated file 0014.md from agents"
      - listitem:
        - button "TEST Uploaded file 0015.md": TEST Uploaded file 0015.md MD · Uploaded
        - button "Add TEST Uploaded file 0015.md to global context"
        - button "Hide TEST Uploaded file 0015.md from agents"
      - listitem:
        - button "TEST Generated file 0016.md": TEST Generated file 0016.md MD · Research agent
        - button "Add TEST Generated file 0016.md to global context"
        - button "Hide TEST Generated file 0016.md from agents"
      - listitem:
        - button "TEST Uploaded file 0017.md": TEST Uploaded file 0017.md MD · Uploaded
        - button "Add TEST Uploaded file 0017.md to global context"
        - button "Hide TEST Uploaded file 0017.md from agents"
      - listitem:
        - button "TEST Generated file 0018.md": TEST Generated file 0018.md MD · Research agent
        - button "Add TEST Generated file 0018.md to global context"
        - button "Hide TEST Generated file 0018.md from agents"
      - listitem:
        - button "TEST Uploaded file 0019.md": TEST Uploaded file 0019.md MD · Uploaded
        - button "Add TEST Uploaded file 0019.md to global context"
        - button "Hide TEST Uploaded file 0019.md from agents"
      - listitem:
        - button "TEST Generated file 0020.md": TEST Generated file 0020.md MD · Research agent
        - button "Add TEST Generated file 0020.md to global context"
        - button "Hide TEST Generated file 0020.md from agents"
      - listitem:
        - button "TEST Uploaded file 0021.md": TEST Uploaded file 0021.md MD · Uploaded
        - button "Add TEST Uploaded file 0021.md to global context"
        - button "Hide TEST Uploaded file 0021.md from agents"
      - listitem:
        - button "TEST Generated file 0022.md": TEST Generated file 0022.md MD · Research agent
        - button "Add TEST Generated file 0022.md to global context"
        - button "Hide TEST Generated file 0022.md from agents"
      - listitem:
        - button "TEST Uploaded file 0023.md": TEST Uploaded file 0023.md MD · Uploaded
        - button "Add TEST Uploaded file 0023.md to global context"
        - button "Hide TEST Uploaded file 0023.md from agents"
      - listitem:
        - button "TEST Generated file 0024.md": TEST Generated file 0024.md MD · Research agent
        - button "Add TEST Generated file 0024.md to global context"
        - button "Hide TEST Generated file 0024.md from agents"
      - listitem:
        - button "TEST Uploaded file 0025.md": TEST Uploaded file 0025.md MD · Uploaded
        - button "Add TEST Uploaded file 0025.md to global context"
        - button "Hide TEST Uploaded file 0025.md from agents"
      - listitem:
        - button "TEST Generated file 0026.md": TEST Generated file 0026.md MD · Research agent
        - button "Add TEST Generated file 0026.md to global context"
        - button "Hide TEST Generated file 0026.md from agents"
      - listitem:
        - button "TEST Uploaded file 0027.md": TEST Uploaded file 0027.md MD · Uploaded
        - button "Add TEST Uploaded file 0027.md to global context"
        - button "Hide TEST Uploaded file 0027.md from agents"
      - listitem:
        - button "TEST Generated file 0028.md": TEST Generated file 0028.md MD · Research agent
        - button "Add TEST Generated file 0028.md to global context"
        - button "Hide TEST Generated file 0028.md from agents"
      - listitem:
        - button "TEST Uploaded file 0029.md": TEST Uploaded file 0029.md MD · Uploaded
        - button "Add TEST Uploaded file 0029.md to global context"
        - button "Hide TEST Uploaded file 0029.md from agents"
      - listitem:
        - button "TEST Generated file 0030.md": TEST Generated file 0030.md MD · Research agent
        - button "Add TEST Generated file 0030.md to global context"
        - button "Hide TEST Generated file 0030.md from agents"
      - listitem:
        - button "TEST Uploaded file 0031.md": TEST Uploaded file 0031.md MD · Uploaded
        - button "Add TEST Uploaded file 0031.md to global context"
        - button "Hide TEST Uploaded file 0031.md from agents"
      - listitem:
        - button "TEST Generated file 0032.md": TEST Generated file 0032.md MD · Research agent
        - button "Add TEST Generated file 0032.md to global context"
        - button "Hide TEST Generated file 0032.md from agents"
      - listitem:
        - button "TEST Uploaded file 0033.md": TEST Uploaded file 0033.md MD · Uploaded
        - button "Add TEST Uploaded file 0033.md to global context"
        - button "Hide TEST Uploaded file 0033.md from agents"
      - listitem:
        - button "TEST Generated file 0034.md": TEST Generated file 0034.md MD · Research agent
        - button "Add TEST Generated file 0034.md to global context"
        - button "Hide TEST Generated file 0034.md from agents"
      - listitem:
        - button "TEST Uploaded file 0035.md": TEST Uploaded file 0035.md MD · Uploaded
        - button "Add TEST Uploaded file 0035.md to global context"
        - button "Hide TEST Uploaded file 0035.md from agents"
      - listitem:
        - button "TEST Generated file 0036.md": TEST Generated file 0036.md MD · Research agent
        - button "Add TEST Generated file 0036.md to global context"
        - button "Hide TEST Generated file 0036.md from agents"
      - listitem:
        - button "TEST Uploaded file 0037.md": TEST Uploaded file 0037.md MD · Uploaded
        - button "Add TEST Uploaded file 0037.md to global context"
        - button "Hide TEST Uploaded file 0037.md from agents"
      - listitem:
        - button "TEST Generated file 0038.md": TEST Generated file 0038.md MD · Research agent
        - button "Add TEST Generated file 0038.md to global context"
        - button "Hide TEST Generated file 0038.md from agents"
      - listitem:
        - button "TEST Uploaded file 0039.md": TEST Uploaded file 0039.md MD · Uploaded
        - button "Add TEST Uploaded file 0039.md to global context"
        - button "Hide TEST Uploaded file 0039.md from agents"
      - listitem:
        - button "TEST Generated file 0040.md": TEST Generated file 0040.md MD · Research agent
        - button "Add TEST Generated file 0040.md to global context"
        - button "Hide TEST Generated file 0040.md from agents"
      - listitem:
        - button "TEST Uploaded file 0041.md": TEST Uploaded file 0041.md MD · Uploaded
        - button "Add TEST Uploaded file 0041.md to global context"
        - button "Hide TEST Uploaded file 0041.md from agents"
      - listitem:
        - button "TEST Generated file 0042.md": TEST Generated file 0042.md MD · Research agent
        - button "Add TEST Generated file 0042.md to global context"
        - button "Hide TEST Generated file 0042.md from agents"
      - listitem:
        - button "TEST Uploaded file 0043.md": TEST Uploaded file 0043.md MD · Uploaded
        - button "Add TEST Uploaded file 0043.md to global context"
        - button "Hide TEST Uploaded file 0043.md from agents"
      - listitem:
        - button "TEST Generated file 0044.md": TEST Generated file 0044.md MD · Research agent
        - button "Add TEST Generated file 0044.md to global context"
        - button "Hide TEST Generated file 0044.md from agents"
      - listitem:
        - button "TEST Uploaded file 0045.md": TEST Uploaded file 0045.md MD · Uploaded
        - button "Add TEST Uploaded file 0045.md to global context"
        - button "Hide TEST Uploaded file 0045.md from agents"
      - listitem:
        - button "TEST Generated file 0046.md": TEST Generated file 0046.md MD · Research agent
        - button "Add TEST Generated file 0046.md to global context"
        - button "Hide TEST Generated file 0046.md from agents"
      - listitem:
        - button "TEST Uploaded file 0047.md": TEST Uploaded file 0047.md MD · Uploaded
        - button "Add TEST Uploaded file 0047.md to global context"
        - button "Hide TEST Uploaded file 0047.md from agents"
      - listitem:
        - button "TEST Generated file 0048.md": TEST Generated file 0048.md MD · Research agent
        - button "Add TEST Generated file 0048.md to global context"
        - button "Hide TEST Generated file 0048.md from agents"
      - listitem:
        - button "TEST Uploaded file 0049.md": TEST Uploaded file 0049.md MD · Uploaded
        - button "Add TEST Uploaded file 0049.md to global context"
        - button "Hide TEST Uploaded file 0049.md from agents"
      - listitem:
        - button "TEST Generated file 0050.md": TEST Generated file 0050.md MD · Research agent
        - button "Add TEST Generated file 0050.md to global context"
        - button "Hide TEST Generated file 0050.md from agents"
    - paragraph: Showing 50 of 2,004 files
    - button "Show more"
  - region "Global context":
    - heading "Global context" [level=2]
    - text: v1
    - button "Context history"
    - button "Edit global context"
    - paragraph: Scope
    - paragraph: TEST synthetic library scope
    - paragraph: Decisions
    - paragraph: Not set yet
    - paragraph: Findings
    - paragraph: Not set yet
    - paragraph: Open questions
    - paragraph: Not set yet
```

# Test source

```ts
  1   | // Maintained browser proof over explicitly synthetic HTTP responses. This tests
  2   | // the production Files panel, not a live file server, DB, provider or agent.
  3   | import { expect, test, type Page } from '@playwright/test'
  4   | import { createHash } from 'node:crypto'
  5   | import { readFileSync, writeFileSync } from 'node:fs'
  6   | import { dirname, resolve } from 'node:path'
  7   | import { fileURLToPath } from 'node:url'
  8   | test.use({ video: 'on', trace: 'on' })
  9   | test.afterEach(async ({ page }, testInfo) => {
  10  |   const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  11  |   const sources = ['frontend/src/components/workspace-parts.tsx', 'frontend/src/components/SectorWorkspace.tsx', 'tests/frontend-e2e/files-scale.spec.ts']
  12  |   const evidencePath = testInfo.outputPath('source-evidence.json')
  13  |   writeFileSync(evidencePath, JSON.stringify({ proof: 'synthetic HTTP fixture; no live DB, file server, provider or Temporal', records: 2005, viewport: page.viewportSize(), node: process.version, at: new Date().toISOString(), sourceHashes: Object.fromEntries(sources.map((path) => [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')])) }, null, 2))
  14  |   await testInfo.attach('files-scale-source-evidence', { contentType: 'application/json', path: evidencePath })
  15  | })
  16  | 
  17  | const at = '2026-10-01T00:00:00.000Z'
  18  | const sectorId = 'TEST-files-scale-sector'
  19  | const sessionId = 'TEST-files-scale-research'
  20  | const session = { id: sessionId, title: 'Research', kind: 'research', sectorId, createdAt: at, updatedAt: at }
  21  | const sector = { id: sectorId, name: 'TEST Files scale', topic: 'TEST synthetic library', state: 'approved', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: at, updatedAt: at }
  22  | const sections = { scope: 'TEST synthetic library scope', decisions: '', findings: '', questions: '' }
  23  | const longName = `TEST Generated ${'unbroken-filename-'.repeat(12)}.md`
  24  | const library = () => Array.from({ length: 2005 }, (_, index) => ({
  25  |   id: `TEST-scale-file-${index}`,
  26  |   filename: index === 0 ? longName : `TEST ${index % 2 ? 'Uploaded' : 'Generated'} file ${String(index).padStart(4, '0')}.md`,
  27  |   status: ['indexed', 'processing', 'failed', 'needs-ocr'][index < 4 ? index : 0],
  28  |   source: index % 2 ? 'Uploaded' : 'Research agent',
  29  |   hash: `TEST-version-${index}`, hidden: index === 4, included: false,
  30  |   kind: index % 2 ? 'document' : 'artifact',
  31  | }))
  32  | type FileState = 'ready' | 'loading' | 'empty' | 'error' | 'denied' | 'offline'
  33  | 
  34  | async function fixture(page: Page, initial: FileState = 'ready') {
  35  |   if (initial === 'offline') await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }))
  36  |   const files = library()
  37  |   let state = initial
  38  |   let release: () => void = () => undefined
  39  |   const held = new Promise<void>((resolve) => { release = resolve })
  40  |   await page.route('**/v1/**', async (route) => {
  41  |     const request = route.request(), path = new URL(request.url()).pathname
  42  |     if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
  43  |     if (path.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': TEST fixture\n\n' })
  44  |     let data: unknown = []
  45  |     if (path.endsWith('/files')) {
  46  |       if (state === 'loading') await held
  47  |       if (state === 'offline') return route.abort('internetdisconnected')
  48  |       if (state === 'error' || state === 'denied') return route.fulfill({ status: state === 'denied' ? 403 : 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: state === 'denied' ? 'permission_denied' : 'internal', message: 'TEST Files unavailable' } }) })
  49  |       data = state === 'empty' ? [] : files
  50  |     } else if (path.endsWith('/body')) {
  51  |       const file = files.find((entry) => path.includes(entry.id))!
  52  |       data = { filename: file.filename, mediaType: 'text/markdown', text: '# TEST exact preview\n\nSynthetic retained content.', originalAvailable: true, contentBase64: Buffer.from('TEST original bytes').toString('base64') }
  53  |     } else if (path.includes('/files/') && request.method() === 'PATCH') {
  54  |       const file = files.find((entry) => path.endsWith(entry.id))!
  55  |       file.hidden = request.postDataJSON().hidden
  56  |       data = file
  57  |     } else if (path === '/v1/sectors') data = [sector]
  58  |     else if (path === `/v1/sectors/${sectorId}`) data = sector
  59  |     else if (path.endsWith('/research-session')) data = session
  60  |     else if (path === '/v1/sessions') data = [session]
  61  |     else if (path.endsWith('/global-context')) data = { sectorId, version: 1, sections, markdown: '## Scope\n\nTEST synthetic library scope', researchSessionId: sessionId, changes: [] }
  62  |     else if (path.endsWith('/plan')) data = { sectorId, versions: [], latest: null, approvals: [], approvedVersion: null }
  63  |     else if (path.endsWith('/progress')) data = { sectorId, state: 'approved', planVersion: 0, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
  64  |     else if (path.endsWith('/threads')) data = [{ key: sessionId, sessionId, kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: at }]
  65  |     else if (path.endsWith('/steering-receipts')) data = { items: [], nextAfterId: null }
  66  |     else if (path.endsWith('/context')) data = { threadKey: sessionId, notes: '', summary: '', coveredSeq: 0, version: 0 }
  67  |     else if (path.startsWith('/v1/sessions/')) data = session
  68  |     else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [] }
  69  |     await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  70  |   })
  71  |   return { ready: async () => { state = 'ready'; release(); if (initial === 'offline') await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })) } }
  72  | }
  73  | 
  74  | async function open(page: Page, width: number, dark = false) {
  75  |   await page.setViewportSize({ width, height: width < 768 ? 844 : 960 })
  76  |   await page.emulateMedia({ reducedMotion: 'reduce' })
  77  |   await page.goto(`/?section=SectorChat&sector=${sectorId}&session=${sessionId}&thread=${sessionId}`)
  78  |   await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible()
  79  |   if (dark) {
  80  |     if (width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
  81  |     await page.getByRole('button', { name: 'Use dark theme' }).click()
  82  |     if (width < 768) await page.getByRole('button', { name: 'Close Sessions' }).click()
  83  |   }
  84  |   if (width < 1280) await page.getByRole('button', { name: 'Open files and global context' }).click()
  85  |   return page.getByRole('region', { name: 'Sector files' })
  86  | }
  87  | 
  88  | for (const width of [1440, 390]) for (const dark of [false, true]) {
  89  |   test(`files scale: 2005 mixed records, ${width}px ${dark ? 'dark' : 'light'}, reduced motion`, async ({ page }, testInfo) => {
  90  |     await fixture(page)
  91  |     const files = await open(page, width, dark)
  92  |     await expect(files.getByRole('button', { name: longName, exact: true })).toBeVisible()
  93  |     // The initial focus/DOM window stays bounded independently of library size.
  94  |     expect(await files.getByRole('button', { name: /^TEST (Generated|Uploaded)/ }).count()).toBeLessThanOrEqual(50)
> 95  |     await expect(files.getByText('Showing 50 of 2004 files', { exact: true })).toBeVisible()
      |                                                                                ^ Error: expect(locator).toBeVisible() failed
  96  |     await expect(files.getByRole('button', { name: 'Upload file' })).toBeVisible()
  97  |     await expect(files.getByRole('button', { name: 'Upload file' })).toBeInViewport()
  98  |     await expect(files.getByRole('button', { name: `Hide ${longName}`, exact: true })).toBeVisible()
  99  |     await expect(files.getByRole('button', { name: `Request context inclusion for ${longName}`, exact: true })).toBeVisible()
  100 |     await expect(files.getByRole('button', { name: `Hide ${longName}`, exact: true })).toBeInViewport()
  101 |     await expect(files.getByRole('button', { name: `Request context inclusion for ${longName}`, exact: true })).toBeInViewport()
  102 |     await expect(files.getByText('Processing', { exact: true })).toBeVisible()
  103 |     await expect(files.getByText('Failed', { exact: true })).toBeVisible()
  104 |     await expect(files.getByText('Needs OCR', { exact: true })).toBeVisible()
  105 |     const contextHeading = page.getByRole('heading', { name: 'Global context', exact: true })
  106 |     const contextPosition = (await contextHeading.boundingBox())!.y
  107 |     await files.getByRole('button', { name: 'TEST Generated file 0050.md', exact: true }).scrollIntoViewIfNeeded()
  108 |     await expect(files.getByRole('button', { name: 'TEST Generated file 0050.md', exact: true })).toBeInViewport()
  109 |     expect((await contextHeading.boundingBox())!.y).toBe(contextPosition)
  110 |     await files.getByRole('button', { name: longName, exact: true }).scrollIntoViewIfNeeded()
  111 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  112 |     await page.screenshot({ path: testInfo.outputPath('initial-window.png'), animations: 'disabled' })
  113 |     const more = files.getByRole('button', { name: 'Show more files', exact: true })
  114 |     await more.scrollIntoViewIfNeeded()
  115 |     await more.focus()
  116 |     await page.keyboard.press('Enter')
  117 |     await expect(files.getByText('Showing 100 of 2004 files', { exact: true })).toBeVisible()
  118 |     await files.getByRole('textbox', { name: 'Search files' }).fill('file 2004')
  119 |     const lastName = 'TEST Generated file 2004.md'
  120 |     await expect(files.getByRole('button', { name: lastName, exact: true })).toBeVisible()
  121 |     await expect(files.getByText('Showing 1 of 1 files', { exact: true })).toBeVisible()
  122 |     await files.getByRole('button', { name: lastName, exact: true }).focus()
  123 |     await page.keyboard.press('Enter')
  124 |     await expect(page.getByRole('dialog', { name: 'File preview' }).getByRole('heading', { name: 'TEST exact preview' })).toBeVisible()
  125 |     await page.keyboard.press('Escape')
  126 |     await expect(files.getByRole('button', { name: lastName, exact: true })).toBeFocused()
  127 |     await files.getByRole('textbox', { name: 'Search files' }).fill('no TEST filename matches')
  128 |     await expect(files.getByText('No matching files.', { exact: true })).toBeVisible()
  129 |     await files.getByRole('textbox', { name: 'Search files' }).fill('file 0004')
  130 |     await files.getByRole('button', { name: 'Show hidden files', exact: true }).click()
  131 |     const hiddenName = 'TEST Generated file 0004.md'
  132 |     await expect(files.getByRole('button', { name: hiddenName, exact: true })).toBeDisabled()
  133 |     await files.getByRole('button', { name: `Reveal ${hiddenName}`, exact: true }).click()
  134 |     await expect(files.getByRole('button', { name: hiddenName, exact: true })).toBeEnabled()
  135 |     await files.getByRole('textbox', { name: 'Search files' }).fill('')
  136 |     await expect(files.getByText('Showing 50 of 2005 files', { exact: true })).toBeVisible()
  137 |     await page.screenshot({ path: testInfo.outputPath('search-and-reveal.png'), animations: 'disabled' })
  138 |     if (width < 1280) {
  139 |       await page.keyboard.press('Escape')
  140 |       await expect(page.getByRole('button', { name: 'Open files and global context' })).toBeFocused()
  141 |     }
  142 |   })
  143 | }
  144 | 
  145 | for (const width of [1440, 390]) for (const state of ['loading', 'empty', 'error', 'denied', 'offline'] as const) {
  146 |   test(`files state: ${state}, ${width}px`, async ({ page }, testInfo) => {
  147 |     const controller = await fixture(page, state)
  148 |     const files = await open(page, width)
  149 |     if (state === 'loading') await expect(files.getByRole('status', { name: 'Files is loading' })).toBeVisible()
  150 |     else if (state === 'empty') await expect(files.getByText('Upload source material or ask an agent to create a file.')).toBeVisible()
  151 |     else await expect(files.getByRole('alert')).toContainText(state === 'denied' ? 'Files is not shared with this key.' : state === 'offline' ? 'No connection' : 'TEST Files unavailable')
  152 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  153 |     await page.screenshot({ path: testInfo.outputPath(`${state}.png`), animations: 'disabled' })
  154 |     await controller.ready()
  155 |     if (['error', 'denied', 'offline'].includes(state)) await files.getByRole('button', { name: 'Try again', exact: true }).click()
  156 |     if (state !== 'empty') await expect(files.getByRole('button', { name: longName, exact: true })).toBeVisible()
  157 |   })
  158 | }
  159 | 
```