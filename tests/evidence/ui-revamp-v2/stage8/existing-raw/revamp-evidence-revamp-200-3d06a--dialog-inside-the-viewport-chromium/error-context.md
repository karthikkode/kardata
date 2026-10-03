# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: revamp-evidence.spec.ts >> revamp: 200% zoom keeps overview, researches, and dialog inside the viewport
- Location: ../tests/frontend-e2e/revamp-evidence.spec.ts:146:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' })

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - complementary [ref=e4]:
      - generic [aria-hidden] [ref=e6]: K
      - navigation "Primary" [ref=e7]:
        - button [ref=e8] [cursor=pointer]
        - button [ref=e15] [cursor=pointer]
        - button [ref=e18] [cursor=pointer]
        - button [ref=e22] [cursor=pointer]
        - button "Emails (coming soon)" [disabled] [ref=e26]
    - generic [ref=e30]:
      - banner [ref=e31]:
        - button "Search" [ref=e32] [cursor=pointer]
        - generic [ref=e33]:
          - button "Ask Karbot" [ref=e34] [cursor=pointer]
          - button "Theme" [ref=e35] [cursor=pointer]
      - main [ref=e36]:
        - generic [ref=e37]:
          - generic [ref=e38]:
            - generic [ref=e39]:
              - heading "Overview" [active] [level=1] [ref=e41]
              - button "New sector" [ref=e43] [cursor=pointer]
            - paragraph [ref=e44]: Research activity across all sectors.
          - generic [ref=e45]:
            - group "Research totals" [ref=e46]:
              - 'button "Sectors: 1, 0 in progress. Show in Researches." [ref=e47] [cursor=pointer]':
                - generic [ref=e48]: Sectors
                - generic [ref=e49]: "1"
                - paragraph [ref=e50]: 0 in progress
              - 'button "Companies found: 0, Across 0 sectors. Show in Researches." [ref=e51] [cursor=pointer]':
                - generic [ref=e52]: Companies found
                - generic [ref=e53]: "0"
                - paragraph [ref=e54]: Across 0 sectors
              - 'button "Needs attention: 0, Failed or blocked research. Show in Researches." [ref=e55] [cursor=pointer]':
                - generic [ref=e56]: Needs attention
                - generic [ref=e57]: "0"
                - paragraph [ref=e58]: Failed or blocked research
              - 'button "Awaiting approval: 0, Plans waiting for review. Show in Researches." [ref=e59] [cursor=pointer]':
                - generic [ref=e60]: Awaiting approval
                - generic [ref=e61]: "0"
                - paragraph [ref=e62]: Plans waiting for review
            - region "Recent sectors" [ref=e63]:
              - generic [ref=e64]:
                - heading "Recent sectors" [level=2] [ref=e65]
                - button "View all" [ref=e66] [cursor=pointer]
              - separator [ref=e67]
              - list "Recent sectors" [ref=e69]:
                - listitem [ref=e70]:
                  - button "Speciality Foods Ready meals Draft 0 companies 6d ago" [ref=e71] [cursor=pointer]:
                    - generic [ref=e72]:
                      - generic "Speciality Foods" [ref=e73]
                      - generic "Ready meals" [ref=e74]
                    - generic [ref=e75]:
                      - generic [ref=e76]: Draft
                      - generic [ref=e78]: 0 companies
                      - generic "27 Sep 2026, 06:30" [ref=e79]: 6d ago
            - region "Recent companies" [ref=e82]:
              - generic [ref=e83]:
                - heading "Recent companies" [level=2] [ref=e84]
                - button "View all" [ref=e85] [cursor=pointer]
              - separator [ref=e86]
              - generic [ref=e88]:
                - heading "No companies yet" [level=3] [ref=e94]
                - paragraph [ref=e95]: Create a sector to start discovering companies.
                - button "New sector" [ref=e97] [cursor=pointer]
  - region "Notifications alt+T"
```

# Test source

```ts
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
> 153 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
      |                                                                                                       ^ Error: locator.click: Test timeout of 30000ms exceeded.
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
```