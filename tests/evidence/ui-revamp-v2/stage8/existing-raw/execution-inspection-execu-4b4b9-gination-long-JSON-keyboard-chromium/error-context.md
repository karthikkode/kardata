# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: execution-inspection.spec.ts >> execution inspection 1440px dark pagination/long JSON/keyboard
- Location: ../tests/frontend-e2e/execution-inspection.spec.ts:75:3

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
- generic [ref=e2]:
  - generic [ref=e3]:
    - complementary "Sector sessions" [ref=e4]:
      - generic [ref=e5]:
        - generic [ref=e6]:
          - generic [ref=e7]:
            - button "Back to sector summary" [ref=e8] [cursor=pointer]
            - generic "TEST execution inspection" [ref=e9]
          - generic [ref=e10]:
            - generic [ref=e11]: Approved
            - generic [ref=e13]: 0 companies
        - tablist "Session types" [ref=e16]:
          - tab "Research" [selected] [ref=e17] [cursor=pointer]
          - tab "Chats ( 0 )" [ref=e20] [cursor=pointer]:
            - generic [ref=e21]:
              - text: Chats (
              - generic [ref=e22]: "0"
              - text: )
        - list "Research sessions" [ref=e24]:
          - listitem [ref=e25]:
            - button "Open Research" [ref=e26] [cursor=pointer]:
              - generic [ref=e36]:
                - generic "Research" [ref=e37]
                - generic [ref=e38]: Approved
        - button "Theme" [ref=e40] [cursor=pointer]
    - main [ref=e41]:
      - generic [ref=e42]:
        - generic [ref=e43]:
          - heading "Research" [level=1] [ref=e44]
          - generic [ref=e45]:
            - generic [ref=e46]: Approved
            - generic [ref=e48]: No plan yet
        - button "Start research" [ref=e49] [cursor=pointer]
        - button "Hide files and context" [ref=e50] [cursor=pointer]
        - button "Conversation options" [ref=e51] [cursor=pointer]
      - generic [ref=e52]:
        - tablist "Research views" [ref=e53]:
          - tab "Chat" [selected] [ref=e54] [cursor=pointer]
          - tab "Plan" [ref=e56] [cursor=pointer]
        - tabpanel "Chat" [ref=e58]:
          - generic [ref=e59]:
            - log "Conversation messages" [ref=e61]:
              - generic [ref=e62]:
                - generic [ref=e63]:
                  - heading "Ask about this research" [level=3] [ref=e67]
                  - paragraph [ref=e68]: Questions, comparisons, and review requests stay in this thread.
                  - generic [ref=e69]:
                    - button "Summarize progress so far" [ref=e70] [cursor=pointer]
                    - button "Which companies were found?" [ref=e71] [cursor=pointer]
                    - button "What needs my review?" [ref=e72] [cursor=pointer]
                - status [ref=e73]:
                  - generic [ref=e77]: Reconnecting. Your conversation is saved.
                  - button "Reconnect now" [ref=e78] [cursor=pointer]
            - generic [ref=e80]:
              - generic [ref=e81]: Message this conversation
              - generic [ref=e82]:
                - generic [ref=e83]:
                  - generic [ref=e84]: Message this conversation
                  - textbox "Message this conversation" [active] [ref=e85]:
                    - /placeholder: Ask about this research...
                  - generic [ref=e86]:
                    - generic [ref=e87]:
                      - button "Local context" [ref=e88] [cursor=pointer]
                      - generic [ref=e90]:
                        - button "Choose a model" [disabled]
                    - generic [ref=e91]:
                      - button "Send message" [disabled]
                - paragraph [ref=e92]:
                  - generic [ref=e93]: Enter
                  - generic [ref=e94]: to send,
                  - generic [ref=e95]: Shift
                  - generic [ref=e96]: +
                  - generic [ref=e97]: Enter
                  - generic [ref=e98]: for a new line
    - complementary "Sector resources" [ref=e99]:
      - generic [ref=e100]:
        - region "Sector files" [ref=e101]:
          - generic [ref=e102]:
            - heading "Files" [level=2] [ref=e103]
            - generic [ref=e104]: 0 files
            - button "Upload file" [ref=e105] [cursor=pointer]
            - button "Show hidden files" [ref=e106] [cursor=pointer]
          - textbox "Search files" [ref=e110]
          - generic [ref=e112]:
            - paragraph [ref=e113]: Upload PDFs, documents or data, or ask an agent to create a file.
            - button "Upload file" [ref=e115] [cursor=pointer]
          - paragraph [ref=e117]: Showing 0 of 0 files
        - region "Global context" [ref=e118]:
          - generic [ref=e119]:
            - heading "Global context" [level=2] [ref=e120]
            - generic [ref=e121]: v1
            - button "Context history" [ref=e122] [cursor=pointer]
            - button "Edit global context" [ref=e123] [cursor=pointer]
          - generic [ref=e125]:
            - generic [ref=e126]:
              - paragraph [ref=e127]: Scope
              - paragraph [ref=e130]: TEST scope
            - generic [ref=e131]:
              - paragraph [ref=e132]: Decisions
              - paragraph [ref=e133]: Not set yet
            - generic [ref=e134]:
              - paragraph [ref=e135]: Findings
              - paragraph [ref=e136]: Not set yet
            - generic [ref=e137]:
              - paragraph [ref=e138]: Open questions
              - paragraph [ref=e139]: Not set yet
  - region "Notifications alt+T"
