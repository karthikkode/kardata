// Dashboard proofs (OV-01/02/04/05). Tiles render fixture-derived
// numbers and link to pre-filtered Researches; panels preview the six
// most recent rows with View-all actions.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Dashboard } from '@/components/Dashboard'
import type {
  CompanyResearch,
  ResearchData,
  SectorResearch,
} from '@/data/research'

const noop = () => {}

const LOADED_SECTORS: SectorResearch[] = [
  { id: 'seed-pet-care', name: 'Pet care', topic: 'D2C pet brands', companiesFound: 14, state: 'running', createdAt: '2026-09-01T09:00:00', updatedAt: '2026-09-30T10:00:00' },
  { id: 'seed-outdoor', name: 'Outdoor gear', topic: 'Trail equipment', companiesFound: 6, state: 'planned', createdAt: '2026-09-02T09:00:00', updatedAt: '2026-09-29T10:00:00' },
  { id: 'seed-home', name: 'Home audio', topic: 'Speaker brands', companiesFound: 0, state: 'failed', createdAt: '2026-09-03T09:00:00', updatedAt: '2026-09-28T10:00:00' },
]

const LOADED_COMPANIES: CompanyResearch[] = [
  { id: 'seed-west', sectorId: 'seed-pet-care', sectorName: 'Pet care', name: 'West Paw', stage: 'Final validation', state: 'running' },
  { id: 'seed-trail', sectorId: 'seed-outdoor', sectorName: 'Outdoor gear', name: 'Trail Co', stage: 'Deep research', state: 'running' },
  { id: 'seed-brew', sectorId: 'seed-pet-care', sectorName: 'Pet care', name: 'Brew Lab', stage: 'Filter', state: 'paused' },
]

function overflowSectors(): SectorResearch[] {
  return Array.from({ length: 8 }, (_, index) => ({
    id: `overflow-${index + 1}`,
    name: `Overflow sector ${index + 1}`,
    topic: 'Bulk rows',
    companiesFound: 0,
    state: 'queued' as const,
    createdAt: '2026-09-01T09:00:00',
    updatedAt: `2026-09-${String(10 + index).padStart(2, '0')}T10:00:00`,
  }))
}

function overflowCompanies(): CompanyResearch[] {
  return Array.from({ length: 8 }, (_, index) => ({
    id: `overflow-maker-${index + 1}`,
    sectorId: 'seed-bulk',
    sectorName: 'Bulk sector',
    name: `Overflow maker ${index + 1}`,
    stage: 'Filter',
    state: 'queued' as const,
  }))
}

type BundleKind = 'ready' | 'loading' | 'error' | 'offline' | 'denied' | 'empty'

function bundleFor(
  kind: 'sectors' | 'companies',
  variant: BundleKind | 'many' = 'ready',
  retry: () => void = noop,
): ResearchData<SectorResearch> | ResearchData<CompanyResearch> {
  if (variant === 'loading') return { status: 'loading', items: [], total: undefined, retry }
  if (variant === 'error') return { status: 'error', items: [], total: undefined, retry }
  if (variant === 'offline') return { status: 'offline', items: [], total: undefined, retry }
  if (variant === 'denied') return { status: 'denied', items: [], total: undefined, retry }
  if (variant === 'empty') return { status: 'ready', items: [], total: 0, retry }
  if (kind === 'sectors') {
    if (variant === 'many') return { status: 'ready', items: overflowSectors(), total: 8, retry }
    return { status: 'ready', items: LOADED_SECTORS, total: LOADED_SECTORS.length, retry }
  }
  if (variant === 'many') return { status: 'ready', items: overflowCompanies(), total: 8, retry }
  return { status: 'ready', items: LOADED_COMPANIES, total: LOADED_COMPANIES.length, retry }
}

function renderDashboard(
  props: {
    sectors?: Parameters<typeof bundleFor>[1]
    companies?: Parameters<typeof bundleFor>[1]
    sectorRetry?: () => void
    companyRetry?: () => void
    onViewAll?: (list: 'sectors' | 'companies') => void
    onOpenFiltered?: (list: 'sectors' | 'companies', state: string | null) => void
    onOpenSector?: (id: string) => void
    onNewSector?: () => void
  } = {},
) {
  const {
    sectors = 'ready',
    companies = 'ready',
    sectorRetry = noop,
    companyRetry = noop,
    onViewAll = noop,
    onOpenFiltered = noop,
    onOpenSector = noop,
    onNewSector = noop,
  } = props
  return render(
    <Dashboard
      onViewAll={onViewAll}
      onOpenFiltered={onOpenFiltered}
      onOpenSector={onOpenSector}
      onNewSector={onNewSector}
      sectors={bundleFor('sectors', sectors, sectorRetry) as ResearchData<SectorResearch>}
      companies={bundleFor('companies', companies, companyRetry) as ResearchData<CompanyResearch>}
    />,
  )
}

