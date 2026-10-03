# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: revamp-evidence.spec.ts >> revamp: bottom-docked model menu stays inside the viewport
- Location: ../tests/frontend-e2e/revamp-evidence.spec.ts:409:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('menu', { name: 'Models' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('menu', { name: 'Models' }) with timeout 5000ms
  - waiting for getByRole('menu', { name: 'Models' })

```

```yaml
- complementary "Sector sessions":
  - button "Back to sector summary"
  - text: TEST Menu foods Approved 0 companies
  - tablist "Session types":
    - tab "Research" [selected]
    - tab "Chats ( 0 )"
  - list "Research sessions":
    - listitem:
      - button "Open Research": Research Approved
  - button "Theme"
- main:
  - heading "Research" [level=1]
  - text: Approved No plan yet
  - button "Start research"
  - button "Hide files and context"
  - button "Conversation options"
  - tablist "Research views":
    - tab "Chat" [selected]
    - tab "Plan"
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
    - text: Message this conversation Message this conversation
    - textbox "Message this conversation":
      - /placeholder: Ask about this research...
    - button "Local context"
    - button "Choose a model" [expanded]: muse-spark-1.3-contributor high
    - menu "Choose a model":
      - textbox "Search models"
      - group "Meta":
        - menuitem "muse-spark-1.3-contributor high"
    - button "Send message" [disabled]
- complementary "Sector resources":
  - region "Sector files":
    - heading "Files" [level=2]
    - text: 0 files
    - button "Upload file"
    - button "Show hidden files"
    - textbox "Search files"
    - paragraph: Upload PDFs, documents or data, or ask an agent to create a file.
    - button "Upload file"
    - paragraph: Showing 0 of 0 files
  - region "Global context":
    - heading "Global context" [level=2]
    - text: v1
    - button "Context history"
    - button "Edit global context"
    - paragraph: Scope
    - paragraph: TEST scope
    - paragraph: Decisions
    - paragraph: Not set yet
    - paragraph: Findings
    - paragraph: Not set yet
    - paragraph: Open questions
    - paragraph: Not set yet
- region "Notifications alt+T"
```

# Test source

```ts
  341 |       else if (path.endsWith('/context')) data = { threadKey: sessionId, notes: '', summary: '', coveredSeq: 0, version: 0 }
  342 |       else if (path.endsWith('/steering-receipts')) data = { items: [], nextAfterId: null }
  343 |       else if (path.startsWith('/v1/sessions/')) data = session
  344 |       else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [] }
  345 |       await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  346 |     })
  347 |     await page.goto(`/?section=SectorChat&sector=${sectorId}`)
  348 |     if (dark) await page.getByRole('button', { name: 'Use dark theme' }).click()
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
> 441 |   await expect(menu).toBeVisible()
      |                      ^ Error: expect(locator).toBeVisible() failed
  442 |   const box = await menu.boundingBox()
  443 |   expect(box).not.toBeNull()
  444 |   const viewport = page.viewportSize()!
  445 |   expect(box!.y).toBeGreaterThanOrEqual(0)
  446 |   expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
  447 |   expect(box!.x).toBeGreaterThanOrEqual(0)
  448 |   expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
  449 |   await page.keyboard.press('Escape')
  450 |   await expect(trigger).toBeFocused()
  451 | })
  452 | 
```