# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: revamp-evidence.spec.ts >> revamp: no sustained long tasks and bounded overlay memory
- Location: ../tests/frontend-e2e/revamp-evidence.spec.ts:219:1

# Error details

```
Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'New sector' }) resolved to 2 elements:
    1) <button tabindex="0" type="button" data-slot="button" class="group/button inline-flex shrink-0 cursor-pointer items-center justify-center font-medium whitespace-nowrap outline-none select-none transition-all duration-120 ease-out-soft active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 bg-primary text-p…>…</button> aka getByRole('button', { name: 'New sector' }).first()
    2) <button tabindex="0" type="button" data-slot="button" class="group/button inline-flex shrink-0 cursor-pointer items-center justify-center font-medium whitespace-nowrap outline-none select-none transition-all duration-120 ease-out-soft active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 bg-primary text-p…>…</button> aka getByRole('region', { name: 'Recent companies' }).getByRole('button', { name: 'New sector' })

Call log:
  - waiting for getByRole('button', { name: 'New sector' })

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - complementary [ref=e4]:
      - generic [ref=e5]:
        - generic [aria-hidden] [ref=e6]: K
        - generic [ref=e7]: Kardata
      - navigation "Primary" [ref=e8]:
        - button "Overview" [ref=e9] [cursor=pointer]
        - button "Researches" [ref=e16] [cursor=pointer]
        - button "Agents" [ref=e21] [cursor=pointer]
        - button "Models" [ref=e26] [cursor=pointer]
        - button "Emails (coming soon)" [disabled] [ref=e31]:
          - generic [ref=e35]: Emails
          - generic [ref=e36]: Soon
      - button "Collapse sidebar" [expanded] [ref=e38] [cursor=pointer]
    - generic [ref=e39]:
      - banner [ref=e40]:
        - button "Search... Ctrl K" [ref=e41] [cursor=pointer]:
          - generic [ref=e42]: Search...
          - generic [ref=e43]: Ctrl K
        - generic [ref=e44]:
          - button "Ask Karbot" [ref=e45] [cursor=pointer]
          - button "Theme" [ref=e46] [cursor=pointer]
      - main [ref=e47]:
        - generic [ref=e48]:
          - generic [ref=e49]:
            - generic [ref=e50]:
              - heading "Researches" [active] [level=1] [ref=e52]
              - button "New sector" [ref=e54] [cursor=pointer]
            - paragraph [ref=e55]: Sectors you research and the companies they discover.
          - generic [ref=e56]:
            - tablist "Research type" [ref=e57]:
              - tab "Sectors 1" [selected] [ref=e58] [cursor=pointer]
              - tab "Companies 0" [ref=e60] [cursor=pointer]
            - generic [ref=e61]:
              - textbox "Search sectors" [ref=e63]
              - generic [ref=e64]:
                - 'combobox "Status: All" [ref=e65] [cursor=pointer]'
                - textbox [aria-hidden] [ref=e71]: all
              - paragraph [ref=e73]: 1 sector
            - tabpanel "Sectors 1" [ref=e74]:
              - table "Sectors" [ref=e77]:
                - rowgroup [ref=e78]:
                  - row [ref=e79]:
                    - columnheader [ref=e80]:
                      - button "Sort by Sector" [ref=e81] [cursor=pointer]: Sector
                    - columnheader [ref=e85]:
                      - button "Sort by Status" [ref=e86] [cursor=pointer]: Status
                    - columnheader [ref=e90]:
                      - button "Sort by Companies" [ref=e91] [cursor=pointer]: Companies
                    - columnheader [ref=e95]:
                      - button "Sort by Updated" [ref=e96] [cursor=pointer]: Updated
                    - columnheader "Open" [ref=e100]
                - rowgroup [ref=e102]:
                  - link [ref=e103] [cursor=pointer]:
                    - cell "Speciality Foods Ready meals" [ref=e104]:
                      - generic [ref=e105]:
                        - generic "Speciality Foods" [ref=e106]
                        - generic "Ready meals" [ref=e107]
                    - cell "Draft" [ref=e108]
                    - cell "0" [ref=e111]
                    - cell "6d ago" [ref=e112]
                    - cell [ref=e113]
  - region "Notifications alt+T"
```

# Test source

