import { expect, test, type Page } from '@playwright/test'

test.use({ video: 'on', trace: 'on' })

const stamp = '2026-09-30T00:00:00.000Z'
const sector = { id: 'test-sector', name: 'TEST Specialty foods', topic: 'Packaged foods', state: 'approved', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: stamp, updatedAt: stamp }
const research = { id: 'test-research', title: 'Research', kind: 'research', sectorId: sector.id, createdAt: stamp, updatedAt: stamp }
const normal = { id: 'test-chat', title: 'Product brainstorm', kind: 'normal', sectorId: sector.id, createdAt: stamp, updatedAt: stamp }
const sections = { scope: 'Research specialty food manufacturers in English-speaking markets.', decisions: 'Prioritize evidence of a costly operational problem. Keep uncertain claims explicit.', findings: 'Discovery has not started.', questions: 'Which regions offer the strongest evidence?' }
const executable = { researchDepth: 'discovery', discovery: [{ id: 'au', title: 'Australian discovery', queries: ['Australian SME manufacturers'], maxPages: 2 }], companyBrief: 'Verify company identity and sources.', budgets: { maxCompanies: 2000, maxWallMinutes: 60, concurrency: 2 }, acceptance: ['Distinct Australian companies with source evidence'] }
const plan = { sectorId: sector.id, versions: [{ version: 1, markdown: '## Scope\nFind specialty food companies.\n\n## Discovery\nSearch approved regions and verify company websites.\n\n## Company research\nInvestigate all worthy problems, with cited evidence.\n\n## Budgets\nTwo researchers at a time.\n\n## Acceptance\nEvery company has an evidence-backed verdict.', at: stamp, executable }], latest: null as unknown, approvals: [1], approvedVersion: 1 }
plan.latest = plan.versions[0]
const progress = { sectorId: sector.id, state: sector.state, planVersion: 1, plan, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }

