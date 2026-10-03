// Scrollbar proofs: every scroll container uses token-matched thin scrollbars.
// Each test forces overflow, asserts the scroll-slim hook plus computed thin
// width, then screenshots. PNGs land in test-results/visual (gitignored);
// rows live in docs/frontend-verification.md.
import { expect, test, type Locator, type Page } from '@playwright/test'

const AT = '2026-09-27T00:00:00.000Z'

const SECTORS = Array.from({ length: 60 }, (_, i) => ({
  id: `sec-overflow-${i + 1}`,
  name: `Overflow sector ${i + 1}`,
  topic: 'Bulk rows for scrollbar overflow',
  companiesFound: 0,
  state: 'queued',
  createdAt: AT,
  updatedAt: AT,
}))

const COMPANIES = Array.from({ length: 30 }, (_, i) => ({
  id: `co-${i + 1}`,
  sectorId: 'sec-overflow-1',
  sectorName: 'Overflow sector 1',
  name: `Overflow company ${i + 1}`,
  stage: 'Discovery',
  state: 'queued',
}))

const DETAIL = {
  ...SECTORS[0],
  companies: COMPANIES,
  companiesTotal: COMPANIES.length,
  activity: COMPANIES.map((c, i) => ({ seq: i + 1, text: `Saw ${c.name}` })),
  activityTotal: COMPANIES.length,
}

const UNITS = Array.from({ length: 30 }, (_, i) => ({
  ord: i, kind: 'paragraph', text: `Unit ${i + 1} text for scrolling.`, uncertain: false, excluded: false,
}))

const CONTEXT = {
  sectorId: 'sec-overflow-1',
  digest: { version: 'abc123def456', text: '[digest:abc123] Overflow' },
  segments: {
    system: 'Sector Overflow sector 1: Bulk rows for scrollbar overflow',
    references: ['[sdoc-1:0] Title'],
    history: [],
    tail: [],
  },
  usage: {
    system: { messages: 1, estimatedTokens: 10 },
    references: { messages: 1, estimatedTokens: 20 },
    history: { messages: 0, estimatedTokens: 0 },
    tail: { messages: 0, estimatedTokens: 0 },
    totalEstimatedTokens: 30,
  },
  files: [{
    id: 'sdoc-1', filename: 'overflow-units.md', mediaType: 'text/plain', status: 'indexed',
    sha256: 'abcdef1234567890abcdef1234567890', chars: 30000, excluded: false, units: UNITS,
  }],
  notes: [],
}

const DOCUMENTS = Array.from({ length: 15 }, (_, i) => ({
  id: `sdoc-${i + 1}`,
  sectorId: 'sec-overflow-1',
  filename: `overflow-doc-${i + 1}.md`,
  mediaType: 'text/plain',
  chars: 1000 + i,
  sha256: 'abcdef1234567890abcdef1234567890',
  createdAt: AT,
  status: 'indexed',
}))

const TABLE_REPLY = [
  'Scrollbar check with a wide table and code:',
  '',
  '| filename | status | id |',
  '|---|---|---|',
  ...Array.from({ length: 8 }, (_, i) => `| overflow-doc-${i + 1}.md | indexed | sdoc-aaaa1111-2222-3333-4444-${String(i).padStart(12, '0')} |`),
  '',
  '```text',
  ...Array.from({ length: 12 }, (_, i) => `code line ${i + 1} with a long token abcdef1234567890abcdef1234567890`),
  '```',
].join('\n')

const MESSAGES = [
  ...Array.from({ length: 18 }, (_, i) => (
    i % 2 === 0
      ? { seq: i + 1, kind: 'text', role: 'user', text: `Scroll probe message ${i + 1} with enough text to fill the chat list.` }
      : { seq: i + 1, kind: 'text', role: 'agent', text: `Reply ${i + 1}: acknowledged with enough text to keep the list overflowing.` }
  )),
  { seq: 19, kind: 'text', role: 'user', text: 'Show the wide table.' },
  { seq: 20, kind: 'text', role: 'agent', text: TABLE_REPLY },
]

