// Visual state matrix (deep-check Phase 7 follow-up). Runnable
// screenshot suite: every shot asserts its state's key locators first, so a
// regression fails the test instead of silently drifting pixels. PNGs land
// in test-results/visual (gitignored) for human review and CI artifacts.
// API answers are route-stubbed; no backend, no keys, no network.
import { expect, test, type Locator, type Page } from '@playwright/test'

const SECTOR = {
  id: 'sec-foods',
  name: 'Speciality Foods',
  topic: 'Ready meals',
  state: 'draft',
  companiesFound: 0,
  companies: [],
  companiesTotal: 0,
  activity: [],
  activityTotal: 0,
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T01:00:00.000Z',
}

const CONTEXT = {
  sectorId: 'sec-foods',
  digest: { version: 'abc123def456', text: 'd' },
  segments: { system: 'Sector Speciality Foods: Ready meals', references: ['First fact.'], history: [], tail: [] },
  usage: {
    system: { messages: 0, estimatedTokens: 0 },
    references: { messages: 1, estimatedTokens: 42 },
    history: { messages: 0, estimatedTokens: 0 },
    tail: { messages: 0, estimatedTokens: 0 },
    totalEstimatedTokens: 42,
  },
  files: [
    {
      id: 'doc-1',
      filename: 'notes.md',
      mediaType: 'text/markdown',
      status: 'indexed',
      sha256: 'deadbeef',
      units: [{ ord: 0, kind: 'text', text: 'First fact.', uncertain: false, excluded: false }],
    },
  ],
  notes: [],
}

