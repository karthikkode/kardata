# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: revamp-evidence.spec.ts >> revamp: overlay exits are armed with ending-style transitions
- Location: ../tests/frontend-e2e/revamp-evidence.spec.ts:88:1

# Error details

```
Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'New sector' }) resolved to 2 elements:
    1) <button tabindex="0" type="button" data-slot="button" class="group/button inline-flex shrink-0 cursor-pointer items-center justify-center font-medium whitespace-nowrap outline-none select-none transition-all duration-120 ease-out-soft active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 bg-primary text-p…>…</button> aka getByRole('button', { name: 'New sector' }).first()
    2) <button tabindex="0" type="button" data-slot="button" class="group/button inline-flex shrink-0 cursor-pointer items-center justify-center font-medium whitespace-nowrap outline-none select-none transition-all duration-120 ease-out-soft active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 bg-primary text-p…>…</button> aka getByRole('region', { name: 'Recent companies' }).getByRole('button', { name: 'New sector' })

Call log:
  - waiting for getByRole('button', { name: 'New sector' })

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - complementary [ref=e4]:
      - generic [ref=e5]:
        - generic [aria-hidden] [ref=e6]: K
        - generic [ref=e7]: Kardata
      - navigation "Primary" [ref=e8]:
        - button "Overview" [ref=e9] [cursor=pointer]
        - button "Researches" [ref=e16] [cursor=pointer]
        - button "Agents" [ref=e21] [cursor=pointer]
        - button "Models" [ref=e26] [cursor=pointer]
        - button "Emails (coming soon)" [disabled] [ref=e31]:
          - generic [ref=e35]: Emails
          - generic [ref=e36]: Soon
      - button "Collapse sidebar" [expanded] [ref=e38] [cursor=pointer]
    - generic [ref=e39]:
      - banner [ref=e40]:
        - button "Search... Ctrl K" [ref=e41] [cursor=pointer]:
          - generic [ref=e42]: Search...
          - generic [ref=e43]: Ctrl K
        - generic [ref=e44]:
          - button "Ask Karbot" [ref=e45] [cursor=pointer]
          - button "Theme" [ref=e46] [cursor=pointer]
      - main [ref=e47]:
        - generic [ref=e48]:
          - generic [ref=e49]:
            - generic [ref=e50]:
              - heading "Researches" [active] [level=1] [ref=e52]
              - button "New sector" [ref=e54] [cursor=pointer]
            - paragraph [ref=e55]: Sectors you research and the companies they discover.
          - generic [ref=e56]:
            - tablist "Research type" [ref=e57]:
              - tab "Sectors 1" [selected] [ref=e58] [cursor=pointer]
              - tab "Companies 0" [ref=e60] [cursor=pointer]
            - generic [ref=e61]:
              - textbox "Search sectors" [ref=e63]
              - generic [ref=e64]:
                - 'combobox "Status: All" [ref=e65] [cursor=pointer]'
                - textbox [aria-hidden] [ref=e71]: all
              - paragraph [ref=e73]: 1 sector
            - tabpanel "Sectors 1" [ref=e74]:
              - table "Sectors" [ref=e77]:
                - rowgroup [ref=e78]:
                  - row [ref=e79]:
                    - columnheader [ref=e80]:
                      - button "Sort by Sector" [ref=e81] [cursor=pointer]: Sector
                    - columnheader [ref=e85]:
                      - button "Sort by Status" [ref=e86] [cursor=pointer]: Status
                    - columnheader [ref=e90]:
                      - button "Sort by Companies" [ref=e91] [cursor=pointer]: Companies
                    - columnheader [ref=e95]:
                      - button "Sort by Updated" [ref=e96] [cursor=pointer]: Updated
                    - columnheader "Open" [ref=e100]
                - rowgroup [ref=e102]:
                  - link [ref=e103] [cursor=pointer]:
                    - cell "Speciality Foods Ready meals" [ref=e104]:
                      - generic [ref=e105]:
                        - generic "Speciality Foods" [ref=e106]
                        - generic "Ready meals" [ref=e107]
                    - cell "Draft" [ref=e108]
                    - cell "0" [ref=e111]
                    - cell "6d ago" [ref=e112]
                    - cell [ref=e113]
  - region "Notifications alt+T"
```

