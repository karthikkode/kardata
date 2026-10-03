// Overview (OV-01/02/04/05): real-data stat tiles plus recent-sectors
// and recent-companies panels. Tiles link to Researches pre-filtered;
// panels preview the six most recent rows behind View-all actions.
import { useRef } from 'react'
import type {
  CompanyResearch,
  ResearchData,
  SectorResearch,
} from '../data/research'
import { Icons } from '@/lib/icons'
import { formatCount, formatFullDate, relativeAge } from '@/lib/format'
import { companyStageLabel } from '@/lib/labels'
import { useAnimatedNumber } from '@/lib/animate-number'
import { StageSteps, StateBadge } from './research-parts'
import { ResourceState, SectionCard } from './shells'
import { Body, BodySm, Caption, Description, Label, Numeric } from './text'
import { Button } from './ui/button'
import { IconButton } from './IconButton'
import { List, ListRow } from './ui/list'
import { Skeleton } from './ui/skeleton'

export type ResearchList = 'sectors' | 'companies'

const overviewPreviewCount = 6

function StatTile({
  label,
  value,
  caption,
  index,
  onOpen,
}: {
  label: string
  value: number
  caption: string
  index: number
  onOpen: () => void
}) {
  const valueRef = useRef<HTMLSpanElement | null>(null)
  useAnimatedNumber(valueRef, value)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${label}: ${formatCount(value)}, ${caption}. Show in Researches.`}
      style={{ animationDelay: `${index * 30}ms` }}
      className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-180 flex min-w-0 cursor-pointer flex-col gap-1 rounded-lg border border-border bg-card p-4 text-left transition-colors duration-120 ease-out-soft hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Label>{label}</Label>
      <Numeric ref={valueRef} size="stat">
        {formatCount(value)}
      </Numeric>
      <Caption>{caption}</Caption>
    </button>
  )
}

function StatTileSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={`${label} is loading`}
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card p-4"
    >
      <span className="sr-only">Loading {label}</span>
      <Skeleton aria-hidden className="h-3 w-16" />
      <Skeleton aria-hidden className="h-6 w-12" />
      <Skeleton aria-hidden className="h-3 w-24" />
    </div>
  )
}

function StatTileError({
  label,
  onRetry,
}: {
  label: string
  onRetry: () => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card p-4">
      <Label>{label}</Label>
      <span className="flex h-8 items-center gap-2">
        <BodySm as="span" className="text-muted-foreground">
          Unavailable
        </BodySm>
        <IconButton label={`Retry ${label}`} size="icon-sm" onClick={onRetry}>
          <Icons.retry aria-hidden />
        </IconButton>
      </span>
      <Caption>Could not load</Caption>
    </div>
  )
}

function StatTiles({
  sectors,
  companies,
  onOpenFiltered,
}: {
  sectors: ResearchData<SectorResearch>
  companies: ResearchData<CompanyResearch>
  onOpenFiltered: (list: ResearchList, state: string | null) => void
}) {
  const failed = sectors.items.filter((sector) => sector.state === 'failed').length
  const inProgress = sectors.items.filter((sector) => sector.state === 'running').length
  const planned = sectors.items.filter((sector) => sector.state === 'planned').length
  const companySectors = new Set(companies.items.map((company) => company.sectorId)).size
  return (
    <div role="group" aria-label="Research totals" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {sectors.status === 'loading' ? (
        <StatTileSkeleton label="Sectors" />
      ) : sectors.status === 'ready' ? (
        <StatTile
          label="Sectors"
          value={sectors.items.length}
          caption={`${formatCount(inProgress)} in progress`}
          index={0}
          onOpen={() => onOpenFiltered('sectors', null)}
        />
      ) : (
        <StatTileError label="Sectors" onRetry={sectors.retry} />
      )}
      {companies.status === 'loading' ? (
        <StatTileSkeleton label="Companies found" />
      ) : companies.status === 'ready' ? (
        <StatTile
          label="Companies found"
          value={companies.total ?? companies.items.length}
          caption={`Across ${formatCount(companySectors)} ${companySectors === 1 ? 'sector' : 'sectors'}`}
          index={1}
          onOpen={() => onOpenFiltered('companies', null)}
        />
      ) : (
        <StatTileError label="Companies found" onRetry={companies.retry} />
      )}
      {sectors.status === 'loading' ? (
        <StatTileSkeleton label="Needs attention" />
      ) : sectors.status === 'ready' ? (
        <StatTile
          label="Needs attention"
          value={failed}
          caption="Failed or blocked research"
          index={2}
          onOpen={() => onOpenFiltered('sectors', 'failed')}
        />
      ) : (
        <StatTileError label="Needs attention" onRetry={sectors.retry} />
      )}
      {sectors.status === 'loading' ? (
        <StatTileSkeleton label="Awaiting approval" />
      ) : sectors.status === 'ready' ? (
        <StatTile
          label="Awaiting approval"
          value={planned}
          caption="Plans waiting for review"
          index={3}
          onOpen={() => onOpenFiltered('sectors', 'planned')}
        />
      ) : (
        <StatTileError label="Awaiting approval" onRetry={sectors.retry} />
      )}
    </div>
  )
}

// Skeleton rows mirror the panel rows (two-line left block, right
// cluster) so arrival does not shift layout.
function OverviewRowsSkeleton() {
  return (
    <div className="flex min-w-0 flex-col" aria-hidden>
      {['64%', '48%', '72%'].map((width, index) => (
        <div key={index} className="flex min-h-14 items-center gap-3 px-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5" style={{ width }} />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-5 w-16 rounded-sm" />
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </div>
  )
}

function SectorPanel({
  data,
  onViewAll,
  onOpenSector,
  onNewSector,
}: {
  data: ResearchData<SectorResearch>
  onViewAll: (list: ResearchList) => void
  onOpenSector: (id: string) => void
  onNewSector: () => void
}) {
  const rows = [...data.items]
    .sort((a, b) => {
      const older = new Date(a.updatedAt).getTime()
      const newer = new Date(b.updatedAt).getTime()
      return (Number.isFinite(newer) ? newer : -1) - (Number.isFinite(older) ? older : -1)
    })
    .slice(0, overviewPreviewCount)
  return (
    <SectionCard
      title="Recent sectors"
      actions={
        <Button type="button" variant="ghost" size="sm" onClick={() => onViewAll('sectors')}>
          View all
          <Icons.chevronRight aria-hidden />
        </Button>
      }
    >
      <ResourceState
        resource={{ status: data.status, refresh: data.retry }}
        label="Recent sectors"
        emptyKind={data.status === 'ready' && rows.length === 0 ? 'first' : null}
        icon={<Icons.sector aria-hidden />}
        emptyTitle="No sectors yet"
        emptyBody="Create a sector to start discovering companies."
        emptyAction={
          <Button type="button" variant="primary" size="sm" onClick={onNewSector}>
            <Icons.plus aria-hidden />
            New sector
          </Button>
        }
        skeleton={<OverviewRowsSkeleton />}
      >
        <List aria-label="Recent sectors">
          {rows.map((sector) => (
            <ListRow key={sector.id} density="comfortable" onClick={() => onOpenSector(sector.id)} className="group">
              <span className="min-w-0 flex-1 basis-40">
                <Body as="span" title={sector.name} className="block truncate font-medium">
                  {sector.name}
                </Body>
                <Description as="span" title={sector.topic} className="block truncate">
                  {sector.topic}
                </Description>
              </span>
              <span className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
                <StateBadge state={sector.state} />
                <BodySm as="span" className="text-muted-foreground">
                  <Numeric>{formatCount(sector.companiesFound)}</Numeric>{' '}
                  {sector.companiesFound === 1 ? 'company' : 'companies'}
                </BodySm>
                <Caption as="span" title={formatFullDate(sector.updatedAt)}>
                  {relativeAge(sector.updatedAt)}
                </Caption>
                <Icons.chevronRight
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground transition-transform duration-180 motion-safe:group-hover:translate-x-0.5"
                />
              </span>
            </ListRow>
          ))}
        </List>
      </ResourceState>
    </SectionCard>
  )
}

function CompanyPanel({
  data,
  onViewAll,
  onOpenSector,
  onNewSector,
}: {
  data: ResearchData<CompanyResearch>
  onViewAll: (list: ResearchList) => void
  onOpenSector: (id: string) => void
  onNewSector: () => void
}) {
  const rows = data.items.slice(0, overviewPreviewCount)
  return (
    <SectionCard
      title="Recent companies"
      actions={
        <Button type="button" variant="ghost" size="sm" onClick={() => onViewAll('companies')}>
          View all
          <Icons.chevronRight aria-hidden />
        </Button>
      }
    >
      <ResourceState
        resource={{ status: data.status, refresh: data.retry }}
        label="Recent companies"
        emptyKind={data.status === 'ready' && rows.length === 0 ? 'first' : null}
        icon={<Icons.company aria-hidden />}
        emptyTitle="No companies yet"
        emptyBody="Create a sector to start discovering companies."
        emptyAction={
          <Button type="button" variant="primary" size="sm" onClick={onNewSector}>
            <Icons.plus aria-hidden />
            New sector
          </Button>
        }
        skeleton={<OverviewRowsSkeleton />}
      >
        <List aria-label="Recent companies">
          {rows.map((company) => (
            <ListRow key={company.id} density="comfortable" onClick={() => onOpenSector(company.sectorId)} className="group">
              <span className="min-w-0 flex-1 basis-40">
                <Body as="span" title={company.name} className="block truncate font-medium">
                  {company.name}
                </Body>
                <Description as="span" title={company.sectorName} className="block truncate">
                  {company.sectorName}
                </Description>
              </span>
              <span className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
                <BodySm as="span">{companyStageLabel(company.stage)}</BodySm>
                <StageSteps stage={company.stage} />
                <StateBadge state={company.state} />
                <Icons.chevronRight
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground transition-transform duration-180 motion-safe:group-hover:translate-x-0.5"
                />
              </span>
            </ListRow>
          ))}
        </List>
      </ResourceState>
    </SectionCard>
  )
}

export function Dashboard({
  onViewAll,
  onOpenFiltered,
  onOpenSector,
  onNewSector,
  sectors,
  companies,
}: {
  onViewAll: (list: ResearchList) => void
  onOpenFiltered: (list: ResearchList, state: string | null) => void
  onOpenSector: (id: string) => void
  onNewSector: () => void
  sectors: ResearchData<SectorResearch>
  companies: ResearchData<CompanyResearch>
}) {
  return (
    <div className="flex flex-col gap-8">
      <StatTiles sectors={sectors} companies={companies} onOpenFiltered={onOpenFiltered} />
      <SectorPanel data={sectors} onViewAll={onViewAll} onOpenSector={onOpenSector} onNewSector={onNewSector} />
      <CompanyPanel data={companies} onViewAll={onViewAll} onOpenSector={onOpenSector} onNewSector={onNewSector} />
    </div>
  )
}
