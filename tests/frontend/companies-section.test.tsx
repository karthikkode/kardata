// CompaniesSection proofs (SL-05): server-filtered company window with
// toolbar, paging, poll, and per-state empties. Fetch is stubbed at the
// network edge; the hook contract stays real.
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompaniesSection } from '@/components/CompaniesSection'
import type { CompanyResearch, ResearchState } from '@/data/api/sectors'
import type { StagingConfig } from '@/data/api/client'

const staging: StagingConfig = { baseUrl: 'https://staging.example.test', apiKey: 'TEST key' }

function company(overrides: Partial<CompanyResearch> = {}): CompanyResearch {
  return {
    id: 'company-1',
    sectorId: 'test-sector',
    sectorName: 'TEST sector',
    name: 'Bright Spark Electrical',
    stage: 'Deep research',
    state: 'running',
    ...overrides,
  }
}

type StubResult = { companies: CompanyResearch[]; total: number } | { error: { status: number; code: string; message: string } }

function stubCompanies(impl: (url: string) => StubResult) {
  const fetchMock = vi.fn(async (url: string) => {
    const result = impl(String(url))
    if ('error' in result) {
      return { ok: false, status: result.error.status, json: async () => ({ ok: false, error: result.error }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, data: result }) }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderSection(state: ResearchState = 'running', pollActive = false) {
  return render(<CompaniesSection staging={staging} sectorId="test-sector" sectorState={state} pollActive={pollActive} />)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('CompaniesSection rows', () => {
  it('lists companies scoped to the sector with stage and status', async () => {
    const fetchMock = stubCompanies(() => ({
      companies: [
        company({ id: 'company-1', name: 'Bright Spark Electrical', stage: 'Deep research', state: 'running' }),
        company({ id: 'company-2', name: 'Harbour City Plumbing', stage: 'Filter', state: 'complete' }),
      ],
      total: 2,
    }))
    renderSection()
    expect(await screen.findByText('Bright Spark Electrical')).toBeInTheDocument()
    expect(screen.getByText('Harbour City Plumbing')).toBeInTheDocument()
    expect(screen.getByText('Deep research')).toBeInTheDocument()
    expect(screen.getByText('Screening')).toBeInTheDocument()
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('Complete')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('sectorId=test-sector'), expect.anything())
    expect(screen.getByText('Showing 2 of 2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
  })

  it('debounces the server search instead of requesting per keystroke', async () => {
    const user = userEvent.setup()
    const seen: string[] = []
    stubCompanies((url) => {
      seen.push(url)
      const query = new URL(url).searchParams.get('query') ?? ''
      const all = [company({ id: 'company-1', name: 'Bright Spark Electrical' }), company({ id: 'company-2', name: 'Harbour City Plumbing' })]
      const companies = all.filter((row) => row.name.toLowerCase().includes(query.toLowerCase()))
      return { companies, total: companies.length }
    })
    renderSection()
    expect(await screen.findByText('Harbour City Plumbing')).toBeInTheDocument()
    const callsBefore = seen.length
    await user.type(screen.getByRole('textbox', { name: 'Search companies' }), 'spark')
    expect(await screen.findByText('Showing 1 of 1')).toBeInTheDocument()
    expect(screen.queryByText('Harbour City Plumbing')).not.toBeInTheDocument()
    expect(seen.length - callsBefore).toBe(1)
    expect(seen[seen.length - 1]).toContain('query=spark')
  })

  it('filters by status through the select', async () => {
    const user = userEvent.setup()
    const fetchMock = stubCompanies((url) => {
      const state = new URL(url).searchParams.get('state') ?? ''
      const all = [company({ id: 'company-1', state: 'running' }), company({ id: 'company-2', name: 'Harbour City Plumbing', state: 'complete' })]
      const companies = state === '' ? all : all.filter((row) => row.state === state)
      return { companies, total: companies.length }
    })
    renderSection()
    expect(await screen.findByText('Harbour City Plumbing')).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Status: All' }))
    await user.click(await screen.findByRole('option', { name: 'Complete' }))
    expect(await screen.findByText('Showing 1 of 1')).toBeInTheDocument()
    expect(screen.queryByText('Bright Spark Electrical')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('state=complete'), expect.anything())
  })

  it('clears a filtered empty back to rows', async () => {
    stubCompanies((url) => {
      const query = new URL(url).searchParams.get('query') ?? ''
      const all = [company()]
      const companies = query === '' ? all : []
      return { companies, total: companies.length }
    })
    renderSection()
    expect(await screen.findByText('Bright Spark Electrical')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search companies' }), { target: { value: 'nothing matches this' } })
    expect(await screen.findByText('No matching companies.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(await screen.findByText('Bright Spark Electrical')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search companies' })).toHaveValue('')
  })
})

describe('CompaniesSection states', () => {
  it('states the running empty with a listening dot', async () => {
    stubCompanies(() => ({ companies: [], total: 0 }))
    const { container } = renderSection('running')
    expect(await screen.findByText('No companies yet')).toBeInTheDocument()
    expect(screen.getByText('Companies appear here as research discovers them.')).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
  })

  it('states the draft empty without a listening dot', async () => {
    stubCompanies(() => ({ companies: [], total: 0 }))
    const { container } = renderSection('draft')
    expect(await screen.findByText('Research has not started')).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('pages through windows with truthful counts', async () => {
    const user = userEvent.setup()
    stubCompanies((url) => {
      const params = new URL(url).searchParams
      const offset = Number(params.get('offset') ?? 0)
      const limit = Number(params.get('limit') ?? 100)
      const total = 250
      const companies = Array.from({ length: Math.min(limit, total - offset) }, (_, index) =>
        company({ id: `company-${offset + index}`, name: `Company ${offset + index}` }),
      )
      return { companies, total }
    })
    renderSection()
    expect(await screen.findByText('Showing 100 of 250')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show more' }))
    expect(await screen.findByText('Showing 200 of 250')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show more' }))
    expect(await screen.findByText('Showing 250 of 250')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
  })

  it('recovers from a failed window with Try again', async () => {
    const user = userEvent.setup()
    let moreAttempts = 0
    stubCompanies((url) => {
      const offset = Number(new URL(url).searchParams.get('offset') ?? 0)
      if (offset >= 2) return { companies: [], total: 2 }
      if (offset === 1) {
        moreAttempts += 1
        if (moreAttempts === 1) return { error: { status: 500, code: 'boom', message: 'window failed' } }
      }
      return { companies: [company({ id: `company-${offset}`, name: `Company ${offset}` })], total: 2 }
    })
    renderSection()
    expect(await screen.findByText('Showing 1 of 2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show more' }))
    expect(await screen.findByText('More companies did not load.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Showing 2 of 2')).toBeInTheDocument()
  })

  it('shows a load error with retry', async () => {
    const user = userEvent.setup()
    let fail = true
    stubCompanies(() => (fail ? { error: { status: 500, code: 'boom', message: 'load failed' } } : { companies: [company()], total: 1 }))
    renderSection()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Bright Spark Electrical')).toBeInTheDocument()
  })

  it('shows denied when the key is refused', async () => {
    stubCompanies(() => ({ error: { status: 403, code: 'denied', message: 'refused' } }))
    renderSection()
    expect(await screen.findByText('Access denied')).toBeInTheDocument()
    expect(await screen.findByText('Company data is not shared with this key. Ask an owner for access, then try again.')).toBeInTheDocument()
  })
})

describe('CompaniesSection polling', () => {
  it('re-reads the loaded window while research is live', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = stubCompanies(() => ({ companies: [company()], total: 1 }))
    renderSection('running', true)
    expect(await screen.findByText('Bright Spark Electrical')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Bright Spark Electrical')).toBeInTheDocument()
  })

  it('stays quiet when research is not live', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = stubCompanies(() => ({ companies: [company()], total: 1 }))
    renderSection('complete', false)
    expect(await screen.findByText('Bright Spark Electrical')).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
