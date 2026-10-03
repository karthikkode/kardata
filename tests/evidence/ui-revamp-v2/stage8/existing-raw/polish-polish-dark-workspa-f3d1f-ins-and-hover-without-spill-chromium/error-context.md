# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: polish.spec.ts >> polish: dark workspace keeps pins and hover without spill
- Location: ../tests/frontend-e2e/polish.spec.ts:109:1

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
            - generic "Polish sector" [ref=e9]
          - generic [ref=e10]:
            - generic [ref=e11]: In progress
            - generic [ref=e13]: 0 companies
        - tablist "Session types" [ref=e16]:
          - tab "Research" [selected] [ref=e17] [cursor=pointer]
          - tab "Chats ( 2 )" [ref=e20] [cursor=pointer]:
            - generic [ref=e21]:
              - text: Chats (
              - generic [ref=e22]: "2"
              - text: )
        - list "Research sessions" [ref=e24]:
          - listitem [ref=e25]:
            - button "Open Polish research" [ref=e26] [cursor=pointer]:
              - generic [ref=e36]:
                - generic "Polish research" [ref=e37]
                - generic [ref=e38]: In progress
        - button "Theme" [ref=e40] [cursor=pointer]
    - main [ref=e41]:
      - generic [ref=e42]:
        - generic [ref=e43]:
          - heading "Polish research" [level=1] [ref=e44]
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
                  - generic [ref=e63]: Which buyers show costly friction?
                  - generic [ref=e65]:
                    - generic [ref=e66]:
                      - heading "Costly friction so far" [level=2] [ref=e67]
                      - paragraph [ref=e68]: Evidence lines that pin the pain to money, each long enough to wrap several lines at desktop measure and force the conversation column well past one viewport of scrollable height.
                      - paragraph [ref=e69]: A repeated manual reconciliation step costs operators hours every week. A repeated manual reconciliation step costs operators hours every week. A repeated manual reconciliation step costs operators hours every week. A repeated manual reconciliation step costs operators hours every week. A repeated manual reconciliation step costs operators hours every week. A repeated manual reconciliation step costs operators hours every week. A repeated manual reconciliation step costs operators hours every week. A repeated manual reconciliation step costs operators hours every week. A repeated manual reconciliation step costs operators hours every week. A repeated manual reconciliation step costs operators hours every week. A repeated manual reconciliation step costs operators hours every week. A repeated manual reconciliation step costs operators hours every week.
                    - generic [ref=e70]:
                      - button "Copy" [ref=e71] [cursor=pointer]
                      - time [ref=e73]: 3d
                - status [ref=e74]:
                  - generic [ref=e78]: Reconnecting. Your conversation is saved.
                  - button "Reconnect now" [ref=e79] [cursor=pointer]
            - generic [ref=e81]:
              - generic [ref=e82]: Message this conversation
              - generic [ref=e83]:
                - generic [ref=e84]:
                  - generic [ref=e85]: Message this conversation
                  - textbox "Message this conversation" [active] [ref=e86]:
                    - /placeholder: Ask about this research...
                  - generic [ref=e87]:
                    - generic [ref=e88]:
                      - button "Local context" [ref=e89] [cursor=pointer]
                      - generic [ref=e91]:
                        - button "Choose a model" [disabled]
                    - generic [ref=e92]:
                      - button "Send message" [disabled]
                - paragraph [ref=e93]:
                  - generic [ref=e94]: Enter
                  - generic [ref=e95]: to send,
                  - generic [ref=e96]: Shift
                  - generic [ref=e97]: +
                  - generic [ref=e98]: Enter
                  - generic [ref=e99]: for a new line
    - complementary "Sector resources" [ref=e100]:
      - generic [ref=e101]:
        - region "Sector files" [ref=e102]:
          - generic [ref=e103]:
            - heading "Files" [level=2] [ref=e104]
            - generic [ref=e105]: 0 files
            - button "Upload file" [ref=e106] [cursor=pointer]
            - button "Show hidden files" [ref=e107] [cursor=pointer]
          - textbox "Search files" [ref=e111]
          - generic [ref=e113]:
            - paragraph [ref=e114]: Upload PDFs, documents or data, or ask an agent to create a file.
            - button "Upload file" [ref=e116] [cursor=pointer]
          - paragraph [ref=e118]: Showing 0 of 0 files
        - region "Global context" [ref=e119]:
          - generic [ref=e120]:
            - heading "Global context" [level=2] [ref=e121]
            - generic [ref=e122]: v0
            - button "Context history" [ref=e123] [cursor=pointer]
            - button "Edit global context" [ref=e124] [cursor=pointer]
          - generic [ref=e126]:
            - generic [ref=e127]:
              - paragraph [ref=e128]: Scope
              - paragraph [ref=e131]: Polish scope.
            - generic [ref=e132]:
              - paragraph [ref=e133]: Decisions
              - paragraph [ref=e134]: Not set yet
            - generic [ref=e135]:
              - paragraph [ref=e136]: Findings
              - paragraph [ref=e137]: Not set yet
            - generic [ref=e138]:
              - paragraph [ref=e139]: Open questions
              - paragraph [ref=e140]: Not set yet
  - region "Notifications alt+T"
