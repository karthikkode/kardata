# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scrollbars.spec.ts >> scrollbars: model menu list scrolls without detaching
- Location: ../tests/frontend-e2e/scrollbars.spec.ts:173:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('complementary', { name: 'Assistant chat' }).getByRole('menu', { name: 'Models' }).getByText('scroll-model-20')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('complementary', { name: 'Assistant chat' }).getByRole('menu', { name: 'Models' }).getByText('scroll-model-20') with timeout 5000ms
  - waiting for getByRole('complementary', { name: 'Assistant chat' }).getByRole('menu', { name: 'Models' }).getByText('scroll-model-20')

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
  - button "Ask Karbot" [expanded]
  - button "Theme"
- complementary "Assistant chat":
  - button "Chat sessions": Scrollbar chat
  - button "New chat"
  - button "Session files"
  - button "More actions"
  - button "Close"
  - log "Chat messages":
    - text: Scroll probe message 1 with enough text to fill the chat list.
    - paragraph: "Reply 2: acknowledged with enough text to keep the list overflowing."
    - button "Copy"
    - text: Scroll probe message 3 with enough text to fill the chat list.
    - paragraph: "Reply 4: acknowledged with enough text to keep the list overflowing."
    - button "Copy"
    - text: Scroll probe message 5 with enough text to fill the chat list.
    - paragraph: "Reply 6: acknowledged with enough text to keep the list overflowing."
    - button "Copy"
    - text: Scroll probe message 7 with enough text to fill the chat list.
    - paragraph: "Reply 8: acknowledged with enough text to keep the list overflowing."
    - button "Copy"
    - text: Scroll probe message 9 with enough text to fill the chat list.
    - paragraph: "Reply 10: acknowledged with enough text to keep the list overflowing."
    - button "Copy"
    - text: Scroll probe message 11 with enough text to fill the chat list.
    - paragraph: "Reply 12: acknowledged with enough text to keep the list overflowing."
    - button "Copy"
    - text: Scroll probe message 13 with enough text to fill the chat list.
    - paragraph: "Reply 14: acknowledged with enough text to keep the list overflowing."
    - button "Copy"
    - text: Scroll probe message 15 with enough text to fill the chat list.
    - paragraph: "Reply 16: acknowledged with enough text to keep the list overflowing."
    - button "Copy"
    - text: Scroll probe message 17 with enough text to fill the chat list.
    - paragraph: "Reply 18: acknowledged with enough text to keep the list overflowing."
    - button "Copy"
    - text: Show the wide table.
    - paragraph: "Scrollbar check with a wide table and code:"
    - table:
      - rowgroup:
        - row "filename status id":
          - columnheader "filename"
          - columnheader "status"
          - columnheader "id"
      - rowgroup:
        - row "overflow-doc-1.md indexed sdoc-aaaa1111-2222-3333-4444-000000000000":
          - cell "overflow-doc-1.md"
          - cell "indexed"
          - cell "sdoc-aaaa1111-2222-3333-4444-000000000000"
        - row "overflow-doc-2.md indexed sdoc-aaaa1111-2222-3333-4444-000000000001":
          - cell "overflow-doc-2.md"
          - cell "indexed"
          - cell "sdoc-aaaa1111-2222-3333-4444-000000000001"
        - row "overflow-doc-3.md indexed sdoc-aaaa1111-2222-3333-4444-000000000002":
          - cell "overflow-doc-3.md"
          - cell "indexed"
          - cell "sdoc-aaaa1111-2222-3333-4444-000000000002"
        - row "overflow-doc-4.md indexed sdoc-aaaa1111-2222-3333-4444-000000000003":
          - cell "overflow-doc-4.md"
          - cell "indexed"
          - cell "sdoc-aaaa1111-2222-3333-4444-000000000003"
        - row "overflow-doc-5.md indexed sdoc-aaaa1111-2222-3333-4444-000000000004":
          - cell "overflow-doc-5.md"
          - cell "indexed"
          - cell "sdoc-aaaa1111-2222-3333-4444-000000000004"
        - row "overflow-doc-6.md indexed sdoc-aaaa1111-2222-3333-4444-000000000005":
          - cell "overflow-doc-6.md"
          - cell "indexed"
          - cell "sdoc-aaaa1111-2222-3333-4444-000000000005"
        - row "overflow-doc-7.md indexed sdoc-aaaa1111-2222-3333-4444-000000000006":
          - cell "overflow-doc-7.md"
          - cell "indexed"
          - cell "sdoc-aaaa1111-2222-3333-4444-000000000006"
        - row "overflow-doc-8.md indexed sdoc-aaaa1111-2222-3333-4444-000000000007":
          - cell "overflow-doc-8.md"
          - cell "indexed"
          - cell "sdoc-aaaa1111-2222-3333-4444-000000000007"
    - code: code line 1 with a long token abcdef1234567890abcdef1234567890 code line 2 with a long token abcdef1234567890abcdef1234567890 code line 3 with a long token abcdef1234567890abcdef1234567890 code line 4 with a long token abcdef1234567890abcdef1234567890 code line 5 with a long token abcdef1234567890abcdef1234567890 code line 6 with a long token abcdef1234567890abcdef1234567890 code line 7 with a long token abcdef1234567890abcdef1234567890 code line 8 with a long token abcdef1234567890abcdef1234567890 code line 9 with a long token abcdef1234567890abcdef1234567890 code line 10 with a long token abcdef1234567890abcdef1234567890 code line 11 with a long token abcdef1234567890abcdef1234567890 code line 12 with a long token abcdef1234567890abcdef1234567890
    - button "Copy code"
    - button "Copy"
  - text: Message the agent Message the agent
  - textbox "Message the agent":
    - /placeholder: Ask Karbot...
  - button "Attach file"
  - button "Toggle plan mode": Plan
  - button "Choose a model" [expanded]: Model high
  - menu "Choose a model":
    - textbox "Search models"
    - group "Meta":
      - menuitem "scroll-model-1 high"
      - menuitem "scroll-model-2 Thinking"
      - menuitem "scroll-model-3 Thinking"
      - menuitem "scroll-model-4 Thinking"
      - menuitem "scroll-model-5 Thinking"
      - menuitem "scroll-model-6 Thinking"
      - menuitem "scroll-model-7 Thinking"
      - menuitem "scroll-model-8 Thinking"
      - menuitem "scroll-model-9 Thinking"
      - menuitem "scroll-model-10 Thinking"
      - menuitem "scroll-model-11 Thinking"
      - menuitem "scroll-model-12 Thinking"
      - menuitem "scroll-model-13 Thinking"
      - menuitem "scroll-model-14 Thinking"
      - menuitem "scroll-model-15 Thinking"
      - menuitem "scroll-model-16 Thinking"
      - menuitem "scroll-model-17 Thinking"
      - menuitem "scroll-model-18 Thinking"
      - menuitem "scroll-model-19 Thinking"
      - menuitem "scroll-model-20 Thinking"
  - button "Send message" [disabled]
