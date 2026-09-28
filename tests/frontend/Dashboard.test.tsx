// Dashboard proofs. Bundles are backend-shaped rows built inline:
// lists, states, filters, and footers run against the component contract.
// The stats strip is a not-connected placeholder with no numbers.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Dashboard } from '@/components/Dashboard'
import type {
  CompanyResearch,
  ResearchData,
  SectorResearch,
} from '@/data/research'

const noop = () => {}

const LOADED_SECTORS: SectorResearch[] = [
  { id: 'seed-pet-care', name: 'Pet care', topic: 'D2C pet brands', companiesFound: 14, state: 'running' },
  { id: 'seed-outdoor', name: 'Outdoor gear', topic: 'Trail equipment', companiesFound: 6, state: 'running' },
  { id: 'seed-home', name: 'Home audio', topic: 'Speaker brands', companiesFound: 0, state: 'queued' },
]

const LOADED_COMPANIES: CompanyResearch[] = [
  { id: 'seed-west', sectorId: 'seed-pet-care', sectorName: 'Pet care', name: 'West Paw', stage: 'Final validation', state: 'running' },
  { id: 'seed-trail', sectorId: 'seed-outdoor', sectorName: 'Outdoor gear', name: 'Trail Co', stage: 'Deep research', state: 'running' },
  { id: 'seed-brew', sectorId: 'seed-coffee', sectorName: 'Coffee gear', name: 'Brew Lab', stage: 'Filter', state: 'paused' },
]

const FAILED_SECTOR: SectorResearch = { id: 'seed-hifi', name: 'Vintage hi-fi', topic: 'Used receivers', companiesFound: 0, state: 'failed' }
const COMPLETE_SECTOR: SectorResearch = { id: 'seed-espresso', name: 'Espresso gear', topic: 'Home brewers', companiesFound: 1, state: 'complete' }
const FAILED_COMPANY: CompanyResearch = { id: 'seed-acme', sectorId: 'seed-pet-care', sectorName: 'Pet care', name: 'Acme Audio', stage: 'Deep research', state: 'failed' }
const COMPLETE_COMPANY: CompanyResearch = { id: 'seed-foam', sectorId: 'seed-espresso', sectorName: 'Espresso gear', name: 'Foam House', stage: 'Final validation', state: 'complete' }

function overflowSectors(): SectorResearch[] {
  return Array.from({ length: 60 }, (_, index) => ({
    id: `overflow-${index + 1}`,
    name: `Overflow sector ${index + 1}`,
    topic: 'Bulk rows',
    companiesFound: 0,
    state: 'queued' as const,
  }))
}

function overflowCompanies(): CompanyResearch[] {
  return Array.from({ length: 60 }, (_, index) => ({
    id: `overflow-maker-${index + 1}`,
    sectorId: 'seed-bulk',
    sectorName: 'Bulk sector',
    name: `Overflow maker ${index + 1}`,
    stage: 'Filter',
    state: 'queued' as const,
  }))
}

type BundleKind = 'ready' | 'loading' | 'error' | 'offline' | 'empty'

