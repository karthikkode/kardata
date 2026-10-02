// ResearchesPage proofs. Bundles are backend-shaped rows built inline for
// rendering: filtering, overflow totals, and tab switches run against the
// component contract, never a mock origin.
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResearchList } from '@/components/Dashboard'
import { ResearchesPage } from '@/components/ResearchesPage'
import type {
  ResearchData,
  SectorResearch,
} from '@/data/research'
import type { StagingConfig } from '@/data/staging-api'

const noop = () => {}
const staging: StagingConfig = { baseUrl: 'https://staging.test', apiKey: 'key' }

afterEach(() => {
  vi.unstubAllGlobals()
})

const SECTORS: SectorResearch[] = [
  { id: 'seed-pet-care', name: 'Pet care', topic: 'D2C pet brands', companiesFound: 2, state: 'running' },
  { id: 'seed-espresso', name: 'Espresso gear', topic: 'Home brewers', companiesFound: 1, state: 'complete' },
  { id: 'seed-outdoor', name: 'Outdoor gear', topic: 'Trail equipment', companiesFound: 0, state: 'queued' },
  { id: 'seed-hifi', name: 'Vintage hi-fi', topic: 'Used receivers', companiesFound: 0, state: 'failed' },
]

const COMPANIES: CompanyResearch[] = [
  { id: 'seed-west', sectorId: 'seed-pet-care', sectorName: 'Pet care', name: 'West Paw', stage: 'Final validation', state: 'running' },
]

function overflowSectors(): SectorResearch[] {
  return Array.from({ length: 60 }, (_, index) => ({
    id: `overflow-${index + 1}`,
    name: `Overflow sector ${index + 1}`,
    topic: 'Bulk rows',
    companiesFound: 0,
    state: 'queued' as const,
  }))
}

function bundle<T>(items: T[]): ResearchData<T> {
  return { status: 'ready', items, total: items.length, retry: noop }
}

/** Stubbed server for the companies tab: filters + pages like the backend
 * (query/state/limit/offset params in, {companies, total} out). */
function stubCompaniesTab(rows: typeof COMPANIES = COMPANIES): void {
  const all = rows
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
        const filtered = all.filter(
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
    sectors?: SectorResearch[]
    onBack?: () => void
    onOpenSector?: (id: string) => void
    onCreateSector?: (name: string, topic: string) => void
    createError?: string | null
  } = {},
) {
  const {
    initialTab = 'sectors',
    sectors = SECTORS,
    onBack = noop,
    onOpenSector = noop,
    onCreateSector = noop,
    createError = null,
  } = props
  return render(
    <ResearchesPage
      initialTab={initialTab}
      sectors={bundle(sectors)}
      staging={staging}
      creating={false}
      createError={createError}
      onBack={onBack}
      onOpenSector={onOpenSector}
      onCreateSector={onCreateSector}
    />,
  )
}

