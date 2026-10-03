# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scale.spec.ts >> scale: 1000 companies walkable through Show more with truthful totals
- Location: ../tests/frontend-e2e/scale.spec.ts:53:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Open Scale sector 1', exact: true })

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
              - tab "Companies 1,000" [ref=e60] [cursor=pointer]
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
                    - cell "Scale sector 1 Thousand-row proof" [ref=e104]:
                      - generic [ref=e105]:
                        - generic "Scale sector 1" [ref=e106]
                        - generic "Thousand-row proof" [ref=e107]
                    - cell "In progress" [ref=e108]
                    - cell "1,000" [ref=e111]
                    - cell "6d ago" [ref=e112]
                    - cell [ref=e113]
  - region "Notifications alt+T"
```

# Test source

```ts
  1  | // Thousand-scale UI proof: 1000 companies reachable through Show-more
  2  | // windows with truthful totals at every step. Route-stubbed; no backend,
  3  | // no keys, no network. Timing is logged for the perf record.
  4  | import { expect, test, type Page } from '@playwright/test'
  5  | 
  6  | const AT = '2026-09-27T00:00:00.000Z'
  7  | 
  8  | const SECTOR = {
  9  |   id: 'sec-scale-1',
  10 |   name: 'Scale sector 1',
  11 |   topic: 'Thousand-row proof',
  12 |   companiesFound: 1000,
  13 |   state: 'running',
  14 |   createdAt: AT,
  15 |   updatedAt: AT,
  16 | }
  17 | 
  18 | const COMPANIES = Array.from({ length: 1000 }, (_, i) => ({
  19 |   id: `scale-co-${i + 1}`,
  20 |   sectorId: 'sec-scale-1',
  21 |   sectorName: 'Scale sector 1',
  22 |   name: `Scale company ${i + 1}`,
  23 |   stage: 'Filter',
  24 |   state: 'running',
  25 | }))
  26 | 
  27 | const DETAIL = {
  28 |   ...SECTOR,
  29 |   companies: COMPANIES.slice(0, 100),
  30 |   companiesTotal: 1000,
  31 |   activity: [],
  32 |   activityTotal: 0,
  33 | }
  34 | 
  35 | async function serveScaleApi(page: Page, refreshNames = false): Promise<() => void> {
  36 |   let refreshed = false
  37 |   await page.route('**/v1/**', async (route) => {
  38 |     const url = new URL(route.request().url())
  39 |     let data: unknown = []
  40 |     if (url.pathname.endsWith('/v1/sectors')) data = [SECTOR]
  41 |     else if (url.pathname.endsWith('/v1/sectors/sec-scale-1')) data = DETAIL
  42 |     else if (url.pathname === '/v1/companies') {
  43 |       const limit = Number(url.searchParams.get('limit') ?? '100')
  44 |       const offset = Number(url.searchParams.get('offset') ?? '0')
  45 |       const companies = COMPANIES.slice(offset, offset + limit).map((company) => refreshNames && refreshed ? { ...company, name: company.name.replace('Scale', 'Refreshed') } : company)
  46 |       data = { companies, total: COMPANIES.length }
  47 |     }
  48 |     await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  49 |   })
  50 |   return () => { refreshed = true }
  51 | }
  52 | 
  53 | test('scale: 1000 companies walkable through Show more with truthful totals', async ({ page }) => {
  54 |   await serveScaleApi(page)
  55 |   await page.goto('/')
  56 |   await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
> 57 |   await page.getByRole('button', { name: 'Open Scale sector 1', exact: true }).click()
     |                                                                                ^ Error: locator.click: Test timeout of 30000ms exceeded.
  58 |   await expect(page.getByText('Scale company 100')).toBeVisible()
  59 |   await expect(page.getByText('Showing 100 of 1000 companies')).toBeVisible()
  60 | 
  61 |   const started = Date.now()
  62 |   for (let shown = 100; shown < 1000; shown += 100) {
  63 |     await page.getByRole('button', { name: `Show more (${shown} of 1000)` }).click()
  64 |     await expect(page.getByText(`Scale company ${shown + 100}`)).toBeVisible()
  65 |     await expect(page.getByText(`Showing ${shown + 100} of 1000 companies`)).toBeVisible()
  66 |   }
  67 |   const walkMs = Date.now() - started
  68 |   // eslint-disable-next-line no-console
  69 |   console.log(`[scale-e2e] thousandWalkMs=${walkMs}`)
  70 |   await expect(page.getByText('Showing 1000 of 1000 companies')).toBeVisible()
  71 |   await expect(page.getByRole('button', { name: /Show more/ })).toHaveCount(0)
  72 | })
  73 | 
  74 | test('scale: polling updates loaded company rows without collapsing the window', async ({ page }) => {
  75 |   const refresh = await serveScaleApi(page, true)
  76 |   await page.goto('/?section=SectorDetail&sector=sec-scale-1')
  77 |   await expect(page.getByText('Scale company 100')).toBeVisible()
  78 |   await page.getByRole('button', { name: 'Show more (100 of 1000)' }).click()
  79 |   await expect(page.getByText('Showing 200 of 1000 companies')).toBeVisible()
  80 |   refresh()
  81 |   await expect(page.getByText('Refreshed company 200')).toBeVisible({ timeout: 10000 })
  82 |   await expect(page.getByText('Showing 200 of 1000 companies')).toBeVisible()
  83 |   await page.screenshot({ path: 'test-results/visual/hardening-company-window-poll.png', animations: 'disabled' })
  84 | })
  85 | 
```