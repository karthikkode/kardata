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
        { provider: 'meta', model: 'muse-spark-1.3-contributor', displayName: 'Muse Spark 1.3 Contributor', reasoning: 'native', mode: 'responses', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
        { provider: 'meta', model: 'muse-spark-1.3', displayName: 'Muse Spark 1.3', reasoning: 'native', mode: 'responses', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
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
  // The chat picker shows the bound display name plus the seeded effort
  // (generic pills live only in the legacy SectorChatPanel):
  // the trigger reads the Contributor name while the portalled
  // menu carries the live catalog (CP-03: search + provider groups +
  // effort submenus, display names, DeepSeek nowhere).
  await expect(trigger).toContainText('Muse Spark 1.3 Contributor')
  await expect(trigger).toContainText('high')
  await trigger.click()
  await expect(page.getByRole('textbox', { name: 'Search models' })).toBeVisible()
  await expect(page.getByText('Meta', { exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /^Muse Spark 1\.3 Contributor/ })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /Muse Spark 1\.3 Thinking/ })).toBeVisible()
  await expect(page.getByText('DeepSeek')).toHaveCount(0)
})

test('chat shows a served reply, quiet tool disclosure, and provider trace', async ({ page }) => {
  let release: () => void = () => undefined
  const sent = new Promise<void>((resolve) => { release = resolve })
  await serveApi(page, sent, release)
  await page.goto('/')
  await page.getByRole('button', { name: 'Ask Karbot' }).click()
  const chat = page.getByRole('complementary', { name: 'Assistant chat' })
  await expect(chat).toBeVisible()
  await chat.getByLabel('Message the agent').fill('Check the sector')
  await chat.getByRole('button', { name: 'Send message' }).click()
  await expect(chat.getByText('There are no sectors yet.')).toBeVisible()
  // CV-06/CV-07: reasoning and tool activity are separate quiet
  // disclosures now, tool names humanized (db.list_sectors -> Listed sectors).
  await expect(chat.getByText('Reasoning')).toBeVisible()
  await expect(chat.getByText('Used 1 tool')).toBeVisible()
  await chat.getByRole('button', { name: 'Show tool activity' }).click()
  await expect(chat.getByText('Listed sectors')).toBeVisible()
  await chat.getByRole('button', { name: 'Show reasoning' }).click()
  await expect(chat.getByText('Checked the sector list.')).toBeVisible()
  await chat.getByRole('button', { name: 'Hide reasoning' }).click()
  await chat.getByRole('button', { name: 'Close' }).click()
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
  // CV-07 live row: "Using <humanized tool>..." while the call runs.
  await expect(chat.getByText('Using Listed sectors...')).toBeVisible()
  await chat.getByRole('button', { name: 'Show tool activity' }).click()
  // Exact: the live summary ("Using Listed sectors...") also contains it.
  await expect(chat.getByText('Listed sectors', { exact: true })).toBeVisible()
  await expect(chat.getByText('There are no sectors yet.')).toHaveCount(0)
  await push({ seq: 3, threadKey: 's-1', type: 'tool', at: '', payload: { runKey: 'r:1', id: 'c1', name: 'db.list_sectors', state: 'done' } })
  await push({ seq: 4, threadKey: 's-1', type: 'message', at: '', payload: { seq: 2, kind: 'tool', name: 'db.list_sectors', detail: '', state: 'done' } })
  await push({ seq: 5, threadKey: 's-1', type: 'message', at: '', payload: { seq: 3, kind: 'text', role: 'agent', text: 'There are no sectors yet.' } })
  await expect(chat.getByText('There are no sectors yet.')).toBeVisible()
  await expect(chat.getByText('Using Listed sectors...')).toHaveCount(0)
})