describe('ResearchesPage', () => {
  it('shows the full list with a truthful total past fifty rows', () => {
    renderPage({ sectors: overflowSectors() })
    expect(
      screen.getByRole('region', { name: 'All sector researches' }),
    ).toHaveTextContent(/60.*total/)
    expect(screen.getByText('Overflow sector 60')).toBeInTheDocument()
  })

  it('starts on the requested segment', async () => {
    stubCompaniesTab()
    renderPage({ initialTab: 'companies' })
    expect(
      screen.getByRole('region', { name: 'All company researches' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('West Paw')).toBeInTheDocument()
  })

  it('switches segments', async () => {
    stubCompaniesTab()
    renderPage()
    expect(screen.getByText('Pet care')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Companies' }))
    expect(await screen.findByText('West Paw')).toBeInTheDocument()
    expect(screen.queryByText('Pet care', { exact: true })).not.toBeInTheDocument()
  })

  it('filters companies server-side with a truthful total', async () => {
    stubCompaniesTab()
    renderPage({ initialTab: 'companies' })
    expect(await screen.findByText('West Paw')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filter researches'), {
      target: { value: 'no-such-company' },
    })
    expect(await screen.findByText(/No researches match these filters/)).toBeInTheDocument()
  })

  it('pages through windows with Show more until the total is reached', async () => {
    const bulk = Array.from({ length: 250 }, (_, index) => ({
      id: `bulk-${index + 1}`,
      sectorId: 'seed-pet-care',
      sectorName: 'Pet care',
      name: `Bulk company ${index + 1}`,
      stage: 'Filter',
      state: 'running' as const,
    }))
    stubCompaniesTab(bulk)
    renderPage({ initialTab: 'companies' })
    expect(await screen.findByText('Bulk company 100')).toBeInTheDocument()
    expect(screen.queryByText('Bulk company 101')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 100 of 250 matching')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }))
    expect(await screen.findByText('Bulk company 200')).toBeInTheDocument()
    expect(screen.getByText('Showing 200 of 250 matching')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Show more/ }))
    expect(await screen.findByText('Bulk company 250')).toBeInTheDocument()
    expect(screen.getByText('Showing 250 of 250 matching')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument()
  })

  it('filters by state and clears back to everything', () => {
    renderPage()
    expect(screen.getByText('Pet care')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }))
    expect(screen.getByText('Vintage hi-fi')).toBeInTheDocument()
    expect(screen.queryByText('Pet care')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Paused' }))
    expect(
      screen.getByText(/No researches match these filters/),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('Pet care')).toBeInTheDocument()
  })

  it('filters by text', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Filter researches'), {
      target: { value: 'outdoor' },
    })
    expect(screen.getByText('Outdoor gear')).toBeInTheDocument()
    expect(screen.queryByText('Pet care')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 1 of 1 matching')).toBeInTheDocument()
  })

  it('clears the text filter from the input without losing the list', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Filter researches'), {
      target: { value: 'outdoor' },
    })
    expect(screen.queryByText('Pet care')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(screen.getByLabelText('Filter researches')).toHaveValue('')
    expect(screen.getByText('Pet care')).toBeInTheDocument()
  })

  it('counts the filtered total past fifty rows, not the base list', () => {
    renderPage({ sectors: overflowSectors() })
    fireEvent.change(screen.getByLabelText('Filter researches'), {
      target: { value: 'Overflow sector 5' },
    })
    expect(screen.getByText(/of 11 matching/)).toBeInTheDocument()
  })

  it('goes back to Overview', () => {
    const onBack = vi.fn()
    renderPage({ onBack })
    fireEvent.click(screen.getByRole('button', { name: 'Back to Overview' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('creates a sector draft from the sectors tab', () => {
    const onCreateSector = vi.fn()
    renderPage({ onCreateSector })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Speciality foods' } })
    fireEvent.change(screen.getByLabelText('Topic (optional)'), { target: { value: 'Artisanal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }))
    expect(onCreateSector).toHaveBeenCalledWith('Speciality foods', 'Artisanal')
  })

  it('requires a name before creating', () => {
    const onCreateSector = vi.fn()
    renderPage({ onCreateSector })
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Name the sector first.')
    expect(onCreateSector).not.toHaveBeenCalled()
  })

  it('surfaces a failed create instead of staying silent', () => {
    renderPage({ createError: 'request failed: POST /v1/sectors' })
    expect(screen.getByRole('alert')).toHaveTextContent('request failed: POST /v1/sectors')
  })

  it('shows loading and error states from the bundle', () => {
    const loading: ResearchData<SectorResearch> = { status: 'loading', items: [], total: 0, retry: noop }
    const failed: ResearchData<SectorResearch> = { status: 'error', items: [], total: 0, retry: noop }
    const { rerender } = render(
      <ResearchesPage
        initialTab="sectors"
        sectors={loading}
        staging={staging}
        creating={false}
        onBack={noop}
        onOpenSector={noop}
        onCreateSector={noop}
      />,
    )
    expect(screen.getByRole('status', { name: 'Sector researches are loading' })).toBeInTheDocument()
    rerender(
      <ResearchesPage
        initialTab="sectors"
        sectors={failed}
        staging={staging}
        creating={false}
        onBack={noop}
        onOpenSector={noop}
        onCreateSector={noop}
      />,
    )
    expect(screen.getByText('Sector researches did not load.')).toBeInTheDocument()
  })
})
