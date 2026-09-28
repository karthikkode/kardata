// ResearchesPage proofs. Bundles are backend-shaped rows built inline for
// rendering: filtering, overflow totals, and tab switches run against the
// component contract, never a mock origin.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ResearchList } from '@/components/Dashboard'
import { ResearchesPage } from '@/components/ResearchesPage'
import type {
  CompanyResearch,
  ResearchData,
  SectorResearch,
} from '@/data/research'

const noop = () => {}

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
  return { status: 'ready', items, retry: noop }
}

function renderPage(
  props: {
    initialTab?: ResearchList
    sectors?: SectorResearch[]
    companies?: CompanyResearch[]
    onBack?: () => void
    onOpenSector?: (id: string) => void
    onCreateSector?: (name: string, topic: string) => void
    createError?: string | null
  } = {},
) {
  const {
    initialTab = 'sectors',
    sectors = SECTORS,
    companies = COMPANIES,
    onBack = noop,
    onOpenSector = noop,
    onCreateSector = noop,
    createError = null,
  } = props
  return render(
    <ResearchesPage
      initialTab={initialTab}
      sectors={bundle(sectors)}
      companies={bundle(companies)}
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

  it('starts on the requested segment', () => {
    renderPage({ initialTab: 'companies' })
    expect(
      screen.getByRole('region', { name: 'All company researches' }),
    ).toBeInTheDocument()
    expect(screen.getByText('West Paw')).toBeInTheDocument()
  })

  it('switches segments', () => {
    renderPage()
    expect(screen.getByText('Pet care')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Companies' }))
    expect(screen.getByText('West Paw')).toBeInTheDocument()
    expect(screen.queryByText('Pet care', { exact: true })).not.toBeInTheDocument()
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
    const loading: ResearchData<SectorResearch> = { status: 'loading', items: [], retry: noop }
    const failed: ResearchData<SectorResearch> = { status: 'error', items: [], retry: noop }
    const { rerender } = render(
      <ResearchesPage
        initialTab="sectors"
        sectors={loading}
        companies={bundle<CompanyResearch>([])}
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
        companies={bundle<CompanyResearch>([])}
        creating={false}
        onBack={noop}
        onOpenSector={noop}
        onCreateSector={noop}
      />,
    )
    expect(screen.getByText('Sector researches did not load.')).toBeInTheDocument()
  })
})
