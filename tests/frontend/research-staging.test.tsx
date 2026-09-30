// Staging-path surface proofs (F-S2). With the staging flag and
// credentials set, App renders sectors, companies, and sector detail from
// the backend instead of mocks; loading and error states come from fetch.
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SECTORS = [
  { id: 'srv-pet', name: 'Server Pet', topic: 'Backend brands', companiesFound: 1, state: 'running' },
]
const COMPANIES = [
  {
    id: 'srv-west',
    sectorId: 'srv-pet',
    sectorName: 'Server Pet',
    name: 'Server West',
    stage: 'Deep research',
    state: 'running',
  },
]
const DETAIL = {
  ...SECTORS[0],
  companies: COMPANIES,
  companiesTotal: COMPANIES.length,
  activity: [{ seq: 1, text: 'Research started for Backend brands.' }],
  activityTotal: 1,
}

function companiesPage() {
  return { status: 200, payload: { ok: true, data: { companies: COMPANIES, total: COMPANIES.length } } }
}

function emptyCompaniesPage() {
  return { status: 200, payload: { ok: true, data: { companies: [], total: 0 } } }
}

function stubFetch(handler: (url: string) => { status: number; payload: unknown }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const { status, payload } = handler(url)
      return { ok: status >= 200 && status < 300, status, json: async () => payload }
    }),
  )
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

describe('staging research surfaces (F-S2)', () => {
  it('renders dashboard lists from the backend', async () => {
    stubFetch((url) => {
      if (url.endsWith('/v1/sectors')) return { status: 200, payload: { ok: true, data: SECTORS } }
      if (url.includes('/v1/companies')) return companiesPage()
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'no' } } }
    })
    const { default: App } = await import('@/App')
    render(<App />)
    expect(await screen.findByText('Server Pet')).toBeInTheDocument()
    expect(await screen.findByText('Server West')).toBeInTheDocument()
    // Mock names stay out of the staging render.
    expect(screen.queryByText('Pet care')).not.toBeInTheDocument()
  })

  it('opens a server sector with companies and chat', async () => {
    stubFetch((url) => {
      if (url.endsWith('/v1/sectors')) return { status: 200, payload: { ok: true, data: SECTORS } }
      if (url.includes('/v1/companies')) return companiesPage()
      if (url.includes('/v1/sectors/')) return { status: 200, payload: { ok: true, data: DETAIL } }
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'no' } } }
    })
    const { default: App } = await import('@/App')
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Open Server Pet' }))
    // Companies render on the summary landing; chat lives in the workspace.
    expect(await screen.findByRole('region', { name: 'Research status' })).toBeInTheDocument()
    expect(await screen.findByText('Server West')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('group', { name: 'Session types' })).toBeInTheDocument()
    // The sector activity timeline has no renderer in the workspace UX yet;
    // coverage for it lives in RunConsole.test.tsx until it is surfaced.
  })

  it('tells refused keys apart from connection failures', async () => {
    stubFetch((url) => {
      if (url.endsWith('/v1/sectors')) {
        return { status: 403, payload: { ok: false, error: { code: 'permission_denied', message: 'no' } } }
      }
      if (url.includes('/v1/companies')) return emptyCompaniesPage()
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'no' } } }
    })
    const { default: App } = await import('@/App')
    render(<App />)
    expect(
      await screen.findByText('Sector researches are not shared with this key.'),
    ).toBeInTheDocument()
    // The connection-error panel must not appear for a refused key.
    expect(screen.queryByText('Sector researches did not load.')).not.toBeInTheDocument()
  })

  it('keeps the connection-error panel for transport failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const { default: App } = await import('@/App')
    render(<App />)
    expect(await screen.findByText('Sector researches did not load.')).toBeInTheDocument()
  })

  it('shows the empty first-run copy instead of an error for empty lists', async () => {
    stubFetch((url) => {
      if (url.includes('/v1/companies')) return emptyCompaniesPage()
      return { status: 200, payload: { ok: true, data: [] } }
    })
    const { default: App } = await import('@/App')
    render(<App />)
    expect(await screen.findByText(/No sector researches yet\./)).toBeInTheDocument()
    expect(screen.queryByText('Sector researches did not load.')).not.toBeInTheDocument()
  })

  it('shows the not-found copy instead of an error for a removed sector', async () => {
    stubFetch((url) => {
      if (url.endsWith('/v1/sectors')) return { status: 200, payload: { ok: true, data: SECTORS } }
      if (url.includes('/v1/companies')) return companiesPage()
      return { status: 404, payload: { ok: false, error: { code: 'not_found', message: 'no' } } }
    })
    const { default: App } = await import('@/App')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Server Pet' }))
    expect(
      await screen.findByText('Sector research not found. It may have been removed.'),
    ).toBeInTheDocument()
  })

  it('shows loading skeletons then the error panel with retry', async () => {
    let failures = 0
    stubFetch(() => {
      failures += 1
      return { status: 500, payload: { ok: false, error: { code: 'overload', message: 'down' } } }
    })
    const { default: App } = await import('@/App')
    render(<App />)
    // The stub fails immediately, so loading flashes past: the error panel
    // is the stable assertion (skeletons are covered on the mock path).
    expect(await screen.findByText('Sector researches did not load.')).toBeInTheDocument()
    const attempts = failures
    fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0])
    expect(await screen.findByText('Sector researches did not load.')).toBeInTheDocument()
    expect(failures).toBeGreaterThan(attempts)
  })
})
