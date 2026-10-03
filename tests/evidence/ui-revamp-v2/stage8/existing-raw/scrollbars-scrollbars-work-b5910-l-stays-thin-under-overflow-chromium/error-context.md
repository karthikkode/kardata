# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scrollbars.spec.ts >> scrollbars: workspace session rail stays thin under overflow
- Location: ../tests/frontend-e2e/scrollbars.spec.ts:214:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Chats', exact: true })

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
            - generic "Overflow workspace" [ref=e9]
          - generic [ref=e10]:
            - generic [ref=e11]: In progress
            - generic [ref=e13]: 0 companies
        - tablist "Session types" [ref=e16]:
          - tab "Research" [selected] [ref=e17] [cursor=pointer]
          - tab "Chats ( 60 )" [ref=e20] [cursor=pointer]:
            - generic [ref=e21]:
              - text: Chats (
              - generic [ref=e22]: "60"
              - text: )
        - list "Research sessions" [ref=e24]:
          - listitem [ref=e25]:
            - button "Open Overflow research" [ref=e26] [cursor=pointer]:
              - generic [ref=e36]:
                - generic "Overflow research" [ref=e37]
                - generic [ref=e38]: In progress
        - button "Theme" [ref=e40] [cursor=pointer]
    - main [ref=e41]:
      - generic [ref=e42]:
        - generic [ref=e43]:
          - heading "Overflow research" [level=1] [ref=e44]
          - generic [ref=e45]: In progress
        - button "Pause" [ref=e48] [cursor=pointer]
        - button "Hide files and context" [ref=e49] [cursor=pointer]
        - button "Conversation options" [ref=e50] [cursor=pointer]
      - generic [ref=e51]:
        - tablist "Research views" [ref=e52]:
          - tab "Chat" [selected] [ref=e53] [cursor=pointer]
          - tab "Plan" [ref=e55] [cursor=pointer]
        - tabpanel "Chat" [ref=e57]:
          - generic [ref=e58]:
            - log "Conversation messages" [ref=e60]:
              - generic [ref=e61]:
                - generic [ref=e62]:
                  - heading "Ask about this research" [level=3] [ref=e66]
                  - paragraph [ref=e67]: Questions, comparisons, and review requests stay in this thread.
                  - generic [ref=e68]:
                    - button "Summarize progress so far" [ref=e69] [cursor=pointer]
                    - button "Which companies were found?" [ref=e70] [cursor=pointer]
                    - button "What needs my review?" [ref=e71] [cursor=pointer]
                - status [ref=e72]:
                  - generic [ref=e76]: Reconnecting. Your conversation is saved.
                  - button "Reconnect now" [ref=e77] [cursor=pointer]
            - generic [ref=e79]:
              - generic [ref=e80]: Message this conversation
              - generic [ref=e81]:
                - generic [ref=e82]:
                  - generic [ref=e83]: Message this conversation
                  - textbox "Message this conversation" [active] [ref=e84]:
                    - /placeholder: Ask about this research...
                  - generic [ref=e85]:
                    - generic [ref=e86]:
                      - button "Local context" [ref=e87] [cursor=pointer]
                      - generic [ref=e89]:
                        - button "Choose a model" [disabled]
                    - generic [ref=e90]:
                      - button "Send message" [disabled]
                - paragraph [ref=e91]:
                  - generic [ref=e92]: Enter
                  - generic [ref=e93]: to send,
                  - generic [ref=e94]: Shift
                  - generic [ref=e95]: +
                  - generic [ref=e96]: Enter
                  - generic [ref=e97]: for a new line
    - complementary "Sector resources" [ref=e98]:
      - generic [ref=e99]:
        - region "Sector files" [ref=e100]:
          - generic [ref=e101]:
            - heading "Files" [level=2] [ref=e102]
            - generic [ref=e103]: 0 files
            - button "Upload file" [ref=e104] [cursor=pointer]
            - button "Show hidden files" [ref=e105] [cursor=pointer]
          - textbox "Search files" [ref=e109]
          - generic [ref=e111]:
            - paragraph [ref=e112]: Upload PDFs, documents or data, or ask an agent to create a file.
            - button "Upload file" [ref=e114] [cursor=pointer]
          - paragraph [ref=e116]: Showing 0 of 0 files
        - region "Global context" [ref=e117]:
          - generic [ref=e118]:
            - heading "Global context" [level=2] [ref=e119]
            - generic [ref=e120]: v0
            - button "Context history" [ref=e121] [cursor=pointer]
            - button "Edit global context" [ref=e122] [cursor=pointer]
          - generic [ref=e124]:
            - generic [ref=e125]:
              - paragraph [ref=e126]: Scope
              - paragraph [ref=e129]: Overflow scope.
            - generic [ref=e130]:
              - paragraph [ref=e131]: Decisions
              - paragraph [ref=e132]: Not set yet
            - generic [ref=e133]:
              - paragraph [ref=e134]: Findings
              - paragraph [ref=e135]: Not set yet
            - generic [ref=e136]:
              - paragraph [ref=e137]: Open questions
              - paragraph [ref=e138]: Not set yet
  - region "Notifications alt+T"
```

# Test source

```ts
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
  181 |   await expect(menu.getByText('scroll-model-20')).toBeVisible()
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
> 219 |   await page.getByRole('button', { name: 'Chats', exact: true }).click()
      |                                                                  ^ Error: locator.click: Test timeout of 30000ms exceeded.
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