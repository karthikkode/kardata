// Researches (RS-01..06): sectors and companies tabs with a shared
// toolbar (search + status + truthful counts) over framed data tables.
// Filters live in the URL (?q, ?state): the input drafts locally and
// syncs back debounced, so Back/Forward and tile deep-links restore the
// view. Sectors filter client-side; companies filter server-side (the
// list pages, so local filtering would search a partial window).
import { useEffect, useMemo, useState } from 'react'
import { Icons } from '@/lib/icons'
import { formatCount, formatFullDate, relativeAge } from '@/lib/format'
import { companyStageLabel, researchStateLabel } from '@/lib/labels'
import type {
  CompanyResearch,
  ResearchData,
  SectorResearch,
} from '../data/research'
import { useStagingCompanies } from '../data/research'
import type { ResearchState } from '../data/useSectors'
import type { StagingConfig } from '../data/useApi'
import type { ResearchList } from './Dashboard'
import { StageSteps, StateBadge } from './research-parts'
import { ResourceState, SearchField } from './shells'
import { Body, BodySm, Caption, Description, Numeric } from './text'
import { Button } from './ui/button'
import { DataTable, type DataTableColumn } from './DataTable'
import { Skeleton } from './ui/skeleton'
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

export type StateFilter = ResearchState | 'all'

export type StateOption = { value: StateFilter; label: string }

export const stateOptions: StateOption[] = [
  { value: 'all', label: 'All' },
  ...stateFilters.map((state) => ({ value: state as StateFilter, label: researchStateLabel(state) })),
]

function isStateFilter(value: string | null | undefined): value is StateFilter {
  return value === 'all' || (stateFilters as readonly string[]).includes(value ?? '')
}

/** Sectors page client-side past this many rows (page scrolls, no inner box). */
const SECTOR_WINDOW = 50

const SKELETON_WIDTHS = ['64%', '48%', '72%', '56%', '64%', '48%', '72%', '56%']

