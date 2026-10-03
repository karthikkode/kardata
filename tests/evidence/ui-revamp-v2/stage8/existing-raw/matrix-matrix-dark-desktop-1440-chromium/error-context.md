# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: matrix.spec.ts >> matrix: dark desktop 1440
- Location: ../tests/frontend-e2e/matrix.spec.ts:113:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: 'Open', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('button', { name: 'Open', exact: true }) with timeout 5000ms
  - waiting for getByRole('button', { name: 'Open', exact: true })

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
  1   | // Full visual matrix (revamp verification). Every primary surface captured in
  2   | // light + dark x desktop 1440 + mobile 390. Anchors asserted before every
  3   | // shot; animations frozen for determinism (motion is verified by the
  4   | // transition clips in transitions.spec.ts, not by stills). PNGs land in
  5   | // test-results/visual (gitignored); rows live in docs/frontend-verification.md.
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
  22  | async function serveMatrixApi(page: Page): Promise<void> {
  23  |   await page.route('**/v1/**', async (route) => {
  24  |     const url = route.request().url()
  25  |     const method = route.request().method()
  26  |     let data: unknown = []
  27  |     if (url.endsWith('/v1/sectors') && method === 'GET') data = [SECTOR]
  28  |     else if (url.endsWith('/v1/sectors/sec-foods')) data = SECTOR
  29  |     else if (url.includes('/v1/companies')) data = { companies: [], total: 0 }
  30  |     else if (url.includes('/v1/sectors/sec-foods/context') && method === 'GET') {
  31  |       data = {
  32  |         sectorId: 'sec-foods',
  33  |         digest: { version: 'abc123def456', text: 'd' },
  34  |         segments: { system: 'Sector Speciality Foods: Ready meals', references: ['First fact.'], history: [], tail: [] },
  35  |         usage: {
  36  |           system: { messages: 0, estimatedTokens: 0 },
  37  |           references: { messages: 1, estimatedTokens: 42 },
  38  |           history: { messages: 0, estimatedTokens: 0 },
  39  |           tail: { messages: 0, estimatedTokens: 0 },
  40  |           totalEstimatedTokens: 42,
  41  |         },
  42  |         files: [],
  43  |         notes: [],
  44  |       }
  45  |     } else if (url.includes('/v1/sectors/sec-foods/documents')) data = []
  46  |     else if (url.includes('/v1/runs')) data = []
  47  |     else if (url.includes('/events?')) {
  48  |       await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
  49  |       return
  50  |     } else if (url.endsWith('/v1/sessions')) {
  51  |       data = [{ id: 's-1', title: 'Browser chat', createdAt: SECTOR.createdAt, updatedAt: SECTOR.updatedAt }]
  52  |     } else if (url.endsWith('/v1/sessions/s-1')) {
  53  |       data = { id: 's-1', title: 'Browser chat', createdAt: SECTOR.createdAt, updatedAt: SECTOR.updatedAt }
  54  |     } else if (url.endsWith('/v1/sessions/s-1/threads')) {
  55  |       data = [{ key: 's-1', sessionId: 's-1', kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: SECTOR.updatedAt }]
  56  |     } else if (url.includes('/v1/providers')) {
  57  |       data = {
  58  |         defaultProvider: 'meta',
  59  |         providers: [{ name: 'meta', hasKey: true, defaultModel: 'muse-spark-1.3-contributor', models: [
  60  |           { provider: 'meta', model: 'muse-spark-1.3-contributor', displayName: 'muse-spark-1.3-contributor', reasoning: 'native', mode: 'responses', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
  61  |         ] }],
  62  |       }
  63  |     }
  64  |     await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  65  |   })
  66  | }
  67  | 
  68  | async function shot(page: Page, name: string, anchors: Locator[]): Promise<void> {
> 69  |   for (const anchor of anchors) await expect(anchor).toBeVisible()
      |                                                      ^ Error: expect(locator).toBeVisible() failed
  70  |   await page.screenshot({ path: `test-results/visual/${name}.png`, animations: 'disabled' })
  71  | }
  72  | 
  73  | async function toDark(page: Page): Promise<void> {
  74  |   await page.getByRole('button', { name: 'Theme' }).click()
  75  |   await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  76  |   await expect(page.locator('html.dark')).toBeAttached()
  77  | }
  78  | 
  79  | async function captureSuite(page: Page, tag: string, dark = false): Promise<void> {
  80  |   await page.goto('/')
  81  |   if (dark) await toDark(page)
  82  |   await shot(page, `${tag}-overview`, [
  83  |     page.getByRole('heading', { name: 'Overview' }),
  84  |     page.getByRole('region', { name: 'Recent sectors' }),
  85  |   ])
  86  |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  87  |   await shot(page, `${tag}-researches`, [page.getByText('Speciality Foods')])
  88  |   await page.getByRole('link', { name: /^Speciality Foods/ }).click()
  89  |   // The sector route lands on the summary page; chat lives one Open deeper
  90  |   // (covered with session/thread/plan detail in workspace.spec.ts).
  91  |   await shot(page, `${tag}-detail`, [
  92  |     page.getByRole('region', { name: 'Research status' }),
  93  |     page.getByRole('button', { name: 'Open', exact: true }),
  94  |   ])
  95  |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Agents' }).click()
  96  |   await shot(page, `${tag}-agents`, [
  97  |     page.getByRole('heading', { name: 'Agents' }),
  98  |     page.getByLabel('Filter runs'),
  99  |   ])
  100 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Models' }).click()
  101 |   await shot(page, `${tag}-models`, [page.getByRole('heading', { name: 'Models' })])
  102 |   await page.getByRole('button', { name: 'Ask Karbot' }).click()
  103 |   const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  104 |   await shot(page, `${tag}-chat`, [chat])
  105 | }
  106 | 
  107 | test('matrix: light desktop 1440', async ({ page }) => {
  108 |   await page.setViewportSize({ width: 1440, height: 900 })
  109 |   await serveMatrixApi(page)
  110 |   await captureSuite(page, 'matrix-light-1440')
  111 | })
  112 | 
  113 | test('matrix: dark desktop 1440', async ({ page }) => {
  114 |   await page.setViewportSize({ width: 1440, height: 900 })
  115 |   await serveMatrixApi(page)
  116 |   await captureSuite(page, 'matrix-dark-1440', true)
  117 | })
  118 | 
  119 | test('matrix: light mobile 390', async ({ page }) => {
  120 |   await page.setViewportSize({ width: 390, height: 844 })
  121 |   await serveMatrixApi(page)
  122 |   await captureSuite(page, 'matrix-light-390')
  123 | })
  124 | 
  125 | test('matrix: dark mobile 390', async ({ page }) => {
  126 |   await page.setViewportSize({ width: 390, height: 844 })
  127 |   await serveMatrixApi(page)
  128 |   await captureSuite(page, 'matrix-dark-390', true)
  129 | })
  130 | 
  131 | test('matrix: reduced motion still completes navigation and dock', async ({ page }) => {
  132 |   await page.emulateMedia({ reducedMotion: 'reduce' })
  133 |   await page.setViewportSize({ width: 1440, height: 900 })
  134 |   await serveMatrixApi(page)
  135 |   await page.goto('/')
  136 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  137 |   await expect(page.getByRole('heading', { name: 'Researches', exact: true })).toBeFocused()
  138 |   await page.getByRole('button', { name: 'Ask Karbot' }).click()
  139 |   await expect(page.getByRole('complementary', { name: 'Assistant chat' })).toBeVisible()
  140 |   await page.keyboard.press('Escape')
  141 |   await expect(page.getByRole('complementary', { name: 'Assistant chat' })).not.toBeVisible()
  142 |   await expect(page.getByRole('button', { name: 'Ask Karbot' })).toBeFocused()
  143 |   await shot(page, 'matrix-reduced-motion', [page.getByRole('heading', { name: 'Researches', exact: true })])
  144 | })
  145 | 
```