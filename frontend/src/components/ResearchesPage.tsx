import { useState } from 'react'
import { ArrowLeft, Plus } from 'lucide-react'
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
import {
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import { FieldLabel, FieldRoot } from './ui/field'
import { ListFooter, SearchField, SectionCard } from './shells'
import { SelectItem, SelectPopup, SelectRoot, SelectTrigger } from './ui/select'
import { TabsList, TabsPanel, TabsRoot, TabsTab } from './ui/tabs'

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

const stateOptions: { value: StateFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  ...stateFilters.map((state) => ({ value: state as StateFilter, label: stateLabel[state] })),
]

function FilterBar({
  query,
  onQuery,
  active,
  onActive,
}: {
  query: string
  onQuery: (value: string) => void
  active: StateFilter
  onActive: (filter: StateFilter) => void
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="min-w-0 flex-1 sm:min-w-52">
        <SearchField
          value={query}
          onChange={onQuery}
          label="Filter researches"
          placeholder="Type to filter"
          clearLabel="Clear filter"
        />
      </div>
      <div className="w-full sm:w-52">
        <span id="researches-state-label" className="mb-1 block text-sm font-medium">
          Filter by state
        </span>
        <SelectRoot
          value={stateOptions.find((option) => option.value === active) ?? stateOptions[0]}
          onValueChange={(option) => {
            if (option) onActive(option.value)
          }}
        >
          <SelectTrigger aria-labelledby="researches-state-label" />
          <SelectPopup>
            {stateOptions.map((option) => (
              <SelectItem key={option.value} value={option}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </SelectRoot>
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
        <ListFooter shown={Math.min(rows.length, 50)} total={rows.length} filtered />
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
      <OverflowList total={total}>{rows.map((item) => <CompanyRow key={item.id} research={item} />)}</OverflowList>
      {showCount || hasMore ? (
        <div className="mt-2">
          <ListFooter
            shown={rows.length}
            total={total}
            filtered
            loadingMore={data.loadingMore}
            onMore={hasMore ? data.showMore : undefined}
          />
        </div>
      ) : null}
    </>
  )
}

function CreateSectorDialog({
  creating,
  createError,
  onCreate,
}: {
  creating: boolean
  createError: string | null
  onCreate: (name: string, topic: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [error, setError] = useState('')
  // Typed values survive a failed submit: the dialog stays open with the
  // draft intact, and only a successful creation navigates away (unmount).
  function submit() {
    if (creating) return
    if (!name.trim()) {
      setError('Name the sector first.')
      return
    }
    setError('')
    onCreate(name.trim(), topic.trim())
  }
  return (
    <DialogRoot
      open={open}
      onOpenChange={(next) => {
        if (creating) return
        setOpen(next)
        if (!next) setError('')
      }}
    >
      <DialogTrigger
        render={(props) => (
          <Button type="button" variant="default" size="sm" {...props}>
            <Plus className="size-4" aria-hidden />
            New sector
          </Button>
        )}
      />
      <DialogPopup>
        <DialogHeader>
          <div className="min-w-0 flex-1">
            <DialogTitle>New sector draft</DialogTitle>
            <DialogDescription>
              Drafts collect context files first; research starts only when you press Start.
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody>
          <form
            aria-label="Create a sector draft"
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <FieldRoot>
              <FieldLabel htmlFor="new-sector-name">Name</FieldLabel>
              <Input
                id="new-sector-name"
                placeholder="Speciality foods"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </FieldRoot>
            <FieldRoot>
              <FieldLabel htmlFor="new-sector-topic">Topic (optional)</FieldLabel>
              <Input
                id="new-sector-topic"
                placeholder="Artisanal packaged foods"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
              />
            </FieldRoot>
            {error || createError ? (
              <p role="alert" className="text-sm text-destructive">
                {error || createError}
              </p>
            ) : null}
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={creating} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" variant="default" disabled={creating} pending={creating} onClick={submit}>
            {creating ? 'Creating…' : 'Create draft'}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </DialogRoot>
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          Back to Overview
        </Button>
        {tab === 'sectors' ? (
          <CreateSectorDialog creating={creating} createError={createError} onCreate={onCreateSector} />
        ) : null}
      </div>
      <TabsRoot value={tab} onValueChange={(value) => changeTab(value as ResearchList)}>
        <SectionCard
          title={tab === 'sectors' ? 'All sector researches' : 'All company researches'}
        >
          <TabsList aria-label="Research type">
            <TabsTab value="sectors">Sectors</TabsTab>
            <TabsTab value="companies">Companies</TabsTab>
          </TabsList>
          <div className="mt-4">
            <FilterBar
              query={query}
              onQuery={setQuery}
              active={active}
              onActive={setActive}
            />
          </div>
          <div className="mt-4">
            <TabsPanel value="sectors">
              <FullList
                data={sectors}
                tab="sectors"
                query={query}
                active={active}
                onClear={() => {
                  setQuery('')
                  setActive('all')
                }}
                onOpenSector={onOpenSector}
              />
            </TabsPanel>
            <TabsPanel value="companies">
              <CompaniesFullList
                staging={staging}
                query={query}
                active={active}
                onClear={() => {
                  setQuery('')
                  setActive('all')
                }}
              />
            </TabsPanel>
          </div>
        </SectionCard>
      </TabsRoot>
    </div>
  )
}
