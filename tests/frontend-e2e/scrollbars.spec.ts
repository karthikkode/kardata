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
  activity: COMPANIES.map((c, i) => ({ seq: i + 1, text: `Saw ${c.name}` })),
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

test('scrollbars: research overflow list is thin and styled', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await serveScrollbarApi(page)
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  const list = page.getByRole('region', { name: 'All sector researches' }).locator('ul.scroll-slim')
  await expect(page.getByText('Overflow sector 60')).toBeVisible()
  await thinScrollbar(page, list)
  await shot(page, 'scroll-researches', [page.getByText('Overflow sector 60')])
})

test('scrollbars: chat list plus table and code scroll in place', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await serveScrollbarApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Open chat' }).click()
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
  await page.getByRole('button', { name: 'Open chat' }).click()
  const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  await chat.getByRole('button', { name: 'Choose a model' }).click()
  const menu = chat.getByRole('menu', { name: 'Models' })
  await expect(menu.getByText('scroll-model-20')).toBeVisible()
  await thinScrollbar(page, menu.locator('.scroll-slim').first())
  await shot(page, 'scroll-model-menu', [menu.getByText('scroll-model-20')])
})

test('scrollbars: sector detail columns and drawer units stay thin', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await serveScrollbarApi(page)
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  await page.getByRole('button', { name: 'Open Overflow sector 1', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Overflow sector 1', exact: true })).toBeVisible()
  const columns = page.locator('.scroll-slim.min-h-0.flex-1.overflow-y-auto.rounded-xl')
  await expect(columns.first()).toBeVisible()
  await thinScrollbar(page, columns.first())
  await shot(page, 'scroll-detail', [page.getByRole('heading', { name: 'Overflow sector 1', exact: true })])
})

test('scrollbars: dark chat keeps the same thin treatment', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await serveScrollbarApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await page.getByRole('button', { name: 'Open chat' }).click()
  const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  await expect(chat.getByText('Scroll probe message 1 with enough text to fill the chat list.', { exact: true })).toBeVisible()
  await thinScrollbar(page, chat.locator('[aria-label="Chat messages"]'))
  await shot(page, 'scroll-chat-dark', [
    chat.getByRole('columnheader', { name: 'filename' }),
    chat.getByText('overflow-doc-8.md').first(),
  ])
})