function SectorsTableSkeleton() {
  return (
    <div role="status" aria-label="Sectors are loading" className="flex min-w-0 flex-col">
      {SKELETON_WIDTHS.map((width, index) => (
        <div
          key={index}
          className="flex min-h-14 items-center gap-3 border-b border-border-subtle py-2 last:border-b-0"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5" style={{ width }} />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-5 w-16 rounded-sm" />
          <Skeleton className="h-3.5 w-10" />
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </div>
  )
}

function CompaniesTableSkeleton() {
  return (
    <div role="status" aria-label="Companies are loading" className="flex min-w-0 flex-col">
      {SKELETON_WIDTHS.map((width, index) => (
        <div
          key={index}
          className="flex min-h-11 items-center gap-3 border-b border-border-subtle py-2 last:border-b-0"
        >
          <Skeleton className="h-3.5 min-w-0 flex-1" style={{ maxWidth: width }} />
          <Skeleton className="hidden h-3 w-24 sm:block" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-16 rounded-sm" />
        </div>
      ))}
    </div>
  )
}

export function ResearchesPage({
  initialTab,
  sectors,
  companiesTotal,
  staging,
  filterQuery = null,
  stateFilter = null,
  onTabChange,
  onFiltersChange,
  onOpenSector,
  onNewSector,
}: {
  initialTab: ResearchList
  sectors: ResearchData<SectorResearch>
  /** Unfiltered company total for the tab count (App's bundle; this page's own query is filtered). */
  companiesTotal?: number
  staging: StagingConfig | null
  filterQuery?: string | null
  stateFilter?: string | null
  onTabChange?: (tab: ResearchList) => void
  onFiltersChange?: (query: string, state: StateFilter) => void
  onOpenSector: (id: string) => void
  onNewSector: () => void
}) {
  const [tab, setTab] = useState<ResearchList>(initialTab)
  const [prevInitialTab, setPrevInitialTab] = useState(initialTab)
  // Back/Forward replays the URL into local state without a remount, so
  // tab focus and the input caret survive navigation.
  if (initialTab !== prevInitialTab) {
    setPrevInitialTab(initialTab)
    setTab(initialTab)
  }
  const [draft, setDraft] = useState(filterQuery ?? '')
  const [prevFilterQuery, setPrevFilterQuery] = useState(filterQuery)
  if (filterQuery !== prevFilterQuery) {
    setPrevFilterQuery(filterQuery)
    setDraft(filterQuery ?? '')
  }
  const active: StateFilter = isStateFilter(stateFilter) ? stateFilter : 'all'
  // One debounce serves the input and the server query: typing never
  // fires a request per keystroke, and the URL stays the filter truth.
  useEffect(() => {
    if (draft === (filterQuery ?? '')) return
    const timer = setTimeout(() => onFiltersChange?.(draft, active), 250)
    return () => clearTimeout(timer)
  }, [draft, active, filterQuery, onFiltersChange])

  function changeTab(next: ResearchList): void {
    setTab(next)
    onTabChange?.(next)
  }

  function changeState(next: StateFilter): void {
    onFiltersChange?.(draft, next)
  }

  function clearFilters(): void {
    setDraft('')
    onFiltersChange?.('', 'all')
  }

  const needle = (filterQuery ?? '').trim().toLowerCase()
  const serverNeedle = (filterQuery ?? '').trim()
  const filtered = needle !== '' || active !== 'all'

  const filteredSectors = useMemo(
    () =>
      sectors.items.filter(
        (sector) =>
          (!needle || `${sector.name} ${sector.topic}`.toLowerCase().includes(needle)) &&
          (active === 'all' || sector.state === active),
      ),
    [sectors.items, needle, active],
  )
  const [visibleSectors, setVisibleSectors] = useState(SECTOR_WINDOW)
  const [prevWindowKey, setPrevWindowKey] = useState(`${needle} ${active}`)
  const windowKey = `${needle} ${active}`
  if (windowKey !== prevWindowKey) {
    setPrevWindowKey(windowKey)
    setVisibleSectors(SECTOR_WINDOW)
  }

  const companies = useStagingCompanies(staging, {
    ...(active === 'all' ? {} : { state: active }),
    ...(serverNeedle === '' ? {} : { query: serverNeedle }),
  })
  const companyTotal = companies.total ?? companies.items.length

  const sectorColumns: DataTableColumn<SectorResearch>[] = useMemo(
    () => [
      {
        id: 'sector',
        header: 'Sector',
        stackedLabel: '',
        cell: (row) => (
          <span className="block min-w-0">
            <Body as="span" title={row.name} className="block truncate font-medium">
              {row.name}
            </Body>
            <Description as="span" title={row.topic} className="block truncate">
              {row.topic}
            </Description>
          </span>
        ),
        sortValue: (row) => row.name,
      },
      {
        id: 'status',
        header: 'Status',
        cell: (row) => <StateBadge state={row.state} />,
        sortValue: (row) => researchStateLabel(row.state),
      },
      {
        id: 'companies',
        header: 'Companies',
        align: 'right',
        cell: (row) => <Numeric>{formatCount(row.companiesFound)}</Numeric>,
        sortValue: (row) => row.companiesFound,
      },
      {
        id: 'updated',
        header: 'Updated',
        cell: (row) => (
          <BodySm as="span" title={formatFullDate(row.updatedAt)} className="text-muted-foreground whitespace-nowrap">
            {relativeAge(row.updatedAt)}
          </BodySm>
        ),
        sortValue: (row) => {
          const time = new Date(row.updatedAt).getTime()
          return Number.isFinite(time) ? time : null
        },
      },
      {
        id: 'open',
        header: <span className="sr-only">Open</span>,
        stackedLabel: '',
        width: '3rem',
        cell: () => <Icons.chevronRight aria-hidden className="size-4 text-muted-foreground" />,
      },
    ],
    [],
  )

  // No client sorting: the company list pages server-side, so sorting the
  // loaded window would lie about the rest. Server sort is a follow-up.
  const companyColumns: DataTableColumn<CompanyResearch>[] = useMemo(
    () => [
      {
        id: 'company',
        header: 'Company',
        stackedLabel: '',
        cell: (row) => (
          <Body as="span" title={row.name} className="block truncate font-medium">
            {row.name}
          </Body>
        ),
      },
      {
        id: 'sector',
        header: 'Sector',
        cell: (row) => (
          <BodySm as="span" title={row.sectorName} className="block truncate">
            {row.sectorName}
          </BodySm>
        ),
      },
      {
        id: 'stage',
        header: 'Stage',
        cell: (row) => (
          <span className="flex flex-col gap-1 lg:flex-row lg:items-center lg:gap-2">
            <BodySm as="span" className="min-w-0 truncate">
              {companyStageLabel(row.stage)}
            </BodySm>
            <StageSteps stage={row.stage} />
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: (row) => <StateBadge state={row.state} />,
      },
      {
        id: 'open',
        header: <span className="sr-only">Open</span>,
        stackedLabel: '',
        width: '3rem',
        cell: () => <Icons.chevronRight aria-hidden className="size-4 text-muted-foreground" />,
      },
    ],
    [],
  )

  const sectorsCount = sectors.total ?? sectors.items.length
  const toolbarCount =
    tab === 'sectors'
      ? sectors.status === 'ready'
        ? `${formatCount(filteredSectors.length)} ${filteredSectors.length === 1 ? 'sector' : 'sectors'}`
        : null
      : companies.status === 'ready'
        ? `${formatCount(companyTotal)} ${companyTotal === 1 ? 'company' : 'companies'}`
        : null

  const selectedOption = stateOptions.find((option) => option.value === active) ?? stateOptions[0]
  const newSectorAction = (
    <Button type="button" variant="primary" size="sm" onClick={onNewSector}>
      <Icons.plus aria-hidden />
      New sector
    </Button>
  )
  const hasMoreSectors = filteredSectors.length > visibleSectors

  return (
    <TabsRoot value={tab} onValueChange={(value) => changeTab(value as ResearchList)}>
      <TabsList aria-label="Research type">
        <TabsTab value="sectors">
          Sectors{' '}
          {sectors.status === 'ready' ? (
            <Numeric className="font-normal text-muted-foreground">{formatCount(sectorsCount)}</Numeric>
          ) : null}
        </TabsTab>
        <TabsTab value="companies">
          Companies{' '}
          {companiesTotal !== undefined ? (
            <Numeric className="font-normal text-muted-foreground">{formatCount(companiesTotal)}</Numeric>
          ) : null}
        </TabsTab>
      </TabsList>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <SearchField
          value={draft}
          onChange={setDraft}
          label={tab === 'sectors' ? 'Search sectors' : 'Search companies'}
          placeholder={tab === 'sectors' ? 'Search sectors' : 'Search companies'}
          className="md:w-64 md:shrink-0"
        />
        <div className="md:w-52 md:shrink-0">
          <SelectRoot
            value={selectedOption}
            onValueChange={(option) => {
              if (option) changeState(option.value)
            }}
          >
            <SelectTrigger
              aria-label={`Status: ${selectedOption.label}`}
              valueText={`Status: ${selectedOption.label}`}
            />
            <SelectPopup>
              {stateOptions.map((option) => (
                <SelectItem key={option.value} value={option}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </SelectRoot>
        </div>
        <div className="md:ml-auto">
          {toolbarCount ? (
            <Caption aria-live="polite" className="tabular-nums">
              {toolbarCount}
            </Caption>
          ) : null}
        </div>
      </div>
      <TabsPanel value="sectors">
        <div data-card="" className="rounded-lg border border-border bg-card px-2 py-2 max-sm:border-0 max-sm:bg-transparent max-sm:p-0">
          <DataTable
            ariaLabel="Sectors"
            data={filteredSectors}
            columns={sectorColumns}
            rowKey={(row) => row.id}
            onSelect={(row) => onOpenSector(row.id)}
            defaultSort={[{ id: 'updated', desc: true }]}
            state={sectors.status === 'loading' ? 'loading' : sectors.status === 'ready' ? 'ready' : 'error'}
            rowLimit={filteredSectors.length > SECTOR_WINDOW ? visibleSectors : undefined}
            loading={<SectorsTableSkeleton />}
            error={<ResourceState resource={{ status: sectors.status, refresh: sectors.retry }} label="Sectors" />}
            empty={
              <ResourceState
                resource={{ status: 'ready', refresh: sectors.retry }}
                label="Sectors"
                emptyKind={filtered ? 'filtered' : 'first'}
                icon={<Icons.sector aria-hidden />}
                emptyTitle="No sectors yet"
                emptyBody="Create a sector to start discovering companies."
                emptyAction={newSectorAction}
                onClearFilter={filtered ? clearFilters : undefined}
                clearLabel="Clear filters"
              />
            }
            footer={
              filteredSectors.length > SECTOR_WINDOW ? (
                <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-2">
                  <Caption aria-live="polite" className="tabular-nums">
                    Showing {formatCount(Math.min(visibleSectors, filteredSectors.length))} of{' '}
                    {formatCount(filteredSectors.length)}
                  </Caption>
                  {hasMoreSectors ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setVisibleSectors((value) => value + SECTOR_WINDOW)}
                    >
                      Show more
                    </Button>
                  ) : null}
                </div>
              ) : undefined
            }
          />
        </div>
      </TabsPanel>
      <TabsPanel value="companies">
        <div data-card="" className="rounded-lg border border-border bg-card px-2 py-2 max-sm:border-0 max-sm:bg-transparent max-sm:p-0">
          <DataTable
            ariaLabel="Companies"
            data={companies.items}
            columns={companyColumns}
            rowKey={(row) => row.id}
            onSelect={(row) => onOpenSector(row.sectorId)}
            state={companies.status === 'loading' ? 'loading' : companies.status === 'ready' ? 'ready' : 'error'}
            loading={<CompaniesTableSkeleton />}
            error={
              <ResourceState
                resource={{ status: companies.status, refresh: companies.retry }}
                label="Companies"
                deniedBody="Company data is not shared with this key. Ask an owner for access, then try again."
              />
            }
            empty={
              <ResourceState
                resource={{ status: 'ready', refresh: companies.retry }}
                label="Companies"
                emptyKind={filtered ? 'filtered' : 'first'}
                icon={<Icons.company aria-hidden />}
                emptyTitle="No companies yet"
                emptyBody="Create a sector to start discovering companies."
                emptyAction={newSectorAction}
                onClearFilter={filtered ? clearFilters : undefined}
                clearLabel="Clear filters"
              />
            }
            footer={
              companies.status === 'ready' && companies.items.length > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-2">
                  <Caption aria-live="polite" className="tabular-nums">
                    Showing {formatCount(companies.items.length)} of {formatCount(companyTotal)}
                  </Caption>
                  {companies.moreError ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <BodySm as="span" className="text-danger">
                        More companies did not load.
                      </BodySm>
                      <Button type="button" variant="ghost" size="sm" onClick={companies.showMore}>
                        Try again
                      </Button>
                    </span>
                  ) : companies.items.length < companyTotal ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      pending={companies.loadingMore}
                      disabled={companies.loadingMore}
                      onClick={companies.showMore}
                    >
                      Show more
                    </Button>
                  ) : null}
                </div>
              ) : undefined
            }
          />
        </div>
      </TabsPanel>
    </TabsRoot>
  )
}
