// Synthetic HTTP browser contract; no live company/provider/Temporal claim.
import { expect, test, type Page } from '@playwright/test'
test.use({ trace: 'on', video: 'on' })
const sectorId = 'TEST-review-sector', sessionId = 'TEST-review-session', at = '2026-10-01T00:00:00Z'
const sector = { id: sectorId, name: 'TEST review', topic: 'TEST fixtures only', state: 'paused', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: at, updatedAt: at }
const session = { id: sessionId, title: 'Research', kind: 'research', sectorId, createdAt: at, updatedAt: at }
const item = { id: `${sectorId}:v1:intake:test`, kind: 'discovery', title: 'TEST intake ' + 'long owner candidate '.repeat(40), state: 'blocked', attempts: 3, childId: null, sourceUrl: 'https://example.com/TEST-source', evidence: ['https://example.com/TEST-evidence'], detail: 'uncertain: TEST geography could not be established. ' + 'TEST saved reason '.repeat(40), receiptVersion: 'a'.repeat(64) }
async function fixtures(page: Page) {
  let current = { ...item }, fail = true
  const decisions: unknown[] = []
  await page.route('**/v1/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
    if (path.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': TEST fixture\n\n' })
    if (path.endsWith('/review')) {
      decisions.push(request.postDataJSON())
      if (fail) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'permission_denied', message: 'TEST approver authority required' } }) })
      current = { ...current, state: 'excluded', receiptVersion: 'c'.repeat(64) }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: current }) })
    }
    let data: unknown = []
    if (path === '/v1/sectors') data = [sector]
    else if (path === `/v1/sectors/${sectorId}`) data = sector
    else if (path.endsWith('/research-session')) data = session
    else if (path === '/v1/sessions') data = [session]
    else if (path.endsWith('/global-context')) data = { sectorId, version: 1, sections: { scope: 'TEST scope', decisions: '', findings: '', questions: '' }, markdown: 'TEST scope', researchSessionId: sessionId, changes: [] }
    else if (path.endsWith('/plan')) data = { sectorId, versions: [], latest: null, approvals: [], approvedVersion: null }
    else if (path.endsWith('/progress')) data = { sectorId, state: 'paused', planVersion: 1, items: [current], completed: 0, total: current.state === 'excluded' ? 0 : 1, unresolved: current.state === 'excluded' ? 0 : 1, discoveryClosed: false, estimatedPercent: null }
    else if (path.endsWith('/threads')) data = [{ key: sessionId, sessionId, kind: 'session', status: 'PAUSED', acceptingSteer: false, queueDepth: 0, updatedAt: at }]
    else if (path.endsWith('/steering-receipts')) data = { items: [], nextAfterId: null }
    else if (path.endsWith('/context')) data = { threadKey: sessionId, notes: '', summary: '', coveredSeq: 0, version: 0 }
    else if (path.startsWith('/v1/sessions/')) data = session
    else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [] }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  })
  return { decisions, recover: () => { fail = false }, change: () => { current = { ...current, attempts: 4, receiptVersion: 'b'.repeat(64) } } }
}
for (const width of [1440,390]) for (const dark of [false,true]) for (const landing of [false,true]) {
  test(`intake review ${width}px ${dark ? 'dark' : 'light'} ${landing ? 'landing' : 'workspace'}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const fixture = await fixtures(page)
    await page.goto(`/?section=${landing ? 'SectorDetail' : 'SectorChat'}&sector=${sectorId}`)
    if (dark) {
      if (!landing && width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
      if (landing) {
        await page.getByRole('button', { name: 'Theme' }).click()
        await page.getByRole('menuitemradio', { name: 'Dark' }).click()
      } else {
        await page.getByRole('button', { name: 'Use dark theme' }).click()
      }
      if (!landing && width < 768) await page.getByRole('button', { name: 'Close Sessions' }).click()
    }
    if (landing) await page.getByRole('button', { name: 'View progress' }).click()
    else await page.getByRole('tab', { name: 'Plan', exact: true }).click()
    const trigger = page.getByRole('button', { name: 'Review intake' })
    await trigger.focus(); await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Review candidate intake' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Owner reason' }).fill('TEST reviewed exact saved evidence')
    await dialog.getByRole('button', { name: 'Exclude candidate' }).click()
    await expect(dialog.getByRole('alert')).toContainText('TEST approver authority required')
    await expect(dialog.getByRole('textbox', { name: 'Owner reason' })).toHaveValue('TEST reviewed exact saved evidence')
    fixture.change()
    await dialog.getByRole('button', { name: 'Reload latest' }).click()
    await expect(dialog.getByRole('button', { name: 'Exclude candidate' })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Review latest receipt' }).click()
    await expect(dialog).toContainText('4 attempts')
    await dialog.screenshot({ path: info.outputPath('intake-review.png'), animations: 'disabled' })
    const bounds = await dialog.boundingBox()
    expect(bounds!.width).toBeLessThanOrEqual(width)
    fixture.recover()
    await dialog.getByRole('button', { name: 'Exclude candidate' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(trigger).not.toBeVisible()
    await expect(page.getByText(/0 of 0 work items completed.*1 candidates excluded/)).toBeVisible()
    expect(fixture.decisions.at(-1)).toMatchObject({ planVersion: 1, receiptVersion: 'b'.repeat(64), decision: 'exclude', reason: 'TEST reviewed exact saved evidence' })
  })
}
