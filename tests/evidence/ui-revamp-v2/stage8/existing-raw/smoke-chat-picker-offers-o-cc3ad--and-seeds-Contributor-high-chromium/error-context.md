# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> chat picker offers only live Meta models and seeds Contributor high
- Location: ../tests/frontend-e2e/smoke.spec.ts:47:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('complementary', { name: 'Assistant chat' }).getByRole('menu', { name: 'Models' }).getByText('Meta', { exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('complementary', { name: 'Assistant chat' }).getByRole('menu', { name: 'Models' }).getByText('Meta', { exact: true }) with timeout 5000ms
  - waiting for getByRole('complementary', { name: 'Assistant chat' }).getByRole('menu', { name: 'Models' }).getByText('Meta', { exact: true })

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
  - button "Chat sessions": Browser chat
  - button "New chat"
  - button "Session files"
  - button "More actions"
  - button "Close"
  - log "Chat messages":
    - text: Check the sector
    - button "Show tool activity": Used 1 tool
    - button "Show reasoning": Reasoning
    - paragraph: There are no sectors yet.
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
      - menuitem "muse-spark-1.3-contributor high"
      - menuitem "muse-spark-1.3 Thinking"
  - button "Send message" [disabled]
- main:
  - heading "Overview" [level=1]
  - button "New sector"
  - paragraph: Research activity across all sectors.
  - group "Research totals":
    - 'button "Sectors: 0, 0 in progress. Show in Researches."':
      - text: Sectors 0
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
    - heading "No sectors yet" [level=3]
    - paragraph: Create a sector to start discovering companies.
    - button "New sector"
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
  1   | import { expect, test, type Page } from '@playwright/test'
  2   | 
  3   | const session = {
  4   |   id: 's-1', title: 'Browser chat',
  5   |   createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z',
  6   | }
  7   | 
  8   | async function serveApi(page: Page, sent?: Promise<void>, release?: () => void) {
  9   |   await page.route('**/v1/**', async (route) => {
  10  |     const url = route.request().url()
  11  |     const method = route.request().method()
  12  |     if (url.includes('/events?')) {
  13  |       if (sent) await sent
  14  |       const frames = [
  15  |         { seq: 1, threadKey: 's-1', type: 'message', at: '', payload: { seq: 1, kind: 'text', role: 'user', text: 'Check the sector' } },
  16  |         { seq: 2, threadKey: 's-1', type: 'message', at: '', payload: { seq: 2, kind: 'tool', name: 'db.list_sectors', detail: 'mcp:db.list_sectors', state: 'done' } },
  17  |         { seq: 3, threadKey: 's-1', type: 'message', at: '', payload: { seq: 3, kind: 'text', role: 'agent', text: 'There are no sectors yet.', reasoning: 'Checked the sector list.' } },
  18  |       ]
  19  |       await route.fulfill({ status: 200, contentType: 'text/event-stream', body: frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') })
  20  |       return
  21  |     }
  22  |     let data: unknown = []
  23  |     if (url.includes('/v1/companies')) data = { companies: [], total: 0 }
  24  |     else if (url.endsWith('/v1/sessions')) data = [session]
  25  |     else if (url.endsWith('/v1/sessions/s-1')) data = session
  26  |     else if (url.endsWith('/v1/sessions/s-1/threads')) data = [{ key: 's-1', sessionId: 's-1', kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: session.updatedAt }]
  27  |     else if (url.includes('/v1/commands/send') && method === 'POST') {
  28  |       data = { commandId: 'cmd-1', state: 'accepted' }
  29  |       release?.()
  30  |     } else if (url.endsWith('/v1/providers')) data = {
  31  |       defaultProvider: 'meta', providers: [{ name: 'meta', hasKey: true, defaultModel: 'muse-spark-1.3-contributor', models: [
  32  |         { provider: 'meta', model: 'muse-spark-1.3-contributor', displayName: 'muse-spark-1.3-contributor', reasoning: 'native', mode: 'responses', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
  33  |         { provider: 'meta', model: 'muse-spark-1.3', displayName: 'muse-spark-1.3', reasoning: 'native', mode: 'responses', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
  34  |       ] }],
  35  |     }
  36  |     await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  37  |   })
  38  | }
  39  | 
  40  | test('overview shows the live empty state without sample research', async ({ page }) => {
  41  |   await serveApi(page)
  42  |   await page.goto('/')
  43  |   await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  44  |   await expect(page.getByText('No sectors yet')).toBeVisible()
  45  | })
  46  | 
  47  | test('chat picker offers only live Meta models and seeds Contributor high', async ({ page }) => {
  48  |   await serveApi(page)
  49  |   await page.goto('/')
  50  |   await page.getByRole('button', { name: 'Ask Karbot' }).click()
  51  |   const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  52  |   const trigger = chat.getByRole('button', { name: 'Choose a model' })
  53  |   // The chat picker uses the generic label (pinned by models-staging.test):
  54  |   // the trigger reads Model while the menu carries the live catalog.
  55  |   await expect(trigger).toContainText('Model')
  56  |   await trigger.click()
> 57  |   await expect(chat.getByRole('menu', { name: 'Models' }).getByText('Meta', { exact: true })).toBeVisible()
      |                                                                                               ^ Error: expect(locator).toBeVisible() failed
  58  |   await expect(chat.getByRole('menu', { name: 'Models' }).getByText('muse-spark-1.3-contributor')).toBeVisible()
  59  |   await expect(chat.getByText('DeepSeek')).toHaveCount(0)
  60  | })
  61  | 
  62  | test('chat shows a served reply, quiet tool disclosure, and provider trace', async ({ page }) => {
  63  |   let release = () => undefined
  64  |   const sent = new Promise<void>((resolve) => { release = resolve })
  65  |   await serveApi(page, sent, release)
  66  |   await page.goto('/')
  67  |   await page.getByRole('button', { name: 'Ask Karbot' }).click()
  68  |   const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  69  |   await expect(chat).toBeVisible()
  70  |   await chat.getByLabel('Message the agent').fill('Check the sector')
  71  |   await chat.getByRole('button', { name: 'Send message' }).click()
  72  |   await expect(chat.getByText('There are no sectors yet.')).toBeVisible()
  73  |   await expect(chat.getByText('Reasoning')).toBeVisible()
  74  |   await chat.getByRole('button', { name: 'Show Reasoning' }).click()
  75  |   await expect(chat.getByText('List sectors')).toBeVisible()
  76  |   await expect(chat.getByText('Checked the sector list.')).toBeVisible()
  77  |   await chat.getByRole('button', { name: 'Hide Reasoning' }).click()
  78  |   await chat.getByRole('button', { name: 'Close' }).click()
  79  |   await expect(chat).not.toBeVisible()
  80  | })
  81  | 
  82  | test('chat shows an MCP tool while its call is still running', async ({ page }) => {
  83  |   await serveApi(page)
  84  |   await page.addInitScript(() => {
  85  |     const nativeFetch = window.fetch.bind(window)
  86  |     let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  87  |     window.fetch = (input, init) => {
  88  |       if (String(input).includes('/events?')) {
  89  |         return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
  90  |           start(controller) { stream = controller },
  91  |         }), { status: 200, headers: { 'content-type': 'text/event-stream' } }))
  92  |       }
  93  |       return nativeFetch(input, init)
  94  |     }
  95  |     Object.assign(window, {
  96  |       pushChatFrame(frame: unknown) {
  97  |         stream?.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`))
  98  |       },
  99  |     })
  100 |   })
  101 |   const push = (frame: unknown) => page.evaluate((value) => {
  102 |     (window as unknown as { pushChatFrame(frame: unknown): void }).pushChatFrame(value)
  103 |   }, frame)
  104 |   await page.goto('/')
  105 |   await page.getByRole('button', { name: 'Ask Karbot' }).click()
  106 |   const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  107 |   await chat.getByLabel('Message the agent').fill('Check the sector')
  108 |   await chat.getByRole('button', { name: 'Send message' }).click()
  109 |   await push({ seq: 1, threadKey: 's-1', type: 'message', at: '', payload: { seq: 1, kind: 'text', role: 'user', text: 'Check the sector' } })
  110 |   await push({ seq: 2, threadKey: 's-1', type: 'tool', at: '', payload: { runKey: 'r:1', id: 'c1', name: 'db.list_sectors', state: 'running' } })
  111 |   await expect(chat.getByText('Running')).toBeVisible()
  112 |   await expect(chat.getByText('List sectors')).toBeVisible()
  113 |   await expect(chat.getByText('There are no sectors yet.')).toHaveCount(0)
  114 |   await push({ seq: 3, threadKey: 's-1', type: 'tool', at: '', payload: { runKey: 'r:1', id: 'c1', name: 'db.list_sectors', state: 'done' } })
  115 |   await push({ seq: 4, threadKey: 's-1', type: 'message', at: '', payload: { seq: 2, kind: 'tool', name: 'db.list_sectors', detail: '', state: 'done' } })
  116 |   await push({ seq: 5, threadKey: 's-1', type: 'message', at: '', payload: { seq: 3, kind: 'text', role: 'agent', text: 'There are no sectors yet.' } })
  117 |   await expect(chat.getByText('There are no sectors yet.')).toBeVisible()
  118 |   await expect(chat.getByText('Running')).toHaveCount(0)
  119 | })
  120 | 
```