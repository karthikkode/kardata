# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: revamp-evidence.spec.ts >> revamp: loaded-list filter timing probe
- Location: ../tests/frontend-e2e/revamp-evidence.spec.ts:160:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Showing 50 of 2005 files')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('Showing 50 of 2005 files') with timeout 5000ms
  - waiting for getByText('Showing 50 of 2005 files')

```

```yaml
- complementary "Sector sessions":
  - button "Back to sector summary"
  - text: TEST Timing Approved 0 companies
  - tablist "Session types":
    - tab "Research" [selected]
    - tab "Chats ( 0 )"
  - list "Research sessions"
  - alert:
    - heading "The server returned an invalid workspace response." [level=3]
    - button "Try again"
  - button "Theme"
- main:
  - heading "Sector workspace" [level=1]
  - button "Hide files and context"
  - button "Conversation options" [disabled]
  - log "Conversation messages":
    - status "Conversation is loading": Loading Conversation
  - text: Message this conversation Message this conversation
  - textbox "Message this conversation" [disabled]:
    - /placeholder: Message...
  - button "Local context"
  - button "Send message" [disabled]
- complementary "Sector resources":
  - region "Sector files":
    - heading "Files" [level=2]
    - text: 2,005 files
    - button "Upload file"
    - button "Show hidden files"
    - textbox "Search files"
    - list "Files":
      - listitem:
        - button "TEST file 0000.md": TEST file 0000.md MD · Uploaded
        - button "Add TEST file 0000.md to global context"
        - button "Hide TEST file 0000.md from agents"
      - listitem:
        - button "TEST file 0001.md": TEST file 0001.md MD · Uploaded
        - button "Add TEST file 0001.md to global context"
        - button "Hide TEST file 0001.md from agents"
      - listitem:
        - button "TEST file 0002.md": TEST file 0002.md MD · Uploaded
        - button "Add TEST file 0002.md to global context"
        - button "Hide TEST file 0002.md from agents"
      - listitem:
        - button "TEST file 0003.md": TEST file 0003.md MD · Uploaded
        - button "Add TEST file 0003.md to global context"
        - button "Hide TEST file 0003.md from agents"
      - listitem:
        - button "TEST file 0004.md": TEST file 0004.md MD · Uploaded
        - button "Add TEST file 0004.md to global context"
        - button "Hide TEST file 0004.md from agents"
      - listitem:
        - button "TEST file 0005.md": TEST file 0005.md MD · Uploaded
        - button "Add TEST file 0005.md to global context"
        - button "Hide TEST file 0005.md from agents"
      - listitem:
        - button "TEST file 0006.md": TEST file 0006.md MD · Uploaded
        - button "Add TEST file 0006.md to global context"
        - button "Hide TEST file 0006.md from agents"
      - listitem:
        - button "TEST file 0007.md": TEST file 0007.md MD · Uploaded
        - button "Add TEST file 0007.md to global context"
        - button "Hide TEST file 0007.md from agents"
      - listitem:
        - button "TEST file 0008.md": TEST file 0008.md MD · Uploaded
        - button "Add TEST file 0008.md to global context"
        - button "Hide TEST file 0008.md from agents"
      - listitem:
        - button "TEST file 0009.md": TEST file 0009.md MD · Uploaded
        - button "Add TEST file 0009.md to global context"
        - button "Hide TEST file 0009.md from agents"
      - listitem:
        - button "TEST file 0010.md": TEST file 0010.md MD · Uploaded
        - button "Add TEST file 0010.md to global context"
        - button "Hide TEST file 0010.md from agents"
      - listitem:
        - button "TEST file 0011.md": TEST file 0011.md MD · Uploaded
        - button "Add TEST file 0011.md to global context"
        - button "Hide TEST file 0011.md from agents"
      - listitem:
        - button "TEST file 0012.md": TEST file 0012.md MD · Uploaded
        - button "Add TEST file 0012.md to global context"
        - button "Hide TEST file 0012.md from agents"
      - listitem:
        - button "TEST file 0013.md": TEST file 0013.md MD · Uploaded
        - button "Add TEST file 0013.md to global context"
        - button "Hide TEST file 0013.md from agents"
      - listitem:
        - button "TEST file 0014.md": TEST file 0014.md MD · Uploaded
        - button "Add TEST file 0014.md to global context"
        - button "Hide TEST file 0014.md from agents"
      - listitem:
        - button "TEST file 0015.md": TEST file 0015.md MD · Uploaded
        - button "Add TEST file 0015.md to global context"
        - button "Hide TEST file 0015.md from agents"
      - listitem:
        - button "TEST file 0016.md": TEST file 0016.md MD · Uploaded
        - button "Add TEST file 0016.md to global context"
        - button "Hide TEST file 0016.md from agents"
      - listitem:
        - button "TEST file 0017.md": TEST file 0017.md MD · Uploaded
        - button "Add TEST file 0017.md to global context"
        - button "Hide TEST file 0017.md from agents"
      - listitem:
        - button "TEST file 0018.md": TEST file 0018.md MD · Uploaded
        - button "Add TEST file 0018.md to global context"
        - button "Hide TEST file 0018.md from agents"
      - listitem:
        - button "TEST file 0019.md": TEST file 0019.md MD · Uploaded
        - button "Add TEST file 0019.md to global context"
        - button "Hide TEST file 0019.md from agents"
      - listitem:
        - button "TEST file 0020.md": TEST file 0020.md MD · Uploaded
        - button "Add TEST file 0020.md to global context"
        - button "Hide TEST file 0020.md from agents"
      - listitem:
        - button "TEST file 0021.md": TEST file 0021.md MD · Uploaded
        - button "Add TEST file 0021.md to global context"
        - button "Hide TEST file 0021.md from agents"
      - listitem:
        - button "TEST file 0022.md": TEST file 0022.md MD · Uploaded
        - button "Add TEST file 0022.md to global context"
        - button "Hide TEST file 0022.md from agents"
      - listitem:
        - button "TEST file 0023.md": TEST file 0023.md MD · Uploaded
        - button "Add TEST file 0023.md to global context"
        - button "Hide TEST file 0023.md from agents"
      - listitem:
        - button "TEST file 0024.md": TEST file 0024.md MD · Uploaded
        - button "Add TEST file 0024.md to global context"
        - button "Hide TEST file 0024.md from agents"
      - listitem:
        - button "TEST file 0025.md": TEST file 0025.md MD · Uploaded
        - button "Add TEST file 0025.md to global context"
        - button "Hide TEST file 0025.md from agents"
      - listitem:
        - button "TEST file 0026.md": TEST file 0026.md MD · Uploaded
        - button "Add TEST file 0026.md to global context"
        - button "Hide TEST file 0026.md from agents"
      - listitem:
        - button "TEST file 0027.md": TEST file 0027.md MD · Uploaded
        - button "Add TEST file 0027.md to global context"
        - button "Hide TEST file 0027.md from agents"
      - listitem:
        - button "TEST file 0028.md": TEST file 0028.md MD · Uploaded
        - button "Add TEST file 0028.md to global context"
        - button "Hide TEST file 0028.md from agents"
      - listitem:
        - button "TEST file 0029.md": TEST file 0029.md MD · Uploaded
        - button "Add TEST file 0029.md to global context"
        - button "Hide TEST file 0029.md from agents"
      - listitem:
        - button "TEST file 0030.md": TEST file 0030.md MD · Uploaded
        - button "Add TEST file 0030.md to global context"
        - button "Hide TEST file 0030.md from agents"
      - listitem:
        - button "TEST file 0031.md": TEST file 0031.md MD · Uploaded
        - button "Add TEST file 0031.md to global context"
        - button "Hide TEST file 0031.md from agents"
      - listitem:
        - button "TEST file 0032.md": TEST file 0032.md MD · Uploaded
        - button "Add TEST file 0032.md to global context"
        - button "Hide TEST file 0032.md from agents"
      - listitem:
        - button "TEST file 0033.md": TEST file 0033.md MD · Uploaded
        - button "Add TEST file 0033.md to global context"
        - button "Hide TEST file 0033.md from agents"
      - listitem:
        - button "TEST file 0034.md": TEST file 0034.md MD · Uploaded
        - button "Add TEST file 0034.md to global context"
        - button "Hide TEST file 0034.md from agents"
      - listitem:
        - button "TEST file 0035.md": TEST file 0035.md MD · Uploaded
        - button "Add TEST file 0035.md to global context"
        - button "Hide TEST file 0035.md from agents"
      - listitem:
        - button "TEST file 0036.md": TEST file 0036.md MD · Uploaded
        - button "Add TEST file 0036.md to global context"
        - button "Hide TEST file 0036.md from agents"
      - listitem:
        - button "TEST file 0037.md": TEST file 0037.md MD · Uploaded
        - button "Add TEST file 0037.md to global context"
        - button "Hide TEST file 0037.md from agents"
      - listitem:
        - button "TEST file 0038.md": TEST file 0038.md MD · Uploaded
        - button "Add TEST file 0038.md to global context"
        - button "Hide TEST file 0038.md from agents"
      - listitem:
        - button "TEST file 0039.md": TEST file 0039.md MD · Uploaded
        - button "Add TEST file 0039.md to global context"
        - button "Hide TEST file 0039.md from agents"
      - listitem:
        - button "TEST file 0040.md": TEST file 0040.md MD · Uploaded
        - button "Add TEST file 0040.md to global context"
        - button "Hide TEST file 0040.md from agents"
      - listitem:
        - button "TEST file 0041.md": TEST file 0041.md MD · Uploaded
        - button "Add TEST file 0041.md to global context"
        - button "Hide TEST file 0041.md from agents"
      - listitem:
        - button "TEST file 0042.md": TEST file 0042.md MD · Uploaded
        - button "Add TEST file 0042.md to global context"
        - button "Hide TEST file 0042.md from agents"
      - listitem:
        - button "TEST file 0043.md": TEST file 0043.md MD · Uploaded
        - button "Add TEST file 0043.md to global context"
        - button "Hide TEST file 0043.md from agents"
      - listitem:
        - button "TEST file 0044.md": TEST file 0044.md MD · Uploaded
        - button "Add TEST file 0044.md to global context"
        - button "Hide TEST file 0044.md from agents"
      - listitem:
        - button "TEST file 0045.md": TEST file 0045.md MD · Uploaded
        - button "Add TEST file 0045.md to global context"
        - button "Hide TEST file 0045.md from agents"
      - listitem:
        - button "TEST file 0046.md": TEST file 0046.md MD · Uploaded
        - button "Add TEST file 0046.md to global context"
        - button "Hide TEST file 0046.md from agents"
      - listitem:
        - button "TEST file 0047.md": TEST file 0047.md MD · Uploaded
        - button "Add TEST file 0047.md to global context"
        - button "Hide TEST file 0047.md from agents"
      - listitem:
        - button "TEST file 0048.md": TEST file 0048.md MD · Uploaded
        - button "Add TEST file 0048.md to global context"
        - button "Hide TEST file 0048.md from agents"
      - listitem:
        - button "TEST file 0049.md": TEST file 0049.md MD · Uploaded
        - button "Add TEST file 0049.md to global context"
        - button "Hide TEST file 0049.md from agents"
    - paragraph: Showing 50 of 2,005 files
    - button "Show more"
  - region "Global context":
    - heading "Global context" [level=2]
    - button "Context history" [disabled]
    - button "Edit global context" [disabled]
    - alert:
      - heading "The server returned an invalid workspace response." [level=3]
      - button "Try again"
