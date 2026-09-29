// Run console: timeline, steer targets, and confirmed dispatch over
// the existing command paths. API answers are stubbed; no fixtures.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunConsole } from '@/components/RunConsole'
import type { StagingConfig } from '@/data/staging-api'

const config: StagingConfig = { baseUrl: 'https://staging.test', apiKey: 'key' }

const SECTOR = {
  id: 'sec-foods',
  name: 'Speciality Foods',
  topic: 'Foods',
  companiesFound: 0,
  state: 'running',
  researchSessionId: 's-research',
  createdAt: '2026-09-30T00:00:00.000Z',
  updatedAt: '2026-09-30T00:00:00.000Z',
} as const

const ACTIVITY = [
  { seq: 1, text: 'Research started for Foods.' },
  { seq: 2, text: 'Found Acme Foods.' },
]

const THREADS = [
  { key: 's-research', sessionId: 's-research', kind: 'session', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: '2026-09-30T00:00:00.000Z' },
  { key: 'agent:child-1', sessionId: 's-research', kind: 'subagent', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: '2026-09-30T00:00:00.000Z' },
]

const SESSIONS = [{ id: 's-research', title: 'Research chat', sectorId: 'sec-foods' }]

function stubThreads() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/v1/sessions?sectorId=')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, data: SESSIONS }) }
      }
      if (String(url).includes('/threads')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, data: THREADS }) }
      }
      return { ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'not_found', message: 'no' } }) }
    }),
  )
}

function renderConsole() {
  return render(
    <RunConsole config={config} sector={{ ...SECTOR, state: 'running' }} activity={ACTIVITY} activityTotal={2} />,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('RunConsole', () => {
  it('shows a loading skeleton while threads load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Promise(() => undefined)))
    render(
      <RunConsole
        config={config}
        sector={{ ...SECTOR, state: 'running' }}
        activity={[]}
        activityTotal={0}
      />,
    )
    expect(await screen.findByLabelText('Steer targets are loading')).toBeInTheDocument()
  })

  it('renders the timeline with truthful counts', async () => {
    stubThreads()
    renderConsole()
    expect(await screen.findByText('Research started for Foods.')).toBeInTheDocument()
    expect(screen.getByText('Found Acme Foods.')).toBeInTheDocument()
  })

  it('lists session and subagent threads as steer targets', async () => {
    stubThreads()
    renderConsole()
    const select = (await screen.findByLabelText('Target')) as HTMLSelectElement
    expect(select.options).toHaveLength(3)
    fireEvent.change(select, { target: { value: 'agent:child-1' } })
    expect(select.value).toBe('agent:child-1')
  })

  it('reviews before dispatching and reports missed steer honestly', async () => {
    const calls: Array<{ url: string; body?: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { method?: string; body?: string } = {}) => {
        calls.push({ url, body: init.body })
        if (String(url).includes('/v1/sessions?sectorId=')) {
          return { ok: true, status: 200, json: async () => ({ ok: true, data: SESSIONS }) }
        }
        if (String(url).includes('/threads') && (init.method ?? 'GET') === 'GET') {
          return { ok: true, status: 200, json: async () => ({ ok: true, data: THREADS }) }
        }
        if (String(url).includes('/commands/steer')) {
          return { ok: true, status: 200, json: async () => ({ ok: true, data: { commandId: 'cmd-1', state: 'missed_steer' } }) }
        }
        return { ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'not_found', message: 'no' } }) }
      }),
    )
    renderConsole()
    fireEvent.change(await screen.findByLabelText('Target'), { target: { value: 'agent:child-1' } })
    fireEvent.change(screen.getByLabelText('Direction'), { target: { value: 'pivot to pricing' } })
    // Review gates dispatch: nothing sent yet.
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(calls.some((call) => call.url.includes('/commands/steer'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(screen.getByText(/Nothing was listening/)).toBeInTheDocument())
    expect(calls.some((call) => call.url.includes('/commands/steer'))).toBe(true)
  })

  it('denies steer targets with the lock note on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ ok: false, error: { code: 'permission_denied', message: 'no' } }) })),
    )
    render(
      <RunConsole config={config} sector={{ ...SECTOR, state: 'running' }} activity={[]} activityTotal={0} />,
    )
    expect(await screen.findByText(/not shared with this key/)).toBeInTheDocument()
    expect(screen.getByText('No run activity yet.')).toBeInTheDocument()
  })
})
