# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: work-review.spec.ts >> intake review 1440px dark landing
- Location: ../tests/frontend-e2e/work-review.spec.ts:39:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.focus: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Review intake' })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - generic [aria-hidden] [ref=e3]:
      - complementary [ref=e4]:
        - generic [ref=e5]:
          - generic [aria-hidden] [ref=e6]: K
          - generic [ref=e7]: Kardata
        - navigation [ref=e8]:
          - button [ref=e9] [cursor=pointer]:
            - generic [ref=e15]: Overview
          - button [ref=e16] [cursor=pointer]:
            - generic [ref=e20]: Researches
          - button [ref=e21] [cursor=pointer]:
            - generic [ref=e25]: Agents
          - button [ref=e26] [cursor=pointer]:
            - generic [ref=e30]: Models
          - button [disabled] [ref=e31]:
            - generic [ref=e35]: Emails
            - generic [ref=e36]: Soon
        - button [expanded] [ref=e38] [cursor=pointer]
      - generic [ref=e39]:
        - banner [ref=e40]:
          - button [ref=e41] [cursor=pointer]:
            - generic [ref=e42]: Search...
            - generic [ref=e43]: Ctrl K
          - generic [ref=e44]:
            - button [ref=e45] [cursor=pointer]: Ask Karbot
            - button [ref=e46] [cursor=pointer]
        - main [ref=e47]:
          - generic [ref=e48]:
            - generic [ref=e49]:
              - navigation [ref=e50]:
                - list [ref=e51]:
                  - listitem [ref=e52]:
                    - button [ref=e53] [cursor=pointer]: Researches
                  - listitem [ref=e54]:
                    - generic [aria-hidden] [ref=e55]: /
                    - generic [ref=e56]: TEST review
              - generic [ref=e57]:
                - generic [ref=e58]:
                  - heading [level=1] [ref=e59]: TEST review
                  - generic [ref=e60]: Paused
                - generic [ref=e62]:
                  - button [ref=e63] [cursor=pointer]: View progress
                  - button [ref=e64] [cursor=pointer]: Open workspace
              - paragraph [ref=e65]: TEST fixtures only
              - paragraph [ref=e66]: Created 1 Oct 2026 · Updated 2d ago
            - generic [ref=e67]:
              - region [ref=e68]:
                - heading [level=2] [ref=e70]: Research status
                - separator [ref=e71]
                - generic [ref=e72]:
                  - paragraph [ref=e73]: Research is paused. Resume to continue where it stopped.
                  - group [ref=e74]:
                    - generic [ref=e75]:
                      - text: Companies found
                      - generic [ref=e76]: "0"
                    - generic [ref=e77]:
                      - text: Progress
                      - generic [ref=e78]:
                        - generic [ref=e79]: Not estimated yet
                        - button [ref=e80] [cursor=pointer]
                    - generic [ref=e81]:
                      - text: Last activity
                      - generic [ref=e82]: 2d ago
              - region [ref=e83]:
                - heading [level=2] [ref=e85]: Companies
                - separator [ref=e86]
                - generic [ref=e87]:
                  - generic [ref=e88]:
                    - textbox [ref=e90]:
                      - /placeholder: Search companies
                    - generic [ref=e91]:
                      - combobox [ref=e92] [cursor=pointer]:
                        - generic [ref=e93]: "Status: All"
                      - textbox [aria-hidden] [ref=e98]: all
                  - table [ref=e100]:
                    - rowgroup [ref=e101]:
                      - row [ref=e102]:
                        - columnheader [ref=e103]: Company
                        - columnheader [ref=e104]: Stage
                        - columnheader [ref=e105]: Status
                    - rowgroup [ref=e106]:
                      - row [ref=e107]:
                        - cell [ref=e108]:
                          - alert [ref=e110]:
                            - heading [level=3] [ref=e114]: Companies did not load.
                            - button [ref=e116] [cursor=pointer]: Try again
    - region "Notifications alt+T"
  - dialog [active] [ref=e119]:
    - generic [ref=e120]:
      - generic [ref=e121]:
        - heading "Research progress" [level=2] [ref=e122]
        - generic [ref=e123]: Paused
      - button "Close Research progress" [ref=e125] [cursor=pointer]
    - region "Research progress" [ref=e131]:
      - generic [ref=e132]:
        - heading "Progress" [level=2] [ref=e133]
        - paragraph [ref=e134]: Not estimated yet
      - group "Work counters" [ref=e135]:
        - generic [ref=e136]:
          - text: Completed
          - generic [ref=e137]: "0"
        - generic [ref=e138]:
          - text: Running
          - generic [ref=e139]: "0"
        - generic [ref=e140]:
          - text: Needs attention
          - generic [ref=e141]: "1"
        - generic [ref=e142]:
          - text: Excluded
          - generic [ref=e143]: "0"
      - generic [ref=e144]:
        - textbox "Search work items" [ref=e146]
        - paragraph [ref=e147]: Showing 1 of 1 work items
      - list "Work items" [ref=e148]:
        - listitem [ref=e149]:
          - generic [ref=e150]:
            - generic [ref=e152]:
              - generic [ref=e153]:
                - generic [ref=e154]: TEST intake long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate
                - generic [ref=e155]: Blocked
              - generic [ref=e156]: "uncertain: TEST geography could not be established. TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason"
            - generic [ref=e157]:
              - button "Review" [ref=e158] [cursor=pointer]
              - link "Open source" [ref=e159] [cursor=pointer]:
                - /url: https://example.com/TEST-source
              - button "Show details" [ref=e160] [cursor=pointer]
    - button "Open workspace" [ref=e162] [cursor=pointer]
