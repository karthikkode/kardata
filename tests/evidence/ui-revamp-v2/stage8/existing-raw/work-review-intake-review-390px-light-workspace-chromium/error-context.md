# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: work-review.spec.ts >> intake review 390px light workspace
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
- generic [ref=e2]:
  - main [ref=e4]:
    - generic [ref=e5]:
      - button "Open sessions" [ref=e6] [cursor=pointer]
      - generic [ref=e7]:
        - heading "Research" [level=1] [ref=e8]
        - generic [ref=e9]:
          - generic [ref=e10]: Paused
          - generic [ref=e12]: No plan yet
      - button "Resume" [ref=e13] [cursor=pointer]
      - button "Open files and global context" [ref=e14] [cursor=pointer]
      - button "Conversation options" [ref=e15] [cursor=pointer]
    - generic [ref=e16]:
      - tablist "Research views" [ref=e17]:
        - tab "Chat" [ref=e18] [cursor=pointer]
        - tab "Plan" [active] [selected] [ref=e19] [cursor=pointer]
      - tabpanel "Plan" [ref=e22]:
        - generic [ref=e23]:
          - generic [ref=e24]:
            - heading "No research plan yet" [level=3] [ref=e29]
            - paragraph [ref=e30]: Create a plan to lock search queries, limits and acceptance criteria before research starts.
            - button "Create plan" [ref=e32] [cursor=pointer]
          - region "Research progress" [ref=e33]:
            - generic [ref=e34]:
              - heading "Progress" [level=2] [ref=e35]
              - paragraph [ref=e36]: Not estimated yet
            - group "Work counters" [ref=e37]:
              - generic [ref=e38]:
                - text: Completed
                - generic [ref=e39]: "0"
              - generic [ref=e40]:
                - text: Running
                - generic [ref=e41]: "0"
              - generic [ref=e42]:
                - text: Needs attention
                - generic [ref=e43]: "1"
              - generic [ref=e44]:
                - text: Excluded
                - generic [ref=e45]: "0"
            - generic [ref=e46]:
              - textbox "Search work items" [ref=e48]
              - paragraph [ref=e49]: Showing 1 of 1 work items
            - list "Work items" [ref=e50]:
              - listitem [ref=e51]:
                - generic [ref=e52]:
                  - generic [ref=e54]:
                    - generic [ref=e55]:
                      - generic [ref=e56]: TEST intake long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate long owner candidate
                      - generic [ref=e57]: Blocked
                    - generic [ref=e58]: "uncertain: TEST geography could not be established. TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason TEST saved reason"
                  - generic [ref=e59]:
                    - button "Review" [ref=e60] [cursor=pointer]
                    - link "Open source" [ref=e61] [cursor=pointer]:
                      - /url: https://example.com/TEST-source
                    - button "Show details" [ref=e62] [cursor=pointer]
  - region "Notifications alt+T"
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