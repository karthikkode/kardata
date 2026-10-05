// ResearchesPage proofs (RS-02..06). Tabs carry counts; one toolbar
// drives both tables; company filtering runs server-side with truthful
// window totals. A URL harness stands in for App navigation state.
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import type { ResearchList } from '@/components/Dashboard'
import { ResearchesPage, type StateFilter } from '@/components/ResearchesPage'
import type {
  CompanyResearch,
  ResearchData,
  SectorResearch,
} from '@/data/research'
import type { StagingConfig } from '@/data/api/client'

const noop = () => {}
const staging: StagingConfig = { baseUrl: 'https://staging.test', apiKey: 'key' }

afterEach(() => {
  vi.unstubAllGlobals()
})

const SECTORS: SectorResearch[] = [
  { id: 'seed-pet-care', name: 'Pet care', topic: 'D2C pet brands', companiesFound: 2, state: 'running', createdAt: '2026-09-01T09:00:00', updatedAt: '2026-09-30T10:00:00' },
  { id: 'seed-espresso', name: 'Espresso gear', topic: 'Home brewers', companiesFound: 1, state: 'complete', createdAt: '2026-09-02T09:00:00', updatedAt: '2026-09-28T10:00:00' },
  { id: 'seed-outdoor', name: 'Outdoor gear', topic: 'Trail equipment', companiesFound: 0, state: 'queued', createdAt: '2026-09-03T09:00:00', updatedAt: '2026-09-29T10:00:00' },
  { id: 'seed-hifi', name: 'Vintage hi-fi', topic: 'Used receivers', companiesFound: 0, state: 'failed', createdAt: '2026-09-04T09:00:00', updatedAt: '2026-09-27T10:00:00' },
]

const COMPANIES: CompanyResearch[] = [
  { id: 'seed-west', sectorId: 'seed-pet-care', sectorName: 'Pet care', name: 'West Paw', stage: 'Final validation', state: 'running' },
]

function overflowSectors(): SectorResearch[] {
  // Distinct days, newest last: default Updated-desc shows sector 60 first.
  return Array.from({ length: 60 }, (_, index) => ({
    id: `overflow-${index + 1}`,
    name: `Overflow sector ${index + 1}`,
    topic: 'Bulk rows',
    companiesFound: 0,
    state: 'queued' as const,
    createdAt: '2026-08-01T09:00:00',
    updatedAt: new Date(2026, 7, 1 + index, 10).toISOString(),
  }))
}

function bundle<T>(items: T[]): ResearchData<T> {
  return { status: 'ready', items, total: items.length, retry: noop }
}

/** Stubbed server for the companies tab: filters + pages like the backend
 * (query/state/limit/offset params in, {companies, total} out). */
function stubCompaniesTab(rows: CompanyResearch[] = COMPANIES): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const text = String(url)
      if (text.includes('/v1/companies')) {
        const query = new URL(text, 'https://stub.test')
        const needle = (query.searchParams.get('query') ?? '').toLowerCase()
        const state = query.searchParams.get('state')
        const limit = Number(query.searchParams.get('limit') ?? '100')
        const offset = Number(query.searchParams.get('offset') ?? '0')
        const filtered = rows.filter(
          (row) =>
            (needle === '' || `${row.name} ${row.sectorName}`.toLowerCase().includes(needle)) &&
            (state === null || row.state === state),
        )
        const window = filtered.slice(offset, offset + limit)
        return { ok: true, status: 200, json: async () => ({ ok: true, data: { companies: window, total: filtered.length } }) }
      }
      return { ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'not_found', message: 'no' } }) }
    }),
  )
}

function renderPage(
  props: {
    initialTab?: ResearchList
    sectors?: ResearchData<SectorResearch>
    companiesTotal?: number
    withStaging?: boolean
    filterQuery?: string | null
    stateFilter?: string | null
    onTabChange?: (tab: ResearchList) => void
    onFiltersChange?: (query: string, state: StateFilter) => void
    onOpenSector?: (id: string) => void
    onNewSector?: () => void
  } = {},
) {
  const {
    initialTab = 'sectors',
    sectors = bundle(SECTORS),
    companiesTotal = COMPANIES.length,
    withStaging = false,
    filterQuery = null,
    stateFilter = null,
    onTabChange = noop,
    onFiltersChange,
    onOpenSector = noop,
    onNewSector = noop,
  } = props
  // URL harness: without an explicit listener the page behaves like App,
  // writing debounced filters back into its own props.
  function Harness() {
    const [query, setQuery] = useState<string | null>(filterQuery)
    const [state, setState] = useState<string | null>(stateFilter)
    return (
      <ResearchesPage
        initialTab={initialTab}
        sectors={sectors}
        companiesTotal={companiesTotal}
        staging={withStaging ? staging : null}
        filterQuery={query}
        stateFilter={state}
        onTabChange={onTabChange}
        onFiltersChange={(nextQuery, nextState) => {
          setQuery(nextQuery === '' ? null : nextQuery)
          setState(nextState === 'all' ? null : nextState)
          onFiltersChange?.(nextQuery, nextState)
        }}
        onOpenSector={onOpenSector}
        onNewSector={onNewSector}
      />
    )
  }
  return render(<Harness />)
}