function bundleFor(
  kind: 'sectors' | 'companies',
  variant: BundleKind | 'withFailed' | 'withComplete' | 'few' | 'many' = 'ready',
): ResearchData<SectorResearch> | ResearchData<CompanyResearch> {
  if (variant === 'loading') return { status: 'loading', items: [], retry: noop }
  if (variant === 'error') return { status: 'error', items: [], retry: noop }
  if (variant === 'offline') return { status: 'offline', items: [], retry: noop }
  if (variant === 'empty') return { status: 'ready', items: [], retry: noop }
  if (kind === 'sectors') {
    if (variant === 'withFailed') return { status: 'ready', items: [...LOADED_SECTORS, FAILED_SECTOR], retry: noop }
    if (variant === 'withComplete') return { status: 'ready', items: [...LOADED_SECTORS, COMPLETE_SECTOR], retry: noop }
    if (variant === 'few') return { status: 'ready', items: [LOADED_SECTORS[0]], retry: noop }
    if (variant === 'many') return { status: 'ready', items: overflowSectors(), retry: noop }
    return { status: 'ready', items: LOADED_SECTORS, retry: noop }
  }
  if (variant === 'withFailed') return { status: 'ready', items: [...LOADED_COMPANIES, FAILED_COMPANY], retry: noop }
  if (variant === 'withComplete') return { status: 'ready', items: [...LOADED_COMPANIES, COMPLETE_COMPANY], retry: noop }
  if (variant === 'few') return { status: 'ready', items: [LOADED_COMPANIES[0]], retry: noop }
  if (variant === 'many') return { status: 'ready', items: overflowCompanies(), retry: noop }
  return { status: 'ready', items: LOADED_COMPANIES, retry: noop }
}

function renderDashboard(
  props: {
    query?: string
    sectors?: Parameters<typeof bundleFor>[1]
    companies?: Parameters<typeof bundleFor>[1]
    onClearSearch?: () => void
    onViewAll?: (list: 'sectors' | 'companies') => void
    onOpenSector?: (id: string) => void
  } = {},
) {
  const {
    query = '',
    sectors = 'ready',
    companies = 'ready',
    onClearSearch = noop,
    onViewAll = noop,
    onOpenSector = noop,
  } = props
  return render(
    <Dashboard
      query={query}
      onClearSearch={onClearSearch}
      onViewAll={onViewAll}
      onOpenSector={onOpenSector}
      sectors={bundleFor('sectors', sectors) as ResearchData<SectorResearch>}
      companies={bundleFor('companies', companies) as ResearchData<CompanyResearch>}
    />,
  )
}

describe('Dashboard stats', () => {
  it('shows the not-connected placeholder with no numbers', () => {
    renderDashboard()
    expect(screen.getByText('Email tracking is not connected yet.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Emails scheduled today')).not.toBeInTheDocument()
    expect(screen.queryByText('12')).not.toBeInTheDocument()
  })
})

