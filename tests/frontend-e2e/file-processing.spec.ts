import { expect, test } from '@playwright/test'

test.use({ video: 'on', trace: 'on' })
const stamp = '2026-10-01T00:00:00.000Z'
const sector = { id: 'TEST sector', name: 'TEST PDF workspace', topic: 'TEST documents', state: 'draft', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: stamp, updatedAt: stamp }
const session = { id: 'TEST research', title: 'Research', kind: 'research', sectorId: sector.id, createdAt: stamp, updatedAt: stamp }
const progress = { jobId: 'TEST file job', state: 'uncertain', revision: 1, totalImages: 24, completedImages: 18, failedImages: 0, uncertainImages: 1, errorCode: 'provider_outcome_unknown', retryRequiresApproval: true }
for (const width of [390, 1440]) for (const dark of [false, true]) test(`PDF processing review and full-section access ${width} ${dark ? 'dark' : 'light'}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  let retried = false
  let denied = true
  let indexed = false
  const decisions: unknown[] = []
  await page.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url()), path = url.pathname
    if (path.endsWith('/events')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': fixture\n\n' })
    if (path.endsWith('/retry')) {
      decisions.push(route.request().postDataJSON())
      if (denied) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'permission_denied', message: 'TEST owner key required' } }) })
      retried = true
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { ...progress, state: 'queued', revision: 2 } }) })
    }
    let data: unknown = []
    if (path.includes('/sectors/TEST%20sector') || path.includes('/sectors/TEST sector')) data = sector
    if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [{ name: 'meta', hasKey: true, defaultModel: 'muse-spark-1.3-contributor', models: [{ provider: 'meta', model: 'muse-spark-1.3-contributor', displayName: 'Muse Spark 1.3 Contributor', reasoning: 'native', mode: 'responses', efforts: ['high'] }] }] }
    else if (path.endsWith('/sessions')) data = [session]
    else if (path.endsWith('/global-context')) data = { sectorId: sector.id, version: 0, markdown: '', sections: { scope: 'TEST source scope', decisions: '', findings: '', questions: '' }, researchSessionId: session.id, changes: [] }
    else if (path.endsWith('/files')) data = [{ id: 'TEST pdf', filename: 'TEST mixed images, charts and native text.pdf', status: indexed ? 'indexed' : retried ? 'processing' : 'failed', source: 'Uploaded', hash: 'TEST version', hidden: false, included: false, kind: 'document', processing: indexed ? { ...progress, state: 'complete', revision: 2, completedImages: 24, uncertainImages: 0 } : retried ? { ...progress, state: 'queued', revision: 2 } : progress }]
    else if (path.endsWith('/body')) data = { filename: 'TEST mixed images, charts and native text.pdf', mediaType: 'application/pdf', text: '## Page 1\nTEST bounded preview', fullChars: 90000, textTruncated: true, nextOrd: 0, originalAvailable: true, contentBase64: Buffer.from('TEST exact original bytes').toString('base64') }
    else if (path.endsWith('/units')) data = { status: 'indexed', units: [{ ord: Number(url.searchParams.get('fromOrd')), kind: 'ocr', text: '## Visual description\nTEST saved chart analysis with exact source placement.', uncertain: true, page: 3, imageOrdinal: 1, imageRole: 'embedded' }], nextOrd: url.searchParams.get('fromOrd') === '0' ? 20 : null, fullChars: 90000 }
    else if (path.endsWith('/threads')) data = [{ key: session.id, sessionId: session.id, kind: 'session', status: 'IDLE', acceptingSteer: false, queueDepth: 0, updatedAt: stamp }]
    else if (path.endsWith('/context')) data = { threadKey: session.id, task: '', notes: '', summary: '', coveredSeq: 0, version: 0, usage: { inputTokens: 0, budget: 100000, remaining: 100000, label: 'Estimate' } }
    else if (path.endsWith('/progress')) data = { sectorId: sector.id, state: 'draft', planVersion: 0, plan: { sectorId: sector.id, versions: [], latest: null, approvals: [], approvedVersion: null }, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
    else if (path.endsWith('/plan')) data = { sectorId: sector.id, versions: [], latest: null, approvals: [], approvedVersion: null }
    else if (path.includes('/sessions/')) data = session
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  })
  await page.goto(`/?section=SectorChat&sector=${encodeURIComponent(sector.id)}`)
  await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible()
  if (dark) {
    if (width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
    await page.getByRole('button', { name: 'Theme' }).click()
    await page.getByRole('menuitemradio', { name: 'Dark' }).click()
    if (width < 768) await page.keyboard.press('Escape')
  }
  if (width < 1280) await page.getByRole('button', { name: 'Open files and global context' }).click()
  const resources = width < 1280 ? page.getByRole('dialog', { name: 'Files and global context' }) : page.getByRole('complementary', { name: 'Sector resources' })
  await expect(resources.getByText('18 of 24 image analyses saved')).toBeVisible()
  await resources.getByRole('button', { name: 'Review retry', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Review file processing retry' })
  await expect(dialog.getByRole('button', { name: 'Resume file processing' })).toBeDisabled()
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: 'Resume file processing' }).click()
  await expect(dialog.getByRole('alert')).toContainText('TEST owner key required')
  await expect(dialog.getByRole('checkbox')).toBeChecked()
  await page.screenshot({ path: info.outputPath('paid-review-denied.png'), animations: 'disabled' })
  denied = false
  await dialog.getByRole('button', { name: 'Resume file processing' }).click()
  await expect(dialog).toHaveCount(0)
  expect(decisions).toEqual([{ jobId: progress.jobId, revision: 1, allowDuplicatePaid: true }, { jobId: progress.jobId, revision: 1, allowDuplicatePaid: true }])
  indexed = true
  await resources.getByRole('button', { name: 'TEST mixed images, charts and native text.pdf', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'File preview' })
  await preview.getByRole('button', { name: 'Browse indexed sections' }).click()
  await expect(preview.getByRole('region', { name: 'Indexed section 1' })).toBeVisible()
  await expect(preview.getByText('Uncertain', { exact: true })).toBeVisible()
  await expect(preview.getByText('TEST saved chart analysis with exact source placement.')).toBeVisible()
  await preview.getByRole('button', { name: 'Next sections' }).click()
  await expect(preview.getByRole('region', { name: 'Indexed section 21' })).toBeVisible()
  await preview.getByRole('button', { name: 'Previous sections' }).click()
  await expect(preview.getByRole('region', { name: 'Indexed section 1' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('indexed-sections.png'), animations: 'disabled' })
})