describe('Dashboard stat tiles', () => {
  it('renders fixture-derived numbers with honest captions', () => {
    renderDashboard()
    expect(screen.getByRole('button', { name: 'Sectors: 3, 1 in progress. Show in Researches.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Companies found: 3, Across 2 sectors. Show in Researches.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Needs attention: 1, Failed or blocked research. Show in Researches.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Awaiting approval: 1, Plans waiting for review. Show in Researches.' })).toBeInTheDocument()
  })

  it('counts sectors across the full list, not the windowed companies page', () => {
    const sectors: SectorResearch[] = [
      { id: 'w-one', name: 'One', topic: 'First', companiesFound: 60, state: 'running', createdAt: '2026-09-01T09:00:00', updatedAt: '2026-09-30T10:00:00' },
      { id: 'w-two', name: 'Two', topic: 'Second', companiesFound: 40, state: 'running', createdAt: '2026-09-01T09:00:00', updatedAt: '2026-09-30T10:00:00' },
    ]
    const companies: CompanyResearch[] = [
      { id: 'w-a', sectorId: 'w-one', sectorName: 'One', name: 'Maker A', stage: 'Filter', state: 'running' },
    ]
    render(
      <Dashboard
        onViewAll={noop}
        onOpenFiltered={noop}
        onOpenSector={noop}
        onNewSector={noop}
        sectors={{ status: 'ready', items: sectors, total: 2, retry: noop }}
        companies={{ status: 'ready', items: companies, total: 100, retry: noop }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Companies found: 100, Across 2 sectors. Show in Researches.' })).toBeInTheDocument()
  })

  it('opens Researches pre-filtered from each tile', () => {
    const onOpenFiltered = vi.fn()
    renderDashboard({ onOpenFiltered })
    fireEvent.click(screen.getByRole('button', { name: /Needs attention/ }))
    expect(onOpenFiltered).toHaveBeenCalledWith('sectors', 'failed')
    fireEvent.click(screen.getByRole('button', { name: /Awaiting approval/ }))
    expect(onOpenFiltered).toHaveBeenCalledWith('sectors', 'planned')
    fireEvent.click(screen.getByRole('button', { name: /^Sectors:/ }))
    expect(onOpenFiltered).toHaveBeenCalledWith('sectors', null)
    fireEvent.click(screen.getByRole('button', { name: /^Companies found:/ }))
    expect(onOpenFiltered).toHaveBeenCalledWith('companies', null)
  })

  it('shows skeleton tiles while bundles load', () => {
    renderDashboard({ sectors: 'loading', companies: 'loading' })
    expect(screen.getByRole('status', { name: 'Sectors is loading' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Companies found is loading' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Needs attention is loading' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Awaiting approval is loading' })).toBeInTheDocument()
  })

  it('shows Unavailable with a retry per failed bundle', () => {
    const sectorRetry = vi.fn()
    const companyRetry = vi.fn()
    renderDashboard({ sectors: 'error', companies: 'error', sectorRetry, companyRetry })
    expect(screen.getAllByText('Unavailable')).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: 'Retry Sectors' }))
    expect(sectorRetry).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Retry Companies found' }))
    expect(companyRetry).toHaveBeenCalledTimes(1)
  })
})

describe('Dashboard recent sectors', () => {
  it('lists the six most recent sectors first with status, counts, and age', () => {
    renderDashboard({ sectors: 'many' })
    const list = screen.getByRole('list', { name: 'Recent sectors' })
    const text = list.textContent ?? ''
    // Sorted by updatedAt desc: Overflow sector 8 is the newest.
    expect(text.indexOf('Overflow sector 8')).toBeLessThan(text.indexOf('Overflow sector 3'))
    expect(screen.getByText('Overflow sector 3')).toBeInTheDocument()
    expect(screen.queryByText('Overflow sector 2')).not.toBeInTheDocument()
    expect(screen.getByTitle('17 Sep 2026, 10:00')).toHaveTextContent(/ago|Just now/)
  })

  it('opens the sector landing from a row', () => {
    const onOpenSector = vi.fn()
    renderDashboard({ onOpenSector })
    const panel = screen.getByRole('region', { name: 'Recent sectors' })
    fireEvent.click(within(panel).getByText('Pet care').closest('button') as HTMLElement)
    expect(onOpenSector).toHaveBeenCalledWith('seed-pet-care')
  })

  it('shows one status badge plus plain counts per row', () => {
    renderDashboard()
    const panel = screen.getByRole('region', { name: 'Recent sectors' })
    const row = within(panel).getByText('Pet care').closest('button') as HTMLElement
    expect(row).toHaveTextContent('In progress')
    expect(row).toHaveTextContent('14 companies')
  })

  it('shows a View all action in the panel header', () => {
    const onViewAll = vi.fn()
    renderDashboard({ onViewAll })
    const panel = screen.getByRole('region', { name: 'Recent sectors' })
    const viewAll = within(panel).getByRole('button', { name: 'View all' })
    expect(panel.contains(viewAll)).toBe(true)
    fireEvent.click(viewAll)
    expect(onViewAll).toHaveBeenCalledWith('sectors')
  })
})

describe('Dashboard recent companies', () => {
  it('lists companies with humanized stage labels and step indicators', () => {
    renderDashboard()
    expect(screen.getByRole('region', { name: 'Recent companies' })).toBeInTheDocument()
    expect(screen.getByText('West Paw')).toBeInTheDocument()
    expect(screen.getByText('Final validation')).toBeInTheDocument()
    expect(screen.getByLabelText('Stage 4 of 4: Final validation')).toBeInTheDocument()
    expect(screen.getByText('Screening')).toBeInTheDocument()
    expect(screen.getByLabelText('Stage 1 of 4: Screening')).toBeInTheDocument()
    // Raw stage keys never reach the UI.
    expect(screen.queryByText('Filter', { exact: true })).not.toBeInTheDocument()
  })

  it('opens the owning sector landing from a company row', () => {
    const onOpenSector = vi.fn()
    renderDashboard({ onOpenSector })
    fireEvent.click(screen.getByText('Trail Co').closest('button') as HTMLElement)
    expect(onOpenSector).toHaveBeenCalledWith('seed-outdoor')
  })

  it('caps the preview at six rows', () => {
    renderDashboard({ companies: 'many' })
    expect(screen.getByText('Overflow maker 6')).toBeInTheDocument()
    expect(screen.queryByText('Overflow maker 7')).not.toBeInTheDocument()
  })
})

describe('Dashboard panel states', () => {
  it('shows skeleton rows while panels load', () => {
    renderDashboard({ sectors: 'loading', companies: 'loading' })
    expect(screen.getByRole('status', { name: 'Recent sectors is loading' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Recent companies is loading' })).toBeInTheDocument()
    expect(screen.queryByText('Pet care')).not.toBeInTheDocument()
  })

  it('offers New sector from first-run panels', () => {
    const onNewSector = vi.fn()
    renderDashboard({ sectors: 'empty', companies: 'empty', onNewSector })
    expect(screen.getByText('No sectors yet')).toBeInTheDocument()
    expect(screen.getByText('No companies yet')).toBeInTheDocument()
    const actions = screen.getAllByRole('button', { name: 'New sector' })
    expect(actions).toHaveLength(2)
    fireEvent.click(actions[0])
    expect(onNewSector).toHaveBeenCalledTimes(1)
  })

  it('retries failed panels independently', () => {
    const sectorRetry = vi.fn()
    const companyRetry = vi.fn()
    renderDashboard({ sectors: 'error', companies: 'error', sectorRetry, companyRetry })
    expect(screen.getByText('Recent sectors did not load.')).toBeInTheDocument()
    expect(screen.getByText('Recent companies did not load.')).toBeInTheDocument()
    const retries = screen.getAllByRole('button', { name: 'Try again' })
    expect(retries).toHaveLength(2)
    fireEvent.click(retries[0])
    expect(sectorRetry).toHaveBeenCalledTimes(1)
    fireEvent.click(retries[1])
    expect(companyRetry).toHaveBeenCalledTimes(1)
  })

  it('shows offline and denied panels without developer copy', () => {
    const sectorRetry = vi.fn()
    const view = renderDashboard({ sectors: 'offline', sectorRetry })
    expect(screen.getByText('You are offline')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(sectorRetry).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/frontend\/\.env/)).not.toBeInTheDocument()
    view.unmount()
    renderDashboard({ sectors: 'denied' })
    expect(screen.getByText('Access denied')).toBeInTheDocument()
  })
})
