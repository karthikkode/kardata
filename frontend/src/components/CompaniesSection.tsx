// Sector landing companies (SL-05): server-filtered company window for
// one sector with search + status toolbar, stage column, and paging.
// Polls quietly while research is live; the poll re-reads the loaded
// window without resetting it, so arrivals appear without losing place.
import { useEffect, useMemo, useState } from 'react'
import { Icons } from '@/lib/icons'
import { formatCount } from '@/lib/format'
import { companiesEmptyCopy, companyStageLabel } from '@/lib/labels'
import type { CompanyResearch } from '../data/research'
import { useStagingCompanies } from '../data/research'
import type { StagingConfig } from '../data/useApi'
import type { ResearchState } from '../data/useSectors'
import { DataTable, type DataTableColumn } from './DataTable'
import { type StateFilter, stateOptions } from './ResearchesPage'
import { StageSteps, StateBadge } from './research-parts'
import { ResourceState, SearchField, SectionCard } from './shells'
import { Body, BodySm, Caption, Numeric } from './text'
import { Button } from './ui/button'
import { Skeleton } from './ui/skeleton'
import { SelectItem, SelectPopup, SelectRoot, SelectTrigger } from './ui/select'

const RESEARCH_POLL_MS = 5000

const SKELETON_WIDTHS = ['64%', '48%', '72%', '56%', '64%', '48%', '72%', '56%']

function CompaniesSectionSkeleton() {
  return (
    <div role="status" aria-label="Companies are loading" className="flex min-w-0 flex-col">
      {SKELETON_WIDTHS.map((width, index) => (
        <div
          key={index}
          className="flex min-h-11 items-center gap-3 border-b border-border-subtle py-2 last:border-b-0"
        >
          <Skeleton className="h-3.5 min-w-0 flex-1" style={{ maxWidth: width }} />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-16 rounded-sm" />
        </div>
      ))}
    </div>
  )
}

export function CompaniesSection({
  staging,
  sectorId,
  sectorState,
  pollActive = false,
}: {
  staging: StagingConfig | null
  sectorId: string
  sectorState: ResearchState
  /** While research runs, the company window re-reads so arrivals appear. */
  pollActive?: boolean
}) {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<StateFilter>('all')
  // Debounced server query: typing never fires a request per keystroke.
  useEffect(() => {
    if (draft.trim() === query) return
    const timer = setTimeout(() => setQuery(draft.trim()), 250)
    return () => clearTimeout(timer)
  }, [draft, query])
  const filtered = query !== '' || active !== 'all'
  const companies = useStagingCompanies(staging, {
    sectorId,
    ...(active === 'all' ? {} : { state: active }),
    ...(query === '' ? {} : { query }),
  })
  const { retry: refetchCompanies } = companies
  useEffect(() => {
    if (!pollActive || !staging) return
    const timer = setInterval(refetchCompanies, RESEARCH_POLL_MS)
    return () => clearInterval(timer)
  }, [pollActive, staging, refetchCompanies])
  const total = companies.total ?? companies.items.length

  function clearFilters(): void {
    setDraft('')
    setQuery('')
    setActive('all')
  }

  const columns: DataTableColumn<CompanyResearch>[] = useMemo(
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
        id: 'stage',
        header: 'Stage',
        cell: (row) => (
          <span className="flex items-center gap-2">
            <BodySm as="span" className="whitespace-nowrap">
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
    ],
    [],
  )

  const selectedOption = stateOptions.find((option) => option.value === active) ?? stateOptions[0]
  const emptyCopy = companiesEmptyCopy(sectorState)
  const listening = sectorState === 'running' && !filtered

  return (
    <SectionCard
      title="Companies"
      metadata={
        companies.status === 'ready' ? (
          <Numeric className="font-normal text-muted-foreground">{formatCount(total)}</Numeric>
        ) : null
      }
    >
      <div className="flex flex-col gap-3 py-2 md:flex-row md:items-center">
        <SearchField
          value={draft}
          onChange={setDraft}
          label="Search companies"
          placeholder="Search companies"
          className="md:w-64 md:shrink-0"
        />
        <div className="md:w-52 md:shrink-0">
          <SelectRoot
            value={selectedOption}
            onValueChange={(option) => {
              if (option) setActive(option.value)
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
      </div>
      <DataTable
        ariaLabel="Companies"
        data={companies.items}
        columns={columns}
        rowKey={(row) => row.id}
        state={companies.status === 'loading' ? 'loading' : companies.status === 'ready' ? 'ready' : 'error'}
        loading={<CompaniesSectionSkeleton />}
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
            icon={
              listening ? (
                <span aria-hidden className="size-2 animate-pulse rounded-full bg-primary" />
              ) : (
                <Icons.company aria-hidden />
              )
            }
            emptyTitle={emptyCopy.title}
            emptyBody={filtered ? undefined : emptyCopy.body}
            onClearFilter={filtered ? clearFilters : undefined}
            clearLabel="Clear filters"
          />
        }
        footer={
          companies.status === 'ready' && companies.items.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-2">
              <Caption aria-live="polite" className="tabular-nums">
                Showing {formatCount(companies.items.length)} of {formatCount(total)}
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
              ) : companies.items.length < total ? (
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
    </SectionCard>
  )
}
