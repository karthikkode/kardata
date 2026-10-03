# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: files-scale.spec.ts >> files scale: 2005 mixed records, 390px dark, reduced motion
- Location: ../tests/frontend-e2e/files-scale.spec.ts:89:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Use dark theme' })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - main [ref=e4]:
      - generic [aria-hidden] [ref=e5]:
        - button [ref=e6] [cursor=pointer]
        - generic [ref=e7]:
          - heading [level=1] [ref=e8]: Research
          - generic [ref=e9]: Approved
        - button [ref=e11] [cursor=pointer]: Start research
        - button [ref=e12] [cursor=pointer]
        - button [ref=e13] [cursor=pointer]
      - generic [ref=e14]:
        - tablist [aria-hidden] [ref=e15]:
          - tab [selected] [ref=e16] [cursor=pointer]: Chat
          - tab [ref=e18] [cursor=pointer]:
            - generic [ref=e19]: Plan
        - tabpanel "Chat" [ref=e20]:
          - generic [ref=e21]:
            - log "Conversation messages" [ref=e23]:
              - generic [ref=e24]:
                - generic [ref=e25]:
                  - heading "Ask about this research" [level=3] [ref=e29]
                  - paragraph [ref=e30]: Questions, comparisons, and review requests stay in this thread.
                  - generic [ref=e31]:
                    - button "Summarize progress so far" [ref=e32] [cursor=pointer]
                    - button "Which companies were found?" [ref=e33] [cursor=pointer]
                    - button "What needs my review?" [ref=e34] [cursor=pointer]
                - status [ref=e35]:
                  - generic [ref=e39]: Reconnecting. Your conversation is saved.
                  - button "Reconnect now" [ref=e40] [cursor=pointer]
            - generic [ref=e42]:
              - generic [ref=e43]: Message this conversation
              - generic [ref=e45]:
                - generic [ref=e46]: Message this conversation
                - textbox [ref=e47]:
                  - /placeholder: Ask about this research...
                - generic [ref=e48]:
                  - generic [ref=e49]:
                    - button [ref=e50] [cursor=pointer]
                    - generic [ref=e52]:
                      - button [disabled]:
                        - generic: Choose a model
                  - generic [ref=e53]:
                    - button [disabled]
    - region "Notifications alt+T"
  - dialog [active] [ref=e56]:
    - generic [ref=e57]:
      - heading "Sessions" [level=2] [ref=e59]
      - button "Close Sessions" [ref=e60] [cursor=pointer]
    - generic [ref=e65]:
      - generic [ref=e66]:
        - generic [ref=e67]:
          - button "Back to sector summary" [ref=e68] [cursor=pointer]
          - generic "TEST Files scale" [ref=e69]
        - generic [ref=e70]:
          - generic [ref=e71]: Approved
          - generic [ref=e73]: 0 companies
      - tablist "Session types" [ref=e76]:
        - tab "Research" [selected] [ref=e77] [cursor=pointer]
        - tab "Chats ( 0 )" [ref=e80] [cursor=pointer]:
          - generic [ref=e81]:
            - text: Chats (
            - generic [ref=e82]: "0"
            - text: )
      - list "Research sessions" [ref=e84]:
        - listitem [ref=e85]:
          - button "Open Research" [ref=e86] [cursor=pointer]:
            - generic [ref=e96]:
              - generic "Research" [ref=e97]
              - generic [ref=e98]: Approved
      - button "Theme" [ref=e100] [cursor=pointer]
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
> 81  |     await page.getByRole('button', { name: 'Use dark theme' }).click()
      |                                                                ^ Error: locator.click: Test timeout of 30000ms exceeded.
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
  95  |     await expect(files.getByText('Showing 50 of 2004 files', { exact: true })).toBeVisible()
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