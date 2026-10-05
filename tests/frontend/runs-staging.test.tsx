// Runs view staging proofs: real run rows, cancel flow, and the empty
// state. No fixtures: the mock agent tree must not appear.
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunsPanel } from '@/components/RunsPanel'
import { notify } from '@/lib/toast'
import type { StagingConfig } from '@/data/api/client'

vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }))

const config: StagingConfig = { baseUrl: 'https://staging.test', apiKey: 'key' }

const RUNS = [
  {
    id: 'session-run-9',
    sessionId: 's-1',
    threadKey: 's-1',
    state: 'RUNNING',
    budgetUsedRatio: 0.25,
    contextUsedRatio: 0.5,
    updatedAt: '2026-09-26T01:00:00.000Z',
  },
]

function stubApi(handler: (url: string) => { status: number; payload: unknown }): { calls: string[] } {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      const { status, payload } = handler(url)
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

describe('runs view (no mocks)', () => {
  it('lists real runs with state and no placeholder ratios', async () => {
    stubApi(() => ({ status: 200, payload: { ok: true, data: RUNS } }))
    render(<RunsPanel config={config} />)
    expect(await screen.findByText('session-')).toBeInTheDocument()
    expect(screen.getByTitle('session-run-9')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    // The backend reports 0 until it measures ratios: the row must not
    // render them at all, even when the payload carries values.
    expect(screen.queryByText(/budget .*% · context/)).not.toBeInTheDocument()
    // Mock agent names stay out of the live render.
    expect(screen.queryByText('Deep sector scan')).not.toBeInTheDocument()
    expect(screen.queryByText('Subagent 1')).not.toBeInTheDocument()
  })

  it('confirms before cancelling a running run, then reloads', async () => {
    const cancelled: string[] = []
    stubApi((url) => {
      if (url.endsWith('/v1/commands/cancel')) {
        cancelled.push(url)
        return { status: 202, payload: { ok: true, data: { commandId: 'cmd-1', state: 'accepted' } } }
      }
      return { status: 200, payload: { ok: true, data: RUNS } }
    })
    render(<RunsPanel config={config} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('alertdialog', { name: 'Cancel this run?' })).toBeInTheDocument()
    expect(cancelled).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }))
    await vi.waitFor(() => {
      expect(cancelled).toHaveLength(1)
    })
  })

  it('shows the empty copy instead of staged agents', async () => {
    stubApi(() => ({ status: 200, payload: { ok: true, data: [] } }))
    render(<RunsPanel config={config} />)
    expect(await screen.findByText('No runs yet', { exact: true })).toBeInTheDocument()
  })

  it('shows the denied notice for refused keys', async () => {
    stubApi(() => ({ status: 403, payload: { ok: false, error: { code: 'permission_denied', message: 'no' } } }))
    render(<RunsPanel config={config} />)
    expect(await screen.findByText('Agent runs are not shared with this key.')).toBeInTheDocument()
  })

  it('tones a cancelling run as paused, never failed', async () => {
    stubApi(() => ({
      status: 200,
      payload: {
        ok: true,
        data: [{ ...RUNS[0], id: 'run-cancelling', state: 'CANCELLING' }],
      },
    }))
    render(<RunsPanel config={config} />)
    expect(await screen.findByText('run-canc')).toBeInTheDocument()
    const pill = screen.getByText('Cancelling')
    expect(
      pill.parentElement?.querySelector('[data-tone="paused"]'),
    ).toBeInTheDocument()
    expect(
      pill.parentElement?.querySelector('[data-tone="failed"]'),
    ).not.toBeInTheDocument()
  })

  it('reports a failed cancel through an error toast', async () => {
    stubApi((url) => {
      if (url.endsWith('/v1/commands/cancel')) {
        return { status: 500, payload: { ok: false, error: { code: 'overload', message: 'down' } } }
      }
      return { status: 200, payload: { ok: true, data: RUNS } }
    })
    render(<RunsPanel config={config} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel run' }))
    await vi.waitFor(() => {
      expect(notify.error).toHaveBeenCalledWith(expect.stringMatching(/Could not cancel run/))
    })
  })
})
