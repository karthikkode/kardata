import { expect, test, type Page } from '@playwright/test'

const session = {
  id: 's-1', title: 'Browser chat',
  createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z',
}

async function serveApi(page: Page, sent?: Promise<void>, release?: () => void) {
  await page.route('**/v1/**', async (route) => {
    const url = route.request().url()
    const method = route.request().method()
    if (url.includes('/events?')) {
      if (sent) await sent
      const frames = [
        { seq: 1, threadKey: 's-1', type: 'message', at: '', payload: { seq: 1, kind: 'text', role: 'user', text: 'Check the sector' } },
        { seq: 2, threadKey: 's-1', type: 'message', at: '', payload: { seq: 2, kind: 'tool', name: 'db.list_sectors', detail: 'mcp:db.list_sectors', state: 'done' } },
        { seq: 3, threadKey: 's-1', type: 'message', at: '', payload: { seq: 3, kind: 'text', role: 'agent', text: 'There are no sectors yet.', reasoning: 'Checked the sector list.' } },
      ]
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') })
      return
    }
    let data: unknown = []
    if (url.includes('/v1/companies')) data = { companies: [], total: 0 }
    else if (url.endsWith('/v1/sessions')) data = [session]
    else if (url.endsWith('/v1/sessions/s-1')) data = session
    else if (url.endsWith('/v1/sessions/s-1/threads')) data = [{ key: 's-1', sessionId: 's-1', kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: session.updatedAt }]
    else if (url.includes('/v1/commands/send') && method === 'POST') {
      data = { commandId: 'cmd-1', state: 'accepted' }
      release?.()
    } else if (url.endsWith('/v1/providers')) data = {
      defaultProvider: 'meta', providers: [{ name: 'meta', hasKey: true, defaultModel: 'muse-spark-1.3-contributor', models: [
        { provider: 'meta', model: 'muse-spark-1.3-contributor', displayName: 'muse-spark-1.3-contributor', reasoning: 'native', mode: 'responses', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
        { provider: 'meta', model: 'muse-spark-1.3', displayName: 'muse-spark-1.3', reasoning: 'native', mode: 'responses', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
      ] }],
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  })
}

test('overview shows the live empty state without sample research', async ({ page }) => {
  await serveApi(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(page.getByText('No sectors yet')).toBeVisible()
})

test('chat picker offers only live Meta models and seeds Contributor high', async ({ page }) => {
  await serveApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Ask Karbot' }).click()
  const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  const trigger = chat.getByRole('button', { name: 'Choose a model' })
  // The chat picker uses the generic label (pinned by models-staging.test):
  // the trigger reads Model while the menu carries the live catalog.
  await expect(trigger).toContainText('Model')
  await trigger.click()
  await expect(chat.getByRole('menu', { name: 'Models' }).getByText('Meta', { exact: true })).toBeVisible()
  await expect(chat.getByRole('menu', { name: 'Models' }).getByText('muse-spark-1.3-contributor')).toBeVisible()
  await expect(chat.getByText('DeepSeek')).toHaveCount(0)
})

test('chat shows a served reply, quiet tool disclosure, and provider trace', async ({ page }) => {
  let release = () => undefined
  const sent = new Promise<void>((resolve) => { release = resolve })
  await serveApi(page, sent, release)
  await page.goto('/')
  await page.getByRole('button', { name: 'Ask Karbot' }).click()
  const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  await expect(chat).toBeVisible()
  await chat.getByLabel('Message the agent').fill('Check the sector')
  await chat.getByRole('button', { name: 'Send message' }).click()
  await expect(chat.getByText('There are no sectors yet.')).toBeVisible()
  await expect(chat.getByText('Reasoning')).toBeVisible()
  await chat.getByRole('button', { name: 'Show Reasoning' }).click()
  await expect(chat.getByText('List sectors')).toBeVisible()
  await expect(chat.getByText('Checked the sector list.')).toBeVisible()
  await chat.getByRole('button', { name: 'Hide Reasoning' }).click()
  await chat.getByRole('button', { name: 'Close chat' }).click()
  await expect(chat).not.toBeVisible()
})

test('chat shows an MCP tool while its call is still running', async ({ page }) => {
  await serveApi(page)
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window)
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined
    window.fetch = (input, init) => {
      if (String(input).includes('/events?')) {
        return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
          start(controller) { stream = controller },
        }), { status: 200, headers: { 'content-type': 'text/event-stream' } }))
      }
      return nativeFetch(input, init)
    }
    Object.assign(window, {
      pushChatFrame(frame: unknown) {
        stream?.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`))
      },
    })
  })
  const push = (frame: unknown) => page.evaluate((value) => {
    (window as unknown as { pushChatFrame(frame: unknown): void }).pushChatFrame(value)
  }, frame)
  await page.goto('/')
  await page.getByRole('button', { name: 'Ask Karbot' }).click()
  const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  await chat.getByLabel('Message the agent').fill('Check the sector')
  await chat.getByRole('button', { name: 'Send message' }).click()
  await push({ seq: 1, threadKey: 's-1', type: 'message', at: '', payload: { seq: 1, kind: 'text', role: 'user', text: 'Check the sector' } })
  await push({ seq: 2, threadKey: 's-1', type: 'tool', at: '', payload: { runKey: 'r:1', id: 'c1', name: 'db.list_sectors', state: 'running' } })
  await expect(chat.getByText('Running')).toBeVisible()
  await expect(chat.getByText('List sectors')).toBeVisible()
  await expect(chat.getByText('There are no sectors yet.')).toHaveCount(0)
  await push({ seq: 3, threadKey: 's-1', type: 'tool', at: '', payload: { runKey: 'r:1', id: 'c1', name: 'db.list_sectors', state: 'done' } })
  await push({ seq: 4, threadKey: 's-1', type: 'message', at: '', payload: { seq: 2, kind: 'tool', name: 'db.list_sectors', detail: '', state: 'done' } })
  await push({ seq: 5, threadKey: 's-1', type: 'message', at: '', payload: { seq: 3, kind: 'text', role: 'agent', text: 'There are no sectors yet.' } })
  await expect(chat.getByText('There are no sectors yet.')).toBeVisible()
  await expect(chat.getByText('Running')).toHaveCount(0)
})
