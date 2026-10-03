# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: revamp-evidence.spec.ts >> revamp: plan timeline presentation dark
- Location: ../tests/frontend-e2e/revamp-evidence.spec.ts:298:3

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
            - generic "TEST Plan foods" [ref=e9]
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
            - generic [ref=e48]: Plan v2 approved
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
              - paragraph [ref=e135]: TEST decisions
            - generic [ref=e136]:
              - paragraph [ref=e137]: Findings
              - paragraph [ref=e138]: Not set yet
            - generic [ref=e139]:
              - paragraph [ref=e140]: Open questions
              - paragraph [ref=e141]: Not set yet
  - region "Notifications alt+T"
```

# Test source

```ts
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
> 348 |     if (dark) await page.getByRole('button', { name: 'Use dark theme' }).click()
      |                                                                          ^ Error: locator.click: Test timeout of 30000ms exceeded.
  349 |     await page.getByRole('tab', { name: 'Plan', exact: true }).click()
  350 |     const region = page.getByRole('region', { name: 'Executable research work' })
  351 |     await expect(region).toBeVisible()
  352 |     await expect(region.getByText('Australian SME manufacturers with cited evidence')).toBeVisible()
  353 |     await expect(region.getByText('Distinct companies with fetched evidence')).toBeVisible()
  354 |     await expect(region.getByText('Discovery only')).toBeVisible()
  355 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  356 |     await page.screenshot({ path: `test-results/visual/revamp-plan-timeline-${dark ? 'dark' : 'light'}.png`, animations: 'disabled' })
  357 |   })
  358 | 
  359 |   test(`revamp: narrative brief timeline ${dark ? 'dark' : 'light'}`, async ({ page }) => {
  360 |     const stamp = '2026-09-30T00:00:00.000Z'
  361 |     const sectorId = 'TEST-narrative-sector'
  362 |     const sessionId = 'TEST-narrative-research'
  363 |     const session = { id: sessionId, title: 'Research', kind: 'research', sectorId, createdAt: stamp, updatedAt: stamp }
  364 |     const sector = { id: sectorId, name: 'TEST Narrative foods', topic: 'Packaged foods', state: 'planned', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: stamp, updatedAt: stamp }
  365 |     const markdown = '## scope\n\nJourney sector, owner-edited.\n\n## direction shards\n\nPayments.\n\n## query shapes\n\nSME payments.\n\n## budgets\n\nLow.\n\n## risks\n\nFew.\n\n## open questions\n\nNone.'
  366 |     const plan = { sectorId, versions: [{ version: 2, markdown, at: stamp }], latest: null as unknown, approvals: [], approvedVersion: null }
  367 |     plan.latest = plan.versions[0]
  368 |     await page.setViewportSize({ width: 1440, height: 960 })
  369 |     await page.route('**/v1/**', async (route) => {
  370 |       const request = route.request()
  371 |       const path = new URL(request.url()).pathname
  372 |       if (request.method() === 'OPTIONS') {
  373 |         await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
  374 |         return
  375 |       }
  376 |       if (path.endsWith('/events')) {
  377 |         await route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': fixture\n\n' })
  378 |         return
  379 |       }
  380 |       let data: unknown = []
  381 |       if (path === '/v1/sectors') data = [sector]
  382 |       else if (path === `/v1/sectors/${sectorId}`) data = sector
  383 |       else if (path.endsWith('/research-session')) data = session
  384 |       else if (path === '/v1/sessions') data = [session]
  385 |       else if (path.includes('/v1/companies')) data = { companies: [], total: 0 }
  386 |       else if (path.endsWith('/global-context')) data = { sectorId, version: 1, sections: { scope: 'TEST scope', decisions: '', findings: '', questions: '' }, markdown: '## Scope\n\nTEST scope', researchSessionId: sessionId, changes: [] }
  387 |       else if (path.endsWith('/plan')) data = plan
  388 |       else if (path.endsWith('/progress')) data = { sectorId, state: 'planned', planVersion: 2, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
  389 |       else if (path.endsWith('/files')) data = []
  390 |       else if (path.endsWith('/threads')) data = [{ key: sessionId, sessionId, kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: stamp }]
  391 |       else if (path.endsWith('/messages')) data = []
  392 |       else if (path.endsWith('/context')) data = { threadKey: sessionId, notes: '', summary: '', coveredSeq: 0, version: 0 }
  393 |       else if (path.endsWith('/steering-receipts')) data = { items: [], nextAfterId: null }
  394 |       else if (path.startsWith('/v1/sessions/')) data = session
  395 |       else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [] }
  396 |       await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  397 |     })
  398 |     await page.goto(`/?section=SectorChat&sector=${sectorId}`)
  399 |     if (dark) await page.getByRole('button', { name: 'Use dark theme' }).click()
  400 |     await page.getByRole('tab', { name: 'Plan', exact: true }).click()
  401 |     const tab = page.getByRole('tabpanel', { name: 'Research plan' })
  402 |     await expect(tab.getByRole('heading', { name: 'direction shards' })).toBeVisible()
  403 |     await expect(tab.getByText('Journey sector, owner-edited.')).toBeVisible()
  404 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  405 |     await page.screenshot({ path: `test-results/visual/revamp-plan-brief-${dark ? 'dark' : 'light'}.png`, animations: 'disabled' })
  406 |   })
  407 | }
  408 | 
  409 | test('revamp: bottom-docked model menu stays inside the viewport', async ({ page }) => {
  410 |   const stamp = '2026-09-30T00:00:00.000Z'
  411 |   const sectorId = 'TEST-menu-sector'
  412 |   const sessionId = 'TEST-menu-research'
  413 |   const session = { id: sessionId, title: 'Research', kind: 'research', sectorId, createdAt: stamp, updatedAt: stamp }
  414 |   const sector = { id: sectorId, name: 'TEST Menu foods', topic: 'Packaged foods', state: 'approved', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: stamp, updatedAt: stamp }
  415 |   await page.setViewportSize({ width: 1440, height: 900 })
  416 |   await page.route('**/v1/**', async (route) => {
  417 |     const path = new URL(route.request().url()).pathname
  418 |     let data: unknown = []
  419 |     if (path === '/v1/sectors') data = [sector]
  420 |     else if (path === `/v1/sectors/${sectorId}`) data = sector
  421 |     else if (path.endsWith('/research-session')) data = session
  422 |     else if (path === '/v1/sessions') data = [session]
  423 |     else if (path.includes('/v1/companies')) data = { companies: [], total: 0 }
  424 |     else if (path.endsWith('/global-context')) data = { sectorId, version: 1, sections: { scope: 'TEST scope', decisions: '', findings: '', questions: '' }, markdown: '## Scope\n\nTEST scope', researchSessionId: sessionId, changes: [] }
  425 |     else if (path.endsWith('/plan')) data = { sectorId, versions: [], latest: null, approvals: [], approvedVersion: null }
  426 |     else if (path.endsWith('/progress')) data = { sectorId, state: 'approved', planVersion: 0, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
  427 |     else if (path.endsWith('/files')) data = []
  428 |     else if (path.endsWith('/threads')) data = [{ key: sessionId, sessionId, kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: stamp }]
  429 |     else if (path.endsWith('/messages')) data = []
  430 |     else if (path.endsWith('/context')) data = { threadKey: sessionId, notes: '', summary: '', coveredSeq: 0, version: 0 }
  431 |     else if (path.endsWith('/steering-receipts')) data = { items: [], nextAfterId: null }
  432 |     else if (path.startsWith('/v1/sessions/')) data = { ...session, model: { provider: 'meta', model: 'muse-spark-1.3-contributor', reasoning: true, effort: 'high' } }
  433 |     else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [{ name: 'meta', hasKey: true, defaultModel: 'muse-spark-1.3-contributor', models: [{ provider: 'meta', model: 'muse-spark-1.3-contributor', displayName: 'muse-spark-1.3-contributor', reasoning: 'native', mode: 'responses', efforts: ['low', 'high'] }] }] }
  434 |     await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  435 |   })
  436 |   await page.goto(`/?section=SectorChat&sector=${sectorId}`)
  437 |   const trigger = page.getByRole('button', { name: 'Choose a model' })
  438 |   await expect(trigger).toBeVisible()
  439 |   await trigger.click()
  440 |   const menu = page.getByRole('menu', { name: 'Models' })
  441 |   await expect(menu).toBeVisible()
  442 |   const box = await menu.boundingBox()
  443 |   expect(box).not.toBeNull()
  444 |   const viewport = page.viewportSize()!
  445 |   expect(box!.y).toBeGreaterThanOrEqual(0)
  446 |   expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
  447 |   expect(box!.x).toBeGreaterThanOrEqual(0)
  448 |   expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
```