describe('Dashboard lists', () => {
  it('lists sector researches with companies found, not percentages', () => {
    renderDashboard()
    expect(
      screen.getByRole('region', { name: 'Sector researches' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Pet care')).toBeInTheDocument()
    const count = screen.getByText('14')
    expect(count.parentElement).toHaveClass('rounded-full')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('lists company researches with their current stage', () => {
    renderDashboard()
    expect(
      screen.getByRole('region', { name: 'Company researches' }),
    ).toBeInTheDocument()
    expect(screen.getByText('West Paw')).toBeInTheDocument()
    expect(
      screen.getByLabelText('Stage: Final validation'),
    ).toBeInTheDocument()
  })

  it('filters researches by search and explains an empty result', () => {
    const view = renderDashboard()
    expect(screen.getByText('Pet care')).toBeInTheDocument()
    view.rerender(
      <Dashboard
        query="outdoor"
        onClearSearch={noop}
        onViewAll={noop}
        onOpenSector={noop}
        sectors={bundleFor('sectors', 'ready') as ResearchData<SectorResearch>}
        companies={bundleFor('companies', 'ready') as ResearchData<CompanyResearch>}
      />,
    )
    expect(screen.queryByText('Pet care')).not.toBeInTheDocument()
    expect(screen.getByText('Outdoor gear')).toBeInTheDocument()
    view.rerender(
      <Dashboard
        query="no-such-research"
        onClearSearch={noop}
        onViewAll={noop}
        onOpenSector={noop}
        sectors={bundleFor('sectors', 'ready') as ResearchData<SectorResearch>}
        companies={bundleFor('companies', 'ready') as ResearchData<CompanyResearch>}
      />,
    )
    expect(
      screen.getByText(/No sector researches match this search/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/No company researches match this search/),
    ).toBeInTheDocument()
  })
})

describe('Dashboard loading states', () => {
  it('shows skeletons while research lists load', () => {
    renderDashboard({ sectors: 'loading', companies: 'loading' })
    expect(
      screen.getByRole('status', { name: 'Sector researches are loading' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('status', { name: 'Company researches are loading' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Pet care')).not.toBeInTheDocument()
  })
})

describe('Dashboard empty states', () => {
  it('offers starting a sector research when no researches exist', () => {
    const onViewAll = vi.fn()
    renderDashboard({ sectors: 'empty', companies: 'empty', onViewAll })
    expect(screen.getByText(/No sector researches yet/)).toBeInTheDocument()
    expect(screen.getByText(/No company researches yet/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Clear search' }),
    ).not.toBeInTheDocument()
    const actions = screen.getAllByRole('button', { name: 'Start a sector research' })
    expect(actions).toHaveLength(2)
    fireEvent.click(actions[0] as HTMLElement)
    expect(onViewAll).toHaveBeenCalledWith('sectors')
  })

  it('offers a working clear action when search matches nothing', () => {
    const onClearSearch = vi.fn()
    renderDashboard({ query: 'no-such-research', onClearSearch })
    const buttons = screen.getAllByRole('button', { name: 'Clear search' })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[0])
    expect(onClearSearch).toHaveBeenCalledTimes(1)
  })
})

describe('Dashboard research overlays', () => {
  it('marks a failed sector research in plain words', () => {
    renderDashboard({ sectors: 'withFailed' })
    expect(screen.getByText('Vintage hi-fi')).toBeInTheDocument()
    const pill = screen.getByText('Failed')
    expect(
      pill.parentElement?.querySelector('[data-tone="failed"]'),
    ).toBeInTheDocument()
  })

  it('marks a complete sector research in plain words', () => {
    renderDashboard({ sectors: 'withComplete' })
    expect(screen.getByText('Espresso gear')).toBeInTheDocument()
    const pill = screen.getByText('Complete')
    expect(
      pill.parentElement?.querySelector('[data-tone="ok"]'),
    ).toBeInTheDocument()
  })

  it('marks failed and complete company researches', () => {
    const view = renderDashboard({ companies: 'withFailed' })
    expect(screen.getByText('Acme Audio')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    view.unmount()
    renderDashboard({ companies: 'withComplete' })
    expect(screen.getByText('Foam House')).toBeInTheDocument()
    expect(screen.getByText('Complete')).toBeInTheDocument()
  })

  it('holds layout with a single row per list', () => {
    renderDashboard({ sectors: 'few', companies: 'few' })
    expect(screen.getByText('Pet care')).toBeInTheDocument()
    expect(screen.queryByText('Outdoor gear')).not.toBeInTheDocument()
    expect(screen.getByText('West Paw')).toBeInTheDocument()
    expect(screen.queryByText('Trail Co')).not.toBeInTheDocument()
  })
})

describe('Dashboard landing preview', () => {
  it('caps each list at five rows with a truthful view-all button', () => {
    const onViewAll = vi.fn()
    renderDashboard({ sectors: 'many', companies: 'many', onViewAll })
    expect(screen.getByText('Overflow sector 5')).toBeInTheDocument()
    expect(screen.queryByText('Overflow sector 6')).not.toBeInTheDocument()
    expect(screen.getByText('Overflow maker 5')).toBeInTheDocument()
    expect(screen.queryByText('Overflow maker 6')).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'View all 60 sector researches' }),
    )
    expect(onViewAll).toHaveBeenCalledWith('sectors')
    fireEvent.click(
      screen.getByRole('button', { name: 'View all 60 company researches' }),
    )
    expect(onViewAll).toHaveBeenCalledWith('companies')
  })

  it('always offers view-all for a non-empty list', () => {
    const onViewAll = vi.fn()
    renderDashboard({ onViewAll })
    fireEvent.click(
      screen.getByRole('button', { name: 'View all 3 sector researches' }),
    )
    expect(onViewAll).toHaveBeenCalledWith('sectors')
    fireEvent.click(
      screen.getByRole('button', { name: 'View all 3 company researches' }),
    )
    expect(onViewAll).toHaveBeenCalledWith('companies')
  })

  it('pins both footers and shares one row height', () => {
    renderDashboard()
    for (const name of [
      'View all 3 sector researches',
      'View all 3 company researches',
    ]) {
      expect(
        screen.getByRole('button', { name }).parentElement,
      ).toHaveClass('mt-auto')
    }
    expect(screen.getByText('Pet care').closest('button')).toHaveClass('min-h-19')
    expect(screen.getByText('West Paw').closest('li')).toHaveClass('min-h-19')
  })

  it('holds baseline and rhythm with one row per list', () => {
    renderDashboard({ sectors: 'few', companies: 'few' })
    for (const name of [
      'View all 1 sector researches',
      'View all 1 company researches',
    ]) {
      expect(
        screen.getByRole('button', { name }).parentElement,
      ).toHaveClass('mt-auto')
    }
    expect(screen.getByText('Pet care').closest('button')).toHaveClass('min-h-19')
    expect(screen.getByText('West Paw').closest('li')).toHaveClass('min-h-19')
  })

  it('shows no view-all button for empty lists', () => {
    renderDashboard({ sectors: 'empty', companies: 'empty' })
    expect(
      screen.queryByRole('button', { name: /View all/ }),
    ).not.toBeInTheDocument()
  })
})

describe('Dashboard error states', () => {
  it('retries each research list independently', () => {
    const sectorRetry = vi.fn()
    const companyRetry = vi.fn()
    render(
      <Dashboard
        query=""
        onClearSearch={noop}
        onViewAll={noop}
        onOpenSector={noop}
        sectors={{ status: 'error', items: [], retry: sectorRetry }}
        companies={{ status: 'error', items: [], retry: companyRetry }}
      />,
    )
    expect(
      screen.getByText('Sector researches did not load.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Company researches did not load.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Pet care')).not.toBeInTheDocument()
    const retries = screen.getAllByRole('button', { name: 'Try again' })
    expect(retries).toHaveLength(2)
    fireEvent.click(retries[0])
    expect(sectorRetry).toHaveBeenCalledTimes(1)
    fireEvent.click(retries[1])
    expect(companyRetry).toHaveBeenCalledTimes(1)
  })
})

describe('Dashboard offline states', () => {  it('shows one connection notice per panel and retries independently', () => {
    const sectorRetry = vi.fn()
    const companyRetry = vi.fn()
    render(
      <Dashboard
        query=""
        onClearSearch={noop}
        onViewAll={noop}
        onOpenSector={noop}
        sectors={{ status: 'offline', items: [], retry: sectorRetry }}
        companies={{ status: 'offline', items: [], retry: companyRetry }}
      />,
    )
    const notices = screen.getAllByText('No connection')
    expect(notices).toHaveLength(2)
    const retries = screen.getAllByRole('button', { name: 'Try again' })
    expect(retries).toHaveLength(2)
    fireEvent.click(retries[0])
    expect(sectorRetry).toHaveBeenCalledTimes(1)
    fireEvent.click(retries[1])
    expect(companyRetry).toHaveBeenCalledTimes(1)
  })
})

describe('Dashboard filtered counts', () => {
  it('states how many rows match while searching', () => {
    renderDashboard({ query: 'outdoor' })
    expect(screen.getAllByText('Showing 1 of 1 matching')).toHaveLength(2)
  })

  it('states the preview cap on large lists', () => {
    renderDashboard({ sectors: 'many', companies: 'many' })
    expect(screen.getAllByText('Showing 5 of 60 matching')).toHaveLength(2)
  })

  it('shows no count line without a filter on small lists', () => {
    renderDashboard()
    expect(screen.queryByText(/matching/)).not.toBeInTheDocument()
  })
})