const MODELS = Array.from({ length: 20 }, (_, i) => ({
  provider: 'meta',
  model: `scroll-model-${i + 1}`,
  displayName: `scroll-model-${i + 1}`,
  reasoning: 'native',
  mode: 'responses',
  efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
}))

const session = { id: 's-1', title: 'Scrollbar chat', createdAt: AT, updatedAt: AT }

async function serveScrollbarApi(page: Page): Promise<void> {
  await page.route('**/v1/**', async (route) => {
    const url = route.request().url()
    const method = route.request().method()
    if (url.includes('/events?')) {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
      return
    }
    let data: unknown = []
    if (url.endsWith('/v1/sectors') && method === 'GET') data = SECTORS
    else if (url.endsWith('/v1/sectors/sec-overflow-1')) data = DETAIL
    else if (url.includes('/v1/companies')) data = { companies: COMPANIES, total: COMPANIES.length }
    else if (url.includes('/v1/sectors/sec-overflow-1/documents')) data = DOCUMENTS
    else if (url.includes('/v1/sectors/sec-overflow-1/context')) data = CONTEXT
    else if (url.includes('/v1/runs')) data = []
    else if (url.endsWith('/v1/sessions')) data = [session]
    else if (url.endsWith('/v1/sessions/s-1')) data = session
    else if (url.endsWith('/v1/sessions/s-1/threads')) {
      data = [{ key: 's-1', sessionId: 's-1', kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: AT }]
    } else if (url.includes('/v1/threads/s-1/messages') && method === 'GET') data = MESSAGES
    else if (url.includes('/v1/providers')) {
      data = { defaultProvider: 'meta', providers: [{ name: 'meta', hasKey: true, defaultModel: 'scroll-model-1', models: MODELS }] }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  })
}

async function shot(page: Page, name: string, anchors: Locator[]): Promise<void> {
  for (const anchor of anchors) await expect(anchor).toBeVisible()
  await page.screenshot({ path: `test-results/visual/${name}.png`, animations: 'disabled' })
}

async function thinScrollbar(page: Page, locator: Locator): Promise<void> {
  await expect(locator).toHaveClass(/scroll-slim/)
  const width = await locator.evaluate((el) => getComputedStyle(el).scrollbarWidth)
  expect(width).toBe('thin')
}

test('scrollbars: researches pages without an inner scroll box', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await serveScrollbarApi(page)
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  await expect(page.getByText('Showing 50 of 60')).toBeVisible()
  // No inner scroll container: the page scrolls and Show more extends it.
  await expect(page.getByRole('table', { name: 'Sectors' }).locator('.scroll-slim')).toHaveCount(0)
  await page.getByRole('button', { name: 'Show more' }).click()
  await expect(page.getByText('Overflow sector 1')).toBeVisible()
  await shot(page, 'scroll-researches', [page.getByText('Showing 60 of 60')])
})

test('scrollbars: chat list plus table and code scroll in place', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await serveScrollbarApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Ask Karbot' }).click()
  const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  await expect(chat.getByText('Scroll probe message 1 with enough text to fill the chat list.', { exact: true })).toBeVisible()
  await thinScrollbar(page, chat.locator('[aria-label="Chat messages"]'))
  await thinScrollbar(page, chat.locator('pre.scroll-slim').first())
  await shot(page, 'scroll-chat-table', [
    chat.getByRole('columnheader', { name: 'filename' }),
    chat.getByText('overflow-doc-1.md').first(),
  ])
})

test('scrollbars: model menu list scrolls without detaching', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await serveScrollbarApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Ask Karbot' }).click()
  const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  await chat.getByRole('button', { name: 'Choose a model' }).click()
  const menu = chat.getByRole('menu', { name: 'Models' })
  await expect(menu.getByText('scroll-model-20')).toBeVisible()
  await thinScrollbar(page, menu.locator('.scroll-slim').first())
  await shot(page, 'scroll-model-menu', [menu.getByText('scroll-model-20')])
})

