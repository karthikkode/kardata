# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: visual.spec.ts >> visual: sector detail with context drawer content
- Location: ../tests/frontend-e2e/visual.spec.ts:105:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Company research has not started yet.')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('Company research has not started yet.') with timeout 5000ms
  - waiting for getByText('Company research has not started yet.')

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
  - navigation "Breadcrumb":
    - list:
      - listitem:
        - button "Researches"
      - listitem: Speciality Foods
  - heading "Speciality Foods" [level=1]
  - text: Draft
  - button "View progress"
  - button "Open workspace"
  - paragraph: Ready meals
  - paragraph: Created 27 Sep 2026 · Updated 6d ago
  - region "Research status":
    - heading "Research status" [level=2]
    - separator
    - paragraph: This sector is a draft. Attach context and create a plan when ready.
    - group "Research numbers":
      - text: Companies found 0 Progress Unavailable
      - button "Retry progress"
      - text: Last activity 6d ago
  - region "Companies":
    - heading "Companies" [level=2]
    - text: "0"
    - separator
    - textbox "Search companies"
    - 'combobox "Status: All"'
    - table "Companies":
      - rowgroup:
        - row "Company Stage Status":
          - columnheader "Company"
          - columnheader "Stage"
          - columnheader "Status"
      - rowgroup:
        - row "Research has not started Create and approve a plan to start discovering companies.":
          - cell "Research has not started Create and approve a plan to start discovering companies.":
            - heading "Research has not started" [level=3]
            - paragraph: Create and approve a plan to start discovering companies.