```ts
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
  240 |     await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible()
  241 |   }
  242 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  243 |   const before = await heap()
  244 |   // Fifty overlay cycles across two surfaces (creation dialog + Karbot
  245 |   // sessions popover); unmount must release, not accumulate. The final
  246 |   // dialog close also times the real exit: removal must lag the Escape
  247 |   // (the exit plays) without lingering.
  248 |   for (let cycle = 0; cycle < 25; cycle++) {
> 249 |     await page.getByRole('button', { name: 'New sector' }).click()
      |                                                            ^ Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'New sector' }) resolved to 2 elements:
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
  299 |     const stamp = '2026-09-30T00:00:00.000Z'
  300 |     const sectorId = 'TEST-plan-sector'
  301 |     const sessionId = 'TEST-plan-research'
  302 |     const session = { id: sessionId, title: 'Research', kind: 'research', sectorId, createdAt: stamp, updatedAt: stamp }
  303 |     const sector = { id: sectorId, name: 'TEST Plan foods', topic: 'Packaged foods', state: 'approved', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: stamp, updatedAt: stamp }
  304 |     const executable = {
  305 |       researchDepth: 'discovery',
  306 |       discoveryTarget: 500,
  307 |       discovery: [
  308 |         { id: 'au', title: 'Australian discovery', queries: ['Australian SME manufacturers with cited evidence', 'Australian wholesalers and fabrication capacity'], maxPages: 2 },
  309 |         { id: 'eu', title: 'European discovery', queries: ['European specialty food manufacturers'], maxPages: 3 },
  310 |       ],
  311 |       companyBrief: 'Verify company identity and sources. Keep uncertain claims explicit.',
  312 |       budgets: { maxCompanies: 2000, maxWallMinutes: 60, concurrency: 2 },
  313 |       acceptance: ['Distinct companies with fetched evidence', 'Every verdict cites its source'],
  314 |     }
  315 |     const plan = { sectorId, versions: [{ version: 2, markdown: '## Scope\nFind specialty food companies.', at: stamp, executable }], latest: null as unknown, approvals: [2], approvedVersion: 2 }
  316 |     plan.latest = plan.versions[0]
  317 |     await page.setViewportSize({ width: 1440, height: 960 })
  318 |     await page.route('**/v1/**', async (route) => {
  319 |       const request = route.request()
  320 |       const path = new URL(request.url()).pathname
  321 |       if (request.method() === 'OPTIONS') {
  322 |         await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
  323 |         return
  324 |       }
  325 |       if (path.endsWith('/events')) {
  326 |         await route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': fixture\n\n' })
  327 |         return
  328 |       }
  329 |       let data: unknown = []
  330 |       if (path === '/v1/sectors') data = [sector]
  331 |       else if (path === `/v1/sectors/${sectorId}`) data = sector
  332 |       else if (path.endsWith('/research-session')) data = session
  333 |       else if (path === '/v1/sessions') data = [session]
  334 |       else if (path.includes('/v1/companies')) data = { companies: [], total: 0 }
  335 |       else if (path.endsWith('/global-context')) data = { sectorId, version: 1, sections: { scope: 'TEST scope', decisions: 'TEST decisions', findings: '', questions: '' }, markdown: '## Scope\n\nTEST scope', researchSessionId: sessionId, changes: [] }
  336 |       else if (path.endsWith('/plan')) data = plan
  337 |       else if (path.endsWith('/progress')) data = { sectorId, state: 'approved', planVersion: 2, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
  338 |       else if (path.endsWith('/files')) data = []
  339 |       else if (path.endsWith('/threads')) data = [{ key: sessionId, sessionId, kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: stamp }]
  340 |       else if (path.endsWith('/messages')) data = []
  341 |       else if (path.endsWith('/context')) data = { threadKey: sessionId, notes: '', summary: '', coveredSeq: 0, version: 0 }
  342 |       else if (path.endsWith('/steering-receipts')) data = { items: [], nextAfterId: null }
  343 |       else if (path.startsWith('/v1/sessions/')) data = session
  344 |       else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [] }
  345 |       await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  346 |     })
  347 |     await page.goto(`/?section=SectorChat&sector=${sectorId}`)
  348 |     if (dark) await page.getByRole('button', { name: 'Use dark theme' }).click()
  349 |     await page.getByRole('tab', { name: 'Plan', exact: true }).click()
```