- main:
  - heading "Overview" [level=1]
  - button "New sector"
  - paragraph: Research activity across all sectors.
  - group "Research totals":
    - 'button "Sectors: 60, 0 in progress. Show in Researches."':
      - text: Sectors 60
      - paragraph: 0 in progress
    - 'button "Companies found: 30, Across 1 sector. Show in Researches."':
      - text: Companies found 30
      - paragraph: Across 1 sector
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
        - button "Overflow sector 1 Bulk rows for scrollbar overflow Queued 0 companies 6d ago"
      - listitem:
        - button "Overflow sector 2 Bulk rows for scrollbar overflow Queued 0 companies 6d ago"
      - listitem:
        - button "Overflow sector 3 Bulk rows for scrollbar overflow Queued 0 companies 6d ago"
      - listitem:
        - button "Overflow sector 4 Bulk rows for scrollbar overflow Queued 0 companies 6d ago"
      - listitem:
        - button "Overflow sector 5 Bulk rows for scrollbar overflow Queued 0 companies 6d ago"
      - listitem:
        - button "Overflow sector 6 Bulk rows for scrollbar overflow Queued 0 companies 6d ago"
  - region "Recent companies":
    - heading "Recent companies" [level=2]
    - button "View all"
    - separator
    - list "Recent companies":
      - listitem:
        - 'button "Overflow company 1 Overflow sector 1 Discovery Stage: Discovery Queued"':
          - text: Overflow company 1 Overflow sector 1 Discovery
          - 'list "Stage: Discovery"':
            - 'listitem "Stage 1 of 4: Screening"'
            - 'listitem "Stage 2 of 4: Deep research"'
            - 'listitem "Stage 3 of 4: Problem found"'
            - 'listitem "Stage 4 of 4: Final validation"'
          - text: Queued
      - listitem:
        - 'button "Overflow company 2 Overflow sector 1 Discovery Stage: Discovery Queued"':
          - text: Overflow company 2 Overflow sector 1 Discovery
          - 'list "Stage: Discovery"':
            - 'listitem "Stage 1 of 4: Screening"'
            - 'listitem "Stage 2 of 4: Deep research"'
            - 'listitem "Stage 3 of 4: Problem found"'
            - 'listitem "Stage 4 of 4: Final validation"'
          - text: Queued
      - listitem:
        - 'button "Overflow company 3 Overflow sector 1 Discovery Stage: Discovery Queued"':
          - text: Overflow company 3 Overflow sector 1 Discovery
          - 'list "Stage: Discovery"':
            - 'listitem "Stage 1 of 4: Screening"'
            - 'listitem "Stage 2 of 4: Deep research"'
            - 'listitem "Stage 3 of 4: Problem found"'
            - 'listitem "Stage 4 of 4: Final validation"'
          - text: Queued
      - listitem:
        - 'button "Overflow company 4 Overflow sector 1 Discovery Stage: Discovery Queued"':
          - text: Overflow company 4 Overflow sector 1 Discovery
          - 'list "Stage: Discovery"':
            - 'listitem "Stage 1 of 4: Screening"'
            - 'listitem "Stage 2 of 4: Deep research"'
            - 'listitem "Stage 3 of 4: Problem found"'
            - 'listitem "Stage 4 of 4: Final validation"'
          - text: Queued
      - listitem:
        - 'button "Overflow company 5 Overflow sector 1 Discovery Stage: Discovery Queued"':
          - text: Overflow company 5 Overflow sector 1 Discovery
          - 'list "Stage: Discovery"':
            - 'listitem "Stage 1 of 4: Screening"'
            - 'listitem "Stage 2 of 4: Deep research"'
            - 'listitem "Stage 3 of 4: Problem found"'
            - 'listitem "Stage 4 of 4: Final validation"'
          - text: Queued
      - listitem:
        - 'button "Overflow company 6 Overflow sector 1 Discovery Stage: Discovery Queued"':
          - text: Overflow company 6 Overflow sector 1 Discovery
          - 'list "Stage: Discovery"':
            - 'listitem "Stage 1 of 4: Screening"'
            - 'listitem "Stage 2 of 4: Deep research"'
            - 'listitem "Stage 3 of 4: Problem found"'
            - 'listitem "Stage 4 of 4: Final validation"'
          - text: Queued
