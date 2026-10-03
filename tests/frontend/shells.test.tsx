import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  ConversationComposer,
  ListFooter,
  OperationNotice,
  PageHeader,
  PlanDocument,
  PlanSection,
  ResourceState,
  SearchField,
  SectionCard,
  StatusBadge,
} from '@/components/shells'
import type { Resource } from '@/data/useWorkspace'

function loading(): Resource<unknown> {
  return { status: 'loading', refresh: vi.fn() }
}

describe('shared shells', () => {
  it('renders one page heading with description and actions', () => {
    render(
      <PageHeader
        title="Researches"
        description="Sectors and companies."
        actions={<button type="button">New sector</button>}
      />,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Researches' })).toBeInTheDocument()
    expect(screen.getByText('Sectors and companies.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New sector' })).toBeInTheDocument()
  })

  it('renders breadcrumbs with the current page marked', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <PageHeader
        title="Australian electrical contractors"
        crumbs={[{ label: 'Researches', onSelect }, { label: 'Australian electrical contractors' }]}
      />,
    )
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(nav).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Researches' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Australian electrical contractors', { selector: '[aria-current="page"]' })).toBeInTheDocument()
  })

  it('renders an inline badge next to the title', () => {
    render(<PageHeader title="Sector" badge={<span data-testid="header-badge">Running</span>} />)
    expect(screen.getByTestId('header-badge')).toHaveTextContent('Running')
  })

  it('shows a title skeleton while loading instead of a fallback string', () => {
    render(<PageHeader title="Sector research" loading />)
    expect(screen.getByRole('heading', { level: 1, name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByText('Sector research')).not.toBeInTheDocument()
  })

  it('renders a muted meta line under the description', () => {
    render(<PageHeader title="Sector" description="Topic." meta="Created 3 Sep 2026 · Updated 2h ago" />)
    expect(screen.getByText('Created 3 Sep 2026 · Updated 2h ago')).toBeInTheDocument()
  })

  it('groups card content with heading, metadata, and footer', () => {
    render(
      <SectionCard title="Sector researches" metadata={<span>60 total</span>} footer={<span>foot</span>}>
        <p>row</p>
      </SectionCard>,
    )
    expect(screen.getByRole('region', { name: 'Sector researches' })).toBeInTheDocument()
    expect(screen.getByText('60 total')).toBeInTheDocument()
    expect(screen.getByText('row')).toBeInTheDocument()
    expect(screen.getByText('foot')).toBeInTheDocument()
  })

  it('shows skeleton geometry while loading', () => {
    render(
      <ResourceState resource={loading()} label="Sector researches">
        <p>row</p>
      </ResourceState>,
    )
    expect(screen.getByRole('status', { name: 'Sector researches is loading' })).toBeInTheDocument()
    expect(screen.queryByText('row')).not.toBeInTheDocument()
  })

  it('distinguishes first-run empty from filtered empty with a clear action', async () => {
    const user = userEvent.setup()
    const onClearFilter = vi.fn()
    const ready: Resource<unknown> = { status: 'ready', data: [], refresh: vi.fn() }
    const { rerender } = render(
      <ResourceState resource={ready} label="Sector researches" emptyKind="first" emptyBody="Start one to see companies here.">
        <p>row</p>
      </ResourceState>,
    )
    expect(screen.getByText('Start one to see companies here.')).toBeInTheDocument()
    rerender(
      <ResourceState resource={ready} label="Sector researches" emptyKind="filtered" onClearFilter={onClearFilter}>
        <p>row</p>
      </ResourceState>,
    )
    expect(screen.getByText('No matching sector researches.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(onClearFilter).toHaveBeenCalledTimes(1)
  })

  it('reports errors with retry and keeps retained content visible', async () => {
    const user = userEvent.setup()
    const refresh = vi.fn()
    const failed: Resource<unknown> = { status: 'error', error: 'That did not load.', refresh }
    render(
      <ResourceState resource={failed} label="Sector researches">
        <p>kept row</p>
      </ResourceState>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('That did not load.')
    expect(screen.getByText('kept row')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('explains denied and offline states with a path forward', () => {
    const denied: Resource<unknown> = { status: 'denied', refresh: vi.fn() }
    const { rerender } = render(
      <ResourceState resource={denied} label="Sector researches">
        <p>row</p>
      </ResourceState>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Sector researches is not shared with this key.')
    const offline: Resource<unknown> = { status: 'offline', refresh: vi.fn() }
    rerender(
      <ResourceState resource={offline} label="Sector researches">
        <p>row</p>
      </ResourceState>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('No connection.')
  })

  it('suppresses the state title when the page header already carries it', () => {
    const denied: Resource<unknown> = { status: 'denied', refresh: vi.fn() }
    const { rerender } = render(
      <ResourceState resource={denied} label="Sector" hideTitle>
        <p>row</p>
      </ResourceState>,
    )
    expect(screen.queryByText('Access denied')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Sector is not shared with this key.')
    const failed: Resource<unknown> = { status: 'error', refresh: vi.fn() }
    rerender(
      <ResourceState resource={failed} label="Sector" hideTitle>
        <p>row</p>
      </ResourceState>,
    )
    expect(screen.queryByText('Sector did not load.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    const ready: Resource<unknown> = { status: 'ready', data: [], refresh: vi.fn() }
    rerender(
      <ResourceState resource={ready} label="Sector" emptyKind="first" hideTitle emptyTitle="Gone" emptyBody="It was removed.">
        <p>row</p>
      </ResourceState>,
    )
    expect(screen.queryByText('Gone')).not.toBeInTheDocument()
    expect(screen.getByText('It was removed.')).toBeInTheDocument()
  })

  it('overrides the denied explanation for plural labels', () => {
    const denied: Resource<unknown> = { status: 'denied', refresh: vi.fn() }
    render(
      <ResourceState resource={denied} label="Companies" deniedBody="Company data is not shared with this key.">
        <p>row</p>
      </ResourceState>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Company data is not shared with this key.')
  })

  it('never renders a failed fetch as empty', () => {
    const failed: Resource<unknown> = { status: 'error', error: 'Gone.', refresh: vi.fn() }
    render(
      <ResourceState resource={failed} label="Sector researches" emptyKind="first">
        <p>row</p>
      </ResourceState>,
    )
    expect(screen.queryByText(/No sector researches yet/)).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Gone.')
  })

  it('clears search text through a keyboard-reachable button', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<SearchField value="Speciality" onChange={onChange} label="Search sectors" />)
    expect(screen.getByLabelText('Search sectors')).toHaveValue('Speciality')
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(onChange).toHaveBeenCalledWith('')
    rerender(<SearchField value="" onChange={onChange} label="Search sectors" />)
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
  })

  it('states shown and total counts with a loading-more control', async () => {
    const user = userEvent.setup()
    const onMore = vi.fn()
    render(<ListFooter shown={50} total={2004} onMore={onMore} />)
    expect(screen.getByText(/Showing/)).toHaveTextContent('50')
    await user.click(screen.getByRole('button', { name: /Show more/ }))
    expect(onMore).toHaveBeenCalledTimes(1)
  })

  it('announces operation phases with retry on failure', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const { rerender } = render(<OperationNotice phase="working" title="Uploading file…" />)
    expect(screen.getByRole('status')).toHaveTextContent('Uploading file…')
    rerender(<OperationNotice phase="error" title="Upload failed." detail="Existing files are kept." onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Existing files are kept.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('pairs badge status text with its tone', () => {
    render(<StatusBadge label="Approved" tone="success" />)
    expect(screen.getByText('Approved')).toBeInTheDocument()
  })

  it('lays out the composer around caller-owned input and controls', () => {
    render(
      <ConversationComposer
        label="Message the sector"
        input={<textarea aria-label="Message the sector" defaultValue="draft" />}
        controls={<button type="button">Send</button>}
      />,
    )
    expect(screen.getByLabelText('Message the sector')).toHaveValue('draft')
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('presents plan versions with distinct sections', () => {
    render(
      <PlanDocument heading="Research plan" version="v2" status={<span>Approved</span>}>
        <PlanSection title="Scope">Speciality foods.</PlanSection>
      </PlanDocument>,
    )
    expect(screen.getByRole('region', { name: 'Research plan' })).toBeInTheDocument()
    expect(screen.getByText('v2')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Scope' })).toBeInTheDocument()
    expect(screen.getByText('Speciality foods.')).toBeInTheDocument()
  })
})