- region "Notifications alt+T"
```

# Test source

```ts
  1   | // Visual state matrix (deep-check Phase 7 follow-up). Runnable
  2   | // screenshot suite: every shot asserts its state's key locators first, so a
  3   | // regression fails the test instead of silently drifting pixels. PNGs land
  4   | // in test-results/visual (gitignored) for human review and CI artifacts.
  5   | // API answers are route-stubbed; no backend, no keys, no network.
  6   | import { expect, test, type Locator, type Page } from '@playwright/test'
  7   | 
  8   | const SECTOR = {
  9   |   id: 'sec-foods',
  10  |   name: 'Speciality Foods',
  11  |   topic: 'Ready meals',
  12  |   state: 'draft',
  13  |   companiesFound: 0,
  14  |   companies: [],
  15  |   companiesTotal: 0,
  16  |   activity: [],
  17  |   activityTotal: 0,
  18  |   createdAt: '2026-09-27T00:00:00.000Z',
  19  |   updatedAt: '2026-09-27T01:00:00.000Z',
  20  | }
  21  | 
  22  | const CONTEXT = {
  23  |   sectorId: 'sec-foods',
  24  |   digest: { version: 'abc123def456', text: 'd' },
  25  |   segments: { system: 'Sector Speciality Foods: Ready meals', references: ['First fact.'], history: [], tail: [] },
  26  |   usage: {
  27  |     system: { messages: 0, estimatedTokens: 0 },
  28  |     references: { messages: 1, estimatedTokens: 42 },
  29  |     history: { messages: 0, estimatedTokens: 0 },
  30  |     tail: { messages: 0, estimatedTokens: 0 },
  31  |     totalEstimatedTokens: 42,
  32  |   },
  33  |   files: [
  34  |     {
  35  |       id: 'doc-1',
  36  |       filename: 'notes.md',
  37  |       mediaType: 'text/markdown',
  38  |       status: 'indexed',
  39  |       sha256: 'deadbeef',
  40  |       units: [{ ord: 0, kind: 'text', text: 'First fact.', uncertain: false, excluded: false }],
  41  |     },
  42  |   ],
  43  |   notes: [],
  44  | }
  45  | 
  46  | async function serveApi(page: Page, sectors: unknown[] = [SECTOR]): Promise<void> {
  47  |   await page.route('**/v1/**', async (route) => {
  48  |     const url = route.request().url()
  49  |     const method = route.request().method()
  50  |     let data: unknown = []
  51  |     if (url.endsWith('/v1/sectors') && method === 'GET') data = sectors
  52  |     else if (url.endsWith('/v1/sectors/sec-foods')) data = SECTOR
  53  |     else if (url.includes('/v1/companies')) data = { companies: [], total: 0 }
  54  |     else if (url.includes('/v1/sectors/sec-foods/context') && method === 'GET') data = CONTEXT
  55  |     else if (url.includes('/v1/sectors/sec-foods/documents')) data = []
  56  |     else if (url.includes('/v1/sessions?sectorId=sec-foods')) {
  57  |       data = [{ id: 'salads', title: 'Speciality Foods chat', sectorId: 'sec-foods', createdAt: SECTOR.createdAt, updatedAt: SECTOR.updatedAt }]
  58  |     } else if (url.includes('/threads/salads/messages') || url.includes('/sessions/salads/messages')) data = []
  59  |     else if (url.includes('/events?')) {
  60  |       await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
  61  |       return
  62  |     } else if (url.endsWith('/v1/sessions')) {
  63  |       data = [{ id: 's-1', title: 'Browser chat', createdAt: SECTOR.createdAt, updatedAt: SECTOR.updatedAt }]
  64  |     } else if (url.endsWith('/v1/sessions/s-1')) {
  65  |       data = { id: 's-1', title: 'Browser chat', createdAt: SECTOR.createdAt, updatedAt: SECTOR.updatedAt }
  66  |     } else if (url.endsWith('/v1/sessions/s-1/threads')) {
  67  |       data = [{ key: 's-1', sessionId: 's-1', kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: SECTOR.updatedAt }]
  68  |     } else if (url.includes('/v1/providers')) {
  69  |       data = {
  70  |         defaultProvider: 'meta',
  71  |         providers: [{ name: 'meta', hasKey: true, defaultModel: 'muse-spark-1.3-contributor', models: [
  72  |           { provider: 'meta', model: 'muse-spark-1.3-contributor', displayName: 'muse-spark-1.3-contributor', reasoning: 'native', mode: 'responses', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
  73  |         ] }],
  74  |       }
  75  |     }
  76  |     await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  77  |   })
  78  | }
  79  | 
  80  | /** Assert the state's anchors, then capture the PNG. Animations are frozen
  81  |  * so the 200ms section/popover fades cannot land mid-fade (Playwright's
  82  |  * visibility check ignores opacity). Motion itself is verified by the
  83  |  * transition clips in the handoff plan, not by stills. */
  84  | async function shot(page: Page, name: string, anchors: Locator[]): Promise<void> {
> 85  |   for (const anchor of anchors) await expect(anchor).toBeVisible()
      |                                                      ^ Error: expect(locator).toBeVisible() failed
  86  |   await page.screenshot({ path: `test-results/visual/${name}.png`, animations: 'disabled' })
  87  | }
  88  | 
  89  | test('visual: overview empty state', async ({ page }) => {
  90  |   await serveApi(page, [])
  91  |   await page.goto('/')
  92  |   await shot(page, 'overview-empty', [
  93  |     page.getByRole('heading', { name: 'Overview' }),
  94  |     page.getByText('No sectors yet'),
  95  |   ])
  96  | })
  97  | 
  98  | test('visual: researches list with one draft sector', async ({ page }) => {
  99  |   await serveApi(page)
  100 |   await page.goto('/')
  101 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  102 |   await shot(page, 'researches-list', [page.getByText('Speciality Foods')])
  103 | })
  104 | 
  105 | test('visual: sector detail with context drawer content', async ({ page }) => {
  106 |   await serveApi(page)
  107 |   await page.goto('/')
  108 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  109 |   await page.getByRole('link', { name: /^Speciality Foods/ }).click()
  110 |   // The summary landing carries status plus companies; the drawer-era
  111 |   // detail/chat headings moved into the workspace (workspace.spec.ts).
  112 |   await shot(page, 'sector-detail', [
  113 |     page.getByRole('region', { name: 'Research status' }),
  114 |     page.getByText('Company research has not started yet.'),
  115 |   ])
  116 | })
  117 | 
  118 | test('visual: chat open idle with model picker expanded', async ({ page }) => {
  119 |   await serveApi(page)
  120 |   await page.goto('/')
  121 |   await page.getByRole('button', { name: 'Ask Karbot' }).click()
  122 |   const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  123 |   await expect(chat).toBeVisible()
  124 |   await chat.getByRole('button', { name: 'Choose a model' }).click()
  125 |   await shot(page, 'chat-model-picker', [chat.getByRole('menu', { name: 'Models' })])
  126 | })
  127 | 
  128 | test('visual: wave1 sidebar collapsed with disabled emails', async ({ page }) => {
  129 |   await serveApi(page, [])
  130 |   await page.goto('/')
  131 |   await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  132 |   await shot(page, 'wave1-sidebar-collapsed', [
  133 |     page.getByRole('button', { name: 'Expand sidebar' }),
  134 |     page.getByRole('button', { name: 'Emails (coming soon)' }),
  135 |   ])
  136 | })
  137 | 
  138 | test('visual: wave1 researches filtered counts with clearable search', async ({ page }) => {
  139 |   await serveApi(page)
  140 |   await page.goto('/')
  141 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  142 |   await page.getByLabel('Search sectors').fill('Speciality')
  143 |   await shot(page, 'wave1-dashboard-filtered', [
  144 |     page.getByRole('button', { name: 'Clear search' }),
  145 |     page.getByText('1 sector'),
  146 |   ])
  147 | })
  148 | 
  149 | test('visual: wave2 dark overview with collapsed rail', async ({ page }) => {
  150 |   await serveApi(page, [])
  151 |   await page.goto('/')
  152 |   await page.getByRole('button', { name: 'Theme' }).click()
  153 |   await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  154 |   await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  155 |   await shot(page, 'wave2-dark-collapsed', [
  156 |     page.getByRole('heading', { name: 'Overview' }),
  157 |     page.getByRole('button', { name: 'Expand sidebar' }),
  158 |   ])
  159 | })
  160 | 
  161 | test('visual: wave2 mobile sector detail stacked', async ({ page }) => {
  162 |   await page.setViewportSize({ width: 390, height: 844 })
  163 |   await serveApi(page)
  164 |   await page.goto('/')
  165 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  166 |   await page.getByRole('link', { name: /^Speciality Foods/ }).click()
  167 |   await shot(page, 'wave2-mobile-detail', [
  168 |     page.getByRole('region', { name: 'Research status' }),
  169 |     page.getByRole('button', { name: 'Open', exact: true }),
  170 |   ])
  171 | })
  172 | 
  173 | test('visual: wave2 runs list with cancelling tone', async ({ page }) => {
  174 |   await page.route('**/v1/**', async (route) => {
  175 |     const url = route.request().url()
  176 |     let data: unknown = []
  177 |     if (url.includes('/v1/companies')) data = { companies: [], total: 0 }
  178 |     else if (url.includes('/v1/runs')) {
  179 |       data = [{ id: 'run-1', sessionId: 's-1', threadKey: 's-1', state: 'CANCELLING', updatedAt: SECTOR.updatedAt }]
  180 |     }
  181 |     await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  182 |   })
  183 |   await page.goto('/')
  184 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Agents' }).click()
  185 |   await shot(page, 'wave2-runs-cancelling', [
```