- region "Notifications alt+T"
```

# Test source

```ts
  81  |   '```text',
  82  |   ...Array.from({ length: 12 }, (_, i) => `code line ${i + 1} with a long token abcdef1234567890abcdef1234567890`),
  83  |   '```',
  84  | ].join('\n')
  85  | 
  86  | const MESSAGES = [
  87  |   ...Array.from({ length: 18 }, (_, i) => (
  88  |     i % 2 === 0
  89  |       ? { seq: i + 1, kind: 'text', role: 'user', text: `Scroll probe message ${i + 1} with enough text to fill the chat list.` }
  90  |       : { seq: i + 1, kind: 'text', role: 'agent', text: `Reply ${i + 1}: acknowledged with enough text to keep the list overflowing.` }
  91  |   )),
  92  |   { seq: 19, kind: 'text', role: 'user', text: 'Show the wide table.' },
  93  |   { seq: 20, kind: 'text', role: 'agent', text: TABLE_REPLY },
  94  | ]
  95  | 
  96  | const MODELS = Array.from({ length: 20 }, (_, i) => ({
  97  |   provider: 'meta',
  98  |   model: `scroll-model-${i + 1}`,
  99  |   displayName: `scroll-model-${i + 1}`,
  100 |   reasoning: 'native',
  101 |   mode: 'responses',
  102 |   efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
  103 | }))
  104 | 
  105 | const session = { id: 's-1', title: 'Scrollbar chat', createdAt: AT, updatedAt: AT }
  106 | 
  107 | async function serveScrollbarApi(page: Page): Promise<void> {
  108 |   await page.route('**/v1/**', async (route) => {
  109 |     const url = route.request().url()
  110 |     const method = route.request().method()
  111 |     if (url.includes('/events?')) {
  112 |       await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
  113 |       return
  114 |     }
  115 |     let data: unknown = []
  116 |     if (url.endsWith('/v1/sectors') && method === 'GET') data = SECTORS
  117 |     else if (url.endsWith('/v1/sectors/sec-overflow-1')) data = DETAIL
  118 |     else if (url.includes('/v1/companies')) data = { companies: COMPANIES, total: COMPANIES.length }
  119 |     else if (url.includes('/v1/sectors/sec-overflow-1/documents')) data = DOCUMENTS
  120 |     else if (url.includes('/v1/sectors/sec-overflow-1/context')) data = CONTEXT
  121 |     else if (url.includes('/v1/runs')) data = []
  122 |     else if (url.endsWith('/v1/sessions')) data = [session]
  123 |     else if (url.endsWith('/v1/sessions/s-1')) data = session
  124 |     else if (url.endsWith('/v1/sessions/s-1/threads')) {
  125 |       data = [{ key: 's-1', sessionId: 's-1', kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: AT }]
  126 |     } else if (url.includes('/v1/threads/s-1/messages') && method === 'GET') data = MESSAGES
  127 |     else if (url.includes('/v1/providers')) {
  128 |       data = { defaultProvider: 'meta', providers: [{ name: 'meta', hasKey: true, defaultModel: 'scroll-model-1', models: MODELS }] }
  129 |     }
  130 |     await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  131 |   })
  132 | }
  133 | 
  134 | async function shot(page: Page, name: string, anchors: Locator[]): Promise<void> {
  135 |   for (const anchor of anchors) await expect(anchor).toBeVisible()
  136 |   await page.screenshot({ path: `test-results/visual/${name}.png`, animations: 'disabled' })
  137 | }
  138 | 
  139 | async function thinScrollbar(page: Page, locator: Locator): Promise<void> {
  140 |   await expect(locator).toHaveClass(/scroll-slim/)
  141 |   const width = await locator.evaluate((el) => getComputedStyle(el).scrollbarWidth)
  142 |   expect(width).toBe('thin')
  143 | }
  144 | 
  145 | test('scrollbars: researches pages without an inner scroll box', async ({ page }) => {
  146 |   await page.setViewportSize({ width: 1440, height: 900 })
  147 |   await serveScrollbarApi(page)
  148 |   await page.goto('/')
  149 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  150 |   await expect(page.getByText('Showing 50 of 60')).toBeVisible()
  151 |   // No inner scroll container: the page scrolls and Show more extends it.
  152 |   await expect(page.getByRole('table', { name: 'Sectors' }).locator('.scroll-slim')).toHaveCount(0)
  153 |   await page.getByRole('button', { name: 'Show more' }).click()
  154 |   await expect(page.getByText('Overflow sector 1')).toBeVisible()
  155 |   await shot(page, 'scroll-researches', [page.getByText('Showing 60 of 60')])
  156 | })
  157 | 
  158 | test('scrollbars: chat list plus table and code scroll in place', async ({ page }) => {
  159 |   await page.setViewportSize({ width: 1440, height: 900 })
  160 |   await serveScrollbarApi(page)
  161 |   await page.goto('/')
  162 |   await page.getByRole('button', { name: 'Ask Karbot' }).click()
  163 |   const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  164 |   await expect(chat.getByText('Scroll probe message 1 with enough text to fill the chat list.', { exact: true })).toBeVisible()
  165 |   await thinScrollbar(page, chat.locator('[aria-label="Chat messages"]'))
  166 |   await thinScrollbar(page, chat.locator('pre.scroll-slim').first())
  167 |   await shot(page, 'scroll-chat-table', [
  168 |     chat.getByRole('columnheader', { name: 'filename' }),
  169 |     chat.getByText('overflow-doc-1.md').first(),
  170 |   ])
  171 | })
  172 | 
  173 | test('scrollbars: model menu list scrolls without detaching', async ({ page }) => {
  174 |   await page.setViewportSize({ width: 1440, height: 900 })
  175 |   await serveScrollbarApi(page)
  176 |   await page.goto('/')
  177 |   await page.getByRole('button', { name: 'Ask Karbot' }).click()
  178 |   const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  179 |   await chat.getByRole('button', { name: 'Choose a model' }).click()
  180 |   const menu = chat.getByRole('menu', { name: 'Models' })
> 181 |   await expect(menu.getByText('scroll-model-20')).toBeVisible()
      |                                                   ^ Error: expect(locator).toBeVisible() failed
  182 |   await thinScrollbar(page, menu.locator('.scroll-slim').first())
  183 |   await shot(page, 'scroll-model-menu', [menu.getByText('scroll-model-20')])
  184 | })
  185 | 
  186 | const WS_AT = '2026-09-30T00:00:00.000Z'
  187 | const WS_SECTOR = { id: 'sec-overflow-ws', name: 'Overflow workspace', topic: 'Bulk rows', state: 'running', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: WS_AT, updatedAt: WS_AT }
  188 | const WS_RESEARCH = { id: 'ws-research', title: 'Overflow research', kind: 'research', sectorId: WS_SECTOR.id, createdAt: WS_AT, updatedAt: WS_AT }
  189 | const WS_NORMALS = Array.from({ length: 60 }, (_, i) => ({ id: `ws-chat-${i + 1}`, title: `Overflow chat ${i + 1}`, kind: 'normal', sectorId: WS_SECTOR.id, createdAt: WS_AT, updatedAt: WS_AT }))
  190 | const WS_SECTIONS = { scope: 'Overflow scope.', decisions: '', findings: '', questions: '' }
  191 | 
  192 | async function serveWorkspaceApi(page: Page): Promise<void> {
  193 |   await page.route('**/v1/**', async (route) => {
  194 |     const request = route.request(), url = new URL(request.url()), path = url.pathname
  195 |     if (path.endsWith('/events')) { await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }); return }
  196 |     let data: unknown = []
  197 |     if (path === '/v1/sectors') data = [WS_SECTOR]
  198 |     else if (path === `/v1/sectors/${WS_SECTOR.id}`) data = WS_SECTOR
  199 |     else if (path === '/v1/companies') data = { companies: [], total: 0 }
  200 |     else if (path.endsWith('/research-session')) data = WS_RESEARCH
  201 |     else if (path === '/v1/sessions') data = url.searchParams.has('sectorId') ? [WS_RESEARCH, ...WS_NORMALS] : []
  202 |     else if (path.endsWith('/global-context')) data = { sectorId: WS_SECTOR.id, version: 0, sections: WS_SECTIONS, markdown: '## Scope\n\nOverflow scope.', researchSessionId: WS_RESEARCH.id, changes: [] }
  203 |     else if (path.endsWith('/progress')) data = { sectorId: WS_SECTOR.id, state: WS_SECTOR.state, planVersion: 0, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
  204 |     else if (path.endsWith('/files')) data = []
  205 |     else if (path.endsWith('/threads')) data = [{ key: WS_RESEARCH.id, sessionId: WS_RESEARCH.id, kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: WS_AT }]
  206 |     else if (path.endsWith('/messages')) data = []
  207 |     else if (path.endsWith('/context')) data = { threadKey: WS_RESEARCH.id, notes: '', summary: '', coveredSeq: 0, version: 0 }
  208 |     else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [] }
  209 |     else if (path.startsWith('/v1/sessions/')) data = WS_RESEARCH
  210 |     await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  211 |   })
  212 | }
  213 | 
  214 | test('scrollbars: workspace session rail stays thin under overflow', async ({ page }) => {
  215 |   await page.setViewportSize({ width: 1440, height: 900 })
  216 |   await serveWorkspaceApi(page)
  217 |   await page.goto(`/?section=SectorChat&sector=${WS_SECTOR.id}&session=${WS_RESEARCH.id}&thread=${WS_RESEARCH.id}`)
  218 |   // Sixty chats overflow the rail list (windowed at fifty with Show more).
  219 |   await page.getByRole('button', { name: 'Chats', exact: true }).click()
  220 |   await expect(page.getByRole('button', { name: 'Show more (50 of 60)' })).toBeVisible()
  221 |   const rail = page.getByRole('complementary', { name: 'Sector sessions' }).locator('.scroll-slim.min-h-0.flex-1.space-y-1.overflow-y-auto')
  222 |   await expect(rail).toBeVisible()
  223 |   await thinScrollbar(page, rail)
  224 |   await thinScrollbar(page, page.getByRole('log', { name: 'Conversation messages' }))
  225 |   await shot(page, 'scroll-workspace-rail', [page.getByRole('group', { name: 'Session types' })])
  226 | })
  227 | 
  228 | test('scrollbars: dark chat keeps the same thin treatment', async ({ page }) => {
  229 |   await page.setViewportSize({ width: 1440, height: 900 })
  230 |   await serveScrollbarApi(page)
  231 |   await page.goto('/')
  232 |   await page.getByRole('button', { name: 'Theme' }).click()
  233 |   await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  234 |   await page.getByRole('button', { name: 'Ask Karbot' }).click()
  235 |   const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  236 |   await expect(chat.getByText('Scroll probe message 1 with enough text to fill the chat list.', { exact: true })).toBeVisible()
  237 |   await thinScrollbar(page, chat.locator('[aria-label="Chat messages"]'))
  238 |   await shot(page, 'scroll-chat-dark', [
  239 |     chat.getByRole('columnheader', { name: 'filename' }),
  240 |     chat.getByText('overflow-doc-8.md').first(),
  241 |   ])
  242 | })
  243 | 
```