# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: alerts.spec.ts >> alerts denied read clears warning rows and retry recovers without altering work
- Location: ../tests/frontend-e2e/alerts.spec.ts:31:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('region', { name: 'Supervision alerts', exact: true }).getByText('Alerts is not shared with this key.', { exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('region', { name: 'Supervision alerts', exact: true }).getByText('Alerts is not shared with this key.', { exact: true }) with timeout 5000ms
  - waiting for getByRole('region', { name: 'Supervision alerts', exact: true }).getByText('Alerts is not shared with this key.', { exact: true })

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
  - heading "Agents" [level=1]
  - button "Refresh"
  - paragraph: Runs and supervision alerts across your sessions.
  - region "Alerts":
    - heading "Alerts" [level=2]
    - tablist "Alert scope":
      - tab "Current" [selected]
      - tab "History"
    - separator
    - paragraph: Durable observations for your sessions. Historical observations do not establish that work is currently unhealthy.
    - alert:
      - heading "Access denied" [level=3]
      - paragraph: Alerts are not shared with this key. Ask an owner for access, then try again.
      - button "Try again"
  - region "Runs":
    - heading "Runs" [level=2]
    - text: 0 of 0 runs
    - textbox "Search runs"
    - separator
    - paragraph: No runs yet
    - paragraph: Runs appear here once sessions start working.
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
  19 |   await expect(panel.getByRole('listitem')).toHaveCount(20)
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
> 40 |   await expect(panel.getByText('Alerts is not shared with this key.', { exact: true })).toBeVisible()
     |                                                                                         ^ Error: expect(locator).toBeVisible() failed
  41 |   await page.screenshot({ path: info.outputPath('alerts-denied.png'), animations: 'disabled' })
  42 |   denied = false
  43 |   await panel.getByRole('button', { name: 'Try again', exact: true }).click()
  44 |   await expect(panel.getByText('No supervision observations recorded for your sessions.', { exact: true })).toBeVisible()
  45 | })
  46 | 
```