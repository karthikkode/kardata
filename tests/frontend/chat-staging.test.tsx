// ChatPanel staging proofs. Every row comes from stubbed API responses:
// sessions, threads, messages, artifacts, stream frames, and commands.
// No fixture imports: the mock sessions, files, and agents must not appear.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatPanel, mergeChatMessages, toChatMessages, toLiveMessages } from '@/components/ChatPanel'
import type { StagingConfig } from '@/data/staging-api'

const config: StagingConfig = { baseUrl: 'https://staging.test', apiKey: 'key' }

const SESSIONS = [{ id: 's-1', title: 'Server chat', createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T01:00:00.000Z' }]
const THREADS = [
  { key: 's-1', sessionId: 's-1', kind: 'session', status: 'running', acceptingSteer: true, queueDepth: 0, updatedAt: '2026-09-26T01:00:00.000Z' },
]

function sseResponse(frames: unknown[]): Response {
  const bytes = new TextEncoder().encode(
    frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
  )
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  return { ok: true, status: 200, body: stream } as Response
}

function stubApi(handler: (url: string, init: { method?: string; body?: string }) => { status: number; payload?: unknown; raw?: Response }): { calls: Array<{ url: string; method: string; body?: string }> } {
  const calls: Array<{ url: string; method: string; body?: string }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { method?: string; body?: string } = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body })
      const { status, payload, raw } = handler(url, init)
      if (raw) return raw
      return { ok: status >= 200 && status < 300, status, json: async () => payload }
    }),
  )
  return { calls }
}

function quietStream(): Response {
  return sseResponse([])
}

beforeEach(() => {
  vi.stubEnv('VITE_STAGING_API', '1')
  vi.stubEnv('VITE_STAGING_URL', 'https://staging.test')
  vi.stubEnv('VITE_STAGING_KEY', 'key')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function baseHandler(url: string): { status: number; payload?: unknown; raw?: Response } {
  if (url.endsWith('/v1/sessions')) return { status: 200, payload: { ok: true, data: SESSIONS } }
  if (url.includes('/threads') && !url.includes('/messages') && !url.includes('/events')) {
    return { status: 200, payload: { ok: true, data: THREADS } }
  }
  if (url.includes('/messages')) return { status: 200, payload: { ok: true, data: [] } }
  if (url.includes('/artifacts')) return { status: 200, payload: { ok: true, data: [] } }
  if (url.includes('/events')) return { status: 200, raw: quietStream() }
  if (url.includes('/runs')) return { status: 200, payload: { ok: true, data: [] } }
  return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'no' } } }
}

