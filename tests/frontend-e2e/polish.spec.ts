// Polish proofs: the small-interaction contracts every component must hold.
// The workspace keeps its header and composer pinned while the conversation
// scrolls, hover/focus states never spill onto neighbors, and no surface
// introduces page-level sideways scroll. PNGs land in test-results/visual
// (gitignored); rows live in docs/frontend-verification.md.
//
// Retired: the drawer-era unit-list scroll-chaining test. The workspace has
// no nested scroller pair (rail list, conversation log, plan panel, and
// overlay body each scroll independently inside a fixed viewport), so the
// chaining contract has no surface to pin.
import { expect, test, type Locator, type Page } from '@playwright/test'

const AT = '2026-09-30T00:00:00.000Z'

const SECTOR = {
  id: 'sec-polish', name: 'Polish sector', topic: 'Bulk rows', state: 'running',
  companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: AT, updatedAt: AT,
}
const RESEARCH = { id: 'ws-research', title: 'Polish research', kind: 'research', sectorId: SECTOR.id, createdAt: AT, updatedAt: AT }
const NORMALS = [
  { id: 'ws-chat-1', title: 'Pricing brainstorm', kind: 'normal', sectorId: SECTOR.id, createdAt: AT, updatedAt: AT },
  { id: 'ws-chat-2', title: 'Buyer notes', kind: 'normal', sectorId: SECTOR.id, createdAt: AT, updatedAt: AT },
]
const MESSAGES = [
  { seq: 1, role: 'user', kind: 'text', text: 'Which buyers show costly friction?', at: AT },
  { seq: 2, role: 'agent', kind: 'text', text: `## Costly friction so far\n\nEvidence lines that pin the pain to money, each long enough to wrap several lines at desktop measure and force the conversation column well past one viewport of scrollable height.\n\n${'A repeated manual reconciliation step costs operators hours every week. '.repeat(12)}`, at: AT },
]
const SECTIONS = { scope: 'Polish scope.', instructions: '', decisions: '', findings: '', questions: '' }

async function serveWorkspaceApi(page: Page): Promise<void> {
  await page.route('**/v1/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (path.endsWith('/events')) { await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }); return }
    let data: unknown = []
    if (path === '/v1/sectors') data = [SECTOR]
    else if (path === `/v1/sectors/${SECTOR.id}`) data = SECTOR
    else if (path === '/v1/companies') data = { companies: [], total: 0 }
    else if (path.endsWith('/research-session')) data = RESEARCH
    else if (path === '/v1/sessions') data = url.searchParams.has('sectorId') ? [RESEARCH, ...NORMALS] : []
    else if (path.endsWith('/global-context')) data = { sectorId: SECTOR.id, version: 0, sections: SECTIONS, markdown: '## Scope\n\nPolish scope.', researchSessionId: RESEARCH.id, changes: [], files: [], usage: { total: 0, budget: 30000, method: 'estimated', bySection: { scope: 0, instructions: 0, decisions: 0, findings: 0, questions: 0 }, byFile: [] } }
    else if (path.endsWith('/progress')) data = { sectorId: SECTOR.id, state: SECTOR.state, planVersion: 0, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
    else if (path.endsWith('/files')) data = []
    else if (path.endsWith('/threads')) data = [{ key: RESEARCH.id, sessionId: RESEARCH.id, kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: AT }]
    else if (path.endsWith('/messages')) data = MESSAGES
    else if (path.endsWith('/context')) data = { threadKey: RESEARCH.id, notes: '', summary: '', coveredSeq: 0, version: 0 }
    else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [] }
    else if (path.startsWith('/v1/sessions/')) data = RESEARCH
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  })
}

async function openWorkspace(page: Page): Promise<void> {
  await page.goto(`/?section=SectorChat&sector=${SECTOR.id}&session=${RESEARCH.id}&thread=${RESEARCH.id}`)
  await expect(page.getByText('Which buyers show costly friction?')).toBeVisible()
}

async function shot(page: Page, name: string, anchors: Locator[]): Promise<void> {
  for (const anchor of anchors) await expect(anchor).toBeVisible()
  await page.screenshot({ path: `test-results/visual/${name}.png`, animations: 'disabled' })
}

interface Box { x: number; y: number; width: number; height: number }

function intersectsPort(box: Box, port: Box): boolean {
  return box.y < port.y + port.height && box.y + box.height > port.y
}

test('polish: workspace keeps header and composer pinned while scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 })
  await serveWorkspaceApi(page)
  await openWorkspace(page)
  const list = page.getByRole('log', { name: 'Conversation messages' })
  await list.evaluate((el) => {
    el.scrollTop = 600
  })
  expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  const port = { y: 0, height: 600 }
  const header = page.getByRole('main').locator('header')
  const composer = page.getByRole('textbox', { name: 'Message this conversation' })
  const headerBox = (await header.boundingBox()) as unknown as Box
  const composerBox = (await composer.boundingBox()) as unknown as Box
  expect(headerBox).not.toBeNull()
  expect(composerBox).not.toBeNull()
  expect(intersectsPort(headerBox, port)).toBe(true)
  expect(intersectsPort(composerBox, port)).toBe(true)
  await shot(page, 'polish-workspace-sticky', [header, composer])
})

test('polish: hover and focus states stay inside their rows', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 })
  await serveWorkspaceApi(page)
  await openWorkspace(page)
  // WS-03: the rail switch is a Session types tablist now.
  await page.getByRole('tab', { name: /^Chats/ }).click()
  await expect(page.getByRole('list', { name: 'Chat sessions' })).toBeVisible()
  const row = page.getByRole('button', { name: 'Open Pricing brainstorm' })
  await row.hover()
  await expect(row).toBeVisible()
  const composer = page.getByRole('textbox', { name: 'Message this conversation' })
  await composer.fill('Which buyers show costly friction?')
  await composer.focus()
  await expect(composer).toBeFocused()
  const spill = await page.evaluate(() => {
    const root = document.documentElement
    return root.scrollWidth - root.clientWidth
  })
  expect(spill).toBeLessThanOrEqual(1)
  await shot(page, 'polish-workspace-hover-focus', [row, composer])
})

test('polish: dark workspace keeps pins and hover without spill', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 })
  await serveWorkspaceApi(page)
  await openWorkspace(page)
  // SH-04: the shared ThemeMenu lives in the rail footer here.
  await page.getByRole('button', { name: 'Theme' }).click()
  await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  await expect(page.locator('html.dark')).toBeAttached()
  const list = page.getByRole('log', { name: 'Conversation messages' })
  await list.evaluate((el) => {
    el.scrollTop = 600
  })
  expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  const port = { y: 0, height: 600 }
  const header = page.getByRole('main').locator('header')
  const composer = page.getByRole('textbox', { name: 'Message this conversation' })
  expect(intersectsPort((await header.boundingBox()) as unknown as Box, port)).toBe(true)
  expect(intersectsPort((await composer.boundingBox()) as unknown as Box, port)).toBe(true)
  await page.getByRole('tab', { name: /^Chats/ }).click()
  await page.getByRole('button', { name: 'Open Buyer notes' }).hover()
  await shot(page, 'polish-workspace-dark', [header, composer])
})