async function fixtures(page: Page, options: { state?: string; denied?: boolean; files?: number; long?: boolean; saveError?: boolean; paused?: boolean; pending?: boolean; approvalConflict?: boolean; retained?: boolean } = {}) {
  await page.route('**/v1/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } }); return }
    if (path.endsWith('/events')) { await route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': fixture\n\n' }); return }
    if (path.endsWith('/approve') && options.approvalConflict) { await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'conflict', message: 'TEST global context changed. Review it before approving the plan.' } }) }); return }
    if (path.endsWith('/plan') && request.method() === 'PATCH' && options.saveError) { await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'conflict', message: 'TEST plan save conflict. Review the latest version.' } }) }); return }
    let data: unknown = []
    if (path === '/v1/sectors') data = [{ ...sector, state: options.state ?? sector.state }]
    else if (path === `/v1/sectors/${sector.id}`) data = { ...sector, state: options.state ?? sector.state }
    else if (path.endsWith('/steering-receipts')) data = { items: [], nextAfterId: null }
    else if (path.endsWith('/research-session')) data = research
    else if (path === '/v1/companies') data = { companies: [], total: 0 }
    else if (path === '/v1/sessions') data = url.searchParams.has('sectorId') ? [research, normal] : []
    else if (path.endsWith('/global-context')) data = { sectorId: sector.id, version: 1, sections, markdown: Object.entries(sections).map(([key, text]) => `## ${key === 'questions' ? 'Open questions' : key}\n\n${text}`).join('\n\n'), researchSessionId: research.id, changes: [] }
    else if (path.endsWith('/progress')) data = options.retained ? { ...progress, planVersion: 2, completed: 1, total: 1, items: [{ id: 'TEST v2 retained', kind: 'company', title: 'TEST retained Australian company', state: 'complete', attempts: 1, childId: null, evidence: ['https://company.example.test/'], sourceUrl: 'https://company.example.test/', detail: 'Source-backed basic intake passed. Retained from approved plan v1; scope and acceptance unchanged.' }] } : progress
    else if (path.endsWith('/plan')) data = options.retained ? { ...plan, versions: [plan.versions[0], { ...plan.versions[0], version: 2 }], latest: { ...plan.versions[0], version: 2 }, approvals: [1, 2], approvedVersion: 2 } : plan
    else if (path.endsWith('/files/test-file-0/body')) data = { filename: 'TEST Market research and industry landscape.md', mediaType: 'text/markdown', text: '# TEST retained source\n\nOriginal indexed evidence.', originalAvailable: true, contentBase64: Buffer.from('# TEST retained source\n\nOriginal indexed evidence.').toString('base64') }
    else if (path.endsWith('/files')) data = Array.from({ length: options.files ?? 3 }, (_, index) => ({ id: `test-file-${index}`, filename: index === 0 ? 'TEST Market research and industry landscape.md' : `TEST source-${index}.pdf`, status: index === 2 ? 'needs-ocr' : 'indexed', source: index === 1 ? 'Research agent' : 'Uploaded', hash: 'fixture-hash', hidden: false, included: index === 0, kind: 'document' }))
    else if (path.endsWith('/threads')) {
      const sessionId = path.includes(normal.id) ? normal.id : research.id
      data = [{ key: sessionId, sessionId, kind: 'session', status: options.paused ? 'PAUSED' : 'RUNNING', acceptingSteer: !options.paused, queueDepth: 0, updatedAt: stamp }, ...Array.from({ length: 6 }, (_, index) => ({ key: `agent:test-child-${index}`, name: ['Source review','Pricing analysis','Problem discovery','Market signals','Evidence check','Company review'][index], sessionId, kind: 'subagent', status: index < 2 ? 'RUNNING' : 'FINISHED', acceptingSteer: index < 2, queueDepth: 0, updatedAt: stamp }))]
    } else if (path.endsWith('/messages')) data = options.long ? [{ seq: 1, role: 'user', kind: 'text', text: 'What should we look for in this sector?', at: stamp }, { seq: 2, role: 'agent', kind: 'text', text: '## A focused research direction\n\nLook for companies with meaningful operational friction and capacity to invest.\n\n### Evidence to gather\n\n- Revenue and scale signals from reliable sources.\n- Repeated manual work across systems.\n- Cost or time impact, with explicit uncertainty.\n\n| Area | Signal | Next step |\n| --- | --- | --- |\n| Operations | Fragmented reporting | Verify the actual workflow |\n| Inventory | Manual reconciliation | Find a cost or time signal |\n\n> Keep the research broad. One symptom should not define the whole investigation.\n\nUse `company_id` only when working with tools; explain findings in plain language.', at: stamp }] : []
    else if (path.endsWith('/context')) data = { threadKey: path.split('/')[3], notes: 'Stay broad and keep sources.', summary: '', coveredSeq: 0, version: 1, ...(options.pending ? { pendingOperations: [{ operationId: 'TEST durable identity '.repeat(100), callId: 'TEST call', toolName: 'db.create_session', reason: 'The tool reply was lost; its committed effect remains unconfirmed.' }] } : {}) }
    else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [{ name: 'meta', hasKey: true, defaultModel: 'muse-spark-1.3-contributor', models: [{ provider: 'meta', model: 'muse-spark-1.3-contributor', displayName: 'Muse Spark 1.3 Contributor', reasoning: 'native', mode: 'responses', efforts: ['low','high'] }] }] }
    else if (path.startsWith('/v1/sessions/')) data = path.includes(normal.id) ? normal : research
    const denied = options.denied && (path.endsWith('/files') || path.endsWith('/global-context'))
    await route.fulfill({ status: denied ? 403 : 200, contentType: 'application/json', body: JSON.stringify(denied ? { ok: false, error: { code: 'permission_denied', message: 'Fixture permission denial' } } : { ok: true, data }) })
  })
}
test('sector summary opens the shared plan/progress dialog and dedicated workspace', async ({ page }) => {
  await fixtures(page)
  await page.goto(`/?section=SectorDetail&sector=${sector.id}`)
  await expect(page.getByRole('region', { name: 'Research status' })).toBeVisible()
  await expect(page.getByText('The plan is approved. Start research when ready.')).toBeVisible()
  await page.getByRole('button', { name: 'View progress' }).click()
  const dialog = page.getByRole('dialog', { name: 'Research progress' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Show plan details' }).click()
  await expect(dialog.getByRole('heading', { name: 'Discovery', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'View progress' })).toBeFocused()
  // The header action and the status-panel next step share the name;
  // the header renders first.
  await page.getByRole('button', { name: 'Open workspace' }).first().click()
  await expect(page.getByRole('tab', { name: /^Plan/ })).toBeVisible()
  await page.getByRole('tab', { name: /^Plan/ }).click()
  await expect(page.getByRole('tabpanel', { name: 'Plan' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Discovery', exact: true })).toBeVisible()
})

async function applyTheme(page: Page, dark: boolean): Promise<void> {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
  // React flips .dark asynchronously after the media change.
  await page
    .waitForFunction((expected) => document.documentElement.classList.contains('dark') === (expected === 'dark'), dark ? 'dark' : 'light', { timeout: 5000 })
    .catch(() => undefined)
}

test.describe('exact workspace drawer boundaries', () => {
  for (const width of [767, 768, 1279, 1280]) for (const dark of [false, true]) {
    test(`workspace boundary ${width}px ${dark ? 'dark' : 'light'}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 960 })
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
      await fixtures(page, { long: true, files: 30 })
      await page.goto(`/?section=SectorChat&sector=${sector.id}`)
      await applyTheme(page, dark)
      await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible()
      const sessions = page.getByRole('complementary', { name: 'Sector sessions', includeHidden: true })
      const resources = page.getByRole('complementary', { name: 'Sector resources', includeHidden: true })
      const openSessions = page.getByRole('button', { name: 'Open sessions', includeHidden: true })
      const openResources = page.getByRole('button', { name: 'Open files and global context', includeHidden: true })
      if (width < 768) {
        await expect(sessions).toBeHidden()
        await expect(openSessions).toBeVisible()
        await openSessions.focus()
        await page.keyboard.press('Enter')
        const drawer = page.getByRole('dialog', { name: 'Sessions', exact: true })
        await expect(drawer.getByRole('tablist', { name: 'Session types' })).toBeVisible()
        await drawer.screenshot({ path: info.outputPath('sessions-drawer.png'), animations: 'disabled' })
        await page.keyboard.press('Escape')
        await expect(drawer).toHaveCount(0)
        await expect(openSessions).toBeFocused()
      } else {
        await expect(sessions).toBeVisible()
        await expect(openSessions).toBeHidden()
      }
      if (width < 1281) {
        await expect(resources).toBeHidden()
        await expect(openResources).toBeVisible()
        await openResources.focus()
        await page.keyboard.press('Enter')
        const drawer = page.getByRole('dialog', { name: 'Files and global context', exact: true })
        await expect(drawer.getByRole('heading', { name: 'Files', exact: true })).toBeVisible()
        await expect(drawer.getByRole('heading', { name: 'Global context', exact: true })).toBeVisible()
        await drawer.screenshot({ path: info.outputPath('resources-drawer.png'), animations: 'disabled' })
        await page.keyboard.press('Escape')
        await expect(drawer).toHaveCount(0)
        await expect(openResources).toBeFocused()
      } else {
        await expect(resources).toBeVisible()
        await expect(openResources).toBeHidden()
        await expect(resources.getByRole('heading', { name: 'Files', exact: true })).toBeVisible()
        await expect(resources.getByRole('heading', { name: 'Global context', exact: true })).toBeVisible()
      }
      await expect(page.getByRole('textbox', { name: 'Message this conversation' })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath('workspace-boundary.png'), animations: 'disabled' })
    })
  }
})

for (const width of [1440, 390]) for (const dark of [false, true]) {
  test(`workspace visual ${width} ${dark ? 'dark' : 'light'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
    await fixtures(page, { long: true, files: 30 })
    await page.goto(`/?section=SectorChat&sector=${sector.id}`)
    await applyTheme(page, dark)
    await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'A focused research direction' })).toBeVisible()
    if (width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
    if (width < 768) await page.getByRole('button', { name: 'Close Sessions' }).click()
    await expect(page.getByRole('textbox', { name: 'Message this conversation' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/visual/workspace-${width}-${dark ? 'dark' : 'light'}.png`, animations: 'disabled' })
    if (width < 1281) await page.getByRole('button', { name: 'Open files and global context' }).click()
    await expect(page.getByRole('heading', { name: 'Files', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Global context', exact: true })).toBeVisible()
    await page.screenshot({ path: `test-results/visual/workspace-resources-${width}-${dark ? 'dark' : 'light'}.png`, animations: 'disabled' })
  })
}

test('paused research offers plan revision and preserves an unsuccessful edit', async ({ page }) => {
  await fixtures(page, { state: 'paused', saveError: true })
  await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  await page.getByRole('tab', { name: /^Plan/ }).click()
  await page.getByRole('button', { name: 'Edit plan' }).click()
  const editor = page.getByRole('dialog', { name: 'Edit research plan' })
  await editor.getByRole('textbox', { name: 'Plan text' }).fill('TEST revised paused scope')
  await editor.getByRole('button', { name: 'Save plan' }).click()
  await expect(editor.getByRole('alert')).toContainText('TEST plan save conflict')
  await expect(editor.getByRole('textbox', { name: 'Plan text' })).toHaveValue('TEST revised paused scope')
  await page.screenshot({ path: 'test-results/visual/hardening-paused-plan-conflict.png', animations: 'disabled' })
})
test('deep-linked normal chat selects Chats; subagents and context are reachable', async ({ page }) => {
  await fixtures(page)
  await page.goto(`/?section=SectorChat&sector=${sector.id}&session=${normal.id}&thread=${normal.id}`)
  await expect(page.getByRole('tab', { name: /^Chats/, selected: true })).toBeVisible()
  await page.getByRole('button', { name: 'View all 6' }).click()
  await page.getByRole('dialog', { name: 'Subagents' }).getByRole('button', { name: 'Open Source review' }).click()
  await expect(page.getByRole('heading', { name: 'Source review', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/thread=agent%3Atest-child-0/)
  await page.getByRole('button', { name: 'Local context', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Local context' }).getByRole('textbox', { name: 'Local notes' })).toHaveValue('Stay broad and keep sources.')
})
test('permission failures remain visible instead of empty files or context', async ({ page }) => {
  await fixtures(page, { denied: true })
  await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  // Below 1281px the rail lives in the drawer; scope there because the
  // hidden inline rail renders the same copy.
  await page.getByRole('button', { name: 'Open files and global context' }).click()
  const drawer = page.getByRole('dialog', { name: 'Files and global context' })
  await expect(drawer.getByText('Files is not shared with this key.')).toBeVisible()
  await expect(drawer.getByText('Global context is not shared with this key.')).toBeVisible()
})

test('file preview downloads retained bytes and returns focus to the file', async ({ page }) => {
  await fixtures(page)
  await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  await page.getByRole('button', { name: 'Open files and global context' }).click()
  const drawer = page.getByRole('dialog', { name: 'Files and global context' })
  const file = drawer.getByRole('button', { name: 'TEST Market research and industry landscape.md', exact: true })
  await file.click()
  const dialog = page.getByRole('dialog', { name: 'File preview' })
  await expect(dialog.getByRole('heading', { name: 'TEST retained source' })).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download' }).click()
  await page.getByRole('menuitem', { name: 'Original file' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('TEST Market research and industry landscape.md')
  await page.screenshot({ path: 'test-results/visual/hardening-file-preview.png', animations: 'disabled' })
  await page.keyboard.press('Escape')
  await expect(file).toBeFocused()
})

test('failed plan edits retain the owner draft and expose exact executable work', async ({ page }) => {
  await fixtures(page, { saveError: true })
  await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  await page.getByRole('tab', { name: /^Plan/ }).click()
  await expect(page.getByRole('region', { name: 'Executable research work' })).toContainText('Up to 2,000')
  await expect(page.getByRole('region', { name: 'Executable research work' })).toContainText('Company limit')
  await page.getByRole('button', { name: 'Edit plan' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit research plan' })
  await dialog.getByRole('textbox', { name: 'Plan text' }).fill('TEST owner draft retained after conflict')
  await dialog.getByRole('button', { name: 'Save plan' }).click()
  await expect(dialog.getByRole('alert')).toContainText('TEST plan save conflict')
  await expect(dialog.getByRole('textbox', { name: 'Plan text' })).toHaveValue('TEST owner draft retained after conflict')
  await expect(dialog.getByRole('spinbutton', { name: 'Company limit' })).toHaveValue('2000')
  await page.screenshot({ path: 'test-results/visual/hardening-plan-conflict.png', animations: 'disabled' })
})

test('paused conversations offer a visible recovery action without indefinite thinking', async ({ page }) => {
  await fixtures(page, { paused: true })
  // Held-open stream with a PAUSED state frame (the CV-08-paused shape):
  // a closing fixture stream would flip the chat into reconnecting and
  // hide the paused recovery action under test.
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      if (String(input).includes('/events?')) {
        const frame = { seq: 1, threadKey: 'test-research', type: 'state', at: '', payload: { status: 'PAUSED' } }
        return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`))
          },
        }), { status: 200, headers: { 'content-type': 'text/event-stream' } }))
      }
      return nativeFetch(input, init)
    }
  })
  await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  await expect(page.getByText('This conversation is paused.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible()
  await expect(page.getByText(/Thinking/)).toHaveCount(0)
  await page.screenshot({ path: 'test-results/visual/hardening-context-paused.png', animations: 'disabled' })
})

