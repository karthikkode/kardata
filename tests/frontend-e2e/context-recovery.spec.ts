// Browser acceptance over synthetic HTTP fixtures: UI evidence only, no live
// provider, database, Temporal or owner business mutations.
import { expect, test, type Page } from '@playwright/test'
test.use({ video: 'on', trace: 'on' })
const sectorId = 'TEST-context-recovery-sector', sessionId = 'TEST-context-recovery-parent'
const at = '2026-10-01T00:00:00Z'
const session = { id: sessionId, title: 'Research', kind: 'research', sectorId, createdAt: at, updatedAt: at }
const sections = { scope: 'TEST Australian SME scope', decisions: '', findings: '', questions: '' }
const sector = { id: sectorId, name: 'TEST Recovery evidence', topic: sections.scope, state: 'paused', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: at, updatedAt: at }
const operationId = 'op:'.concat('a'.repeat(64))
async function fixture(page: Page, blocked: boolean) {
  let failRebuild = true
  let local = { threadKey: sessionId, notes: 'TEST keep draft notes', summary: '## Stored summary\n\nTEST objectives and retained historical evidence.', version: 2, coveredSeq: 4, task: 'TEST preserve original research objective', sourceRefs: [{ fileId: 'TEST source', filename: `TEST ${'long-source-'.repeat(15)}.md`, hash: 'b'.repeat(64), ords: [0, 1] }], ...(blocked ? { contextBlocked: 'TEST source is hidden. Reveal its exact version or rebuild independently.' } : { pendingOperations: [{ operationId, toolName: 'db.create_session', callId: 'TEST call', reason: 'TEST reply delivery was lost; avoid repeating a change.' }] }) }
  await page.route('**/v1/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
    if (path.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': TEST fixture\n\n' })
    let data: unknown = []
    if (path.endsWith('/context/rebuild')) {
      if (failRebuild) { local = { ...local, version: 3 }; return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'conflict', message: 'TEST recovery conflict: draft is kept.' } }) }) }
      const body = request.postDataJSON()
      expect(body).toMatchObject({ version: 3, independent: true })
      local = { ...local, summary: body.summary, version: 4, contextBlocked: undefined }
      data = local
    } else if (path.includes('/operations/')) data = { operationId, toolName: 'db.create_session', state: 'confirmed', reason: 'TEST durable successful reply is recorded. Original authority is required; guard conflicts remain blocked.' }
    else if (path.endsWith('/context')) data = local
    else if (path === '/v1/sectors') data = [sector]
    else if (path === `/v1/sectors/${sectorId}`) data = sector
    else if (path.endsWith('/research-session')) data = session
    else if (path === '/v1/sessions') data = [session]
    else if (path.endsWith('/global-context')) data = { sectorId, version: 1, sections, markdown: '## Scope\n\nTEST Australian SME scope', researchSessionId: sessionId, changes: [] }
    else if (path.endsWith('/plan')) data = { sectorId, versions: [], latest: null, approvals: [], approvedVersion: null }
    else if (path.endsWith('/progress')) data = { sectorId, state: 'paused', planVersion: 0, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
    else if (path.endsWith('/threads')) data = [{ key: sessionId, sessionId, kind: 'session', status: 'PAUSED', acceptingSteer: false, queueDepth: 0, updatedAt: at }]
    else if (path.endsWith('/steering-receipts')) data = { items: [], nextAfterId: null }
    else if (path.startsWith('/v1/sessions/')) data = session
    else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [] }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  })
  return { allowRebuild: () => { failRebuild = false } }
}
async function open(page: Page, width: number, dark: boolean) {
  await page.setViewportSize({ width, height: width < 768 ? 844 : 960 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`/?section=SectorChat&sector=${sectorId}&session=${sessionId}&thread=${sessionId}`)
  await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible()
  if (dark) {
    if (width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
    await page.getByRole('button', { name: 'Use dark theme' }).click()
    if (width < 768) await page.getByRole('button', { name: 'Close Sessions' }).click()
  }
  const context = page.getByRole('button', { name: 'Local context', exact: true })
  await context.focus(); await page.keyboard.press('Enter')
  return page.getByRole('dialog', { name: 'Local context', exact: true })
}
for (const width of [1440, 390]) for (const dark of [false, true]) {
  test(`receipt inspection ${width}px ${dark ? 'dark' : 'light'}, reduced motion`, async ({ page }, info) => {
    await fixture(page, false)
    const context = await open(page, width, dark)
    await expect(context.getByText('Operation needs review')).toBeVisible()
    await context.getByRole('button', { name: 'Inspect receipt' }).click()
    await expect(context.getByText('Result confirmed')).toBeVisible()
    await context.getByText('Operation identity', { exact: true }).click()
    await expect(context.getByText(operationId, { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath('receipt-inspection.png'), animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Local context', exact: true })).toBeFocused()
  })
  test(`owner safe rebuild ${width}px ${dark ? 'dark' : 'light'}, reduced motion`, async ({ page }, info) => {
    const state = await fixture(page, true)
    const context = await open(page, width, dark)
    await expect(context.getByText('Context needs source review')).toBeVisible()
    await expect(context.getByRole('button', { name: 'Compact context' })).toBeDisabled()
    await context.getByRole('button', { name: 'Review safe rebuild' }).click()
    const review = page.getByRole('dialog', { name: 'Rebuild private context' })
    const confirm = review.getByRole('button', { name: 'Confirm safe rebuild' })
    await expect(confirm).toBeDisabled()
    await review.getByText('Stored summary and source dependencies', { exact: true }).click()
    await expect(review.getByText('b'.repeat(64), { exact: true })).toBeVisible()
    await review.getByRole('textbox', { name: 'Independent replacement' }).fill('## TEST reviewed objectives\n\nKeep completed work and open questions without hidden source content.')
    await expect(review.getByRole('region', { name: 'Replacement preview' })).toBeVisible()
    await review.getByRole('checkbox').check()
    await confirm.click()
    await expect(review.getByText('TEST recovery conflict: draft is kept.')).toBeInViewport({ ratio: 1 })
    await expect(review.getByText('TEST recovery conflict: draft is kept.')).toBeFocused()
    await expect(confirm).toBeInViewport()
    await expect(review.getByRole('textbox', { name: 'Independent replacement' })).toHaveValue(/Keep completed work/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath('safe-rebuild-conflict.png'), animations: 'disabled' })
    await expect(confirm).toBeDisabled()
    await review.getByRole('button', { name: 'Review latest context' }).click()
    await expect(review.getByRole('checkbox')).not.toBeChecked()
    await expect(review.getByRole('textbox', { name: 'Independent replacement' })).toHaveValue(/Keep completed work/)
    await review.getByRole('checkbox').check()
    state.allowRebuild(); await confirm.click()
    await expect(review).not.toBeVisible()
    await expect(context.getByRole('button', { name: 'Compact context' })).toBeEnabled()
    await expect(context.getByText('Context needs source review')).not.toBeVisible()
    await page.screenshot({ path: info.outputPath('safe-rebuild-complete.png'), animations: 'disabled' })
  })
}