describe('chat staging (no mocks)', () => {
  it('keeps a streamed reply when an older REST page resolves later', () => {
    const streamed = toLiveMessages([
      { seq: 2, role: 'agent', kind: 'text', text: 'live answer' },
    ])
    const older = toChatMessages([{ seq: 1, role: 'user', kind: 'text', text: 'question' }])
    const merged = mergeChatMessages(streamed, older)
    expect(merged.map((row) => row.id)).toEqual(['m-1', 'm-2'])
    expect(mergeChatMessages(merged, streamed)).toHaveLength(2)
  })
  it('lists real sessions and opens the first thread', async () => {
    stubApi((url) => baseHandler(url))
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Chat sessions' }))
    expect(await screen.findByRole('menuitem', { name: 'Open Server chat' })).toBeInTheDocument()
    expect(screen.queryByText('0 subagents')).not.toBeInTheDocument()
    // Mock titles stay out of the live render.
    expect(screen.queryByText('ETL Optimization')).not.toBeInTheDocument()
  })

  it('opens the slash skill picker and inserts the picked skill', async () => {
    stubApi((url) => {
      if (url.endsWith('/v1/skills')) {
        return {
          status: 200,
          payload: {
            ok: true,
            data: [
              { name: 'brainstorm', description: 'Open product discussion', tools: ['db.kb_search'] },
              { name: 'sector-draft', description: 'Draft a sector', tools: ['db.create_sector'] },
            ],
          },
        }
      }
      return baseHandler(url)
    })
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    const box = (await screen.findByLabelText('Message the agent')) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '/br' } })
    expect(await screen.findByRole('listbox', { name: 'Invoke a skill' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '/brainstorm Open product discussion' })).toBeInTheDocument()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(box.value).toBe('/brainstorm ')
  })
  it('sends through commands and surfaces send failures without echoing', async () => {
    const { calls } = stubApi((url) => baseHandler(url))
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    const box = await screen.findByLabelText('Message the agent')
    fireEvent.change(box, { target: { value: 'hello server' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url.endsWith('/v1/commands/send'))).toBe(true)
    })
    const send = calls.find((call) => call.url.endsWith('/v1/commands/send'))
    expect(send?.method).toBe('POST')
    expect(send?.body).toBe(JSON.stringify({ threadKey: 's-1', text: 'hello server' }))
    // Rejected send: the optimistic echo stays hidden, the failure
    // notice shows, and the draft is restored for editing (Retry reuses
    // the pending payload).
    expect(await screen.findByText('The request failed.')).toBeInTheDocument()
    expect(within(screen.getByRole('log', { name: 'Chat messages' })).queryByText('hello server')).not.toBeInTheDocument()
    const restored = (await screen.findByLabelText('Message the agent')) as HTMLTextAreaElement
    expect(restored).toHaveValue('hello server')
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()
    })
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows offline copy and fires no request when the browser is offline', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      const { calls } = stubApi((url) => baseHandler(url))
      render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
      const box = await screen.findByLabelText('Message the agent')
      fireEvent.change(box, { target: { value: 'hello offline' } })
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
      expect(await screen.findByText('No connection.')).toBeInTheDocument()
      expect(calls.some((call) => call.url.endsWith('/v1/commands/send'))).toBe(false)
      expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()
    } finally {
      online.mockRestore()
    }
  })

  it('does not create a session on send while offline', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      const { calls } = stubApi((url, init) => {
        if (url.endsWith('/v1/sessions') && (init.method ?? 'GET') === 'GET') {
          return { status: 200, payload: { ok: true, data: [] } }
        }
        return baseHandler(url)
      })
      render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
      expect(await screen.findByPlaceholderText('Ask Karbot...')).toBeInTheDocument()
      const box = screen.getByLabelText('Message the agent')
      fireEvent.change(box, { target: { value: 'offline first' } })
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
      expect(await screen.findByText('No connection.')).toBeInTheDocument()
      expect(calls.some((call) => call.method === 'POST')).toBe(false)
    } finally {
      online.mockRestore()
    }
  })

  it('starts a session on send when none exists (start-on-send)', async () => {
    const { calls } = stubApi((url, init) => {
      if (url.endsWith('/v1/sessions')) {
        if ((init.method ?? 'GET') === 'POST') {
          return {
            status: 200,
            payload: {
              ok: true,
              data: { id: 's-new', title: 'first question', createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z' },
            },
          }
        }
        return { status: 200, payload: { ok: true, data: [] } }
      }
      if (url.endsWith('/v1/commands/send')) return { status: 202, payload: { ok: true, data: { commandId: 'cmd-1', state: 'accepted' } } }
      return baseHandler(url)
    })
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    expect(await screen.findByPlaceholderText('Ask Karbot...')).toBeInTheDocument()
    const box = screen.getByLabelText('Message the agent')
    fireEvent.change(box, { target: { value: 'first question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url.endsWith('/v1/commands/send'))).toBe(true)
    })
    const created = calls.find((call) => call.url.endsWith('/v1/sessions') && call.method === 'POST')
    expect(created).toBeDefined()
    const send = calls.find((call) => call.url.endsWith('/v1/commands/send'))
    expect(send?.body).toBe(JSON.stringify({ threadKey: 's-new', text: 'first question' }))
    // The new session becomes active: it leads the sessions menu.
    fireEvent.click(screen.getByRole('button', { name: 'Chat sessions' }))
    expect(await screen.findByRole('menuitem', { name: 'Open first question' })).toBeInTheDocument()
  })

  it('echoes the sent message instantly, then shows the confirmed copy once', async () => {
    let push: ((bytes: Uint8Array) => void) | undefined
    let acceptSend = () => undefined
    const encode = (frames: unknown[]) =>
      new TextEncoder().encode(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''))
    stubApi((url) => {
      if (url.endsWith('/v1/commands/send')) {
        // Held open: the Sending caption belongs to the in-flight POST,
        // not to the confirmed echo that follows it. The async stub
        // adopts the gate, so fetch stays pending until accepted.
        const gate = new Promise<Response>((resolve) => {
          acceptSend = () =>
            resolve({
              ok: true,
              status: 200,
              json: async () => ({ ok: true, data: { commandId: 'cmd-1', state: 'accepted' } }),
            } as Response)
        })
        return { status: 200, raw: gate as unknown as Response }
      }
      if (url.includes('/events')) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            push = (bytes) => controller.enqueue(bytes)
          },
        })
        return { status: 200, raw: { ok: true, status: 200, body: stream } as Response }
      }
      return baseHandler(url)
    })
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    await screen.findByRole('button', { name: 'Send message' })
    const box = await screen.findByLabelText('Message the agent')
    fireEvent.change(box, { target: { value: 'hello server' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    // Instant local echo with the in-flight caption.
    expect(await screen.findByText('hello server')).toBeInTheDocument()
    expect(screen.getByText('Sending…')).toBeInTheDocument()
    // Accepted: the caption clears (the message is sent) while the echo
    // stays until the confirmed copy lands.
    acceptSend()
    await vi.waitFor(() => {
      expect(screen.queryByText('Sending…')).not.toBeInTheDocument()
    })
    expect(screen.getByText('hello server')).toBeInTheDocument()
    await vi.waitFor(() => expect(push).toBeDefined())
    // The run confirms through the still-open tail: echo hides, exactly
    // one confirmed bubble remains (never a duplicate).
    push!(
      encode([
        { seq: 1, threadKey: 's-1', type: 'message', at: '', payload: { id: 'u1', role: 'user', kind: 'text', text: 'hello server' } },
        { seq: 2, threadKey: 's-1', type: 'message', at: '', payload: { id: 'a1', role: 'agent', kind: 'text', text: 'done here' } },
      ]),
    )
    await vi.waitFor(() => {
      expect(screen.getAllByText('hello server')).toHaveLength(1)
      expect(screen.getByText('done here')).toBeInTheDocument()
    })
  })

  it('clears Replying when a resumed stream contains only a short message tail', async () => {
    let push: ((bytes: Uint8Array) => void) | undefined
    const previous = Array.from({ length: 10 }, (_, index) => ({
      seq: index + 1, kind: 'text', role: index % 2 ? 'agent' : 'user',
      text: `previous ${index + 1}`, at: '',
    }))
    stubApi((url) => {
      if (url.includes('/messages')) return { status: 200, payload: { ok: true, data: previous } }
      if (url.endsWith('/v1/commands/send')) return { status: 202, payload: { ok: true, data: { commandId: 'cmd-1', state: 'accepted' } } }
      if (url.includes('/events')) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) { push = (bytes) => controller.enqueue(bytes) },
        })
        return { status: 200, raw: { ok: true, status: 200, body: stream } as Response }
      }
      return baseHandler(url)
    })
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    await screen.findByText('previous 10')
    const box = screen.getByLabelText('Message the agent')
    fireEvent.change(box, { target: { value: 'new question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByLabelText('Agent is replying')).toBeInTheDocument()
    await vi.waitFor(() => expect(push).toBeDefined())
    const frames = [
      { seq: 201, threadKey: 's-1', type: 'message', at: '', payload: { seq: 11, kind: 'text', role: 'user', text: 'new question' } },
      { seq: 202, threadKey: 's-1', type: 'message', at: '', payload: { seq: 12, kind: 'text', role: 'agent', text: 'new answer' } },
    ]
    push!(new TextEncoder().encode(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')))
    expect(await screen.findByText('new answer')).toBeInTheDocument()
    await vi.waitFor(() => expect(screen.queryByLabelText('Agent is replying')).not.toBeInTheDocument())
  })

  it('fails visible instead of spinning Replying when the stream dies with no reply', async () => {
    stubApi((url) => {
      if (url.endsWith('/v1/commands/send')) return { status: 202, payload: { ok: true, data: { commandId: 'cmd-1', state: 'accepted' } } }
      // Dead tail: every reconnect fails, and no terminal message lands.
      if (url.includes('/events')) return { status: 500, payload: { ok: false, error: { code: 'overload', message: 'down' } } }
      return baseHandler(url)
    })
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    await screen.findByRole('button', { name: 'Send message' })
    const box = screen.getByLabelText('Message the agent')
    fireEvent.change(box, { target: { value: 'doomed question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByLabelText('Agent is replying')).toBeInTheDocument()
    // Three dead reconnects, then the wait ends with a visible failure
    // (and the sent text restored for retry) instead of an eternal Replying.
    expect(await screen.findByRole('alert', undefined, { timeout: 15000 })).toHaveTextContent('The reply never arrived.')
    await vi.waitFor(() => expect(screen.queryByLabelText('Agent is replying')).not.toBeInTheDocument())
    const alertBox = screen.getByRole('alert').parentElement
    if (!alertBox) throw new Error('send-failure box missing')
    expect(within(alertBox).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('keeps streamed tool identity and state instead of nameless running rows', () => {
    const rows = toLiveMessages([
      { id: 't1', role: '', kind: 'tool', text: '', name: 'db.list_sessions', detail: 'mcp:db.list_sessions', state: 'done', at: '' },
    ])
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.kind).toBe('tool')
    if (row?.kind === 'tool') {
      expect(row.name).toBe('db.list_sessions')
      expect(row.detail).toBe('mcp:db.list_sessions')
      expect(row.state).toBe('done')
    }
  })

  it('shows a running tool before the final reply is persisted', async () => {
    let push: ((frame: unknown) => void) | undefined
    stubApi((url) => {
      if (url.includes('/events')) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) { push = (frame) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`)) },
        })
        return { status: 200, raw: { ok: true, status: 200, body: stream } as Response }
      }
      return baseHandler(url)
    })
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    await vi.waitFor(() => expect(push).toBeDefined())
    push!({ seq: 1, threadKey: 's-1', type: 'tool', at: '', payload: { runKey: 'r:1', id: 'c1', name: 'db.list_sectors', state: 'running' } })
    expect(await screen.findByText('Using Listed sectors...')).toBeInTheDocument()
    expect(screen.queryByText('There are no sectors yet.')).not.toBeInTheDocument()
  })

  it('renders agent replies as formatted markdown, not raw markers', async () => {
    stubApi((url) => {
      if (url.includes('/messages')) {
        return {
          status: 200,
          payload: {
            ok: true,
            data: [
              { seq: 1, kind: 'text', role: 'user', text: 'status', at: '' },
              { seq: 2, kind: 'text', role: 'agent', text: '**Sessions:** 0 found\n\n- one', at: '' },
            ],
          },
        }
      }
      return baseHandler(url)
    })
    const { container } = render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    expect(await screen.findByText('Sessions:')).toBeInTheDocument()
    expect(container.querySelector('strong')).not.toBeNull()
    expect(container.querySelector('ul')).not.toBeNull()
    expect(container.textContent).not.toContain('**')
  })

  it('shows a thinking placeholder with elapsed time before the first frame', async () => {
    stubApi((url) => {
      if (url.endsWith('/v1/commands/send')) return { status: 202, payload: { ok: true, data: { commandId: 'cmd-1', state: 'accepted' } } }
      if (url.includes('/events')) return { status: 200, raw: quietStream() }
      return baseHandler(url)
    })
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    const box = await screen.findByLabelText('Message the agent')
    fireEvent.change(box, { target: { value: 'think hard' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    // Accepted with zero frames: the thinking shell (stable aria-label)
    // proves the app is alive during provider silence.
    expect(await screen.findByLabelText('Agent is replying')).toBeInTheDocument()
    expect(screen.getByText('Thinking', { exact: false })).toBeInTheDocument()
  })

  it('shows elapsed time on a running tool call', async () => {
    let push: ((frame: unknown) => void) | undefined
    stubApi((url) => {
      if (url.includes('/events')) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) { push = (frame) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`)) },
        })
        return { status: 200, raw: { ok: true, status: 200, body: stream } as Response }
      }
      return baseHandler(url)
    })
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    await vi.waitFor(() => expect(push).toBeDefined())
    push!({ seq: 1, threadKey: 's-1', type: 'tool', at: '', payload: { runKey: 'r:1', id: 'c1', name: 'db.list_sectors', state: 'running' } })
    expect(await screen.findByText('Using Listed sectors...')).toBeInTheDocument()
  })

  it('groups consecutive tool calls into one collapsible block', async () => {
    stubApi((url) => {
      if (url.includes('/messages')) {
        return {
          status: 200,
          payload: {
            ok: true,
            data: [
              { seq: 1, kind: 'text', role: 'user', text: 'scan it', at: '' },
              { seq: 2, kind: 'tool', name: 'domain.scan', detail: 'mcp:domain.scan', state: 'done', at: '' },
              { seq: 3, kind: 'tool', name: 'db.list_sessions', detail: 'mcp:db.list_sessions', state: 'done', at: '' },
              { seq: 4, kind: 'text', role: 'agent', text: 'found two', at: '' },
            ],
          },
        }
      }
      return baseHandler(url)
    })
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    expect(await screen.findByText('Used 2 tools')).toBeInTheDocument()
    expect(screen.queryByText('Scan')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show tool activity' }))
    expect(screen.getByText('Scan')).toBeInTheDocument()
    expect(screen.getByText('Listed sessions')).toBeInTheDocument()
    // Chronological order is preserved: tools sit between the user
    // message and the reply, not trailing at the bottom.
    const rows = screen.getByRole('log', { name: 'Chat messages' }).textContent ?? ''
    expect(rows.indexOf('scan it') < rows.indexOf('Used 2 tools')).toBe(true)
    expect(rows.indexOf('Used 2 tools') < rows.indexOf('found two')).toBe(true)
  })

  it('renders persisted thinking traces in a collapsible block', async () => {
    stubApi((url) => {
      if (url.includes('/messages')) {
        return {
          status: 200,
          payload: {
            ok: true,
            data: [
              { seq: 1, kind: 'text', role: 'agent', text: 'done here', reasoning: 'weighing options', at: '' },
            ],
          },
        }
      }
      return baseHandler(url)
    })
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    expect(await screen.findByText('done here')).toBeInTheDocument()
    const activity = screen.getByRole('button', { name: 'Show reasoning' })
    fireEvent.click(activity)
    expect(screen.getByText('weighing options')).toBeInTheDocument()
  })

  it('renders live thinking traces while the reply streams', async () => {
    stubApi((url) => {
      if (url.includes('/events')) {
        // Open tail like production: the socket stays up, so the
        // in-flight thinking trace is observable instead of wiped by
        // the stream-close resync.
        const bytes = new TextEncoder().encode(
          `data: ${JSON.stringify({ seq: 1, threadKey: 's-1', type: 'reasoning', at: '', payload: { runKey: 'r', text: 'thinking it' } })}\n\n`,
        )
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes)
          },
        })
        return { status: 200, raw: { ok: true, status: 200, body: stream } as Response }
      }
      return baseHandler(url)
    })
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    expect(await screen.findByText('Thinking')).toBeInTheDocument()
    expect(screen.queryByText('thinking it')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show live reasoning' }))
    expect(screen.getByText('thinking it')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide live reasoning' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('renders streamed agent messages and pending deltas', async () => {
    stubApi((url) => {
      if (url.includes('/events')) {
        // Open tail: frames flow but the socket never closes, so no final
        // resync wipes the streamed rows (production resyncs from the
        // persisted log, which the stub cannot do).
        const bytes = new TextEncoder().encode(
          [
            { seq: 1, threadKey: 's-1', type: 'delta', at: '', payload: { runKey: 'r', text: 'working on' } },
            { seq: 2, threadKey: 's-1', type: 'message', at: '', payload: { id: 'a1', role: 'agent', kind: 'text', text: 'done here' } },
          ]
            .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
            .join(''),
        )
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes)
          },
        })
        return { status: 200, raw: { ok: true, status: 200, body: stream } as Response }
      }
      return baseHandler(url)
    })
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    expect(await screen.findByText('done here')).toBeInTheDocument()
  })

  it('shows partial text below the user turn before the provider finishes', async () => {
    let push: ((frame: unknown) => void) | undefined
    stubApi((url) => {
      if (url.includes('/messages')) return { status: 200, payload: { ok: true, data: [] } }
      if (url.includes('/events')) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            push = (frame) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`))
          },
        })
        return { status: 200, raw: { ok: true, status: 200, body: stream } as Response }
      }
      return baseHandler(url)
    })
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    await vi.waitFor(() => expect(push).toBeDefined())
    push!({ seq: 1, threadKey: 's-1', type: 'message', at: '', payload: { seq: 1, role: 'user', kind: 'text', text: 'What is happening?' } })
    push!({ seq: 2, threadKey: 's-1', type: 'delta', at: '', payload: { runKey: 'r', text: 'I am checking' } })
    expect(await screen.findByText('I am checking')).toBeInTheDocument()
    const log = screen.getByRole('log', { name: 'Chat messages' })
    expect((log.textContent ?? '').indexOf('What is happening?')).toBeLessThan((log.textContent ?? '').indexOf('I am checking'))
    push!({ seq: 3, threadKey: 's-1', type: 'delta', at: '', payload: { runKey: 'r', text: ' the sector.' } })
    expect(await screen.findByText('I am checking the sector.')).toBeInTheDocument()
    push!({ seq: 4, threadKey: 's-1', type: 'message', at: '', payload: { seq: 2, role: 'agent', kind: 'text', text: 'I am checking the sector.' } })
    await vi.waitFor(() => expect(screen.getAllByText('I am checking the sector.')).toHaveLength(1))
  })

  it('sends with Enter while a reply streams (no submit button then)', async () => {
    const { calls } = stubApi((url) => {
      if (url.includes('/events')) {
        // Delta with no terminal message: the panel stays in the
        // replying state, where Stop replaces Send.
        const bytes = new TextEncoder().encode(
          `data: ${JSON.stringify({ seq: 1, threadKey: 's-1', type: 'delta', at: '', payload: { runKey: 'r', text: 'working on' } })}\n\n`,
        )
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes)
          },
        })
        return { status: 200, raw: { ok: true, status: 200, body: stream } as Response }
      }
      return baseHandler(url)
    })
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    expect(await screen.findByRole('button', { name: 'Stop reply' })).toBeInTheDocument()
    const box = screen.getByLabelText('Message the agent')
    fireEvent.change(box, { target: { value: 'follow-up' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await vi.waitFor(() => {
      const sends = calls.filter((call) => call.url.endsWith('/v1/commands/send'))
      expect(sends.length).toBeGreaterThanOrEqual(1)
      expect(sends[sends.length - 1]?.body).toBe(JSON.stringify({ threadKey: 's-1', text: 'follow-up' }))
    })
  })

  it('deletes the session after confirm, dropping it from the header', async () => {
    const { calls } = stubApi((url, init) => {
      if (init.method === 'DELETE' && url.includes('/v1/sessions/s-1')) {
        return { status: 200, payload: { ok: true, data: { id: 's-1', deleted: true } } }
      }
      return baseHandler(url)
    })
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    // Arm, not fire: no request until confirmed.
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
    expect(await screen.findByRole('alertdialog', { name: 'Delete "Server chat"?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }))
    await vi.waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE' && call.url.includes('/v1/sessions/s-1'))).toBe(true)
    })
    // The tombstoned session leaves the header; the panel falls back.
    await vi.waitFor(() => {
      expect(screen.queryByText('Server chat')).not.toBeInTheDocument()
    })
  })

  it('deletes from the sessions list after row confirm', async () => {
    const { calls } = stubApi((url, init) => {
      if (init.method === 'DELETE' && url.includes('/v1/sessions/s-1')) {
        return { status: 200, payload: { ok: true, data: { id: 's-1', deleted: true } } }
      }
      return baseHandler(url)
    })
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Chat sessions' }))
    const menu = await screen.findByRole('menu', { name: 'Chat sessions' })
    fireEvent.click(within(menu).getByRole('button', { name: 'Delete Server chat' }))
    // Arm, not fire: no request until the row confirm.
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
    expect(await screen.findByRole('alertdialog', { name: 'Delete "Server chat"?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }))
    await vi.waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE' && call.url.includes('/v1/sessions/s-1'))).toBe(true)
    })
    // The row leaves the list with the session.
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Open Server chat' })).not.toBeInTheDocument()
    })
  })

  it('shows the denied notice for refused keys, never mock data', async () => {
    stubApi(() => ({ status: 403, payload: { ok: false, error: { code: 'permission_denied', message: 'no' } } }))
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    expect(await screen.findByText('Chat is not shared with this key.')).toBeInTheDocument()
    expect(screen.queryByText('Start conversation')).not.toBeInTheDocument()
  })

  it('shows the active session name in the header', async () => {
    stubApi((url) => baseHandler(url))
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    expect(await screen.findByText('Server chat')).toBeInTheDocument()
  })

  it('explains a missing backend connection with a reload action', () => {
    render(<ChatPanel config={null} scope={null} contextSummary={null} onClose={() => undefined} />)
    expect(screen.getByText('Chat needs a backend connection.')).toBeInTheDocument()
    expect(screen.getByText('Set the staging API URL and key, then reload.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('shows the scoped context popover for a sector-linked chat', async () => {
    stubApi((url) => baseHandler(url))
    render(
      <ChatPanel
        config={config}
        scope={{ id: 'sector-1', name: 'Seed sector' }}
        contextSummary="Seed sector · 4 found · Running"
        contextDetails={[{ label: 'Sector', value: 'Seed sector' }]}
        onClose={() => undefined}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Context' }))
    expect(await screen.findByRole('region', { name: 'Chat context' })).toBeInTheDocument()
    expect(screen.getByText('What this chat knows')).toBeInTheDocument()
    expect(screen.getByText('Seed sector · 4 found · Running')).toBeInTheDocument()
    expect(screen.getByText('Sector')).toBeInTheDocument()
  })

  it('renames the session through the rename command', async () => {
    const { calls } = stubApi((url, init) => {
      if (url.endsWith('/rename') && init.method === 'POST') {
        return {
          status: 200,
          payload: { ok: true, data: { ...SESSIONS[0], title: 'Renamed chat' } },
        }
      }
      return baseHandler(url)
    })
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    expect(await screen.findByRole('dialog', { name: 'Rename chat' })).toBeInTheDocument()
    const box = screen.getByLabelText('Chat name')
    expect(box).toHaveValue('Server chat')
    fireEvent.change(box, { target: { value: 'Renamed chat' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Renamed chat')).toBeInTheDocument()
    const rename = calls.find((call) => call.url.endsWith('/v1/sessions/s-1/rename'))
    expect(rename?.method).toBe('POST')
    expect(rename?.body).toBe(JSON.stringify({ title: 'Renamed chat' }))
  })

  it('disables rename save for a blank name without calling the API', async () => {
    const { calls } = stubApi((url) => baseHandler(url))
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    expect(await screen.findByRole('dialog', { name: 'Rename chat' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Chat name'), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(calls.some((call) => call.url.endsWith('/rename'))).toBe(false)
  })

  it('creates a session through the API', async () => {
    const { calls } = stubApi((url, init) => {
      if (url.endsWith('/v1/sessions') && init.method === 'POST') {
        return {
          status: 201,
          payload: { ok: true, data: { id: 's-2', title: 'New chat', createdAt: '', updatedAt: '' } },
        }
      }
      return baseHandler(url)
    })
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Chat sessions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New chat' }))
    await vi.waitFor(() => {
      expect(calls.some((call) => call.url.endsWith('/v1/sessions') && call.method === 'POST')).toBe(true)
    })
  })
  it('distinguishes duplicate session titles by the exact identifier shown in alerts', async () => {
    const rows = [
      { ...SESSIONS[0], title: 'TEST duplicate title' },
      { ...SESSIONS[0], id: 's-2', title: 'TEST duplicate title' },
    ]
    stubApi((url) => url.endsWith('/v1/sessions')
      ? { status: 200, payload: { ok: true, data: rows } }
      : baseHandler(url))
    render(<ChatPanel config={config} scope={null} contextSummary={null} onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Chat sessions' }))
    const choices = await screen.findAllByRole('menuitem', { name: 'Open TEST duplicate title' })
    expect(within(choices[0]!).getByText('s-1', { exact: true })).toBeVisible()
    expect(within(choices[1]!).getByText('s-2', { exact: true })).toBeVisible()
  })

})
