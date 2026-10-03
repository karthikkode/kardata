# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: alerts.spec.ts >> alerts paging and long references 1440 dark
- Location: ../tests/frontend-e2e/alerts.spec.ts:5:68

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByRole('region', { name: 'Supervision alerts', exact: true }).getByRole('listitem')
Expected: 20
Received: 0
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" getByRole('region', { name: 'Supervision alerts', exact: true }).getByRole('listitem') with timeout 5000ms
  - waiting for getByRole('region', { name: 'Supervision alerts', exact: true }).getByRole('listitem')
    14 × locator resolved to 0 elements
       - unexpected value "0"

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
        - button "Agents" [ref=e20] [cursor=pointer]
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
          - button "Theme" [active] [ref=e46] [cursor=pointer]
      - main [ref=e47]:
        - generic [ref=e48]:
          - generic [ref=e49]:
            - generic [ref=e50]:
              - heading "Agents" [level=1] [ref=e52]
              - button "Refresh" [ref=e54] [cursor=pointer]
            - paragraph [ref=e55]: Runs and supervision alerts across your sessions.
          - generic [ref=e56]:
            - region "Alerts" [ref=e57]:
              - generic [ref=e58]:
                - heading "Alerts" [level=2] [ref=e59]
                - tablist "Alert scope" [ref=e61]:
                  - tab "Current" [selected] [ref=e62] [cursor=pointer]
                  - tab "History" [ref=e65] [cursor=pointer]
              - separator [ref=e67]
              - generic [ref=e68]:
                - paragraph [ref=e69]: Durable observations for your sessions. Historical observations do not establish that work is currently unhealthy.
                - list "Current warnings" [ref=e70]:
                  - listitem [ref=e71]:
                    - generic [ref=e72]:
                      - generic [ref=e76]:
                        - generic [ref=e77]: Owning execution ended
                        - generic [ref=e78]: Session TEST named conversation · Parked for review
                      - generic [ref=e79]:
                        - generic "10/1/2026, 5:30:00 AM" [ref=e80]: 2d ago
                        - button "Open conversation" [ref=e81] [cursor=pointer]
              - separator [ref=e82]
              - button "Older alerts" [ref=e84] [cursor=pointer]
            - region "Runs" [ref=e86]:
              - generic [ref=e87]:
                - heading "Runs" [level=2] [ref=e88]
                - generic [ref=e89]: 0 of 0 runs
                - textbox "Search runs" [ref=e91]
              - separator [ref=e92]
              - generic [ref=e94]:
                - paragraph [ref=e95]: No runs yet
                - paragraph [ref=e96]: Runs appear here once sessions start working.
  - region "Notifications alt+T"
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | 
  3  | test.use({ video: 'on', trace: 'on' })
  4  | const sample = { seq: 500, at: '2026-10-01T00:00:00.000Z', sessionId: 'TEST session', sessionTitle: 'TEST named conversation', threadKey: `agent:${'TEST long thread identifier '.repeat(40)}`, sectorId: 'TEST sector', kind: 'closed-owner', response: 'park', state: 'current-warning', threadStatus: 'PAUSED' }
  5  | for (const width of [390, 1440]) for (const dark of [false, true]) test(`alerts paging and long references ${width} ${dark ? 'dark' : 'light'}`, async ({ page }, info) => {
  6  |   await page.setViewportSize({ width, height: 900 })
  7  |   await page.emulateMedia({ reducedMotion: 'reduce' })
  8  |   await page.route('**/v1/**', async (route) => {
  9  |     const url = new URL(route.request().url())
  10 |     const data = url.pathname === '/v1/alerts' ? url.searchParams.has('beforeSeq') ? { items: [{ ...sample, seq: 479, state: 'historical', sectorId: null }], nextBeforeSeq: null } : { items: Array.from({ length: 20 }, (_, index) => ({ ...sample, seq: 500 - index, state: index === 0 ? 'current-warning' : 'historical' })), nextBeforeSeq: 481 } : []
  11 |     await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  12 |   })
  13 |   await page.goto('/?section=Agents')
  14 |   if (dark) {
  15 |     await page.getByRole('button', { name: 'Theme' }).click()
  16 |     await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  17 |   }
  18 |   const panel = page.getByRole('region', { name: 'Supervision alerts', exact: true })
> 19 |   await expect(panel.getByRole('listitem')).toHaveCount(20)
     |                                             ^ Error: expect(locator).toHaveCount(expected) failed
  20 |   await expect(panel.getByText('Current warning · review paused work', { exact: true })).toHaveCount(1)
  21 |   await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  22 |   await page.screenshot({ path: info.outputPath('alerts-long.png'), fullPage: true, animations: 'disabled' })
  23 |   await panel.getByRole('button', { name: 'Older alerts', exact: true }).click()
  24 |   await expect(panel.getByRole('listitem')).toHaveCount(1)
  25 |   await expect(panel.getByText('Historical observation', { exact: true })).toBeVisible()
  26 |   await expect(panel.getByText('Current warning · review paused work', { exact: true })).toHaveCount(0)
  27 |   await panel.getByRole('button', { name: 'Latest alerts', exact: true }).focus()
  28 |   await page.keyboard.press('Enter')
  29 |   await expect(panel.getByRole('listitem')).toHaveCount(20)
  30 | })
  31 | test('alerts denied read clears warning rows and retry recovers without altering work', async ({ page }, info) => {
  32 |   let denied = true
  33 |   await page.route('**/v1/**', async (route) => {
  34 |     const path = new URL(route.request().url()).pathname
  35 |     if (path === '/v1/alerts' && denied) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'permission_denied', message: 'TEST denied' } }) })
  36 |     await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: path === '/v1/alerts' ? { items: [], nextBeforeSeq: null } : [] }) })
  37 |   })
  38 |   await page.goto('/?section=Agents')
  39 |   const panel = page.getByRole('region', { name: 'Supervision alerts', exact: true })
  40 |   await expect(panel.getByText('Alerts is not shared with this key.', { exact: true })).toBeVisible()
  41 |   await page.screenshot({ path: info.outputPath('alerts-denied.png'), animations: 'disabled' })
  42 |   denied = false
  43 |   await panel.getByRole('button', { name: 'Try again', exact: true }).click()
  44 |   await expect(panel.getByText('No supervision observations recorded for your sessions.', { exact: true })).toBeVisible()
  45 | })
  46 | 
```