- region "Notifications alt+T"
```

# Test source

```ts
  98  |   await expect(dialog).not.toBeVisible()
  99  | })
  100 | 
  101 | test('revamp: karbot deletion uses the shared alert dialog', async ({ page }) => {
  102 |   await page.setViewportSize({ width: 1440, height: 900 })
  103 |   await serveApi(page)
  104 |   await page.goto('/')
  105 |   await page.getByRole('button', { name: 'Ask Karbot' }).click()
  106 |   const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  107 |   await expect(chat).toBeVisible()
  108 |   await chat.getByRole('button', { name: 'Chat sessions' }).click()
  109 |   const sessions = chat.getByRole('menu', { name: 'Chat sessions' })
  110 |   await sessions.getByRole('button', { name: 'Delete Browser chat' }).click()
  111 |   const confirm = page.getByRole('alertdialog', { name: 'Delete "Browser chat"?' })
  112 |   await expect(confirm).toBeVisible()
  113 |   await expect(confirm.getByRole('button', { name: 'Delete conversation' })).toBeVisible()
  114 |   await shot(page, 'revamp-deletion-dialog', [confirm])
  115 |   await page.keyboard.press('Escape')
  116 |   await expect(confirm).not.toBeVisible()
  117 | })
  118 | 
  119 | test('revamp: models selects use the shared selection controls', async ({ page }) => {
  120 |   await page.setViewportSize({ width: 1440, height: 900 })
  121 |   await serveApi(page)
  122 |   await page.goto('/')
  123 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Models' }).click()
  124 |   await expect(page.getByText('Configured', { exact: true })).toBeVisible()
  125 |   const model = page.getByRole('combobox', { name: 'Model' })
  126 |   await expect(model).toBeVisible()
  127 |   await model.click()
  128 |   await expect(page.getByRole('option', { name: 'muse-spark-1.3-contributor' })).toBeVisible()
  129 |   await shot(page, 'revamp-models-select', [page.getByRole('option', { name: 'muse-spark-1.3-contributor' })])
  130 |   await page.keyboard.press('Escape')
  131 |   await expect(model).toBeFocused()
  132 | })
  133 | 
  134 | test('revamp: palette opens from every shell page', async ({ page }) => {
  135 |   await page.setViewportSize({ width: 1440, height: 900 })
  136 |   await serveApi(page)
  137 |   await page.goto('/')
  138 |   await page.keyboard.press('ControlOrMeta+k')
  139 |   await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
  140 |   await page.keyboard.press('Escape')
  141 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  142 |   await page.getByRole('button', { name: /Search\.\.\. Ctrl K/ }).click()
  143 |   await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
  144 | })
  145 | 
  146 | test('revamp: 200% zoom keeps overview, researches, and dialog inside the viewport', async ({ page }) => {
  147 |   // 720 CSS px at 1440 physical ≈ 200% zoom.
  148 |   await page.setViewportSize({ width: 720, height: 900 })
  149 |   await serveApi(page)
  150 |   await page.goto('/')
  151 |   await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  152 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  153 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  154 |   await page.getByRole('button', { name: 'New sector' }).click()
  155 |   await expect(page.getByRole('dialog', { name: 'New sector' })).toBeVisible()
  156 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  157 |   await shot(page, 'revamp-zoom-dialog', [page.getByRole('dialog', { name: 'New sector' })])
  158 | })
  159 | 
  160 | test('revamp: loaded-list filter timing probe', async ({ page }) => {
  161 |   await page.setViewportSize({ width: 1440, height: 900 })
  162 |   const at = '2026-10-01T00:00:00.000Z'
  163 |   const sectorId = 'TEST-timing-sector'
  164 |   const sessionId = 'TEST-timing-research'
  165 |   const session = { id: sessionId, title: 'Research', kind: 'research', sectorId, createdAt: at, updatedAt: at }
  166 |   const sector = { id: sectorId, name: 'TEST Timing', topic: 'TEST', state: 'approved', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: at, updatedAt: at }
  167 |   const files = Array.from({ length: 2005 }, (_, index) => ({
  168 |     id: `TEST-timing-file-${index}`,
  169 |     filename: `TEST file ${String(index).padStart(4, '0')}.md`,
  170 |     status: 'indexed',
  171 |     source: 'Uploaded',
  172 |     hash: `TEST-version-${index}`,
  173 |     hidden: false,
  174 |     included: false,
  175 |     kind: 'document',
  176 |   }))
  177 |   await page.route('**/v1/**', async (route) => {
  178 |     const path = new URL(route.request().url()).pathname
  179 |     let data: unknown = []
  180 |     if (path.endsWith('/files')) data = files
  181 |     else if (path === '/v1/sectors') data = [sector]
  182 |     else if (path === `/v1/sectors/${sectorId}`) data = sector
  183 |     else if (path.endsWith('/research-session')) data = session
  184 |     else if (path === '/v1/sessions') data = [session]
  185 |     else if (path.endsWith('/global-context')) data = { sectorId, version: 1, sections: { scope: 'TEST' }, markdown: '## Scope\n\nTEST', researchSessionId: sessionId, changes: [] }
  186 |     else if (path.endsWith('/plan')) data = { sectorId, versions: [], latest: null, approvals: [], approvedVersion: null }
  187 |     else if (path.endsWith('/progress')) data = { sectorId, state: 'approved', planVersion: 0, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
  188 |     else if (path.endsWith('/threads')) data = [{ key: sessionId, sessionId, kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: at }]
  189 |     else if (path.endsWith('/context')) data = { threadKey: sessionId, notes: '', summary: '', coveredSeq: 0, version: 0 }
  190 |     else if (path.startsWith('/v1/sessions/')) data = session
  191 |     else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [] }
  192 |     await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  193 |   })
  194 |   await page.goto(`/?section=SectorChat&sector=${sectorId}&session=${sessionId}&thread=${sessionId}`)
  195 |   const box = page.getByRole('textbox', { name: 'Search files' })
  196 |   await expect(box).toBeVisible()
  197 |   const t0 = await page.evaluate(() => performance.now())
> 198 |   await expect(page.getByText('Showing 50 of 2005 files')).toBeVisible()
      |                                                            ^ Error: expect(locator).toBeVisible() failed
  199 |   const initialMs = (await page.evaluate(() => performance.now())) - t0
  200 |   const needles = Array.from({ length: 20 }, (_, index) =>
  201 |     index % 4 === 3 ? 'no-match-needle' : `file ${String((index * 97) % 2005).padStart(4, '0')}`,
  202 |   )
  203 |   const samples: number[] = []
  204 |   for (const needle of needles) {
  205 |     const start = await page.evaluate(() => performance.now())
  206 |     await box.fill(needle)
  207 |     await expect(page.getByText(/Showing \d+ of \d+ files/)).toBeVisible()
  208 |     samples.push((await page.evaluate(() => performance.now())) - start)
  209 |   }
  210 |   const sorted = [...samples].sort((a, b) => a - b)
  211 |   const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
  212 |   console.log(`revamp-filter-initial-ms: ${initialMs.toFixed(1)}`)
  213 |   console.log(`revamp-filter-p95-ms: ${p95.toFixed(1)} over ${samples.length} queries`)
  214 |   // Design target is 100ms (held on unloaded runs: 72-96ms); the committed
  215 |   // tripwire absorbs shared-runner harness noise in full-matrix runs.
  216 |   expect(p95).toBeLessThanOrEqual(125)
  217 | })
  218 | 
  219 | test('revamp: no sustained long tasks and bounded overlay memory', async ({ page }) => {
  220 |   await page.setViewportSize({ width: 1440, height: 900 })
  221 |   await page.addInitScript(() => {
  222 |     const store: number[] = []
  223 |     new PerformanceObserver((list) => {
  224 |       for (const entry of list.getEntries()) store.push(entry.duration)
  225 |     }).observe({ entryTypes: ['longtask'] })
  226 |     ;(window as unknown as { __revampLongtasks: number[] }).__revampLongtasks = store
  227 |   })
  228 |   await serveApi(page)
  229 |   await page.goto('/')
  230 |   // Load-time work (module transform, first paint) is not motion: reset the
  231 |   // record so only sustained interaction tasks count below.
  232 |   await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
  233 |   await page.evaluate(() => {
  234 |     ;(window as unknown as { __revampLongtasks: number[] }).__revampLongtasks.length = 0
  235 |   })
  236 |   const heap = () => page.evaluate(() => (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize)
  237 |   // Section transitions plus tab switches with real motion running.
  238 |   for (const section of ['Researches', 'Agents', 'Models', 'Overview']) {
  239 |     await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: section }).click()
  240 |     await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible()
  241 |   }
  242 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  243 |   const before = await heap()
  244 |   // Fifty overlay cycles across two surfaces (creation dialog + Karbot
  245 |   // sessions popover); unmount must release, not accumulate. The final
  246 |   // dialog close also times the real exit: removal must lag the Escape
  247 |   // (the exit plays) without lingering.
  248 |   for (let cycle = 0; cycle < 25; cycle++) {
  249 |     await page.getByRole('button', { name: 'New sector' }).click()
  250 |     await expect(page.getByRole('dialog', { name: 'New sector' })).toBeVisible()
  251 |     await page.keyboard.press('Escape')
  252 |     await expect(page.getByRole('dialog', { name: 'New sector' })).not.toBeVisible()
  253 |   }
  254 |   await page.getByRole('button', { name: 'Ask Karbot' }).click()
  255 |   const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  256 |   await expect(chat).toBeVisible()
  257 |   for (let cycle = 0; cycle < 25; cycle++) {
  258 |     await chat.getByRole('button', { name: 'Chat sessions' }).click()
  259 |     await expect(chat.getByRole('menu', { name: 'Chat sessions' })).toBeVisible()
  260 |     await page.keyboard.press('Escape')
  261 |     await expect(chat.getByRole('menu', { name: 'Chat sessions' })).not.toBeVisible()
  262 |   }
  263 |   await page.keyboard.press('Escape')
  264 |   const after = await heap()
  265 |   const growth = (after - before) / before
  266 |   const longtasks: number[] = await page.evaluate(
  267 |     () => (window as unknown as { __revampLongtasks: number[] }).__revampLongtasks,
  268 |   )
  269 |   const worst = longtasks.length ? Math.max(...longtasks) : 0
  270 |   console.log(`revamp-longtask-max-ms: ${worst.toFixed(1)} over ${longtasks.length} tasks`)
  271 |   console.log(`revamp-heap-growth: ${(growth * 100).toFixed(1)}% over 50 overlay cycles`)
  272 |   expect(worst).toBeLessThanOrEqual(200)
  273 |   expect(growth).toBeLessThanOrEqual(0.2)
  274 | })
  275 | 
  276 | test('revamp: dialog exit plays before unmount', async ({ page }) => {
  277 |   await page.setViewportSize({ width: 1440, height: 900 })
  278 |   await serveApi(page)
  279 |   await page.goto('/')
  280 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  281 |   await page.getByRole('button', { name: 'New sector' }).click()
  282 |   const dialog = page.getByRole('dialog', { name: 'New sector' })
  283 |   await expect(dialog).toBeVisible()
  284 |   const t0 = await page.evaluate(() => performance.now())
  285 |   await page.keyboard.press('Escape')
  286 |   // Detachment, not hiding: Base UI retains the exiting popup through its
  287 |   // ending-style transition, so removal must lag the keypress.
  288 |   await expect
  289 |     .poll(async () => page.getByRole('dialog', { name: 'New sector' }).count(), { timeout: 2000 })
  290 |     .toBe(0)
  291 |   const elapsed = (await page.evaluate(() => performance.now())) - t0
  292 |   console.log(`revamp-dialog-exit-ms: ${elapsed.toFixed(1)}`)
  293 |   expect(elapsed).toBeGreaterThanOrEqual(50)
  294 |   expect(elapsed).toBeLessThanOrEqual(2000)
  295 | })
  296 | 
  297 | for (const dark of [false, true]) {
  298 |   test(`revamp: plan timeline presentation ${dark ? 'dark' : 'light'}`, async ({ page }) => {
```