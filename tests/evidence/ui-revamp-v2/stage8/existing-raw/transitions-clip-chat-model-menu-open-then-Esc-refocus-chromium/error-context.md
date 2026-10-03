# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: transitions.spec.ts >> clip: chat model menu open then Esc refocus
- Location: ../tests/frontend-e2e/transitions.spec.ts:60:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('complementary', { name: 'Assistant chat' }).getByRole('menu', { name: 'Models' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('complementary', { name: 'Assistant chat' }).getByRole('menu', { name: 'Models' }) with timeout 5000ms
  - waiting for getByRole('complementary', { name: 'Assistant chat' }).getByRole('menu', { name: 'Models' })

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
    - heading "Ask Karbot anything" [level=3]
    - paragraph: Karbot sees every sector you can open.
    - button "What is running right now?"
    - button "Create a new sector"
    - button "Show recent companies"
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
  1  | // Transition clips (revamp verification). Short videos proving motion pairs:
  2  | // dock open/close, section switch, model menu open/Esc. Videos land in
  3  | // test-results/visual/video (gitignored); rows live in
  4  | // docs/frontend-verification.md.
  5  | import { expect, test } from '@playwright/test'
  6  | 
  7  | test.use({ video: { mode: 'on', size: { width: 1280, height: 720 } } })
  8  | 
  9  | async function serveClipsApi(page): Promise<void> {
  10 |   await page.route('**/v1/**', async (route) => {
  11 |     const url = route.request().url()
  12 |     if (url.includes('/events?')) {
  13 |       await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
  14 |       return
  15 |     }
  16 |     let data: unknown = []
  17 |     if (url.includes('/v1/companies')) data = { companies: [], total: 0 }
  18 |     else if (url.includes('/v1/providers')) {
  19 |       data = {
  20 |         defaultProvider: 'meta',
  21 |         providers: [{ name: 'meta', hasKey: true, defaultModel: 'muse-spark-1.3-contributor', models: [
  22 |           { provider: 'meta', model: 'muse-spark-1.3-contributor', displayName: 'muse-spark-1.3-contributor', reasoning: 'native', mode: 'responses', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
  23 |         ] }],
  24 |       }
  25 |     } else if (url.endsWith('/v1/sessions')) {
  26 |       data = [{ id: 's-1', title: 'Browser chat', createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T01:00:00.000Z' }]
  27 |     } else if (url.endsWith('/v1/sessions/s-1')) {
  28 |       data = { id: 's-1', title: 'Browser chat', createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T01:00:00.000Z' }
  29 |     } else if (url.endsWith('/v1/sessions/s-1/threads')) {
  30 |       data = [{ key: 's-1', sessionId: 's-1', kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: '2026-09-27T01:00:00.000Z' }]
  31 |     }
  32 |     await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  33 |   })
  34 | }
  35 | 
  36 | test('clip: dock open then close', async ({ page }) => {
  37 |   await serveClipsApi(page)
  38 |   await page.goto('/')
  39 |   await page.getByRole('button', { name: 'Ask Karbot' }).click()
  40 |   const dock = page.getByRole('complementary', { name: 'Assistant chat' })
  41 |   await expect(dock).toBeVisible()
  42 |   await page.waitForTimeout(400)
  43 |   await page.keyboard.press('Escape')
  44 |   await expect(dock).not.toBeVisible()
  45 |   await expect(page.getByRole('button', { name: 'Ask Karbot' })).toBeFocused()
  46 |   await page.waitForTimeout(300)
  47 | })
  48 | 
  49 | test('clip: section switch crossfade with heading focus', async ({ page }) => {
  50 |   await serveClipsApi(page)
  51 |   await page.goto('/')
  52 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  53 |   await expect(page.getByRole('heading', { name: 'Researches', exact: true })).toBeFocused()
  54 |   await page.waitForTimeout(300)
  55 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Agents' }).click()
  56 |   await expect(page.getByRole('heading', { name: 'Agents' })).toBeFocused()
  57 |   await page.waitForTimeout(300)
  58 | })
  59 | 
  60 | test('clip: chat model menu open then Esc refocus', async ({ page }) => {
  61 |   await serveClipsApi(page)
  62 |   await page.goto('/')
  63 |   await page.getByRole('button', { name: 'Ask Karbot' }).click()
  64 |   const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  65 |   await expect(chat).toBeVisible()
  66 |   await chat.getByRole('button', { name: 'Choose a model' }).click()
> 67 |   await expect(chat.getByRole('menu', { name: 'Models' })).toBeVisible()
     |                                                            ^ Error: expect(locator).toBeVisible() failed
  68 |   await page.waitForTimeout(300)
  69 |   await page.keyboard.press('Escape')
  70 |   await expect(chat.getByRole('menu', { name: 'Models' })).not.toBeVisible()
  71 |   await expect(chat.getByRole('button', { name: 'Choose a model' })).toBeFocused()
  72 | })
  73 | 
```