function sectorsTable(): HTMLElement {
  return screen.getByRole('table', { name: 'Sectors' })
}

describe('ResearchesPage tabs', () => {
  it('tabs carry tabular counts and switch without losing the toolbar', async () => {
    stubCompaniesTab()
    const onTabChange = vi.fn()
    renderPage({ withStaging: true, onTabChange })
    expect(screen.getByRole('tab', { name: 'Sectors 4' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Companies 1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Companies 1' }))
    expect(onTabChange).toHaveBeenCalledWith('companies')
    expect(await screen.findByText('West Paw')).toBeInTheDocument()
    expect(screen.getByLabelText('Search companies')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Sectors' })).not.toBeInTheDocument()
  })

  it('explains a refused companies key without plural grammar slips', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ ok: false, error: { code: 'permission_denied', message: 'no' } }) })),
    )
    renderPage({ initialTab: 'companies', withStaging: true })
    expect(await screen.findByText('Access denied')).toBeInTheDocument()
    expect(await screen.findByText('Company data is not shared with this key. Ask an owner for access, then try again.')).toBeInTheDocument()
  })
})

describe('ResearchesPage sectors table', () => {
  it('sorts by updated desc by default and re-sorts by column', () => {
    renderPage()
    const table = sectorsTable()
    const order = () => (table.textContent ?? '')
    // Pet care (30 Sep) before Outdoor gear (29 Sep) before Espresso (28 Sep).
    expect(order().indexOf('Pet care')).toBeLessThan(order().indexOf('Outdoor gear'))
    expect(order().indexOf('Outdoor gear')).toBeLessThan(order().indexOf('Espresso gear'))
    expect(
      within(table).getByRole('columnheader', { name: /Updated/ }),
    ).toHaveAttribute('aria-sort', 'descending')
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Sector' }))
    const sorted = order()
    expect(sorted.indexOf('Espresso gear')).toBeLessThan(sorted.indexOf('Outdoor gear'))
    expect(sorted.indexOf('Outdoor gear')).toBeLessThan(sorted.indexOf('Pet care'))
  })

  it('opens the sector from a row click or Enter', () => {
    const onOpenSector = vi.fn()
    renderPage({ onOpenSector })
    const table = sectorsTable()
    const rows = within(table).getAllByRole('link')
    fireEvent.click(rows[0])
    expect(onOpenSector).toHaveBeenCalledWith('seed-pet-care')
    fireEvent.keyDown(rows[1], { key: 'Enter' })
    expect(onOpenSector).toHaveBeenCalledWith('seed-outdoor')
  })

  it('shows status badges, tabular counts, and full-date tooltips', () => {
    renderPage()
    const table = sectorsTable()
    expect(within(table).getByText('In progress')).toBeInTheDocument()
    expect(within(table).getByTitle('30 Sep 2026, 10:00')).toHaveTextContent(/ago|Just now/)
  })

  it('pages client-side past fifty rows with truthful counts', () => {
    renderPage({ sectors: bundle(overflowSectors()) })
    expect(screen.getByText('Overflow sector 60')).toBeInTheDocument()
    expect(screen.queryByText('Overflow sector 1')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 50 of 60')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getByText('Overflow sector 1')).toBeInTheDocument()
    expect(screen.getByText('Showing 60 of 60')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
  })
})

describe('ResearchesPage toolbar', () => {
  it('labels the status trigger and lists every state', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByRole('combobox', { name: 'Status: All' })).toHaveTextContent('Status: All')
    await user.click(screen.getByRole('combobox', { name: 'Status: All' }))
    for (const label of ['All', 'Planning', 'Planned', 'Approved', 'In progress', 'Failed']) {
      expect(await screen.findByRole('option', { name: label })).toBeInTheDocument()
    }
  })

  it('filters sectors by text then state, and clears back to everything', async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()
    renderPage({ onFiltersChange })
    fireEvent.change(screen.getByLabelText('Search sectors'), { target: { value: 'outdoor' } })
    expect(await screen.findByText('1 sector')).toBeInTheDocument()
    expect(screen.getByText('Outdoor gear')).toBeInTheDocument()
    expect(screen.queryByText('Pet care')).not.toBeInTheDocument()
    expect(onFiltersChange).toHaveBeenCalledWith('outdoor', 'all')
    await user.click(screen.getByRole('combobox', { name: 'Status: All' }))
    await user.click(await screen.findByRole('option', { name: 'Failed' }))
    expect(await screen.findByText('No matching sectors.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(await screen.findByText('4 sectors')).toBeInTheDocument()
    expect(screen.getByText('Pet care')).toBeInTheDocument()
    expect(screen.getByLabelText('Search sectors')).toHaveValue('')
  })

  it('announces result counts politely', () => {
    renderPage()
    const count = screen.getByText('4 sectors')
    expect(count).toHaveAttribute('aria-live', 'polite')
  })

  it('falls back to All for an unknown state filter', () => {
    renderPage({ stateFilter: 'mystery' })
    expect(screen.getByRole('combobox', { name: 'Status: All' })).toBeInTheDocument()
    expect(screen.getByText('Pet care')).toBeInTheDocument()
  })
})

describe('ResearchesPage sectors states', () => {
  it('shows skeleton rows while loading', () => {
    renderPage({ sectors: { status: 'loading', items: [], total: 0, retry: noop } })
    expect(screen.getByRole('status', { name: 'Sectors are loading' })).toBeInTheDocument()
  })

  it('offers New sector on first run', () => {
    const onNewSector = vi.fn()
    renderPage({ sectors: bundle([]), onNewSector })
    expect(screen.getByText('No sectors yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New sector' }))
    expect(onNewSector).toHaveBeenCalledTimes(1)
  })

  it('retries errors without developer copy', () => {
    const retry = vi.fn()
    const view = renderPage({ sectors: { status: 'error', items: [], total: 0, retry } })
    expect(screen.getByText('Sectors did not load.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/frontend\/\.env/)).not.toBeInTheDocument()
    view.unmount()
    renderPage({ sectors: { status: 'denied', items: [], total: 0, retry: noop } })
    expect(screen.getByText('Access denied')).toBeInTheDocument()
  })
})

describe('ResearchesPage companies table', () => {
  it('renders stage labels with step indicators and one badge per row', async () => {
    stubCompaniesTab()
    renderPage({ initialTab: 'companies', withStaging: true })
    expect(await screen.findByText('West Paw')).toBeInTheDocument()
    expect(screen.getByText('Final validation')).toBeInTheDocument()
    expect(screen.getByLabelText('Stage 4 of 4: Final validation')).toBeInTheDocument()
    const row = screen.getByText('West Paw').closest('[role="link"]') as HTMLElement
    expect(within(row).getAllByText('In progress')).toHaveLength(1)
    // Single row link: the sector renders as text, never a nested link.
    expect(within(row).queryByRole('link')).not.toBeInTheDocument()
    expect(row.querySelector('a')).toBeNull()
  })

  it('opens the owning sector from a company row', async () => {
    stubCompaniesTab()
    const onOpenSector = vi.fn()
    renderPage({ initialTab: 'companies', withStaging: true, onOpenSector })
    fireEvent.click((await screen.findByText('West Paw')).closest('[role="link"]') as HTMLElement)
    expect(onOpenSector).toHaveBeenCalledWith('seed-pet-care')
  })

  it('filters server-side with a truthful total', async () => {
    stubCompaniesTab()
    renderPage({ initialTab: 'companies', withStaging: true })
    expect(await screen.findByText('West Paw')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search companies'), { target: { value: 'no-such-company' } })
    expect(await screen.findByText('No matching companies.')).toBeInTheDocument()
  })

  it('pages through windows until the total is reached', async () => {
    const bulk = Array.from({ length: 250 }, (_, index) => ({
      id: `bulk-${index + 1}`,
      sectorId: 'seed-pet-care',
      sectorName: 'Pet care',
      name: `Bulk company ${index + 1}`,
      stage: 'Filter',
      state: 'running' as const,
    }))
    stubCompaniesTab(bulk)
    renderPage({ initialTab: 'companies', withStaging: true, companiesTotal: 250 })
    expect(await screen.findByText('Bulk company 100')).toBeInTheDocument()
    expect(screen.queryByText('Bulk company 101')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 100 of 250')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(await screen.findByText('Bulk company 200')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(await screen.findByText('Bulk company 250')).toBeInTheDocument()
    expect(screen.getByText('Showing 250 of 250')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
  })

  it('recovers from a failed window with Try again', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const text = String(url)
        if (!text.includes('/v1/companies')) {
          return { ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'not_found', message: 'no' } }) }
        }
        const params = new URL(text, 'https://stub.test').searchParams
        const offset = Number(params.get('offset') ?? '0')
        calls += 1
        if (offset > 0 && calls === 2) {
          return { ok: false, status: 500, json: async () => ({ ok: false, error: { code: 'overload', message: 'down' } }) }
        }
        const window = Array.from({ length: 100 }, (_, index) => ({
          id: `more-${offset + index + 1}`,
          sectorId: 'seed-pet-care',
          sectorName: 'Pet care',
          name: `More company ${offset + index + 1}`,
          stage: 'Filter',
          state: 'running',
        }))
        return { ok: true, status: 200, json: async () => ({ ok: true, data: { companies: window, total: 200 } }) }
      }),
    )
    renderPage({ initialTab: 'companies', withStaging: true, companiesTotal: 200 })
    expect(await screen.findByText('More company 100')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(await screen.findByText('More companies did not load.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('More company 200')).toBeInTheDocument()
    expect(screen.getByText('Showing 200 of 200')).toBeInTheDocument()
  })

  it('offers New sector on first run', async () => {
    stubCompaniesTab([])
    const onNewSector = vi.fn()
    renderPage({ initialTab: 'companies', withStaging: true, companiesTotal: 0, onNewSector })
    expect(await screen.findByText('No companies yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New sector' }))
    expect(onNewSector).toHaveBeenCalledTimes(1)
  })
})