# Test source

```ts
  1   | // Revamp-completion evidence: browser proof for the surfaces this pass
  2   | // introduced or migrated (Researches Tabs/Select/creation dialog, Karbot
  3   | // deletion dialog, Models selects), a 200%-zoom overflow gate, loaded-list
  4   | // filter timings, and long-task/memory profiling across transitions.
  5   | // Synthetic fixtures only.
  6   | import { expect, test, type Locator, type Page } from '@playwright/test'
  7   | 
  8   | test.use({ video: 'on' })
  9   | 
  10  | const SECTOR = {
  11  |   id: 'sec-foods',
  12  |   name: 'Speciality Foods',
  13  |   topic: 'Ready meals',
  14  |   state: 'draft',
  15  |   companiesFound: 0,
  16  |   companies: [],
  17  |   companiesTotal: 0,
  18  |   activity: [],
  19  |   activityTotal: 0,
  20  |   createdAt: '2026-09-27T00:00:00.000Z',
  21  |   updatedAt: '2026-09-27T01:00:00.000Z',
  22  | }
  23  | 
  24  | async function serveApi(page: Page): Promise<void> {
  25  |   await page.route('**/v1/**', async (route) => {
  26  |     const url = route.request().url()
  27  |     let data: unknown = []
  28  |     if (url.endsWith('/v1/sectors')) data = [SECTOR]
  29  |     else if (url.endsWith('/v1/sectors/sec-foods')) data = SECTOR
  30  |     else if (url.includes('/v1/companies')) data = { companies: [], total: 0 }
  31  |     else if (url.includes('/events?')) {
  32  |       await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
  33  |       return
  34  |     } else if (url.endsWith('/v1/sessions')) {
  35  |       data = [{ id: 's-1', title: 'Browser chat', createdAt: SECTOR.createdAt, updatedAt: SECTOR.updatedAt }]
  36  |     } else if (url.endsWith('/v1/sessions/s-1')) {
  37  |       data = { id: 's-1', title: 'Browser chat', createdAt: SECTOR.createdAt, updatedAt: SECTOR.updatedAt }
  38  |     } else if (url.endsWith('/v1/sessions/s-1/threads')) {
  39  |       data = [{ key: 's-1', sessionId: 's-1', kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: SECTOR.updatedAt }]
  40  |     } else if (url.includes('/v1/providers')) {
  41  |       data = {
  42  |         defaultProvider: 'meta',
  43  |         providers: [{ name: 'meta', hasKey: true, defaultModel: 'muse-spark-1.3-contributor', models: [
  44  |           { provider: 'meta', model: 'muse-spark-1.3-contributor', displayName: 'muse-spark-1.3-contributor', reasoning: 'native', mode: 'responses', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
  45  |         ] }],
  46  |       }
  47  |     }
  48  |     await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  49  |   })
  50  | }
  51  | 
  52  | async function shot(page: Page, name: string, anchors: Locator[]): Promise<void> {
  53  |   for (const anchor of anchors) await expect(anchor).toBeVisible()
  54  |   await page.screenshot({ path: `test-results/visual/${name}.png`, animations: 'disabled' })
  55  | }
  56  | 
  57  | for (const dark of [false, true]) {
  58  |   test(`revamp: researches tabs, select, and creation dialog ${dark ? 'dark' : 'light'}`, async ({ page }) => {
  59  |     await page.setViewportSize({ width: 1440, height: 900 })
  60  |     await serveApi(page)
  61  |     await page.goto('/')
  62  |     if (dark) {
  63  |       await page.getByRole('button', { name: 'Theme' }).click()
  64  |       await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  65  |     }
  66  |     await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  67  |     // Controlled tabs with keyboard behavior and a labeled state selection.
  68  |     await expect(page.getByRole('tab', { name: 'Sectors 1' })).toHaveAttribute('aria-selected', 'true')
  69  |     await page.getByRole('tab', { name: 'Companies 0' }).click()
  70  |     await expect(page.getByRole('tab', { name: 'Companies 0' })).toHaveAttribute('aria-selected', 'true')
  71  |     await page.getByRole('tab', { name: 'Sectors 1' }).click()
  72  |     await expect(page.getByRole('combobox', { name: 'Status: All' })).toBeVisible()
  73  |     // Creation dialog: title, labeled fields, sticky footer, Escape return.
  74  |     await page.getByRole('button', { name: 'New sector' }).click()
  75  |     const dialog = page.getByRole('dialog', { name: 'New sector' })
  76  |     await expect(dialog.getByLabel('Name')).toBeVisible()
  77  |     await expect(dialog.getByLabel('Topic (optional)')).toBeVisible()
  78  |     await expect(dialog.getByRole('button', { name: 'Create sector' })).toBeVisible()
  79  |     await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
  80  |     await shot(page, `revamp-researches-dialog-${dark ? 'dark' : 'light'}`, [dialog.getByLabel('Name')])
  81  |     await page.keyboard.press('Escape')
  82  |     await expect(dialog).not.toBeVisible()
  83  |     await expect(page.getByRole('button', { name: 'New sector' })).toBeFocused()
  84  |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  85  |   })
  86  | }
  87  | 
  88  | test('revamp: overlay exits are armed with ending-style transitions', async ({ page }) => {
  89  |   await page.setViewportSize({ width: 1440, height: 900 })
  90  |   await serveApi(page)
  91  |   await page.goto('/')
  92  |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
> 93  |   await page.getByRole('button', { name: 'New sector' }).click()
      |                                                          ^ Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'New sector' }) resolved to 2 elements:
  94  |   const dialog = page.getByRole('dialog', { name: 'New sector' })
  95  |   await expect(dialog).toBeVisible()
  96  |   expect(await dialog.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe('0.18s')
  97  |   await page.keyboard.press('Escape')
  98  |   await expect(dialog).not.toBeVisible()
  99  | })
  100 | 
  101 | test('revamp: karbot deletion uses the shared alert dialog', async ({ page }) => {
  102 |   await page.setViewportSize({ width: 1440, height: 900 })
  103 |   await serveApi(page)
  104 |   await page.goto('/')
  105 |   await page.getByRole('button', { name: 'Ask Karbot' }).click()
  106 |   const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  107 |   await expect(chat).toBeVisible()
  108 |   await chat.getByRole('button', { name: 'Chat sessions' }).click()
  109 |   const sessions = chat.getByRole('menu', { name: 'Chat sessions' })
  110 |   await sessions.getByRole('button', { name: 'Delete Browser chat' }).click()
  111 |   const confirm = page.getByRole('alertdialog', { name: 'Delete "Browser chat"?' })
  112 |   await expect(confirm).toBeVisible()
  113 |   await expect(confirm.getByRole('button', { name: 'Delete conversation' })).toBeVisible()
  114 |   await shot(page, 'revamp-deletion-dialog', [confirm])
  115 |   await page.keyboard.press('Escape')
  116 |   await expect(confirm).not.toBeVisible()
  117 | })
  118 | 
  119 | test('revamp: models selects use the shared selection controls', async ({ page }) => {
  120 |   await page.setViewportSize({ width: 1440, height: 900 })
  121 |   await serveApi(page)
  122 |   await page.goto('/')
  123 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Models' }).click()
  124 |   await expect(page.getByText('Configured', { exact: true })).toBeVisible()
  125 |   const model = page.getByRole('combobox', { name: 'Model' })
  126 |   await expect(model).toBeVisible()
  127 |   await model.click()
  128 |   await expect(page.getByRole('option', { name: 'muse-spark-1.3-contributor' })).toBeVisible()
  129 |   await shot(page, 'revamp-models-select', [page.getByRole('option', { name: 'muse-spark-1.3-contributor' })])
  130 |   await page.keyboard.press('Escape')
  131 |   await expect(model).toBeFocused()
  132 | })
  133 | 
  134 | test('revamp: palette opens from every shell page', async ({ page }) => {
  135 |   await page.setViewportSize({ width: 1440, height: 900 })
  136 |   await serveApi(page)
  137 |   await page.goto('/')
  138 |   await page.keyboard.press('ControlOrMeta+k')
  139 |   await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
  140 |   await page.keyboard.press('Escape')
  141 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  142 |   await page.getByRole('button', { name: /Search\.\.\. Ctrl K/ }).click()
  143 |   await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
  144 | })
  145 | 
  146 | test('revamp: 200% zoom keeps overview, researches, and dialog inside the viewport', async ({ page }) => {
  147 |   // 720 CSS px at 1440 physical ≈ 200% zoom.
  148 |   await page.setViewportSize({ width: 720, height: 900 })
  149 |   await serveApi(page)
  150 |   await page.goto('/')
  151 |   await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  152 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  153 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  154 |   await page.getByRole('button', { name: 'New sector' }).click()
  155 |   await expect(page.getByRole('dialog', { name: 'New sector' })).toBeVisible()
  156 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  157 |   await shot(page, 'revamp-zoom-dialog', [page.getByRole('dialog', { name: 'New sector' })])
  158 | })
  159 | 
  160 | test('revamp: loaded-list filter timing probe', async ({ page }) => {
  161 |   await page.setViewportSize({ width: 1440, height: 900 })
  162 |   const at = '2026-10-01T00:00:00.000Z'
  163 |   const sectorId = 'TEST-timing-sector'
  164 |   const sessionId = 'TEST-timing-research'
  165 |   const session = { id: sessionId, title: 'Research', kind: 'research', sectorId, createdAt: at, updatedAt: at }
  166 |   const sector = { id: sectorId, name: 'TEST Timing', topic: 'TEST', state: 'approved', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: at, updatedAt: at }
  167 |   const files = Array.from({ length: 2005 }, (_, index) => ({
  168 |     id: `TEST-timing-file-${index}`,
  169 |     filename: `TEST file ${String(index).padStart(4, '0')}.md`,
  170 |     status: 'indexed',
  171 |     source: 'Uploaded',
  172 |     hash: `TEST-version-${index}`,
  173 |     hidden: false,
  174 |     included: false,
  175 |     kind: 'document',
  176 |   }))
  177 |   await page.route('**/v1/**', async (route) => {
  178 |     const path = new URL(route.request().url()).pathname
  179 |     let data: unknown = []
  180 |     if (path.endsWith('/files')) data = files
  181 |     else if (path === '/v1/sectors') data = [sector]
  182 |     else if (path === `/v1/sectors/${sectorId}`) data = sector
  183 |     else if (path.endsWith('/research-session')) data = session
  184 |     else if (path === '/v1/sessions') data = [session]
  185 |     else if (path.endsWith('/global-context')) data = { sectorId, version: 1, sections: { scope: 'TEST' }, markdown: '## Scope\n\nTEST', researchSessionId: sessionId, changes: [] }
  186 |     else if (path.endsWith('/plan')) data = { sectorId, versions: [], latest: null, approvals: [], approvedVersion: null }
  187 |     else if (path.endsWith('/progress')) data = { sectorId, state: 'approved', planVersion: 0, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
  188 |     else if (path.endsWith('/threads')) data = [{ key: sessionId, sessionId, kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: at }]
  189 |     else if (path.endsWith('/context')) data = { threadKey: sessionId, notes: '', summary: '', coveredSeq: 0, version: 0 }
  190 |     else if (path.startsWith('/v1/sessions/')) data = session
  191 |     else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [] }
  192 |     await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  193 |   })
```