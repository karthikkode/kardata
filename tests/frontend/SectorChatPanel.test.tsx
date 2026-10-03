// SectorChatPanel proofs: the session pool is server-filtered by sector,
// creates carry the sector link, and sends go to the session thread.
// API answers are stubbed; no fixture imports.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionAge } from '@/components/ChatPanel'
import { SectorChatPanel } from '@/components/SectorChatPanel'
import type { StagingConfig } from '@/data/staging-api'

const config: StagingConfig = { baseUrl: 'https://staging.test', apiKey: 'key' }

const SECTOR_SESSIONS = [
  { id: 'salads', title: 'Speciality Foods chat', sectorId: 'sec-foods', createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T01:00:00.000Z' },
  { id: 'soups', title: 'Tomato soups', sectorId: 'sec-foods', createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T02:00:00.000Z' },
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

function stubApi(handler: (url: string, init: { method?: string; body?: string }) => { status: number; payload?: unknown; raw?: Response }): {
  calls: Array<{ url: string; method: string; body?: string }>
} {
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

beforeEach(() => {
  vi.stubEnv('VITE_STAGING_API', '1')
  vi.stubEnv('VITE_STAGING_URL', 'https://staging.test')
  vi.stubEnv('VITE_STAGING_KEY', 'key')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function renderPanel(
  research: {
    researchState?: 'draft' | 'running' | 'paused' | 'queued' | 'failed' | 'complete' | null
    researchSessionId?: string | null
    researchBusy?: boolean
    researchError?: string | null
    onPauseResearch?: () => void
    onResumeResearch?: () => void
    onStartResearch?: () => void
    onRestartResearch?: () => void
    onPlanResearch?: () => void
  } = {},
) {
  return render(
    <SectorChatPanel
      config={config}
      sectorId="sec-foods"
      sectorName="Speciality Foods"
      researchState={research.researchState ?? null}
      researchSessionId={research.researchSessionId ?? null}
      researchBusy={research.researchBusy ?? false}
      researchError={research.researchError ?? null}
      onPauseResearch={research.onPauseResearch ?? (() => {})}
      onResumeResearch={research.onResumeResearch ?? (() => {})}
      onStartResearch={research.onStartResearch ?? (() => {})}
      onRestartResearch={research.onRestartResearch ?? (() => {})}
      onPlanResearch={research.onPlanResearch ?? (() => {})}
    />,
  )
}

describe('SectorChatPanel', () => {
  it('shows a loading skeleton while the sector pool loads', async () => {
    stubApi((url) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: new Promise(() => undefined) }
      }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    renderPanel()
    expect(await screen.findByLabelText('Sector chats are loading')).toBeInTheDocument()
  })

  it('lists only the sector pool and creates linked chats', async () => {
    const { calls } = stubApi((url, init) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url === 'https://staging.test/v1/sessions' && init.method === 'POST') {
        const body = JSON.parse(init.body ?? '{}') as { title?: string; sectorId?: string }
        expect(body).toEqual({ title: 'Speciality Foods chat', sectorId: 'sec-foods' })
        return { status: 201, payload: { ok: true, data: { ...SECTOR_SESSIONS[0], id: 's-sec-2' } } }
      }
      if (url.includes('/messages')) return { status: 200, payload: { ok: true, data: [] } }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    renderPanel()
    await waitFor(() => expect(screen.getByText('Speciality Foods chat')).toBeInTheDocument())
    expect(calls.some((call) => call.url === 'https://staging.test/v1/sessions?sectorId=sec-foods')).toBe(true)
    expect(calls.some((call) => call.url === 'https://staging.test/v1/sessions' && !call.url.includes('?'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Chat sessions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New chat' }))
    await waitFor(() => expect(screen.getByText('Speciality Foods chat')).toBeInTheDocument())
  })

  it('sends to the session thread and streams the reply', async () => {
    stubApi((url, init) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url.endsWith('/v1/commands/send') && init.method === 'POST') {
        const body = JSON.parse(init.body ?? '{}') as { threadKey?: string; text?: string }
        expect(body).toEqual({ threadKey: 's-sec-1', text: 'hello sector' })
        return { status: 202, payload: { ok: true, data: { runId: 'run-1' } } }
      }
      if (url.includes('/messages')) {
        return {
          status: 200,
          payload: {
            ok: true,
            data: [
              { seq: 1, kind: 'text', role: 'user', text: 'hello sector' },
              { seq: 2, kind: 'text', role: 'agent', text: 'Fresh thread, same sector.' },
            ],
          },
        }
      }
      if (url.includes('/events')) {
        return {
          raw: sseResponse([{ seq: 3, type: 'message', payload: { seq: 2, kind: 'text', role: 'agent', text: 'Fresh thread, same sector.' } }]),
          status: 200,
        }
      }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    renderPanel()
    await waitFor(() => expect(screen.getByLabelText(/Message the .* chat/)).toBeInTheDocument())
    const box = screen.getByLabelText(/Message the .* chat/)
    fireEvent.change(box, { target: { value: 'hello sector' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(screen.getByText('Fresh thread, same sector.')).toBeInTheDocument())
  })

  it('shows the shared replying status while the reply streams nothing yet', async () => {
    stubApi((url, init) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url.endsWith('/v1/commands/send') && init.method === 'POST') {
        return { status: 202, payload: { ok: true, data: { runId: 'run-1' } } }
      }
      if (url.includes('/messages')) return { status: 200, payload: { ok: true, data: [] } }
      if (url.includes('/events')) {
        return { raw: { ok: true, status: 200, body: new ReadableStream<Uint8Array>() } as Response, status: 200 }
      }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    renderPanel()
    await waitFor(() => expect(screen.getByLabelText(/Message the .* chat/)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/Message the .* chat/), { target: { value: 'hello?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByLabelText('Agent is replying')).toBeInTheDocument()
  })

  it('splits the flow with a timestamp divider across a long gap', async () => {
    // Relative stamps keep the age buckets ("3h" vs "2h") fixed no matter
    // when the suite runs; absolute dates rot as the 24h bucket rolls over.
    const firstAt = new Date(Date.now() - 3 * 3600_000).toISOString()
    const secondAt = new Date(Date.now() - 2 * 3600_000).toISOString()
    stubApi((url) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url.includes('/messages')) {
        return {
          status: 200,
          payload: {
            ok: true,
            data: [
              { seq: 1, kind: 'text', role: 'user', text: 'first question', at: firstAt },
              { seq: 2, kind: 'text', role: 'agent', text: 'later answer', at: secondAt },
            ],
          },
        }
      }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    renderPanel()
    await waitFor(() => expect(screen.getByText('later answer')).toBeInTheDocument())
    // The divider repeats the second row's clock, so it appears twice inside
    // the thread. Scoped to the thread because the session list can carry the
    // same age for a session updated at the same hour.
    const thread = screen.getByLabelText('Chat messages')
    expect(within(thread).getAllByText(sessionAge(secondAt)).length).toBe(2)
  })

  it('wraps long tokens inside bubbles and inline code', async () => {
    const token = 'sec-f95d337c-8b50-426f-b39e-6b87a79b5391'
    stubApi((url) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url.includes('/messages')) {
        return {
          status: 200,
          payload: {
            ok: true,
            data: [
              { seq: 1, kind: 'text', role: 'user', text: `check ${token} now` },
              { seq: 2, kind: 'text', role: 'agent', text: `see \`${token}\` next` },
            ],
          },
        }
      }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    const { container } = renderPanel()
    await waitFor(() => expect(screen.getByText(/check sec-/)).toBeInTheDocument())
    const userBubble = screen.getByText(/check sec-/).closest('div')
    expect(userBubble?.className).toContain('[overflow-wrap:anywhere]')
    const code = container.querySelector('code')
    expect(code?.className).toContain('break-all')
  })

  it('streams live tool rows and the thinking trace during a turn', async () => {
    let push: ((frame: unknown) => void) | undefined
    stubApi((url, init) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url.endsWith('/v1/commands/send') && init.method === 'POST') {
        return { status: 202, payload: { ok: true, data: { runId: 'run-1' } } }
      }
      if (url.includes('/messages')) return { status: 200, payload: { ok: true, data: [] } }
      if (url.includes('/events')) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            push = (frame) =>
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`))
          },
        })
        return { status: 200, raw: { ok: true, status: 200, body: stream } as Response }
      }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    renderPanel()
    await waitFor(() => expect(screen.getByLabelText(/Message the .* chat/)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/Message the .* chat/), { target: { value: 'search now' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await vi.waitFor(() => expect(push).toBeDefined())
    push!({ seq: 1, type: 'reasoning', payload: { text: 'Checking context first.', runKey: 'r1' } })
    push!({ seq: 2, type: 'tool', payload: { runKey: 'r1', id: 't1', name: 'db.kb_search', state: 'running' } })
    expect(await screen.findByText('Reasoning')).toBeInTheDocument()
    expect(screen.getByText('Using Searched knowledge base...')).toBeInTheDocument()
    expect(screen.getByText('Searched knowledge base')).toBeInTheDocument()
  })

  it('shows a persisted thinking trace even with no tool calls', async () => {
    stubApi((url) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url.includes('/messages')) {
        return {
          status: 200,
          payload: {
            ok: true,
            data: [
              {
                seq: 2,
                kind: 'text',
                role: 'agent',
                text: 'Done.',
                reasoning: 'Checked context first.',
                at: '2026-09-27T00:00:00.000Z',
              },
            ],
          },
        }
      }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    renderPanel()
    await waitFor(() => expect(screen.getByText('Done.')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Show reasoning' }))
    expect(screen.getByText('Checked context first.')).toBeInTheDocument()
  })

  it('opens the live thinking trace while it streams without tools', async () => {
    let push: ((frame: unknown) => void) | undefined
    stubApi((url, init) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url.endsWith('/v1/commands/send') && init.method === 'POST') {
        return { status: 202, payload: { ok: true, data: { runId: 'run-1' } } }
      }
      if (url.includes('/messages')) return { status: 200, payload: { ok: true, data: [] } }
      if (url.includes('/events')) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            push = (frame) =>
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`))
          },
        })
        return { status: 200, raw: { ok: true, status: 200, body: stream } as Response }
      }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    renderPanel()
    await waitFor(() => expect(screen.getByLabelText(/Message the .* chat/)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/Message the .* chat/), { target: { value: 'think aloud' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await vi.waitFor(() => expect(push).toBeDefined())
    push!({ seq: 1, type: 'reasoning', payload: { text: 'Weighing two options.', runKey: 'r1' } })
    expect(await screen.findByText('Weighing two options.')).toBeInTheDocument()
  })

  it('echoes the sent text with Sending while no frame has landed', async () => {
    stubApi((url, init) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url.endsWith('/v1/commands/send') && init.method === 'POST') {
        return { status: 202, payload: { ok: true, data: { runId: 'run-1' } } }
      }
      if (url.includes('/messages')) return { status: 200, payload: { ok: true, data: [] } }
      if (url.includes('/events')) {
        return { raw: { ok: true, status: 200, body: new ReadableStream<Uint8Array>() } as Response, status: 200 }
      }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    renderPanel()
    await waitFor(() => expect(screen.getByLabelText(/Message the .* chat/)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/Message the .* chat/), { target: { value: 'hello?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByText('Sending…')).toBeInTheDocument()
    expect(screen.getByText('hello?')).toBeInTheDocument()
  })

  it('offers a Latest jump after scrolling up the message list', async () => {
    stubApi((url) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url.includes('/messages')) {
        return {
          status: 200,
          payload: { ok: true, data: [{ seq: 1, kind: 'text', role: 'user', text: 'first', at: '2026-09-27T00:00:00.000Z' }] },
        }
      }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    const { container } = renderPanel()
    await waitFor(() => expect(screen.getByText('first')).toBeInTheDocument())
    const list = container.querySelector('[aria-live]') as HTMLElement
    Object.defineProperties(list, {
      scrollHeight: { value: 2000, configurable: true },
      clientHeight: { value: 500, configurable: true },
    })
    list.scrollTop = 0
    fireEvent.scroll(list)
    expect(await screen.findByRole('button', { name: 'Latest' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Latest' }))
    expect(list.scrollTop).toBe(2000)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Latest' })).not.toBeInTheDocument())
  })

  it('reconciles a reply that lands after the stream ends', async () => {
    let reads = 0
    stubApi((url, init) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url.endsWith('/v1/commands/send') && init.method === 'POST') {
        return { status: 202, payload: { ok: true, data: { runId: 'run-1' } } }
      }
      if (url.includes('/messages')) {
        reads += 1
        // Mount read plus the first post-tail refetch both predate the
        // terminal append; only a reconciling read sees the reply.
        const data =
          reads < 3
            ? [{ seq: 1, kind: 'text', role: 'user', text: 'late reply?' }]
            : [
                { seq: 1, kind: 'text', role: 'user', text: 'late reply?' },
                { seq: 2, kind: 'text', role: 'agent', text: 'Landed after the tail.' },
              ]
        return { status: 200, payload: { ok: true, data } }
      }
      if (url.includes('/events')) return { raw: sseResponse([]), status: 200 }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    renderPanel()
    await waitFor(() => expect(screen.getByLabelText(/Message the .* chat/)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/Message the .* chat/), { target: { value: 'late reply?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(screen.getByText('Landed after the tail.')).toBeInTheDocument(), {
      timeout: 10000,
    })
  }, 15000)

  it('needs staging before any chat', () => {
    render(<SectorChatPanel config={null} sectorId="sec-foods" sectorName="Speciality Foods" />)
    expect(screen.getByText('Sector chat needs the staging backend first.')).toBeInTheDocument()
  })

  it('renders tool rows and timestamps instead of dropping them', async () => {
    stubApi((url) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url.includes('/messages')) {
        return {
          status: 200,
          payload: {
            ok: true,
            data: [
              { seq: 1, kind: 'text', role: 'user', text: 'search now', at: '2026-09-27T00:00:00.000Z' },
              { seq: 2, kind: 'tool', name: 'db.kb_search', detail: 'rows', state: 'done', at: '2026-09-27T00:01:00.000Z' },
              { seq: 3, kind: 'text', role: 'agent', text: 'Found it.', at: '2026-09-27T00:02:00.000Z' },
            ],
          },
        }
      }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    renderPanel()
    await waitFor(() => expect(screen.getByText('Found it.')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Show tool activity' }))
    expect(await screen.findByText('Searched knowledge base')).toBeInTheDocument()
    expect(screen.getAllByText(/\d+[mhd]|now/).length).toBeGreaterThan(0)
  })

  it('opens the sessions popover and switches chats', async () => {
    stubApi((url) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url === 'https://staging.test/v1/sessions/soups') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS[1] } }
      }
      if (url.includes('/messages')) {
        return { status: 200, payload: { ok: true, data: [] } }
      }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    renderPanel()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chat sessions' })).toBeInTheDocument())
    expect(screen.queryByLabelText('Chat', { selector: 'select' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Chat sessions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open Tomato soups' }))
    await waitFor(() => expect(screen.getByText('Tomato soups')).toBeInTheDocument())
  })

  it('creates chats from the icon button and deletes with confirm', async () => {
    stubApi((url, init) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods' && init.method === 'GET') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url === 'https://staging.test/v1/sessions' && init.method === 'POST') {
        return {
          status: 201,
          payload: { ok: true, data: { id: 'sess-new', title: 'Fresh chat', createdAt: 't', updatedAt: 't' } },
        }
      }
      if (url === 'https://staging.test/v1/sessions/soups') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS[1] } }
      }
      if (url === 'https://staging.test/v1/sessions/salads' && init.method === 'DELETE') {
        return { status: 200, payload: { ok: true, data: { id: 'sess-salads', deleted: true } } }
      }
      if (url.includes('/messages')) {
        return { status: 200, payload: { ok: true, data: [] } }
      }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    renderPanel()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chat sessions' })).toBeInTheDocument())
    expect(screen.queryByRole('menuitem', { name: 'New chat' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Chat sessions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New chat' }))
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'New chat' })).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Chat sessions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Speciality Foods chat' }))
    expect(await screen.findByRole('alertdialog', { name: 'Delete "Speciality Foods chat"?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }))
    await waitFor(() => expect(screen.queryByText('Speciality Foods chat')).not.toBeInTheDocument())
    expect(screen.getByText('Tomato soups')).toBeInTheDocument()
  })

  it('renames the active chat inline', async () => {
    stubApi((url, init) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url === 'https://staging.test/v1/sessions/salads') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS[0] } }
      }
      if (url === 'https://staging.test/v1/sessions/salads/rename' && init.method === 'POST') {
        return {
          status: 200,
          payload: { ok: true, data: { ...SECTOR_SESSIONS[0], title: 'Renamed salads' } },
        }
      }
      if (url.includes('/messages')) {
        return { status: 200, payload: { ok: true, data: [] } }
      }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    renderPanel()
    await waitFor(() => expect(screen.getByText('Speciality Foods chat')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Rename Speciality Foods chat' }))
    fireEvent.change(screen.getByLabelText('Session name'), { target: { value: 'Renamed salads' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save session name' }))
    await waitFor(() => expect(screen.getByText('Renamed salads')).toBeInTheDocument())
  })

  it('binds a model to the sector session through the toolbar', async () => {
    const { calls } = stubApi((url, init) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url.endsWith('/v1/providers')) {
        return {
          status: 200,
          payload: {
            ok: true,
            data: {
              defaultProvider: 'meta',
              providers: [{ name: 'meta', hasKey: true, defaultModel: 'muse-spark-1.3-contributor', models: [{ provider: 'meta', model: 'muse-spark-1.3-contributor', displayName: 'muse-spark-1.3-contributor', reasoning: 'none', efforts: [] }] }],
            },
          },
        }
      }
      if (url === 'https://staging.test/v1/sessions/salads') {
        return {
          status: 200,
          payload: {
            ok: true,
            data: { ...SECTOR_SESSIONS[0], model: { provider: 'meta', model: 'muse-spark-1.3-contributor', reasoning: false, effort: 'high' } },
          },
        }
      }
      if (url.endsWith('/v1/sessions/salads/model') && init.method === 'PATCH') {
        return { status: 200, payload: { ok: true, data: JSON.parse(init.body ?? '{}') } }
      }
      if (url.includes('/messages')) {
        return { status: 200, payload: { ok: true, data: [] } }
      }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    renderPanel()
    const modelTrigger = await screen.findByRole('button', { name: 'Choose a model' })
    // Composer pill stays generic (full names live in the menu): no
    // truncated model ids crowding the input row.
    expect(modelTrigger).toHaveTextContent('Model')
    expect(modelTrigger.closest('form')).toBe(screen.getByRole('button', { name: 'Send message' }).closest('form'))
    fireEvent.click(modelTrigger)
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'muse-spark-1.3-contributor' }))
    await waitFor(() =>
      expect(calls.some((call) => call.url.endsWith('/v1/sessions/salads/model') && call.method === 'PATCH')).toBe(true),
    )
  })

  it('pauses and resumes research from the chat strip', async () => {
    stubApi((url) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url.includes('/messages')) return { status: 200, payload: { ok: true, data: [] } }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    const onPauseResearch = vi.fn()
    const view = renderPanel({ researchState: 'running', onPauseResearch })
    expect(await screen.findByLabelText('Research state: In progress')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pause research' }))
    expect(onPauseResearch).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Resume research' })).not.toBeInTheDocument()
    view.unmount()
    const onResumeResearch = vi.fn()
    renderPanel({ researchState: 'paused', onResumeResearch })
    expect(await screen.findByLabelText('Research state: Paused')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resume research' }))
    expect(onResumeResearch).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Pause research' })).not.toBeInTheDocument()
  })

  it('plans a draft, starts an approved plan, and re-plans failures from the strip', async () => {
    stubApi((url) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url.includes('/messages')) return { status: 200, payload: { ok: true, data: [] } }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    // Drafts plan (plan-mandatory: no direct start).
    const onPlanResearch = vi.fn()
    const draft = renderPanel({ researchState: 'draft', onPlanResearch })
    expect(await screen.findByLabelText('Research state: Draft')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Plan research' }))
    expect(onPlanResearch).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Start research' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause research' })).not.toBeInTheDocument()
    draft.unmount()
    // Approved plans start.
    const onStartResearch = vi.fn()
    const approved = renderPanel({ researchState: 'approved', onStartResearch })
    expect(await screen.findByLabelText('Research state: Approved')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start research' }))
    expect(onStartResearch).toHaveBeenCalledTimes(1)
    approved.unmount()
    // Failures re-plan or restart the approved scope.
    const onRestartResearch = vi.fn()
    const onReplan = vi.fn()
    renderPanel({ researchState: 'failed', onRestartResearch, onPlanResearch: onReplan })
    expect(await screen.findByLabelText('Research state: Failed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Restart research' }))
    expect(onRestartResearch).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Plan research' }))
    expect(onReplan).toHaveBeenCalledTimes(1)
  })

  it('labels planning states with no action while a run is away', async () => {
    stubApi((url) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url.includes('/messages')) return { status: 200, payload: { ok: true, data: [] } }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    const planning = renderPanel({ researchState: 'planning' })
    expect(await screen.findByLabelText('Research state: Planning')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Plan research' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start research' })).not.toBeInTheDocument()
    planning.unmount()
    renderPanel({ researchState: 'planned' })
    expect(await screen.findByLabelText('Research state: Planned')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start research' })).not.toBeInTheDocument()
  })

  it('disables Plan while busy and shows research errors', async () => {
    stubApi((url) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url.includes('/messages')) return { status: 200, payload: { ok: true, data: [] } }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    renderPanel({ researchState: 'draft', researchBusy: true, researchError: 'Plan failed.' })
    expect(await screen.findByLabelText('Research state: Draft')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plan research' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Plan failed.')
  })

  it('pins the research session first in Chats', async () => {
    stubApi((url) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url.includes('/messages')) return { status: 200, payload: { ok: true, data: [] } }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    renderPanel({ researchState: 'running', researchSessionId: 'soups' })
    await waitFor(() => expect(screen.getByText('Speciality Foods chat')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Chat sessions' }))
    const items = await screen.findAllByRole('menuitem')
    // KB-03 puts the New chat row first; the pinned research session leads
    // the session rows after it.
    expect(items[0]).toHaveTextContent('New chat')
    expect(items[1]).toHaveTextContent('Tomato soups')
    expect(items[1]).toHaveTextContent('Research')
    expect(items[2]).toHaveTextContent('Speciality Foods chat')
  })

  it('stops a live reply and retries the last user message', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    stubApi((url, init) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url.endsWith('/v1/commands/send') && init.method === 'POST') {
        return { status: 202, payload: { ok: true, data: { runId: 'run-1' } } }
      }
      if (url.includes('/messages')) {
        return {
          status: 200,
          payload: { ok: true, data: [{ seq: 1, kind: 'text', role: 'user', text: 'again?' }] },
        }
      }
      if (url.includes('/events')) {
        return {
          raw: (async () => {
            await gate
            return sseResponse([])
          })() as unknown as Response,
          status: 200,
        }
      }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    renderPanel()
    await waitFor(() => expect(screen.getByLabelText(/Message the .* chat/)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/Message the .* chat/), { target: { value: 'again?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop reply' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Stop reply' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument())
    release()
  })

  it('proposes and approves a note into global sector context', async () => {
    const { calls } = stubApi((url, init) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url.includes('/messages')) {
        return {
          status: 200,
          payload: {
            ok: true,
            data: [
              { seq: 1, kind: 'text', role: 'user', text: 'focus on organic salads' },
              { seq: 2, kind: 'text', role: 'agent', text: 'Consider prioritizing companies with USDA organic certification.' },
            ],
          },
        }
      }
      if (url === 'https://staging.test/v1/sectors/sec-foods/context' && init.method === 'PATCH') {
        const body = JSON.parse(init.body ?? '{}') as { notes?: string[] }
        expect(body.notes).toEqual(['Consider prioritizing companies with USDA organic certification.'])
        return {
          status: 200,
          payload: {
            ok: true,
            data: {
              sectorId: 'sec-foods',
              digest: { version: '1', text: '' },
              segments: { system: '', references: [], history: [], tail: [] },
              usage: { totalEstimatedTokens: 100 },
              files: [],
              notes: [{ id: 'n1', text: body.notes![0], createdAt: '2026-09-27T00:00:00Z' }],
            },
          },
        }
      }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    renderPanel()
    await waitFor(() => expect(screen.getByText('Consider prioritizing companies with USDA organic certification.')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Add to sector context' }))
    expect(await screen.findByRole('region', { name: 'Global context proposal' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve context update' }))
    await waitFor(() => expect(screen.getByText('Context updated for ongoing research.')).toBeInTheDocument())
    expect(calls.some((call) => call.url.includes('/context') && call.method === 'PATCH')).toBe(true)
  })
})

describe('SectorChatPanel stuck thinking', () => {
  function openSseResponse(frames: unknown[]): Response {
    const bytes = new TextEncoder().encode(
      frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
    )
    // Never closes: mirrors the server tail, which replays then holds the
    // socket open with pings. A send loop that waits for stream end hangs
    // here forever; the fixed loop breaks on the terminal agent message.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
      },
    })
    return { ok: true, status: 200, body: stream } as Response
  }

  it('clears Thinking once the reply lands on a held-open stream', async () => {
    let messageCalls = 0
    stubApi((url, init) => {
      if (url === 'https://staging.test/v1/sessions?sectorId=sec-foods') {
        return { status: 200, payload: { ok: true, data: SECTOR_SESSIONS } }
      }
      if (url.endsWith('/v1/commands/send') && init.method === 'POST') {
        return { status: 202, payload: { ok: true, data: { runId: 'run-1' } } }
      }
      if (url.includes('/messages')) {
        messageCalls += 1
        // Mount load sees an empty thread; only the post-reply refetch
        // returns the finished turn, so the streamed seq 2 is genuinely new.
        const data =
          messageCalls === 1
            ? []
            : [
                { seq: 1, kind: 'text', role: 'user', text: 'hello sector' },
                { seq: 2, kind: 'text', role: 'agent', text: 'Held-open reply.' },
              ]
        return { status: 200, payload: { ok: true, data } }
      }
      if (url.includes('/events')) {
        return {
          raw: openSseResponse([
            { seq: 3, type: 'message', payload: { seq: 2, kind: 'text', role: 'agent', text: 'Held-open reply.' } },
          ]),
          status: 200,
        }
      }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'nope' } } }
    })
    const rendered = renderPanel()
    await waitFor(() => expect(screen.getByLabelText(/Message the .* chat/)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/Message the .* chat/), { target: { value: 'hello sector' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(screen.getByText('Held-open reply.')).toBeInTheDocument())
    // The reply is on screen while the socket stays open: Thinking must be
    // gone and the composer usable again instead of counting forever.
    await waitFor(
      () => expect(screen.queryByRole('status', { name: 'Agent is replying' })).not.toBeInTheDocument(),
      { timeout: 5000 },
    )
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument()
    rendered.unmount()
  })
})