```

# Test source

```ts
  13  | const AT = '2026-09-30T00:00:00.000Z'
  14  | 
  15  | const SECTOR = {
  16  |   id: 'sec-polish', name: 'Polish sector', topic: 'Bulk rows', state: 'running',
  17  |   companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: AT, updatedAt: AT,
  18  | }
  19  | const RESEARCH = { id: 'ws-research', title: 'Polish research', kind: 'research', sectorId: SECTOR.id, createdAt: AT, updatedAt: AT }
  20  | const NORMALS = [
  21  |   { id: 'ws-chat-1', title: 'Pricing brainstorm', kind: 'normal', sectorId: SECTOR.id, createdAt: AT, updatedAt: AT },
  22  |   { id: 'ws-chat-2', title: 'Buyer notes', kind: 'normal', sectorId: SECTOR.id, createdAt: AT, updatedAt: AT },
  23  | ]
  24  | const MESSAGES = [
  25  |   { seq: 1, role: 'user', kind: 'text', text: 'Which buyers show costly friction?', at: AT },
  26  |   { seq: 2, role: 'agent', kind: 'text', text: `## Costly friction so far\n\nEvidence lines that pin the pain to money, each long enough to wrap several lines at desktop measure and force the conversation column well past one viewport of scrollable height.\n\n${'A repeated manual reconciliation step costs operators hours every week. '.repeat(12)}`, at: AT },
  27  | ]
  28  | const SECTIONS = { scope: 'Polish scope.', decisions: '', findings: '', questions: '' }
  29  | 
  30  | async function serveWorkspaceApi(page: Page): Promise<void> {
  31  |   await page.route('**/v1/**', async (route) => {
  32  |     const request = route.request(), url = new URL(request.url()), path = url.pathname
  33  |     if (path.endsWith('/events')) { await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }); return }
  34  |     let data: unknown = []
  35  |     if (path === '/v1/sectors') data = [SECTOR]
  36  |     else if (path === `/v1/sectors/${SECTOR.id}`) data = SECTOR
  37  |     else if (path === '/v1/companies') data = { companies: [], total: 0 }
  38  |     else if (path.endsWith('/research-session')) data = RESEARCH
  39  |     else if (path === '/v1/sessions') data = url.searchParams.has('sectorId') ? [RESEARCH, ...NORMALS] : []
  40  |     else if (path.endsWith('/global-context')) data = { sectorId: SECTOR.id, version: 0, sections: SECTIONS, markdown: '## Scope\n\nPolish scope.', researchSessionId: RESEARCH.id, changes: [] }
  41  |     else if (path.endsWith('/progress')) data = { sectorId: SECTOR.id, state: SECTOR.state, planVersion: 0, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
  42  |     else if (path.endsWith('/files')) data = []
  43  |     else if (path.endsWith('/threads')) data = [{ key: RESEARCH.id, sessionId: RESEARCH.id, kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: AT }]
  44  |     else if (path.endsWith('/messages')) data = MESSAGES
  45  |     else if (path.endsWith('/context')) data = { threadKey: RESEARCH.id, notes: '', summary: '', coveredSeq: 0, version: 0 }
  46  |     else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [] }
  47  |     else if (path.startsWith('/v1/sessions/')) data = RESEARCH
  48  |     await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  49  |   })
  50  | }
  51  | 
  52  | async function openWorkspace(page: Page): Promise<void> {
  53  |   await page.goto(`/?section=SectorChat&sector=${SECTOR.id}&session=${RESEARCH.id}&thread=${RESEARCH.id}`)
  54  |   await expect(page.getByText('Which buyers show costly friction?')).toBeVisible()
  55  | }
  56  | 
  57  | async function shot(page: Page, name: string, anchors: Locator[]): Promise<void> {
  58  |   for (const anchor of anchors) await expect(anchor).toBeVisible()
  59  |   await page.screenshot({ path: `test-results/visual/${name}.png`, animations: 'disabled' })
  60  | }
  61  | 
  62  | interface Box { x: number; y: number; width: number; height: number }
  63  | 
  64  | function intersectsPort(box: Box, port: Box): boolean {
  65  |   return box.y < port.y + port.height && box.y + box.height > port.y
  66  | }
  67  | 
  68  | test('polish: workspace keeps header and composer pinned while scrolling', async ({ page }) => {
  69  |   await page.setViewportSize({ width: 1440, height: 600 })
  70  |   await serveWorkspaceApi(page)
  71  |   await openWorkspace(page)
  72  |   const list = page.getByRole('log', { name: 'Conversation messages' })
  73  |   await list.evaluate((el) => {
  74  |     el.scrollTop = 600
  75  |   })
  76  |   expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  77  |   const port = { y: 0, height: 600 }
  78  |   const header = page.getByRole('main').locator('header')
  79  |   const composer = page.getByRole('textbox', { name: 'Message this conversation' })
  80  |   const headerBox = (await header.boundingBox()) as unknown as Box
  81  |   const composerBox = (await composer.boundingBox()) as unknown as Box
  82  |   expect(headerBox).not.toBeNull()
  83  |   expect(composerBox).not.toBeNull()
  84  |   expect(intersectsPort(headerBox, port)).toBe(true)
  85  |   expect(intersectsPort(composerBox, port)).toBe(true)
  86  |   await shot(page, 'polish-workspace-sticky', [header, composer])
  87  | })
  88  | 
  89  | test('polish: hover and focus states stay inside their rows', async ({ page }) => {
  90  |   await page.setViewportSize({ width: 1440, height: 600 })
  91  |   await serveWorkspaceApi(page)
  92  |   await openWorkspace(page)
  93  |   await page.getByRole('button', { name: 'Chats', exact: true }).click()
  94  |   const row = page.getByRole('button', { name: 'Open Pricing brainstorm' })
  95  |   await row.hover()
  96  |   await expect(row).toBeVisible()
  97  |   const composer = page.getByRole('textbox', { name: 'Message this conversation' })
  98  |   await composer.fill('Which buyers show costly friction?')
  99  |   await composer.focus()
  100 |   await expect(composer).toBeFocused()
  101 |   const spill = await page.evaluate(() => {
  102 |     const root = document.documentElement
  103 |     return root.scrollWidth - root.clientWidth
  104 |   })
  105 |   expect(spill).toBeLessThanOrEqual(1)
  106 |   await shot(page, 'polish-workspace-hover-focus', [row, composer])
  107 | })
  108 | 
  109 | test('polish: dark workspace keeps pins and hover without spill', async ({ page }) => {
  110 |   await page.setViewportSize({ width: 1440, height: 600 })
  111 |   await serveWorkspaceApi(page)
  112 |   await openWorkspace(page)
> 113 |   await page.getByRole('button', { name: 'Use dark theme' }).click()
      |                                                              ^ Error: locator.click: Test timeout of 30000ms exceeded.
  114 |   await expect(page.getByRole('button', { name: 'Use light theme' })).toBeVisible()
  115 |   const list = page.getByRole('log', { name: 'Conversation messages' })
  116 |   await list.evaluate((el) => {
  117 |     el.scrollTop = 600
  118 |   })
  119 |   expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  120 |   const port = { y: 0, height: 600 }
  121 |   const header = page.getByRole('main').locator('header')
  122 |   const composer = page.getByRole('textbox', { name: 'Message this conversation' })
  123 |   expect(intersectsPort((await header.boundingBox()) as unknown as Box, port)).toBe(true)
  124 |   expect(intersectsPort((await composer.boundingBox()) as unknown as Box, port)).toBe(true)
  125 |   await page.getByRole('button', { name: 'Chats', exact: true }).click()
  126 |   await page.getByRole('button', { name: 'Open Buyer notes' }).hover()
  127 |   await shot(page, 'polish-workspace-dark', [header, composer])
  128 | })
  129 | 
```