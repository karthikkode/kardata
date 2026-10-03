# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: visual.spec.ts >> visual: wave2 mobile sector detail stacked
- Location: ../tests/frontend-e2e/visual.spec.ts:161:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' })

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - complementary [ref=e4]:
      - generic [aria-hidden] [ref=e6]: K
      - navigation "Primary" [ref=e7]:
        - button [ref=e8] [cursor=pointer]
        - button [ref=e15] [cursor=pointer]
        - button [ref=e18] [cursor=pointer]
        - button [ref=e22] [cursor=pointer]
        - button "Emails (coming soon)" [disabled] [ref=e26]
    - generic [ref=e30]:
      - banner [ref=e31]:
        - button "Search" [ref=e32] [cursor=pointer]
        - generic [ref=e33]:
          - button "Ask Karbot" [ref=e34] [cursor=pointer]
          - button "Theme" [ref=e35] [cursor=pointer]
      - main [ref=e36]:
        - generic [ref=e37]:
          - generic [ref=e38]:
            - generic [ref=e39]:
              - heading "Overview" [active] [level=1] [ref=e41]
              - button "New sector" [ref=e43] [cursor=pointer]
            - paragraph [ref=e44]: Research activity across all sectors.
          - generic [ref=e45]:
            - group "Research totals" [ref=e46]:
              - 'button "Sectors: 1, 0 in progress. Show in Researches." [ref=e47] [cursor=pointer]':
                - generic [ref=e48]: Sectors
                - generic [ref=e49]: "1"
                - paragraph [ref=e50]: 0 in progress
              - 'button "Companies found: 0, Across 0 sectors. Show in Researches." [ref=e51] [cursor=pointer]':
                - generic [ref=e52]: Companies found
                - generic [ref=e53]: "0"
                - paragraph [ref=e54]: Across 0 sectors
              - 'button "Needs attention: 0, Failed or blocked research. Show in Researches." [ref=e55] [cursor=pointer]':
                - generic [ref=e56]: Needs attention
                - generic [ref=e57]: "0"
                - paragraph [ref=e58]: Failed or blocked research
              - 'button "Awaiting approval: 0, Plans waiting for review. Show in Researches." [ref=e59] [cursor=pointer]':
                - generic [ref=e60]: Awaiting approval
                - generic [ref=e61]: "0"
                - paragraph [ref=e62]: Plans waiting for review
            - region "Recent sectors" [ref=e63]:
              - generic [ref=e64]:
                - heading "Recent sectors" [level=2] [ref=e65]
                - button "View all" [ref=e66] [cursor=pointer]
              - separator [ref=e67]
              - list "Recent sectors" [ref=e69]:
                - listitem [ref=e70]:
                  - button "Speciality Foods Ready meals Draft 0 companies 6d ago" [ref=e71] [cursor=pointer]:
                    - generic [ref=e72]:
                      - generic "Speciality Foods" [ref=e73]
                      - generic "Ready meals" [ref=e74]
                    - generic [ref=e75]:
                      - generic [ref=e76]: Draft
                      - generic [ref=e78]: 0 companies
                      - generic "27 Sep 2026, 06:30" [ref=e79]: 6d ago
            - region "Recent companies" [ref=e82]:
              - generic [ref=e83]:
                - heading "Recent companies" [level=2] [ref=e84]
                - button "View all" [ref=e85] [cursor=pointer]
              - separator [ref=e86]
              - generic [ref=e88]:
                - heading "No companies yet" [level=3] [ref=e94]
                - paragraph [ref=e95]: Create a sector to start discovering companies.
                - button "New sector" [ref=e97] [cursor=pointer]
  - region "Notifications alt+T"
```

# Test source

```ts
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
  85  |   for (const anchor of anchors) await expect(anchor).toBeVisible()
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
> 165 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
      |                                                                                                       ^ Error: locator.click: Test timeout of 30000ms exceeded.
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
  186 |     page.getByRole('heading', { name: 'Agents' }),
  187 |     page.getByText('Cancelling'),
  188 |   ])
  189 | })
  190 | 
```