```

# Test source

```ts
  1   | // Maintained synthetic-HTTP UI proof. No live archive, DB, provider or Temporal.
  2   | import { expect, test, type Page } from '@playwright/test'
  3   | import { createHash } from 'node:crypto'
  4   | import { readFileSync, writeFileSync } from 'node:fs'
  5   | import { dirname, resolve } from 'node:path'
  6   | import { fileURLToPath } from 'node:url'
  7   | test.use({ video: 'on', trace: 'on' })
  8   | test.afterEach(async ({ page }, info) => {
  9   |   const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  10  |   const paths = ['frontend/src/components/ExecutionInspector.tsx', 'frontend/src/components/workspace-parts.tsx', 'frontend/src/data/sector-workspace.ts', 'tests/frontend-e2e/execution-inspection.spec.ts']
  11  |   const evidencePath = info.outputPath('source-evidence.json')
  12  |   writeFileSync(evidencePath, JSON.stringify({ proof: 'synthetic HTTP UI only', viewport: page.viewportSize(), node: process.version, sourceHashes: Object.fromEntries(paths.map((path) => [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')])) }))
  13  |   await info.attach('execution-inspection-source-evidence', { contentType: 'application/json', path: evidencePath })
  14  | })
  15  | const sectorId = 'TEST-execution-sector', sessionId = 'TEST-execution-session'
  16  | const at = '2026-10-01T00:00:00Z'
  17  | const session = { id: sessionId, title: 'Research', kind: 'research', sectorId, createdAt: at, updatedAt: at }
  18  | const sector = { id: sectorId, name: 'TEST execution inspection', topic: 'TEST sources', state: 'approved', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: at, updatedAt: at }
  19  | const record = (seq: number) => ({ version: 1, provider: 'TEST adapter', model: 'TEST recorded model', round: Math.ceil(seq / 3), boundary: { contextVersion: 3, planVersion: 7, localVersion: 0 }, data: { prompt: '<script>window.executionInjected=true</script>\n' + 'TEST normalized source evidence\n'.repeat(5000) + 'TEST_END_OF_COMPLETE_RECORD' } })
  20  | const metadata = Array.from({ length: 23 }, (_, index) => ({ seq: index + 1, at, runKey: 'TEST original turn '.repeat(10), attemptLease: '7844274c-d10a-4c66-a65e-3bb171da2b60', round: Math.ceil((index + 1) / 3), kind: ['request', 'response', 'tool-result'][index % 3], workflowId: 'TEST actual workflow', executionId: 'TEST actual execution', ownerEpoch: '4583649e-c568-4d79-b4a5-8a411de7f42b', ref: { hash: createHash('sha256').update(JSON.stringify(record(index + 1))).digest('hex'), bytes: Buffer.byteLength(JSON.stringify(record(index + 1))) } }))
  21  | type State = 'ready' | 'loading' | 'empty' | 'denied' | 'error' | 'offline' | 'body-error'
  22  | async function fixtures(page: Page, initial: State = 'ready') {
  23  |   if (initial === 'offline') await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }))
  24  |   let state = initial
  25  |   let release: () => void = () => undefined
  26  |   const wait = new Promise<void>((resolve) => { release = resolve })
  27  |   await page.route('**/v1/**', async (route) => {
  28  |     const request = route.request(), url = new URL(request.url()), path = url.pathname
  29  |     if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
  30  |     if (path.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': TEST fixture\n\n' })
  31  |     let data: unknown = []
  32  |     if (path.endsWith('/execution-records')) {
  33  |       if (state === 'loading') await wait
  34  |       if (state === 'offline') return route.abort('internetdisconnected')
  35  |       if (state === 'denied' || state === 'error') return route.fulfill({ status: state === 'denied' ? 403 : 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: state === 'denied' ? 'permission_denied' : 'internal', message: 'TEST inspection unavailable' } }) })
  36  |       const after = Number(url.searchParams.get('afterSeq') ?? 0)
  37  |       const rows = state === 'empty' ? [] : metadata.filter((entry) => entry.seq > after)
  38  |       data = { records: rows.slice(0, 20), nextAfterSeq: rows.length > 20 ? rows[19]!.seq : null }
  39  |     } else if (path.includes('/execution-records/')) {
  40  |       if (state === 'body-error') return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'conflict', message: 'TEST archive missing or corrupt' } }) })
  41  |       data = { record: record(Number(path.split('/').at(-1))) }
  42  |     } else if (path === '/v1/sectors') data = [sector]
  43  |     else if (path === `/v1/sectors/${sectorId}`) data = sector
  44  |     else if (path.endsWith('/research-session')) data = session
  45  |     else if (path === '/v1/sessions') data = [session]
  46  |     else if (path.endsWith('/global-context')) data = { sectorId, version: 1, sections: { scope: 'TEST scope', decisions: '', findings: '', questions: '' }, markdown: '## Scope\nTEST scope', researchSessionId: sessionId, changes: [] }
  47  |     else if (path.endsWith('/plan')) data = { sectorId, versions: [], latest: null, approvals: [], approvedVersion: null }
  48  |     else if (path.endsWith('/progress')) data = { sectorId, state: 'approved', planVersion: 0, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
  49  |     else if (path.endsWith('/threads')) data = [{ key: sessionId, sessionId, kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: at }]
  50  |     else if (path.endsWith('/steering-receipts')) data = { items: [], nextAfterId: null }
  51  |     else if (path.endsWith('/context')) data = { threadKey: sessionId, notes: 'TEST draft persists', summary: 'TEST private memory', coveredSeq: 0, version: 1 }
  52  |     else if (path.startsWith('/v1/sessions/')) data = session
  53  |     else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [] }
  54  |     await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  55  |   })
  56  |   return { ready: async () => { state = 'ready'; release(); if (initial === 'offline') await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })) } }
  57  | }
  58  | async function open(page: Page, width: number, dark = false) {
  59  |   await page.setViewportSize({ width, height: width < 768 ? 844 : 960 })
  60  |   await page.emulateMedia({ reducedMotion: 'reduce' })
  61  |   await page.goto(`/?section=SectorChat&sector=${sectorId}&session=${sessionId}&thread=${sessionId}`)
  62  |   await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible()
  63  |   if (dark) {
  64  |     if (width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
> 65  |     await page.getByRole('button', { name: 'Use dark theme' }).click()
      |                                                                ^ Error: locator.click: Test timeout of 30000ms exceeded.
  66  |     if (width < 768) await page.getByRole('button', { name: 'Close Sessions' }).click()
  67  |   }
  68  |   await page.getByRole('button', { name: 'Local context', exact: true }).click()
  69  |   await page.getByRole('textbox', { name: 'Local notes' }).fill('TEST unsaved local draft')
  70  |   await page.getByRole('button', { name: 'Execution records', exact: true }).focus()
  71  |   await page.keyboard.press('Enter')
  72  |   return page.getByRole('dialog', { name: 'Execution records', exact: true })
  73  | }
  74  | for (const width of [1440, 390]) for (const dark of [false, true]) {
  75  |   test(`execution inspection ${width}px ${dark ? 'dark' : 'light'} pagination/long JSON/keyboard`, async ({ page }, info) => {
  76  |     await fixtures(page)
  77  |     const dialog = await open(page, width, dark)
  78  |     await expect(dialog.getByText('20 records on this page')).toBeVisible()
  79  |     await dialog.getByRole('button', { name: 'Request · Round 1 · #1' }).focus()
  80  |     await page.keyboard.press('Enter')
  81  |     const json = dialog.getByLabel('Normalized execution JSON')
  82  |     await expect(json).toBeVisible()
  83  |     expect((await json.textContent())?.length).toBe(64000)
  84  |     await expect(json).not.toContainText('TEST_END_OF_COMPLETE_RECORD')
  85  |     await expect(dialog.getByText('Shared plan observed')).toBeVisible()
  86  |     expect(await page.evaluate(() => 'executionInjected' in window)).toBe(false)
  87  |     const download = page.waitForEvent('download')
  88  |     await dialog.getByRole('button', { name: 'Download JSON' }).click()
  89  |     const saved = await download
  90  |     expect(saved.suggestedFilename()).toBe('execution-1.json')
  91  |     expect(readFileSync((await saved.path())!, 'utf8')).toBe(JSON.stringify(record(1)))
  92  |     await page.screenshot({ path: info.outputPath('long-record.png'), animations: 'disabled' })
  93  |     await dialog.getByRole('button', { name: 'Next records' }).click()
  94  |     await expect(dialog.getByText('3 records on this page')).toBeVisible()
  95  |     await expect(dialog.getByRole('button', { name: 'Next records' })).toBeDisabled()
  96  |     await expect(dialog.getByRole('button', { name: 'Previous records' })).toBeEnabled()
  97  |     await dialog.getByRole('button', { name: 'Previous records' }).click()
  98  |     await expect(dialog.getByText('20 records on this page')).toBeVisible()
  99  |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  100 |     await page.keyboard.press('Escape')
  101 |     await expect(page.getByRole('button', { name: 'Execution records', exact: true })).toBeFocused()
  102 |     await expect(page.getByRole('textbox', { name: 'Local notes' })).toHaveValue('TEST unsaved local draft')
  103 |   })
  104 | }
  105 | for (const state of ['loading', 'empty', 'denied', 'error', 'offline', 'body-error'] as const) {
  106 |   test(`execution inspection ${state} mobile state`, async ({ page }, info) => {
  107 |     const control = await fixtures(page, state)
  108 |     const dialog = await open(page, 390)
  109 |     if (state === 'body-error') {
  110 |       await dialog.getByRole('button', { name: 'Request · Round 1 · #1' }).click()
  111 |       await expect(dialog.getByRole('alert')).toContainText('TEST archive missing or corrupt')
  112 |       await expect(dialog.getByRole('alert')).toBeInViewport({ ratio: 1 })
  113 |       await expect(dialog.getByLabel('Normalized execution JSON')).toHaveCount(0)
  114 |     } else if (state === 'loading') await expect(dialog.getByRole('status', { name: 'Execution inspection is loading' })).toBeVisible()
  115 |     else if (state === 'empty') await expect(dialog.getByText('No execution records have been saved for this conversation.')).toBeVisible()
  116 |     else await expect(dialog.getByRole('alert')).toContainText(state === 'denied' ? 'Execution inspection is not shared' : state === 'offline' ? 'No connection' : 'TEST inspection unavailable')
  117 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  118 |     await page.screenshot({ path: info.outputPath(`${state}.png`), animations: 'disabled' })
  119 |     await control.ready()
  120 |     if (['denied', 'error', 'offline'].includes(state)) await dialog.getByRole('button', { name: 'Try again' }).click()
  121 |     if (['denied', 'error', 'offline', 'loading'].includes(state)) await expect(dialog.getByText('20 records on this page')).toBeVisible()
  122 |   })
  123 | }
  124 | 
```