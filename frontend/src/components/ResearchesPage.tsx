import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { CompanyResearch, ResearchData, SectorResearch } from '../data/research'
import { useStagingCompanies } from '../data/research'
import type { ResearchState, StagingConfig } from '../data/staging-api'
import type { ResearchList } from './Dashboard'
import {
  CompanyRow,
  DeniedNotice,
  firstRunCopy,
  OverflowList,
  PanelError,
  SectorRow,
  SkeletonRows,
  stateLabel,
  UnavailableNotice,
} from './research-parts'
import { Button } from './ui/button'
import { Input } from './ui/input'

const stateFilters = [
  'draft',
  'planning',
  'planned',
  'approved',
  'running',
  'paused',
  'queued',
  'failed',
  'complete',
] as const satisfies readonly ResearchState[]

type StateFilter = ResearchState | 'all'

function FilterBar({
  tab,
  onTab,
  query,
  onQuery,
  active,
  onActive,
}: {
  tab: ResearchList
  onTab: (tab: ResearchList) => void
  query: string
  onQuery: (value: string) => void
  active: StateFilter
  onActive: (filter: StateFilter) => void
}) {
  return (
    <div className="space-y-3">
      <div role="group" aria-label="Research type" className="flex gap-2">
        {(
          [
            { value: 'sectors', label: 'Sectors' },
            { value: 'companies', label: 'Companies' },
          ] as const
        ).map(({ value, label }) => (
          <Button
            key={value}
            type="button"
            variant={tab === value ? 'default' : 'outline'}
            size="sm"
            aria-pressed={tab === value}
            onClick={() => onTab(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="max-w-sm">
        <label htmlFor="researches-filter" className="mb-1 block text-sm font-medium">
          Filter researches
        </label>
        <Input
          id="researches-filter"
          placeholder="Type to filter"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </div>
      <div role="group" aria-label="Filter by state" className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={active === 'all' ? 'default' : 'outline'}
          size="sm"
          aria-pressed={active === 'all'}
          onClick={() => onActive('all')}
        >
          All
        </Button>
        {stateFilters.map((state) => (
          <Button
            key={state}
            type="button"
            variant={active === state ? 'default' : 'outline'}
            size="sm"
            aria-pressed={active === state}
            onClick={() => onActive(active === state ? 'all' : state)}
          >
            {stateLabel[state]}
          </Button>
        ))}
      </div>
    </div>
  )
}

function FullList({
  data,
  tab,
  query,
  active,
  onClear,
  onOpenSector,
}: {
  data: ResearchData<SectorResearch> | ResearchData<CompanyResearch>
  tab: ResearchList
  query: string
  active: StateFilter
  onClear: () => void
  onOpenSector: (id: string) => void
}) {
  const needle = query.trim().toLowerCase()
  if (data.status === 'loading') {
    return (
      <SkeletonRows
        label={tab === 'sectors' ? 'Sector researches are loading' : 'Company researches are loading'}
      />
    )
  }
  if (data.status === 'error') {
    return (
      <PanelError
        heading={
          tab === 'sectors'
            ? 'Sector researches did not load.'
            : 'Company researches did not load.'
        }
        detail="Check your connection and try again."
        onRetry={data.retry}
      />
    )
  }
  if (data.status === 'denied') {
    return (
      <DeniedNotice
        heading={
          tab === 'sectors'
            ? 'Sector researches are not shared with this key.'
            : 'Company researches are not shared with this key.'
        }
      />
    )
  }
  if (data.status === 'offline') {
    return <UnavailableNotice onRetry={data.retry} />
  }
  // Sectors stay client-filtered: the sector list is small and unpaged.
  const base = (data.items as SectorResearch[]).map((item) => ({
    id: item.id,
    text: `${item.name} ${item.topic}`,
    state: item.state,
    row: <SectorRow key={item.id} research={item} onOpen={onOpenSector} />,
  }))
  const rows = base.filter(
    (item) =>
      (!needle || item.text.toLowerCase().includes(needle)) &&
      (active === 'all' || item.state === active),
  )
  const showCount = needle || active !== 'all' || rows.length > 50
  if (!rows.length) {
    const filtered = needle || active !== 'all'
    return (
      <div className="mt-2 rounded-lg border border-dashed border-border p-4">
        <p className="text-sm text-muted-foreground">
          {filtered
            ? 'No researches match these filters. Clear them to see everything.'
            : firstRunCopy[tab]}
        </p>
        {filtered ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClear}
            className="mt-3"
          >
            Clear filters
          </Button>
        ) : null}
      </div>
    )
  }
  return (
    <>
      {showCount ? (
        <p aria-live="polite" className="mb-2 text-xs text-muted-foreground">
          Showing {Math.min(rows.length, 50)} of {rows.length} matching
        </p>
      ) : null}
      <OverflowList total={rows.length}>{rows.map((item) => item.row)}</OverflowList>
    </>
  )
}

// Companies filter server-side: the company list pages (default window
// 100), so local filtering would silently search a partial window. The
// count line reads the server total, never the window length.
function CompaniesFullList({
  staging,
  query,
  active,
  onClear,
}: {
  staging: StagingConfig | null
  query: string
  active: StateFilter
  onClear: () => void
}) {
  const needle = query.trim()
  const data = useStagingCompanies(staging, {
    ...(active === 'all' ? {} : { state: active }),
    ...(needle === '' ? {} : { query: needle }),
  })
  if (data.status === 'loading') {
    return <SkeletonRows label="Company researches are loading" />
  }
  if (data.status === 'error') {
    return (
      <PanelError
        heading="Company researches did not load."
        detail="Check your connection and try again."
        onRetry={data.retry}
      />
    )
  }
  if (data.status === 'denied') {
    return <DeniedNotice heading="Company researches are not shared with this key." />
  }
  if (data.status === 'offline') {
    return <UnavailableNotice onRetry={data.retry} />
  }
  const rows = data.items
  const total = data.total ?? rows.length
  const filtered = needle !== '' || active !== 'all'
  const showCount = filtered || rows.length > 50 || total > rows.length
  const hasMore = rows.length < total
  if (!rows.length) {
    return (
      <div className="mt-2 rounded-lg border border-dashed border-border p-4">
        <p className="text-sm text-muted-foreground">
          {filtered
            ? 'No researches match these filters. Clear them to see everything.'
            : firstRunCopy.companies}
        </p>
        {filtered ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClear}
            className="mt-3"
          >
            Clear filters
          </Button>
        ) : null}
      </div>
    )
  }
  return (
    <>
      {showCount ? (
        <p aria-live="polite" className="mb-2 text-xs text-muted-foreground">
          Showing {rows.length} of {total} matching
        </p>
      ) : null}
      <OverflowList total={total}>{rows.map((item) => <CompanyRow key={item.id} research={item} />)}</OverflowList>
      {hasMore ? (
        <div className="mt-2 flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={data.showMore}
            disabled={data.loadingMore}
          >
            {data.loadingMore ? 'Loading more…' : `Show more (${rows.length} of ${total})`}
          </Button>
        </div>
      ) : null}
    </>
  )
}

function CreateSectorForm({
  creating,
  createError,
  onCreate,
}: {
  creating: boolean
  createError: string | null
  onCreate: (name: string, topic: string) => void
}) {
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [error, setError] = useState('')
  return (
    <form
      aria-label="Create a sector draft"
      className="mt-4 rounded-xl border border-dashed border-border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!name.trim()) {
          setError('Name the sector first.')
          return
        }
        setError('')
        onCreate(name.trim(), topic.trim())
      }}
    >
      <h2 className="text-sm font-semibold">New sector draft</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Drafts collect context files first; research starts only when you press Start.
      </p>
      <div className="mt-2 grid max-w-md gap-2">
        <div>
          <label htmlFor="new-sector-name" className="mb-1 block text-sm font-medium">
            Name
          </label>
          <Input
            id="new-sector-name"
            placeholder="Speciality foods"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="new-sector-topic" className="mb-1 block text-sm font-medium">
            Topic (optional)
          </label>
          <Input
            id="new-sector-topic"
            placeholder="Artisanal packaged foods"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
          />
        </div>
      </div>
      {error || createError ? (
        <p role="alert" className="mt-2 text-sm text-muted-foreground">
          {error || createError}
        </p>
      ) : null}
      <Button type="submit" variant="default" size="sm" className="mt-2" disabled={creating}>
        {creating ? 'Creating…' : 'Create draft'}
      </Button>
    </form>
  )
}

