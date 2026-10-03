import { expect, test } from '@playwright/test'

test.use({ video: 'on', trace: 'on' })
const sample = { seq: 500, at: '2026-10-01T00:00:00.000Z', sessionId: 'TEST session', sessionTitle: 'TEST named conversation', threadKey: `agent:${'TEST long thread identifier '.repeat(40)}`, sectorId: 'TEST sector', kind: 'closed-owner', response: 'park', state: 'current-warning', threadStatus: 'PAUSED' }
for (const width of [390, 1440]) for (const dark of [false, true]) test(`alerts paging and long references ${width} ${dark ? 'dark' : 'light'}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const data = url.pathname === '/v1/alerts' ? url.searchParams.has('beforeSeq') ? { items: [{ ...sample, seq: 479, state: 'historical', sectorId: null }], nextBeforeSeq: null } : { items: Array.from({ length: 20 }, (_, index) => ({ ...sample, seq: 500 - index, state: index === 0 ? 'current-warning' : 'historical' })), nextBeforeSeq: 481 } : []
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  })
  await page.goto('/?section=Agents')
  if (dark) {
    await page.getByRole('button', { name: 'Theme' }).click()
    await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  }
  const panel = page.getByRole('region', { name: 'Supervision alerts', exact: true })
  await expect(panel.getByRole('listitem')).toHaveCount(20)
  await expect(panel.getByText('Current warning · review paused work', { exact: true })).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('alerts-long.png'), fullPage: true, animations: 'disabled' })
  await panel.getByRole('button', { name: 'Older alerts', exact: true }).click()
  await expect(panel.getByRole('listitem')).toHaveCount(1)
  await expect(panel.getByText('Historical observation', { exact: true })).toBeVisible()
  await expect(panel.getByText('Current warning · review paused work', { exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Latest alerts', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(panel.getByRole('listitem')).toHaveCount(20)
})
test('alerts denied read clears warning rows and retry recovers without altering work', async ({ page }, info) => {
  let denied = true
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/v1/alerts' && denied) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'permission_denied', message: 'TEST denied' } }) })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: path === '/v1/alerts' ? { items: [], nextBeforeSeq: null } : [] }) })
  })
  await page.goto('/?section=Agents')
  const panel = page.getByRole('region', { name: 'Supervision alerts', exact: true })
  await expect(panel.getByText('Alerts is not shared with this key.', { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('alerts-denied.png'), animations: 'disabled' })
  denied = false
  await panel.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(panel.getByText('No supervision observations recorded for your sessions.', { exact: true })).toBeVisible()
})
