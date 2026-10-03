# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: execution-inspection.spec.ts >> execution inspection offline mobile state
- Location: ../tests/frontend-e2e/execution-inspection.spec.ts:106:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('dialog', { name: 'Execution records', exact: true }).getByText('20 records on this page')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('dialog', { name: 'Execution records', exact: true }).getByText('20 records on this page') with timeout 5000ms
  - waiting for getByRole('dialog', { name: 'Execution records', exact: true }).getByText('20 records on this page')

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
- dialog "Execution records":
  - heading "Execution records" [level=2]
  - button "Close Execution records"
  - paragraph: Saved normalized adapter inputs, results and tool boundaries. Historical snapshots retain the content seen at that time. Inspection requires an approver key.
  - button "Refresh execution records"
  - paragraph: 20 entries · updated 2d ago
  - button "Previous records" [disabled]
  - button "Next records"
  - list "Recorded boundaries":
    - listitem:
      - 'button "Request · Round 1 · #1"':
        - text: "#1 Request · Round 1"
        - time: 10/1/2026, 5:30:00 AM
    - listitem:
      - 'button "Response · Round 1 · #2"':
        - text: "#2 Response · Round 1"
        - time: 10/1/2026, 5:30:00 AM
    - listitem:
      - 'button "Tool result · Round 1 · #3"':
        - text: "#3 Tool result · Round 1"
        - time: 10/1/2026, 5:30:00 AM
    - listitem:
      - 'button "Request · Round 2 · #4"':
        - text: "#4 Request · Round 2"
        - time: 10/1/2026, 5:30:00 AM
    - listitem:
      - 'button "Response · Round 2 · #5"':
        - text: "#5 Response · Round 2"
        - time: 10/1/2026, 5:30:00 AM
    - listitem:
      - 'button "Tool result · Round 2 · #6"':
        - text: "#6 Tool result · Round 2"
        - time: 10/1/2026, 5:30:00 AM
    - listitem:
      - 'button "Request · Round 3 · #7"':
        - text: "#7 Request · Round 3"
        - time: 10/1/2026, 5:30:00 AM
    - listitem:
      - 'button "Response · Round 3 · #8"':
        - text: "#8 Response · Round 3"
        - time: 10/1/2026, 5:30:00 AM
    - listitem:
      - 'button "Tool result · Round 3 · #9"':
        - text: "#9 Tool result · Round 3"
        - time: 10/1/2026, 5:30:00 AM
    - listitem:
      - 'button "Request · Round 4 · #10"':
        - text: "#10 Request · Round 4"
        - time: 10/1/2026, 5:30:00 AM
    - listitem:
      - 'button "Response · Round 4 · #11"':
        - text: "#11 Response · Round 4"
        - time: 10/1/2026, 5:30:00 AM
    - listitem:
      - 'button "Tool result · Round 4 · #12"':
        - text: "#12 Tool result · Round 4"
        - time: 10/1/2026, 5:30:00 AM
    - listitem:
      - 'button "Request · Round 5 · #13"':
        - text: "#13 Request · Round 5"
        - time: 10/1/2026, 5:30:00 AM
    - listitem:
      - 'button "Response · Round 5 · #14"':
        - text: "#14 Response · Round 5"
        - time: 10/1/2026, 5:30:00 AM
    - listitem:
      - 'button "Tool result · Round 5 · #15"':
        - text: "#15 Tool result · Round 5"
        - time: 10/1/2026, 5:30:00 AM
    - listitem:
      - 'button "Request · Round 6 · #16"':
        - text: "#16 Request · Round 6"
        - time: 10/1/2026, 5:30:00 AM
    - listitem:
      - 'button "Response · Round 6 · #17"':
        - text: "#17 Response · Round 6"
        - time: 10/1/2026, 5:30:00 AM
    - listitem:
      - 'button "Tool result · Round 6 · #18"':
        - text: "#18 Tool result · Round 6"
        - time: 10/1/2026, 5:30:00 AM
    - listitem:
      - 'button "Request · Round 7 · #19"':
        - text: "#19 Request · Round 7"
        - time: 10/1/2026, 5:30:00 AM
    - listitem:
      - 'button "Response · Round 7 · #20"':
        - text: "#20 Response · Round 7"
        - time: 10/1/2026, 5:30:00 AM
  - button "Close"
```

# Test source

```ts
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
  65  |     await page.getByRole('button', { name: 'Use dark theme' }).click()
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
> 121 |     if (['denied', 'error', 'offline', 'loading'].includes(state)) await expect(dialog.getByText('20 records on this page')).toBeVisible()
      |                                                                                                                              ^ Error: expect(locator).toBeVisible() failed
  122 |   })
  123 | }
  124 | 
```