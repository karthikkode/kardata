# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: work-review.spec.ts >> intake review 390px dark landing
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
        - generic [aria-hidden] [ref=e6]: K
        - navigation [ref=e7]:
          - button [ref=e8] [cursor=pointer]
          - button [ref=e14] [cursor=pointer]
          - button [ref=e18] [cursor=pointer]
          - button [ref=e22] [cursor=pointer]
          - button [disabled] [ref=e26]
      - generic [ref=e30]:
        - banner [ref=e31]:
          - button [ref=e32] [cursor=pointer]
          - generic [ref=e33]:
            - button [ref=e34] [cursor=pointer]
            - button [ref=e35] [cursor=pointer]
        - main [ref=e36]:
          - generic [ref=e37]:
            - generic [ref=e38]:
              - navigation [ref=e39]:
                - list [ref=e40]:
                  - listitem [ref=e41]:
                    - button [ref=e42] [cursor=pointer]: Researches
                  - listitem [ref=e43]:
                    - generic [aria-hidden] [ref=e44]: /
                    - generic [ref=e45]: TEST review
              - generic [ref=e46]:
                - generic [ref=e47]:
                  - heading [level=1] [ref=e48]: TEST review
                  - generic [ref=e49]: Paused
                - generic [ref=e51]:
                  - button [ref=e52] [cursor=pointer]: View progress
                  - button [ref=e53] [cursor=pointer]: Open workspace
              - paragraph [ref=e54]: TEST fixtures only
              - paragraph [ref=e55]: Created 1 Oct 2026 · Updated 2d ago
            - generic [ref=e56]:
              - region [ref=e57]:
                - heading [level=2] [ref=e59]: Research status
                - separator [ref=e60]
                - generic [ref=e61]:
                  - paragraph [ref=e62]: Research is paused. Resume to continue where it stopped.
                  - group [ref=e63]:
                    - generic [ref=e64]:
                      - text: Companies found
                      - generic [ref=e65]: "0"
                    - generic [ref=e66]:
                      - text: Progress
                      - generic [ref=e67]:
                        - generic [ref=e68]: Not estimated yet
                        - button [ref=e69] [cursor=pointer]
                    - generic [ref=e70]:
                      - text: Last activity
                      - generic [ref=e71]: 2d ago
              - region [ref=e72]:
                - heading [level=2] [ref=e74]: Companies
                - separator [ref=e75]
                - generic [ref=e76]:
                  - generic [ref=e77]:
                    - textbox [ref=e79]:
                      - /placeholder: Search companies
                    - generic [ref=e80]:
                      - combobox [ref=e81] [cursor=pointer]:
                        - generic [ref=e82]: "Status: All"
                      - textbox [aria-hidden] [ref=e87]: all
                  - table [ref=e89]:
                    - rowgroup [ref=e90]:
                      - row [ref=e91]:
                        - cell [ref=e92]:
                          - alert [ref=e94]:
                            - heading [level=3] [ref=e98]: Companies did not load.
                            - button [ref=e100] [cursor=pointer]: Try again
    - region "Notifications alt+T"
  - dialog [active] [ref=e103]:
    - generic [ref=e104]:
      - generic [ref=e105]:
        - heading "Research progress" [level=2] [ref=e106]
        - generic [ref=e107]: Paused
      - button "Close Research progress" [ref=e109] [cursor=pointer]
    - region "Research progress" [ref=e115]:
      - generic [ref=e116]:
        - heading "Progress" [level=2] [ref=e117]
        - paragraph [ref=e118]: Not estimated yet
      - group "Work counters" [ref=e119]:
        - generic [ref=e120]:
          - text: Completed
          - generic [ref=e121]: "0"
        - generic [ref=e122]:
          - text: Running
          - generic [ref=e123]: "0"
        - generic [ref=e124]:
          - text: Needs attention
          - generic [ref=e125]: "1"
        - generic [ref=e126]:
          - text: Excluded
          - generic [ref=e127]: "0"
      - generic [ref=e128]:
        - textbox "Search work items" [ref=e130]
        - paragraph [ref=e131]: Showing 1 of 1 work items
      - list "Work items" [ref=e132]:
        - listitem [ref=e133]:
          - generic [ref=e134]:
            - generic [ref=e136]:
              - generic [ref=e137]:
                - generic [ref=e138]: TEST intake long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate
                - generic [ref=e139]: Blocked
              - generic [ref=e140]: "uncertain: TEST geography could not be established. TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason"
            - generic [ref=e141]:
              - button "Review" [ref=e142] [cursor=pointer]
              - link "Open source" [ref=e143] [cursor=pointer]:
                - /url: https://example.com/TEST-source
              - button "Show details" [ref=e144] [cursor=pointer]
    - button "Open workspace" [ref=e146] [cursor=pointer]
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