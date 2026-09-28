// Formatter proofs: a table-heavy agent reply renders without mid-token
// breaks, with quotes and code intact, in both themes and on mobile.
// Screenshots land in test-results/visual (gitignored); rows live in
// docs/frontend-verification.md.
import { expect, test, type Locator, type Page } from '@playwright/test'

const REPLY = [
  '**Verified via tools** for `sec-f95d337c`:',
  '',
  'Sector state:',
  '',
  '- name Speciality Foods, state `draft`, topic empty',
  '- `0` companies found, no pinned session',
  '',
  'Files attached:',
  '',
  '| filename | status | id |',
  '|---|---|---|',
  '| speciality-foods-context.md | indexed | sdoc-2a9ee883-8d32-40b2-af3b-972a2b10e |',
  '| speciality-foods-brief.md | indexed | sdoc-8e243545-46e2-4447-b5fe-d15155a2b10e |',
  '',
  '> ### Speciality Foods, sector brief',
  '>',
  '> Sector: Speciality Foods. State: draft. Topic: open (not yet narrowed).',
  '',
  'Full hash `5d1a33378a329b0e7ad3d770af41b4c97abe965761f309ae0f36e5d2f79013ae` for reference.',
].join('\n')

const session = {
  id: 's-1', title: 'Browser chat',
  createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z',
}

async function serveFormatterApi(page: Page): Promise<void> {
  await page.route('**/v1/**', async (route) => {
    const url = route.request().url()
    const method = route.request().method()
    if (url.includes('/events?')) {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
      return
    }
    let data: unknown = []
    if (url.endsWith('/v1/sessions')) data = [session]
    else if (url.endsWith('/v1/sessions/s-1')) data = session
    else if (url.endsWith('/v1/sessions/s-1/threads')) {
      data = [{ key: 's-1', sessionId: 's-1', kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: session.updatedAt }]
    } else if (url.includes('/v1/threads/s-1/messages') && method === 'GET') {
      data = [
        { seq: 1, kind: 'text', role: 'user', text: 'What files are attached?' },
        { seq: 2, kind: 'text', role: 'agent', text: REPLY },
      ]
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

async function openFormatterChat(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open chat' }).click()
  const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  await expect(chat.getByText('What files are attached?')).toBeVisible()
  await expect(chat.getByText('Files attached:')).toBeVisible()
}

test('formatter: table-heavy reply on light desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await serveFormatterApi(page)
  await page.goto('/')
  await openFormatterChat(page)
  const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  await shot(page, 'formatter-light-1440', [
    chat.getByRole('columnheader', { name: 'filename' }),
    chat.getByText('speciality-foods-context.md'),
  ])
})

test('formatter: table-heavy reply on dark desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await serveFormatterApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await openFormatterChat(page)
  const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  await shot(page, 'formatter-dark-1440', [
    chat.getByRole('columnheader', { name: 'filename' }),
    chat.getByText('speciality-foods-brief.md'),
  ])
})

test('formatter: table-heavy reply on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await serveFormatterApi(page)
  await page.goto('/')
  await openFormatterChat(page)
  const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  await shot(page, 'formatter-light-390', [
    chat.getByRole('columnheader', { name: 'id' }),
    chat.getByText('Files attached:'),
  ])
})