for (const width of [1440, 390]) for (const dark of [false, true]) {
  test.use({ video: 'on' })
  test(`hardening surfaces ${width} ${dark ? 'dark' : 'light'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
    await fixtures(page, { saveError: true })
    await page.goto(`/?section=SectorChat&sector=${sector.id}`)
    await applyTheme(page, dark)
    await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible()
    if (width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
    if (width < 768) await page.getByRole('button', { name: 'Close Sessions' }).click()
    await page.getByRole('tab', { name: /^Plan/ }).click()
    await expect(page.getByRole('region', { name: 'Executable research work' })).toBeVisible()
    await page.getByRole('button', { name: 'Edit plan' }).click()
    const editor = page.getByRole('dialog', { name: 'Edit research plan' })
    await expect(editor.getByRole('textbox', { name: 'Plan text' })).toBeVisible()
    await expect(editor.getByRole('combobox', { name: 'Research depth' })).toContainText('Discovery only')
    const saveBox = await editor.getByRole('button', { name: 'Save plan' }).boundingBox()
    expect(saveBox).not.toBeNull()
    expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(960)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/visual/hardening-editor-${width}-${dark ? 'dark' : 'light'}.png`, animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Edit plan' })).toBeFocused()
    if (width < 1281) {
      await page.getByRole('button', { name: 'Open files and global context' }).click()
      await page.getByRole('dialog', { name: 'Files and global context' }).getByRole('button', { name: 'TEST Market research and industry landscape.md', exact: true }).click()
    } else {
      await page.getByRole('button', { name: 'TEST Market research and industry landscape.md', exact: true }).click()
    }
    const preview = page.getByRole('dialog', { name: 'File preview' })
    await expect(preview.getByRole('heading', { name: 'TEST retained source' })).toBeVisible()
    await preview.getByRole('button', { name: 'Download' }).click()
    await expect(page.getByRole('menuitem', { name: 'Original file' })).toBeVisible()
    await page.keyboard.press('Escape')
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
  await expect(page.getByRole('button', { name: 'Steer', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Message this conversation' }).fill('TEST owner steering instruction')
  await page.getByRole('button', { name: 'Steer', exact: true }).click()
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
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: dark ? 'dark' : 'light' })
    await fixtures(page, { paused: true, pending: true })
    // Held-open stream with a PAUSED state frame (same shape as the
    // paused-conversations test above): a closing fixture stream would
    // flip the chat into reconnecting and hide the Resume button.
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window)
      window.fetch = (input, init) => {
        if (String(input).includes('/events?')) {
          const frame = { seq: 1, threadKey: 'test-research', type: 'state', at: '', payload: { status: 'PAUSED' } }
          return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`))
            },
          }), { status: 200, headers: { 'content-type': 'text/event-stream' } }))
        }
        return nativeFetch(input, init)
      }
    })
    await page.goto(`/?section=SectorChat&sector=${sector.id}`)
    // Wait for the .dark flip without resetting reducedMotion emulation.
    await page
      .waitForFunction((expected) => document.documentElement.classList.contains('dark') === (expected === 'dark'), dark ? 'dark' : 'light', { timeout: 5000 })
      .catch(() => undefined)
    // First-paint anchor: cold dev boot can exceed the 5s default, so
    // budget like the v2 first anchors (15s) instead of failing cold.
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible({ timeout: 15000 })
    if (width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
    if (width < 768) await page.getByRole('button', { name: 'Close Sessions' }).click()
    await page.getByRole('button', { name: 'Local context', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Local context' })
    const recovery = dialog.getByRole('region', { name: 'Pending operation recovery' })
    await expect(recovery.getByText('An operation needs review')).toBeVisible()
    await expect(recovery.getByText('DB create session', { exact: true })).toBeVisible()
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

for (const width of [1440, 390]) for (const dark of [false, true]) {
  test(`plan approval context conflict ${width} ${dark ? 'dark' : 'light'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
    await fixtures(page, { state: 'planned', approvalConflict: true })
    await page.goto(`/?section=SectorChat&sector=${sector.id}`)
    await applyTheme(page, dark)
    if (width < 768) await page.getByRole('button', { name: 'Open sessions' }).click()
    if (width < 768) await page.getByRole('button', { name: 'Close Sessions' }).click()
    await page.getByRole('tab', { name: /^Plan/ }).click()
    const request = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/approve'))
    await page.getByRole('button', { name: 'Approve v1', exact: true }).click()
    expect((await request).postDataJSON()).toEqual({ version: 1, contextVersion: 1 })
    await expect(page.getByRole('alert').filter({ hasText: 'TEST global context changed' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit plan' })).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/visual/plan-context-conflict-${width}-${dark ? 'dark' : 'light'}.png`, animations: 'disabled' })
  })
}
test('retained discovery provenance remains visible in progress without a false percentage', async ({ page }) => {
  await fixtures(page, { retained: true })
  await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  await page.getByRole('tab', { name: /^Plan/ }).click()
  const progress = page.getByRole('region', { name: 'Research progress' })
  await expect(progress.getByText('TEST retained Australian company', { exact: true })).toBeVisible()
  await expect(progress.getByText(/Retained from approved plan v1/)).toBeVisible()
  await expect(progress.getByText('Not estimated yet', { exact: true })).toBeVisible()
  await expect(progress.getByRole('link', { name: 'Open source' })).toHaveAttribute('href', 'https://company.example.test/')
})
test('plan approval is unavailable when context authority is denied', async ({ page }) => {
  await fixtures(page, { state: 'planned', denied: true })
  await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  // The inactive plan panel is hidden from the role tree: select it before
  // opening the drawer, then assert the blocked approval behind the modal.
  await page.getByRole('tab', { name: /^Plan/ }).click()
  await expect(page.getByRole('button', { name: 'Approve v1', exact: true })).toHaveAttribute('aria-disabled', 'true')
  await page.getByRole('button', { name: 'Open files and global context' }).click()
  const drawer = page.getByRole('dialog', { name: 'Files and global context' })
  await expect(drawer.getByText('Global context is not shared with this key.')).toBeVisible()
})

test('plan approval stops when fresh global context becomes unavailable', async ({ page }) => {
  await fixtures(page, { state: 'planned' })
  await page.goto(`/?section=SectorChat&sector=${sector.id}`)
  await page.getByRole('tab', { name: /^Plan/ }).click()
  await expect(page.getByRole('button', { name: 'Approve v1', exact: true })).toBeEnabled()
  await page.route(`**/v1/sectors/${sector.id}/global-context`, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'overload', message: 'TEST context unavailable' } }) }))
  // The 5s shared-context poll delivers the failure; approval blocks via
  // aria-disabled with an explanatory tooltip, not the disabled attribute.
  await expect(page.getByRole('button', { name: 'Approve v1', exact: true })).toHaveAttribute('aria-disabled', 'true', { timeout: 15000 })
  await page.getByRole('button', { name: 'Open files and global context' }).click()
  const drawer = page.getByRole('dialog', { name: 'Files and global context' })
  await expect(drawer.getByRole('alert').filter({ hasText: 'TEST context unavailable' })).toBeVisible()
})
