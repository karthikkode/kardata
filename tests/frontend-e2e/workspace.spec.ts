import { expect, test, type Page } from '@playwright/test'

const stamp = '2026-09-30T00:00:00.000Z'
const sector = { id: 'test-sector', name: 'TEST Specialty foods', topic: 'Packaged foods', state: 'approved', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: stamp, updatedAt: stamp }
const research = { id: 'test-research', title: 'Research', kind: 'research', sectorId: sector.id, createdAt: stamp, updatedAt: stamp }
const normal = { id: 'test-chat', title: 'Product brainstorm', kind: 'normal', sectorId: sector.id, createdAt: stamp, updatedAt: stamp }
const sections = { scope: 'Research specialty food manufacturers in English-speaking markets.', decisions: 'Prioritize evidence of a costly operational problem. Keep uncertain claims explicit.', findings: 'Discovery has not started.', questions: 'Which regions offer the strongest evidence?' }
const executable = { researchDepth: 'discovery', discovery: [{ id: 'au', title: 'Australian discovery', queries: ['Australian SME manufacturers'], maxPages: 2 }], companyBrief: 'Verify company identity and sources.', budgets: { maxCompanies: 2000, maxWallMinutes: 60, concurrency: 2 }, acceptance: ['Distinct Australian companies with source evidence'] }
const plan = { sectorId: sector.id, versions: [{ version: 1, markdown: '## Scope\nFind specialty food companies.\n\n## Discovery\nSearch approved regions and verify company websites.\n\n## Company research\nInvestigate all worthy problems, with cited evidence.\n\n## Budgets\nTwo researchers at a time.\n\n## Acceptance\nEvery company has an evidence-backed verdict.', at: stamp, executable }], latest: null as unknown, approvals: [1], approvedVersion: 1 }
plan.latest = plan.versions[0]
const progress = { sectorId: sector.id, state: sector.state, planVersion: 1, plan, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }

