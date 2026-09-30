import { expect, test, type Page } from '@playwright/test'

const stamp = '2026-09-30T00:00:00.000Z'
const sector = { id: 'test-sector', name: 'TEST Specialty foods', topic: 'Packaged foods', state: 'approved', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: stamp, updatedAt: stamp }
const research = { id: 'test-research', title: 'Research', kind: 'research', sectorId: sector.id, createdAt: stamp, updatedAt: stamp }
const normal = { id: 'test-chat', title: 'Product brainstorm', kind: 'normal', sectorId: sector.id, createdAt: stamp, updatedAt: stamp }
const sections = { scope: 'Research specialty food manufacturers in English-speaking markets.', decisions: 'Prioritize evidence of a costly operational problem. Keep uncertain claims explicit.', findings: 'Discovery has not started.', questions: 'Which regions offer the strongest evidence?' }
const plan = { sectorId: sector.id, versions: [{ version: 1, markdown: '## Scope\nFind specialty food companies.\n\n## Discovery\nSearch approved regions and verify company websites.\n\n## Company research\nInvestigate all worthy problems, with cited evidence.\n\n## Budgets\nTwo researchers at a time.\n\n## Acceptance\nEvery company has an evidence-backed verdict.', at: stamp }], latest: null as unknown, approvals: [1], approvedVersion: 1 }
plan.latest = plan.versions[0]
const progress = { sectorId: sector.id, state: sector.state, planVersion: 1, plan, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }

async function fixtures(page: Page, options: { state?: string; denied?: boolean; files?: number; long?: boolean } = {}) {
  await page.route('**/v1/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } }); return }
    if (path.endsWith('/events')) { await route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': fixture\n\n' }); return }
    let data: unknown = []
    if (path === '/v1/sectors') data = [{ ...sector, state: options.state ?? sector.state }]
    else if (path === `/v1/sectors/${sector.id}`) data = { ...sector, state: options.state ?? sector.state }
    else if (path.endsWith('/research-session')) data = research
    else if (path === '/v1/companies') data = { companies: [], total: 0 }
    else if (path === '/v1/sessions') data = url.searchParams.has('sectorId') ? [research, normal] : []
    else if (path.endsWith('/global-context')) data = { sectorId: sector.id, version: 1, sections, markdown: Object.entries(sections).map(([key, text]) => `## ${key === 'questions' ? 'Open questions' : key}\n\n${text}`).join('\n\n'), researchSessionId: research.id, changes: [] }
    else if (path.endsWith('/progress')) data = progress
    else if (path.endsWith('/plan')) data = plan
    else if (path.endsWith('/files')) data = Array.from({ length: options.files ?? 3 }, (_, index) => ({ id: `test-file-${index}`, filename: index === 0 ? 'TEST Market research and industry landscape.md' : `TEST source-${index}.pdf`, status: index === 2 ? 'needs-ocr' : 'indexed', source: index === 1 ? 'Research agent' : 'Uploaded', hash: 'fixture-hash', hidden: false, included: index === 0, kind: 'document' }))
    else if (path.endsWith('/threads')) {
      const sessionId = path.includes(normal.id) ? normal.id : research.id
      data = [{ key: sessionId, sessionId, kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: stamp }, ...Array.from({ length: 6 }, (_, index) => ({ key: `agent:test-child-${index}`, name: ['Source review','Pricing analysis','Problem discovery','Market signals','Evidence check','Company review'][index], sessionId, kind: 'subagent', status: index < 2 ? 'RUNNING' : 'FINISHED', acceptingSteer: index < 2, queueDepth: 0, updatedAt: stamp }))]
    } else if (path.endsWith('/messages')) data = options.long ? [{ seq: 1, role: 'user', kind: 'text', text: 'What should we look for in this sector?', at: stamp }, { seq: 2, role: 'agent', kind: 'text', text: '## A focused research direction\n\nLook for companies with meaningful operational friction and capacity to invest.\n\n### Evidence to gather\n\n- Revenue and scale signals from reliable sources.\n- Repeated manual work across systems.\n- Cost or time impact, with explicit uncertainty.\n\n| Area | Signal | Next step |\n| --- | --- | --- |\n| Operations | Fragmented reporting | Verify the actual workflow |\n| Inventory | Manual reconciliation | Find a cost or time signal |\n\n> Keep the research broad. One symptom should not define the whole investigation.\n\nUse `company_id` only when working with tools; explain findings in plain language.', at: stamp }] : []
    else if (path.endsWith('/context')) data = { threadKey: path.split('/')[3], notes: 'Stay broad and keep sources.', summary: '', coveredSeq: 0, version: 1 }
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
  await expect(page.getByRole('heading', { name: 'Discovery' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'View progress' })).toBeFocused()
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Plan', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Plan', exact: true }).click()
  await expect(page.getByRole('tabpanel', { name: 'Research plan' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Discovery' })).toBeVisible()
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