const WS_AT = '2026-09-30T00:00:00.000Z'
const WS_SECTOR = { id: 'sec-overflow-ws', name: 'Overflow workspace', topic: 'Bulk rows', state: 'running', companiesFound: 0, companies: [], companiesTotal: 0, activity: [], activityTotal: 0, createdAt: WS_AT, updatedAt: WS_AT }
const WS_RESEARCH = { id: 'ws-research', title: 'Overflow research', kind: 'research', sectorId: WS_SECTOR.id, createdAt: WS_AT, updatedAt: WS_AT }
const WS_NORMALS = Array.from({ length: 60 }, (_, i) => ({ id: `ws-chat-${i + 1}`, title: `Overflow chat ${i + 1}`, kind: 'normal', sectorId: WS_SECTOR.id, createdAt: WS_AT, updatedAt: WS_AT }))
const WS_SECTIONS = { scope: 'Overflow scope.', decisions: '', findings: '', questions: '' }

async function serveWorkspaceApi(page: Page): Promise<void> {
  await page.route('**/v1/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    if (path.endsWith('/events')) { await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }); return }
    let data: unknown = []
    if (path === '/v1/sectors') data = [WS_SECTOR]
    else if (path === `/v1/sectors/${WS_SECTOR.id}`) data = WS_SECTOR
    else if (path === '/v1/companies') data = { companies: [], total: 0 }
    else if (path.endsWith('/research-session')) data = WS_RESEARCH
    else if (path === '/v1/sessions') data = url.searchParams.has('sectorId') ? [WS_RESEARCH, ...WS_NORMALS] : []
    else if (path.endsWith('/global-context')) data = { sectorId: WS_SECTOR.id, version: 0, sections: WS_SECTIONS, markdown: '## Scope\n\nOverflow scope.', researchSessionId: WS_RESEARCH.id, changes: [] }
    else if (path.endsWith('/progress')) data = { sectorId: WS_SECTOR.id, state: WS_SECTOR.state, planVersion: 0, items: [], completed: 0, total: 0, unresolved: 0, discoveryClosed: false, estimatedPercent: null }
    else if (path.endsWith('/files')) data = []
    else if (path.endsWith('/threads')) data = [{ key: WS_RESEARCH.id, sessionId: WS_RESEARCH.id, kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: WS_AT }]
    else if (path.endsWith('/messages')) data = []
    else if (path.endsWith('/context')) data = { threadKey: WS_RESEARCH.id, notes: '', summary: '', coveredSeq: 0, version: 0 }
    else if (path === '/v1/providers') data = { defaultProvider: 'meta', providers: [] }
    else if (path.startsWith('/v1/sessions/')) data = WS_RESEARCH
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  })
}

test('scrollbars: workspace session rail stays thin under overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await serveWorkspaceApi(page)
  await page.goto(`/?section=SectorChat&sector=${WS_SECTOR.id}&session=${WS_RESEARCH.id}&thread=${WS_RESEARCH.id}`)
  // Sixty chats overflow the rail list (windowed at fifty with Show more).
  await page.getByRole('button', { name: 'Chats', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Show more (50 of 60)' })).toBeVisible()
  const rail = page.getByRole('complementary', { name: 'Sector sessions' }).locator('.scroll-slim.min-h-0.flex-1.space-y-1.overflow-y-auto')
  await expect(rail).toBeVisible()
  await thinScrollbar(page, rail)
  await thinScrollbar(page, page.getByRole('log', { name: 'Conversation messages' }))
  await shot(page, 'scroll-workspace-rail', [page.getByRole('group', { name: 'Session types' })])
})

test('scrollbars: dark chat keeps the same thin treatment', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await serveScrollbarApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Theme' }).click()
  await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  await page.getByRole('button', { name: 'Ask Karbot' }).click()
  const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  await expect(chat.getByText('Scroll probe message 1 with enough text to fill the chat list.', { exact: true })).toBeVisible()
  await thinScrollbar(page, chat.locator('[aria-label="Chat messages"]'))
  await shot(page, 'scroll-chat-dark', [
    chat.getByRole('columnheader', { name: 'filename' }),
    chat.getByText('overflow-doc-8.md').first(),
  ])
})