async function fixtures(page: Page, options: { state?: string; denied?: boolean; files?: number; long?: boolean; saveError?: boolean; paused?: boolean; pending?: boolean } = {}) {
  await page.route('**/v1/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } }); return }
    if (path.endsWith('/events')) { await route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': fixture\n\n' }); return }
    if (path.endsWith('/plan') && request.method() === 'PATCH' && options.saveError) { await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'conflict', message: 'TEST plan save conflict. Review the latest version.' } }) }); return }
    let data: unknown = []
    if (path === '/v1/sectors') data = [{ ...sector, state: options.state ?? sector.state }]
    else if (path === `/v1/sectors/${sector.id}`) data = { ...sector, state: options.state ?? sector.state }
    else if (path.endsWith('/steering-receipts')) data = { items: [], nextAfterId: null }
    else if (path.endsWith('/research-session')) data = research
    else if (path === '/v1/companies') data = { companies: [], total: 0 }
    else if (path === '/v1/sessions') data = url.searchParams.has('sectorId') ? [research, normal] : []
    else if (path.endsWith('/global-context')) data = { sectorId: sector.id, version: 1, sections, markdown: Object.entries(sections).map(([key, text]) => `## ${key === 'questions' ? 'Open questions' : key}\n\n${text}`).join('\n\n'), researchSessionId: research.id, changes: [] }
    else if (path.endsWith('/progress')) data = progress
    else if (path.endsWith('/plan')) data = plan
    else if (path.endsWith('/files/test-file-0/body')) data = { filename: 'TEST Market research and industry landscape.md', mediaType: 'text/markdown', text: '# TEST retained source\n\nOriginal indexed evidence.', originalAvailable: true, contentBase64: Buffer.from('# TEST retained source\n\nOriginal indexed evidence.').toString('base64') }
    else if (path.endsWith('/files')) data = Array.from({ length: options.files ?? 3 }, (_, index) => ({ id: `test-file-${index}`, filename: index === 0 ? 'TEST Market research and industry landscape.md' : `TEST source-${index}.pdf`, status: index === 2 ? 'needs-ocr' : 'indexed', source: index === 1 ? 'Research agent' : 'Uploaded', hash: 'fixture-hash', hidden: false, included: index === 0, kind: 'document' }))
    else if (path.endsWith('/threads')) {
      const sessionId = path.includes(normal.id) ? normal.id : research.id
      data = [{ key: sessionId, sessionId, kind: 'session', status: options.paused ? 'PAUSED' : 'RUNNING', acceptingSteer: !options.paused, queueDepth: 0, updatedAt: stamp }, ...Array.from({ length: 6 }, (_, index) => ({ key: `agent:test-child-${index}`, name: ['Source review','Pricing analysis','Problem discovery','Market signals','Evidence check','Company review'][index], sessionId, kind: 'subagent', status: index < 2 ? 'RUNNING' : 'FINISHED', acceptingSteer: index < 2, queueDepth: 0, updatedAt: stamp }))]
    } else if (path.endsWith('/messages')) data = options.long ? [{ seq: 1, role: 'user', kind: 'text', text: 'What should we look for in this sector?', at: stamp }, { seq: 2, role: 'agent', kind: 'text', text: '## A focused research direction\n\nLook for companies with meaningful operational friction and capacity to invest.\n\n### Evidence to gather\n\n- Revenue and scale signals from reliable sources.\n- Repeated manual work across systems.\n- Cost or time impact, with explicit uncertainty.\n\n| Area | Signal | Next step |\n| --- | --- | --- |\n| Operations | Fragmented reporting | Verify the actual workflow |\n| Inventory | Manual reconciliation | Find a cost or time signal |\n\n> Keep the research broad. One symptom should not define the whole investigation.\n\nUse `company_id` only when working with tools; explain findings in plain language.', at: stamp }] : []
    else if (path.endsWith('/context')) data = { threadKey: path.split('/')[3], notes: 'Stay broad and keep sources.', summary: '', coveredSeq: 0, version: 1, ...(options.pending ? { pendingOperations: [{ operationId: 'TEST durable identity '.repeat(100), callId: 'TEST call', toolName: 'db.create_session', reason: 'The tool reply was lost; its committed effect remains unconfirmed.' }] } : {}) }
    else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [{ name: 'meta', hasKey: true, defaultModel: 'muse-spark-1.3-contributor', models: [{ provider: 'meta', model: 'muse-spark-1.3-contributor', displayName: 'muse-spark-1.3-contributor', reasoning: 'native', mode: 'responses', efforts: ['low','high'] }] }] }
    else if (path.startsWith('/v1/sessions/')) data = path.includes(normal.id) ? normal : research
    const denied = options.denied && (path.endsWith('/files') || path.endsWith('/global-context'))
    await route.fulfill({ status: denied ? 403 : 200, contentType: 'application/json', body: JSON.stringify(denied ? { ok: false, error: { code: 'permission_denied', message: 'Fixture permission denial' } } : { ok: true, data }) })
  })
}
test('sector summary opens the shared plan/progress dialog and dedicated workspace', async ({ page }) => {
  await fixtures(page)
  await page.goto(`/?section=SectorDetail&sector=${sector.id}`)
  await expect(page.getByRole('region', { name: 'Research status' })).toBeVisible()
  await expect(page.getByText('Company research has not started yet.')).toBeVisible()
  await page.getByRole('button', { name: 'View progress' }).click()
  await expect(page.getByRole('dialog', { name: 'Research progress' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Discovery', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'View progress' })).toBeFocused()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Plan', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Plan', exact: true }).click()
  await expect(page.getByRole('tabpanel', { name: 'Research plan' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Discovery', exact: true })).toBeVisible()
})
for (const width of [1440, 390]) for (const dark of [false, true]) {
  test(`workspace visual ${width} ${dark ? 'dark' : 'light'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await fixtures(page, { long: true, files: 30 })
    await page.goto(`/?section=SectorChat&sector=${sector.id}`)
    await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'A focused research direction' })).toBeVisible()
    if (width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
    if (dark) await page.getByRole('button', { name: 'Use dark theme' }).click()
    if (width < 768) await page.getByRole('button', { name: 'Close Sessions' }).click()
    await expect(page.getByRole('textbox', { name: 'Message this conversation' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/visual/workspace-${width}-${dark ? 'dark' : 'light'}.png`, animations: 'disabled' })
    if (width < 1280) await page.getByRole('button', { name: 'Open files and global context' }).click()
    await expect(page.getByRole('heading', { name: 'Files', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Global context', exact: true })).toBeVisible()
    await page.screenshot({ path: `test-results/visual/workspace-resources-${width}-${dark ? 'dark' : 'light'}.png`, animations: 'disabled' })
  })
}

test('paused research offers plan revision and preserves an unsuccessful edit', async ({ page }) => {
  await fixtures(page, { state: 'paused', saveError: true })
  await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  await page.getByRole('tab', { name: 'Plan', exact: true }).click()
  await page.getByRole('button', { name: 'Edit plan' }).click()
  const editor = page.getByRole('dialog', { name: 'Edit research plan' })
  await editor.getByRole('textbox', { name: 'Plan', exact: true }).fill('TEST revised paused scope')
  await editor.getByRole('button', { name: 'Save plan' }).click()
  await expect(editor.getByRole('alert')).toContainText('TEST plan save conflict')
  await expect(editor.getByRole('textbox', { name: 'Plan', exact: true })).toHaveValue('TEST revised paused scope')
  await page.screenshot({ path: 'test-results/visual/hardening-paused-plan-conflict.png', animations: 'disabled' })
})
test('deep-linked normal chat selects Chats; subagents and context are reachable', async ({ page }) => {
  await fixtures(page)
  await page.goto(`/?section=SectorChat&sector=${sector.id}&session=${normal.id}&thread=${normal.id}`)
  await expect(page.getByRole('button', { name: 'Chats', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'All 6' }).click()
  await page.getByRole('dialog', { name: 'Subagents' }).getByRole('button', { name: /Source review/ }).click()
  await expect(page.getByRole('heading', { name: 'Source review', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/thread=agent%3Atest-child-0/)
  await page.getByRole('button', { name: 'Local context', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Local notes' })).toHaveValue('Stay broad and keep sources.')
})
test('permission failures remain visible instead of empty files or context', async ({ page }) => {
  await fixtures(page, { denied: true })
  await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  await expect(page.getByText('Files is not shared with this key.')).toBeVisible()
  await expect(page.getByText('Global context is not shared with this key.')).toBeVisible()
})

test('file preview downloads retained bytes and returns focus to the file', async ({ page }) => {
  await fixtures(page)
  await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  const file = page.getByRole('button', { name: 'TEST Market research and industry landscape.md', exact: true })
  await file.click()
  const dialog = page.getByRole('dialog', { name: 'File preview' })
  await expect(dialog.getByRole('heading', { name: 'TEST retained source' })).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download original file' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('TEST Market research and industry landscape.md')
  await page.screenshot({ path: 'test-results/visual/hardening-file-preview.png', animations: 'disabled' })
  await page.keyboard.press('Escape')
  await expect(file).toBeFocused()
})

test('failed plan edits retain the owner draft and expose exact executable work', async ({ page }) => {
  await fixtures(page, { saveError: true })
  await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  await page.getByRole('tab', { name: 'Plan', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Executable research work' })).toContainText('2,000 companies')
  await page.getByRole('button', { name: 'Edit plan' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit research plan' })
  await dialog.getByRole('textbox', { name: 'Plan', exact: true }).fill('TEST owner draft retained after conflict')
  await dialog.getByRole('button', { name: 'Save plan' }).click()
  await expect(dialog.getByRole('alert')).toContainText('TEST plan save conflict')
  await expect(dialog.getByRole('textbox', { name: 'Plan', exact: true })).toHaveValue('TEST owner draft retained after conflict')
  await expect(dialog.getByRole('spinbutton', { name: 'Company limit' })).toHaveValue('2000')
  await page.screenshot({ path: 'test-results/visual/hardening-plan-conflict.png', animations: 'disabled' })
})

test('paused conversations offer a visible recovery action without indefinite thinking', async ({ page }) => {
  await fixtures(page, { paused: true })
  await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  await expect(page.getByRole('button', { name: 'Resume conversation' })).toBeVisible()
  await expect(page.getByText('This conversation is paused. Review local context, then resume the saved turn.')).toBeVisible()
  await expect(page.getByText(/Thinking/)).toHaveCount(0)
  await page.screenshot({ path: 'test-results/visual/hardening-context-paused.png', animations: 'disabled' })
})

for (const width of [1440, 390]) for (const dark of [false, true]) {
  test.use({ video: 'on' })
  test(`hardening surfaces ${width} ${dark ? 'dark' : 'light'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await fixtures(page, { saveError: true })
    await page.goto(`/?section=SectorChat&sector=${sector.id}`)
    await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible()
    if (width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
    if (dark) await page.getByRole('button', { name: 'Use dark theme' }).click()
    if (width < 768) await page.getByRole('button', { name: 'Close Sessions' }).click()
    await page.getByRole('tab', { name: 'Plan', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Executable research work' })).toBeVisible()
    await page.getByRole('button', { name: 'Edit plan' }).click()
    const editor = page.getByRole('dialog', { name: 'Edit research plan' })
    await expect(editor.getByRole('textbox', { name: 'Plan', exact: true })).toBeVisible()
    await expect(editor.getByRole('combobox', { name: 'Research depth' })).toHaveValue('discovery')
    const saveBox = await editor.getByRole('button', { name: 'Save plan' }).boundingBox()
    expect(saveBox).not.toBeNull()
    expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(960)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/visual/hardening-editor-${width}-${dark ? 'dark' : 'light'}.png`, animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Edit plan' })).toBeFocused()
    if (width < 1280) await page.getByRole('button', { name: 'Open files and global context' }).click()
    await page.getByRole('button', { name: 'TEST Market research and industry landscape.md', exact: true }).click()
    const preview = page.getByRole('dialog', { name: 'File preview' })
    await expect(preview.getByRole('heading', { name: 'TEST retained source' })).toBeVisible()
    await expect(preview.getByRole('button', { name: 'Download original file' })).toBeVisible()
    await page.screenshot({ path: `test-results/visual/hardening-preview-${width}-${dark ? 'dark' : 'light'}.png`, animations: 'disabled' })
  })
}


test('overflow recovery shows the durable answer after a long history and clears stale thinking', async ({ page }) => {
  await fixtures(page)
  await page.route('**/v1/threads/*/messages?**', async (route) => {
    const after = Number(new URL(route.request().url()).searchParams.get('afterSeq'))
    const data = after === 0 ? Array.from({ length: 200 }, (_, index) => ({ seq: index + 1, kind: 'text', role: 'user', text: `TEST history ${index + 1}`, at: stamp }))
      : after === 200 ? [{ seq: 201, kind: 'text', role: 'agent', text: 'TEST recovered terminal answer', at: stamp }] : []
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data, nextAfterSeq: after === 0 ? 200 : 201 }) })
  })
  await page.route('**/v1/threads/*/events?**', async (route) => {
    if (Number(new URL(route.request().url()).searchParams.get('lastSeq')) >= 300) { await route.fulfill({ contentType: 'text/event-stream', body: ': recovered\n\n' }); return }
    const frames = [
      { seq: 1, type: 'reasoning', payload: { runKey: 'TEST finished turn', text: 'TEST obsolete thinking' } },
      { seq: 300, type: 'state', payload: { status: 'RUNNING', historyRefresh: true } },
    ]
    await route.fulfill({ contentType: 'text/event-stream', body: frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') })
  })
  await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  await expect(page.getByText('TEST recovered terminal answer', { exact: true })).toBeVisible()
  await expect(page.getByText('TEST obsolete thinking', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/visual/hardening-overflow-recovery.png', animations: 'disabled' })
})


for (const outcome of ['consumed', 'missed'] as const) test(`overflow recovery restores ${outcome} steering in the UI`, async ({ page }) => {
  await fixtures(page)
  let steered = false
  await page.route('**/v1/commands/steer', async (route) => {
    steered = true
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: { commandId: 'TEST overflow steer', state: 'accepted' } }) })
  })
  await page.route('**/v1/threads/*/messages?**', async (route) => {
    const after = Number(new URL(route.request().url()).searchParams.get('afterSeq'))
    const data = steered && after === 0 ? [{ seq: 2, kind: 'text', role: 'agent', text: 'TEST terminal after steering', at: stamp }] : []
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data, nextAfterSeq: steered ? 2 : 0 }) })
  })
  await page.route('**/v1/threads/*/steering-receipts?**', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: { items: [{ id: 'TEST overflow steer', state: outcome }], nextAfterId: null } }) })
  })
  await page.route('**/v1/threads/*/events?**', async (route) => {
    const after = Number(new URL(route.request().url()).searchParams.get('lastSeq'))
    const frames = after >= 300 ? [] : steered ? [{ seq: 300, type: 'state', payload: { status: 'FINISHED', historyRefresh: true } }]
      : [{ seq: 1, type: 'reasoning', payload: { runKey: 'TEST active', text: 'TEST initial active work' } }]
    await route.fulfill({ contentType: 'text/event-stream', body: frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') || ': recovered\n\n' })
  })
  await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  await expect(page.getByRole('button', { name: 'Steer this turn', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Message this conversation' }).fill('TEST owner steering instruction')
  await page.getByRole('button', { name: 'Steer this turn', exact: true }).click()
  await expect(page.getByText('TEST terminal after steering', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0)
  if (outcome === 'missed') {
    await expect(page.getByRole('region', { name: 'Unapplied steering' })).toContainText('TEST owner steering instruction')
    await expect(page.getByRole('textbox', { name: 'Message this conversation' })).toHaveValue('TEST owner steering instruction')
  }
  await page.screenshot({ path: `test-results/visual/hardening-overflow-steering-${outcome}.png`, animations: 'disabled' })
})

for (const width of [1440, 390]) for (const dark of [false, true]) {
  test(`operation recovery ${width} ${dark ? 'dark' : 'light'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await fixtures(page, { paused: true, pending: true })
    await page.goto(`/?section=SectorChat&sector=${sector.id}`)
    await expect(page.getByRole('button', { name: 'Resume conversation' })).toBeVisible()
    if (width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
    if (dark) await page.getByRole('button', { name: 'Use dark theme' }).click()
    if (width < 768) await page.getByRole('button', { name: 'Close Sessions' }).click()
    await page.getByRole('button', { name: 'Local context', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Local context' })
    const recovery = dialog.getByRole('region', { name: 'Pending operation recovery' })
    await expect(recovery.getByRole('heading', { name: 'Operation needs review' })).toBeVisible()
    await expect(recovery.getByText('db.create_session', { exact: true })).toBeVisible()
    await recovery.getByText('Operation identity', { exact: true }).click()
    await expect(recovery.locator('code')).toBeVisible()
    expect(await recovery.locator('code').evaluate((element) => element.clientHeight <= 128 && element.scrollHeight > element.clientHeight)).toBe(true)
    await recovery.locator('code').focus()
    await expect(recovery.locator('code')).toBeFocused()
    expect(await recovery.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/visual/operation-recovery-${width}-${dark ? 'dark' : 'light'}.png`, animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Local context', exact: true })).toBeFocused()
    await expect(page.getByText(/Thinking/)).toHaveCount(0)
  })
}