async function serveApi(page: Page, sectors: unknown[] = [SECTOR]): Promise<void> {
  await page.route('**/v1/**', async (route) => {
    const url = route.request().url()
    const method = route.request().method()
    let data: unknown = []
    if (url.endsWith('/v1/sectors') && method === 'GET') data = sectors
    else if (url.endsWith('/v1/sectors/sec-foods')) data = SECTOR
    else if (url.includes('/v1/companies')) data = { companies: [], total: 0 }
    else if (url.includes('/v1/sectors/sec-foods/context') && method === 'GET') data = CONTEXT
    else if (url.includes('/v1/sectors/sec-foods/documents')) data = []
    else if (url.includes('/v1/sessions?sectorId=sec-foods')) {
      data = [{ id: 'salads', title: 'Speciality Foods chat', sectorId: 'sec-foods', createdAt: SECTOR.createdAt, updatedAt: SECTOR.updatedAt }]
    } else if (url.includes('/threads/salads/messages') || url.includes('/sessions/salads/messages')) data = []
    else if (url.includes('/events?')) {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
      return
    } else if (url.endsWith('/v1/sessions')) {
      data = [{ id: 's-1', title: 'Browser chat', createdAt: SECTOR.createdAt, updatedAt: SECTOR.updatedAt }]
    } else if (url.endsWith('/v1/sessions/s-1')) {
      data = { id: 's-1', title: 'Browser chat', createdAt: SECTOR.createdAt, updatedAt: SECTOR.updatedAt }
    } else if (url.endsWith('/v1/sessions/s-1/threads')) {
      data = [{ key: 's-1', sessionId: 's-1', kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: SECTOR.updatedAt }]
    } else if (url.includes('/v1/providers')) {
      data = {
        defaultProvider: 'meta',
        providers: [{ name: 'meta', hasKey: true, defaultModel: 'muse-spark-1.3-contributor', models: [
          { provider: 'meta', model: 'muse-spark-1.3-contributor', displayName: 'Muse Spark 1.3 Contributor', reasoning: 'native', mode: 'responses', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
        ] }],
      }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  })
}

/** Assert the state's anchors, then capture the PNG. Animations are frozen
 * so the 200ms section/popover fades cannot land mid-fade (Playwright's
 * visibility check ignores opacity). Motion itself is verified by the
 * transition clips in the handoff plan, not by stills. */
async function shot(page: Page, name: string, anchors: Locator[]): Promise<void> {
  for (const anchor of anchors) await expect(anchor).toBeVisible()
  await page.screenshot({ path: `test-results/visual/${name}.png`, animations: 'disabled' })
}

test('visual: overview empty state', async ({ page }) => {
  await serveApi(page, [])
  await page.goto('/')
  await shot(page, 'overview-empty', [
    page.getByRole('heading', { name: 'Overview' }),
    page.getByText('No sectors yet'),
  ])
})

test('visual: researches list with one draft sector', async ({ page }) => {
  await serveApi(page)
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  await shot(page, 'researches-list', [page.getByText('Speciality Foods')])
})

test('visual: sector detail with context drawer content', async ({ page }) => {
  await serveApi(page)
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  await page.getByRole('link', { name: /^Speciality Foods/ }).click()
  // The summary landing carries status plus companies; the drawer-era
  // detail/chat headings moved into the workspace (workspace.spec.ts).
  // Draft empty copy is per-state now (companiesEmptyCopy).
  await shot(page, 'sector-detail', [
    page.getByRole('region', { name: 'Research status' }),
    page.getByText('Research has not started'),
  ])
})

test('visual: chat open idle with model picker expanded', async ({ page }) => {
  await serveApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Ask Karbot' }).click()
  const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  await expect(chat).toBeVisible()
  await chat.getByRole('button', { name: 'Choose a model' }).click()
  // CP-03: the menu portals to the body; search + the model row prove it.
  await shot(page, 'chat-model-picker', [
    page.getByRole('textbox', { name: 'Search models' }),
    page.getByRole('menuitem', { name: /^Muse Spark 1\.3 Contributor/ }),
  ])
})

test('visual: wave1 sidebar collapsed with disabled emails', async ({ page }) => {
  await serveApi(page, [])
  await page.goto('/')
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await shot(page, 'wave1-sidebar-collapsed', [
    page.getByRole('button', { name: 'Expand sidebar' }),
    page.getByRole('button', { name: 'Emails (coming soon)' }),
  ])
})

test('visual: wave1 researches filtered counts with clearable search', async ({ page }) => {
  await serveApi(page)
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  await page.getByLabel('Search sectors').fill('Speciality')
  await shot(page, 'wave1-dashboard-filtered', [
    page.getByRole('button', { name: 'Clear search' }),
    page.getByText('1 sector'),
  ])
})

test('visual: wave2 dark overview with collapsed rail', async ({ page }) => {
  await serveApi(page, [])
  await page.goto('/')
  await page.getByRole('button', { name: 'Theme' }).click()
  await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await shot(page, 'wave2-dark-collapsed', [
    page.getByRole('heading', { name: 'Overview' }),
    page.getByRole('button', { name: 'Expand sidebar' }),
  ])
})

test('visual: wave2 mobile sector detail stacked', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await serveApi(page)
  // Below 768px the sidebar is an icon rail with no accessible names;
  // deep-link like the v2 audits do. SL-01 actions are labelled now.
  await page.goto('/?section=SectorDetail&sector=sec-foods')
  await shot(page, 'wave2-mobile-detail', [
    page.getByRole('region', { name: 'Research status' }),
    page.getByRole('button', { name: 'Open workspace' }),
  ])
})

test('visual: wave2 runs list with cancelling tone', async ({ page }) => {
  await page.route('**/v1/**', async (route) => {
    const url = route.request().url()
    let data: unknown = []
    if (url.includes('/v1/companies')) data = { companies: [], total: 0 }
    else if (url.includes('/v1/runs')) {
      data = [{ id: 'run-1', sessionId: 's-1', threadKey: 's-1', state: 'CANCELLING', updatedAt: SECTOR.updatedAt }]
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  })
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Agents' }).click()
  await shot(page, 'wave2-runs-cancelling', [
    page.getByRole('heading', { name: 'Agents' }),
    page.getByText('Cancelling'),
  ])
})
