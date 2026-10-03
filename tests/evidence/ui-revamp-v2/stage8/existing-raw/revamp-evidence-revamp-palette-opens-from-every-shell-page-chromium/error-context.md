# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: revamp-evidence.spec.ts >> revamp: palette opens from every shell page
- Location: ../tests/frontend-e2e/revamp-evidence.spec.ts:134:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('dialog', { name: 'Command palette' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('dialog', { name: 'Command palette' }) with timeout 5000ms
  - waiting for getByRole('dialog', { name: 'Command palette' })

```

```yaml
- complementary:
  - text: Kardata
  - navigation "Primary":
    - button "Overview"
    - button "Researches"
    - button "Agents"
    - button "Models"
    - button "Emails (coming soon)" [disabled]: Emails Soon
  - button "Collapse sidebar" [expanded]
- banner:
  - button "Search... Ctrl K"
  - button "Ask Karbot"
  - button "Theme"
- main:
  - heading "Overview" [level=1]
  - button "New sector"
  - paragraph: Research activity across all sectors.
  - group "Research totals":
    - 'button "Sectors: 1, 0 in progress. Show in Researches."':
      - text: Sectors 1
      - paragraph: 0 in progress
    - 'button "Companies found: 0, Across 0 sectors. Show in Researches."':
      - text: Companies found 0
      - paragraph: Across 0 sectors
    - 'button "Needs attention: 0, Failed or blocked research. Show in Researches."':
      - text: Needs attention 0
      - paragraph: Failed or blocked research
    - 'button "Awaiting approval: 0, Plans waiting for review. Show in Researches."':
      - text: Awaiting approval 0
      - paragraph: Plans waiting for review
  - region "Recent sectors":
    - heading "Recent sectors" [level=2]
    - button "View all"
    - separator
    - list "Recent sectors":
      - listitem:
        - button "Speciality Foods Ready meals Draft 0 companies 6d ago"
  - region "Recent companies":
    - heading "Recent companies" [level=2]
    - button "View all"
    - separator
    - heading "No companies yet" [level=3]
    - paragraph: Create a sector to start discovering companies.
    - button "New sector"
- region "Notifications alt+T"
```

# Test source

```ts
  39  |       data = [{ key: 's-1', sessionId: 's-1', kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: SECTOR.updatedAt }]
  40  |     } else if (url.includes('/v1/providers')) {
  41  |       data = {
  42  |         defaultProvider: 'meta',
  43  |         providers: [{ name: 'meta', hasKey: true, defaultModel: 'muse-spark-1.3-contributor', models: [
  44  |           { provider: 'meta', model: 'muse-spark-1.3-contributor', displayName: 'muse-spark-1.3-contributor', reasoning: 'native', mode: 'responses', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
  45  |         ] }],
  46  |       }
  47  |     }
  48  |     await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  49  |   })
  50  | }
  51  | 
  52  | async function shot(page: Page, name: string, anchors: Locator[]): Promise<void> {
  53  |   for (const anchor of anchors) await expect(anchor).toBeVisible()
  54  |   await page.screenshot({ path: `test-results/visual/${name}.png`, animations: 'disabled' })
  55  | }
  56  | 
  57  | for (const dark of [false, true]) {
  58  |   test(`revamp: researches tabs, select, and creation dialog ${dark ? 'dark' : 'light'}`, async ({ page }) => {
  59  |     await page.setViewportSize({ width: 1440, height: 900 })
  60  |     await serveApi(page)
  61  |     await page.goto('/')
  62  |     if (dark) {
  63  |       await page.getByRole('button', { name: 'Theme' }).click()
  64  |       await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  65  |     }
  66  |     await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  67  |     // Controlled tabs with keyboard behavior and a labeled state selection.
  68  |     await expect(page.getByRole('tab', { name: 'Sectors 1' })).toHaveAttribute('aria-selected', 'true')
  69  |     await page.getByRole('tab', { name: 'Companies 0' }).click()
  70  |     await expect(page.getByRole('tab', { name: 'Companies 0' })).toHaveAttribute('aria-selected', 'true')
  71  |     await page.getByRole('tab', { name: 'Sectors 1' }).click()
  72  |     await expect(page.getByRole('combobox', { name: 'Status: All' })).toBeVisible()
  73  |     // Creation dialog: title, labeled fields, sticky footer, Escape return.
  74  |     await page.getByRole('button', { name: 'New sector' }).click()
  75  |     const dialog = page.getByRole('dialog', { name: 'New sector' })
  76  |     await expect(dialog.getByLabel('Name')).toBeVisible()
  77  |     await expect(dialog.getByLabel('Topic (optional)')).toBeVisible()
  78  |     await expect(dialog.getByRole('button', { name: 'Create sector' })).toBeVisible()
  79  |     await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
  80  |     await shot(page, `revamp-researches-dialog-${dark ? 'dark' : 'light'}`, [dialog.getByLabel('Name')])
  81  |     await page.keyboard.press('Escape')
  82  |     await expect(dialog).not.toBeVisible()
  83  |     await expect(page.getByRole('button', { name: 'New sector' })).toBeFocused()
  84  |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  85  |   })
  86  | }
  87  | 
  88  | test('revamp: overlay exits are armed with ending-style transitions', async ({ page }) => {
  89  |   await page.setViewportSize({ width: 1440, height: 900 })
  90  |   await serveApi(page)
  91  |   await page.goto('/')
  92  |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  93  |   await page.getByRole('button', { name: 'New sector' }).click()
  94  |   const dialog = page.getByRole('dialog', { name: 'New sector' })
  95  |   await expect(dialog).toBeVisible()
  96  |   expect(await dialog.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe('0.18s')
  97  |   await page.keyboard.press('Escape')
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
> 139 |   await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
      |                                                                       ^ Error: expect(locator).toBeVisible() failed
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
  198 |   await expect(page.getByText('Showing 50 of 2005 files')).toBeVisible()
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
```