export function ResearchesPage({
  initialTab,
  sectors,
  staging,
  creating,
  createError,
  onBack,
  onTabChange,
  onOpenSector,
  onCreateSector,
}: {
  initialTab: ResearchList
  sectors: ResearchData<SectorResearch>
  staging: StagingConfig | null
  creating: boolean
  createError: string | null
  onBack: () => void
  onTabChange?: (tab: ResearchList) => void
  onOpenSector: (id: string) => void
  onCreateSector: (name: string, topic: string) => void
}) {
  const [tab, setTab] = useState<ResearchList>(initialTab)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<StateFilter>('all')
  // Tab switches sync to the URL (via App) so refresh keeps the tab.
  function changeTab(next: ResearchList): void {
    setTab(next)
    onTabChange?.(next)
  }
  return (
    <div className="space-y-6">
      <Button type="button" variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="size-4" aria-hidden />
        Back to Overview
      </Button>
      {tab === 'sectors' ? (
        <CreateSectorForm creating={creating} createError={createError} onCreate={onCreateSector} />
      ) : null}
      <section
        aria-label={tab === 'sectors' ? 'All sector researches' : 'All company researches'}
        className="rounded-xl border border-border bg-background px-4 py-3"
      >
        <FilterBar
          tab={tab}
          onTab={changeTab}
          query={query}
          onQuery={setQuery}
          active={active}
          onActive={setActive}
        />
        <div className="mt-4">
          {tab === 'sectors' ? (
            <FullList
              data={sectors}
              tab={tab}
              query={query}
              active={active}
              onClear={() => {
                setQuery('')
                setActive('all')
              }}
              onOpenSector={onOpenSector}
            />
          ) : (
            <CompaniesFullList
              staging={staging}
              query={query}
              active={active}
              onClear={() => {
                setQuery('')
                setActive('all')
              }}
            />
          )}
        </div>
      </section>
    </div>
  )
}