```

# Test source

```ts
  1  | // Synthetic HTTP browser contract; no live company/provider/Temporal claim.
  2  | import { expect, test, type Page } from '@playwright/test'
  3  | test.use({ trace: 'on', video: 'on' })
  4  | const sectorId = 'TEST-review-sector', sessionId = 'TEST-review-session', at = '2026-10-01T00:00:00Z'
  5  | const sector = { id: sectorId, name: 'TEST review', topic: 'TEST fixtures only', state: 'paused', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: at, updatedAt: at }
  6  | const session = { id: sessionId, title: 'Research', kind: 'research', sectorId, createdAt: at, updatedAt: at }
  7  | const item = { id: `${sectorId}:v1:intake:test`, kind: 'discovery', title: 'TEST intake ' + 'long owner candidate '.repeat(40), state: 'blocked', attempts: 3, childId: null, sourceUrl: 'https://example.com/TEST-source', evidence: ['https://example.com/TEST-evidence'], detail: 'uncertain: TEST geography could not be established. ' + 'TEST saved reason '.repeat(40), receiptVersion: 'a'.repeat(64) }
  8  | async function fixtures(page: Page) {
  9  |   let current = { ...item }, fail = true
  10 |   const decisions: unknown[] = []
  11 |   await page.route('**/v1/**', async (route) => {
  12 |     const request = route.request(), path = new URL(request.url()).pathname
  13 |     if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
  14 |     if (path.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': TEST fixture\n\n' })
  15 |     if (path.endsWith('/review')) {
  16 |       decisions.push(request.postDataJSON())
  17 |       if (fail) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'permission_denied', message: 'TEST approver authority required' } }) })
  18 |       current = { ...current, state: 'excluded', receiptVersion: 'c'.repeat(64) }
  19 |       return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: current }) })
  20 |     }
  21 |     let data: unknown = []
  22 |     if (path === '/v1/sectors') data = [sector]
  23 |     else if (path === `/v1/sectors/${sectorId}`) data = sector
  24 |     else if (path.endsWith('/research-session')) data = session
  25 |     else if (path === '/v1/sessions') data = [session]
  26 |     else if (path.endsWith('/global-context')) data = { sectorId, version: 1, sections: { scope: 'TEST scope', decisions: '', findings: '', questions: '' }, markdown: 'TEST scope', researchSessionId: sessionId, changes: [] }
  27 |     else if (path.endsWith('/plan')) data = { sectorId, versions: [], latest: null, approvals: [], approvedVersion: null }
  28 |     else if (path.endsWith('/progress')) data = { sectorId, state: 'paused', planVersion: 1, items: [current], completed: 0, total: current.state === 'excluded' ? 0 : 1, unresolved: current.state === 'excluded' ? 0 : 1, discoveryClosed: false, estimatedPercent: null }
  29 |     else if (path.endsWith('/threads')) data = [{ key: sessionId, sessionId, kind: 'session', status: 'PAUSED', acceptingSteer: false, queueDepth: 0, updatedAt: at }]
  30 |     else if (path.endsWith('/steering-receipts')) data = { items: [], nextAfterId: null }
  31 |     else if (path.endsWith('/context')) data = { threadKey: sessionId, notes: '', summary: '', coveredSeq: 0, version: 0 }
  32 |     else if (path.startsWith('/v1/sessions/')) data = session
  33 |     else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [] }
  34 |     await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  35 |   })
  36 |   return { decisions, recover: () => { fail = false }, change: () => { current = { ...current, attempts: 4, receiptVersion: 'b'.repeat(64) } } }
  37 | }
  38 | for (const width of [1440,390]) for (const dark of [false,true]) for (const landing of [false,true]) {
  39 |   test(`intake review ${width}px ${dark ? 'dark' : 'light'} ${landing ? 'landing' : 'workspace'}`, async ({ page }, info) => {
  40 |     await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
  41 |     await page.emulateMedia({ reducedMotion: 'reduce' })
  42 |     const fixture = await fixtures(page)
  43 |     await page.goto(`/?section=${landing ? 'SectorDetail' : 'SectorChat'}&sector=${sectorId}`)
  44 |     if (dark) {
  45 |       if (!landing && width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
  46 |       if (landing) {
  47 |         await page.getByRole('button', { name: 'Theme' }).click()
  48 |         await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  49 |       } else {
  50 |         await page.getByRole('button', { name: 'Use dark theme' }).click()
  51 |       }
  52 |       if (!landing && width < 768) await page.getByRole('button', { name: 'Close Sessions' }).click()
  53 |     }
  54 |     if (landing) await page.getByRole('button', { name: 'View progress' }).click()
  55 |     else await page.getByRole('tab', { name: 'Plan', exact: true }).click()
  56 |     const trigger = page.getByRole('button', { name: 'Review intake' })
> 57 |     await trigger.focus(); await page.keyboard.press('Enter')
     |                   ^ Error: locator.focus: Test timeout of 30000ms exceeded.
  58 |     const dialog = page.getByRole('dialog', { name: 'Review candidate intake' })
  59 |     await expect(dialog).toBeVisible()
  60 |     await dialog.getByRole('textbox', { name: 'Owner reason' }).fill('TEST reviewed exact saved evidence')
  61 |     await dialog.getByRole('button', { name: 'Exclude candidate' }).click()
  62 |     await expect(dialog.getByRole('alert')).toContainText('TEST approver authority required')
  63 |     await expect(dialog.getByRole('textbox', { name: 'Owner reason' })).toHaveValue('TEST reviewed exact saved evidence')
  64 |     fixture.change()
  65 |     await dialog.getByRole('button', { name: 'Reload latest' }).click()
  66 |     await expect(dialog.getByRole('button', { name: 'Exclude candidate' })).toBeDisabled()
  67 |     await dialog.getByRole('button', { name: 'Review latest receipt' }).click()
  68 |     await expect(dialog).toContainText('4 attempts')
  69 |     await dialog.screenshot({ path: info.outputPath('intake-review.png'), animations: 'disabled' })
  70 |     const bounds = await dialog.boundingBox()
  71 |     expect(bounds!.width).toBeLessThanOrEqual(width)
  72 |     fixture.recover()
  73 |     await dialog.getByRole('button', { name: 'Exclude candidate' }).click()
  74 |     await expect(dialog).not.toBeVisible()
  75 |     await expect(trigger).not.toBeVisible()
  76 |     await expect(page.getByText(/0 of 0 work items completed.*1 candidates excluded/)).toBeVisible()
  77 |     expect(fixture.decisions.at(-1)).toMatchObject({ planVersion: 1, receiptVersion: 'b'.repeat(64), decision: 'exclude', reason: 'TEST reviewed exact saved evidence' })
  78 |   })
  79 | }
  80 | 
```