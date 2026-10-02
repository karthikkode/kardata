// Full visual matrix (revamp verification). Every primary surface captured in
// light + dark x desktop 1440 + mobile 390. Anchors asserted before every
// shot; animations frozen for determinism (motion is verified by the
// transition clips in transitions.spec.ts, not by stills). PNGs land in
// test-results/visual (gitignored); rows live in docs/frontend-verification.md.
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

async function serveMatrixApi(page: Page): Promise<void> {
  await page.route('**/v1/**', async (route) => {
    const url = route.request().url()
    const method = route.request().method()
    let data: unknown = []
    if (url.endsWith('/v1/sectors') && method === 'GET') data = [SECTOR]
    else if (url.endsWith('/v1/sectors/sec-foods')) data = SECTOR
    else if (url.includes('/v1/companies')) data = { companies: [], total: 0 }
    else if (url.includes('/v1/sectors/sec-foods/context') && method === 'GET') {
      data = {
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
        files: [],
        notes: [],
      }
    } else if (url.includes('/v1/sectors/sec-foods/documents')) data = []
    else if (url.includes('/v1/runs')) data = []
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
          { provider: 'meta', model: 'muse-spark-1.3-contributor', displayName: 'muse-spark-1.3-contributor', reasoning: 'native', mode: 'responses', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
        ] }],
      }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  })
}

async function shot(page: Page, name: string, anchors: Locator[]): Promise<void> {
  for (const anchor of anchors) await expect(anchor).toBeVisible()
  await page.screenshot({ path: `test-results/visual/${name}.png`, animations: 'disabled' })
}

async function toDark(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible()
}

async function captureSuite(page: Page, tag: string, dark = false): Promise<void> {
  await page.goto('/')
  if (dark) await toDark(page)
  await shot(page, `${tag}-overview`, [
    page.getByRole('heading', { name: 'Overview' }),
    page.getByRole('region', { name: 'Sector researches' }),
  ])
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  await shot(page, `${tag}-researches`, [page.getByText('Speciality Foods')])
  await page.getByRole('button', { name: 'Open Speciality Foods' }).click()
  // The sector route lands on the summary page; chat lives one Open deeper
  // (covered with session/thread/plan detail in workspace.spec.ts).
  await shot(page, `${tag}-detail`, [
    page.getByRole('region', { name: 'Research status' }),
    page.getByRole('button', { name: 'Open', exact: true }),
  ])
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Agents' }).click()
  await shot(page, `${tag}-agents`, [
    page.getByRole('heading', { name: 'Agents' }),
    page.getByLabel('Filter runs'),
  ])
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Models' }).click()
  await shot(page, `${tag}-models`, [page.getByRole('heading', { name: 'Models' })])
  await page.getByRole('button', { name: 'Open chat' }).click()
  const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  await shot(page, `${tag}-chat`, [chat])
}

test('matrix: light desktop 1440', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await serveMatrixApi(page)
  await captureSuite(page, 'matrix-light-1440')
})

test('matrix: dark desktop 1440', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await serveMatrixApi(page)
  await captureSuite(page, 'matrix-dark-1440', true)
})

test('matrix: light mobile 390', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await serveMatrixApi(page)
  await captureSuite(page, 'matrix-light-390')
})

test('matrix: dark mobile 390', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await serveMatrixApi(page)
  await captureSuite(page, 'matrix-dark-390', true)
})

test('matrix: reduced motion still completes navigation and dock', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await serveMatrixApi(page)
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Researches' }).click()
  await expect(page.getByRole('heading', { name: 'Researches', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Open chat' }).click()
  await expect(page.getByRole('complementary', { name: 'Assistant chat' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('complementary', { name: 'Assistant chat' })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Open chat' })).toBeFocused()
  await shot(page, 'matrix-reduced-motion', [page.getByRole('heading', { name: 'Researches', exact: true })])
})
