import type { ReactNode } from 'react'
import type {
  CompanyResearch,
  ResearchData,
  SectorResearch,
} from '../data/research'
import { Mail } from 'lucide-react'
import {
  CompanyRow,
  DeniedNotice,
  firstRunCopy,
  PanelError,
  SectorRow,
  SkeletonRows,
  UnavailableNotice,
} from './research-parts'
import { Button } from './ui/button'
import { SectionCard } from './shells'

// Email tracking has no backend yet, so the stats strip is a neutral
// placeholder with no numbers and no sample rows.
function StatsPanel() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-background p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />        Email tracking is not connected yet.
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Scheduled, sent, and reply counts will appear here once email tracking lands.
      </p>
    </div>
  )
}

function FilteredEmpty({
  message,
  onClearSearch,
}: {
  message: string
  onClearSearch: () => void
}) {
  return (
    <div className="mt-2 rounded-lg border border-dashed border-border p-4">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onClearSearch}
        className="mt-3"
      >
        Clear search
      </Button>
    </div>
  )
}

// First visit, no rows yet: same dashed container as FilteredEmpty, but
// the action starts the only path to research (a sector draft on the
// Researches page). Companies cannot start standalone (they fall out of
// sector runs), so both panels point at the same action.
function FirstRun({ message, actionLabel, onAction }: { message: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="mt-2 rounded-lg border border-dashed border-border p-4">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button type="button" variant="default" size="sm" onClick={onAction} className="mt-3">
        {actionLabel}
      </Button>
    </div>
  )
}

export type ResearchList = 'sectors' | 'companies'

// Landing shows a fixed preview count. Newest first; the full list lives on
// the Researches page behind the View-all button.
const landingPreviewCount = 5

function SectorPanel({
  data,
  query,
  onClearSearch,
  onViewAll,
  onOpenSector,
}: {
  data: ResearchData<SectorResearch>
  query: string
  onClearSearch: () => void
  onViewAll: (list: ResearchList) => void
  onOpenSector: (id: string) => void
}) {
  const needle = query.trim().toLowerCase()
  const filtered = data.items.filter(
    (item) =>
      !needle || `${item.name} ${item.topic}`.toLowerCase().includes(needle),
  )
  const rows = filtered.slice(0, landingPreviewCount)
  let body: ReactNode
  if (data.status === 'loading') {
    body = <SkeletonRows label="Sector researches are loading" />
  } else if (data.status === 'error') {
    body = (
      <PanelError
        heading="Sector researches did not load."
        detail="Check your connection and try again."
        onRetry={data.retry}
      />
    )
  } else if (data.status === 'denied') {
    body = <DeniedNotice heading="Sector researches are not shared with this key." />
  } else if (data.status === 'offline') {
    body = <UnavailableNotice onRetry={data.retry} />
  } else if (rows.length) {
    body = (
      <ul>
        {rows.map((research) => (
          <SectorRow
            key={research.id}
            research={research}
            onOpen={onOpenSector}
          />
        ))}
      </ul>
    )
  } else if (needle) {
    body = (
      <FilteredEmpty
        message="No sector researches match this search. Clear it to see everything."
        onClearSearch={onClearSearch}
      />
    )
  } else {
    body = (
      <FirstRun
        message={firstRunCopy.sectors}
        actionLabel="Start a sector research"
        onAction={() => onViewAll('sectors')}
      />
    )
  }
  const showCount = data.status === 'ready' && (needle || filtered.length > rows.length)
  return (
    <SectionCard
      title="Sector researches"
      metadata={
        showCount ? (
          <p aria-live="polite" className="shrink-0 text-xs text-muted-foreground">
            Showing {rows.length} of {filtered.length} matching
          </p>
        ) : undefined
      }
      footer={
        data.items.length > 0 ? (
          <div className="mt-auto ml-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onViewAll('sectors')}
            >
              View all {data.items.length} sector researches
            </Button>
          </div>
        ) : undefined
      }
    >
      {body}
    </SectionCard>
  )
}

function CompanyPanel({
  data,
  query,
  onClearSearch,
  onViewAll,
}: {
  data: ResearchData<CompanyResearch>
  query: string
  onClearSearch: () => void
  onViewAll: (list: ResearchList) => void
}) {
  const needle = query.trim().toLowerCase()
  const filtered = data.items.filter(
    (item) =>
      !needle ||
      `${item.name} ${item.sectorName}`.toLowerCase().includes(needle),
  )
  const rows = filtered.slice(0, landingPreviewCount)
  let body: ReactNode
  if (data.status === 'loading') {
    body = <SkeletonRows label="Company researches are loading" />
  } else if (data.status === 'error') {
    body = (
      <PanelError
        heading="Company researches did not load."
        detail="Check your connection and try again."
        onRetry={data.retry}
      />
    )
  } else if (data.status === 'denied') {
    body = <DeniedNotice heading="Company researches are not shared with this key." />
  } else if (data.status === 'offline') {
    body = <UnavailableNotice onRetry={data.retry} />
  } else if (rows.length) {
    body = (
      <ul>
        {rows.map((research) => (
          <CompanyRow key={research.id} research={research} />
        ))}
      </ul>
    )
  } else if (needle) {
    body = (
      <FilteredEmpty
        message="No company researches match this search. Clear it to see everything."
        onClearSearch={onClearSearch}
      />
    )
  } else {
    body = (
      <FirstRun
        message={firstRunCopy.companies}
        actionLabel="Start a sector research"
        onAction={() => onViewAll('sectors')}
      />
    )
  }
  const showCount = data.status === 'ready' && (needle || filtered.length > rows.length)
  const total = data.total ?? data.items.length
  const windowed = total > data.items.length
  return (
    <SectionCard
      title="Company researches"
      metadata={
        showCount ? (
          <p aria-live="polite" className="shrink-0 text-xs text-muted-foreground">
            {needle && windowed
              ? `Showing ${rows.length} of ${filtered.length} matching in the loaded ${data.items.length} of ${total}`
              : `Showing ${rows.length} of ${filtered.length} matching`}
          </p>
        ) : undefined
      }
      footer={
        data.items.length > 0 ? (
          <div className="mt-auto ml-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onViewAll('companies')}
            >
              View all {total} company researches
            </Button>
          </div>
        ) : undefined
      }
    >
      {body}
    </SectionCard>
  )
}

export function Dashboard({
  query,
  onClearSearch,
  onViewAll,
  onOpenSector,
  sectors,
  companies,
}: {
  query: string
  onClearSearch: () => void
  onViewAll: (list: ResearchList) => void
  onOpenSector: (id: string) => void
  sectors: ResearchData<SectorResearch>
  companies: ResearchData<CompanyResearch>
}) {
  return (
    <div className="space-y-6">
      <StatsPanel />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectorPanel
          data={sectors}
          query={query}
          onClearSearch={onClearSearch}
          onViewAll={onViewAll}
          onOpenSector={onOpenSector}
        />
        <CompanyPanel
          data={companies}
          query={query}
          onClearSearch={onClearSearch}
          onViewAll={onViewAll}
        />
      </div>
    </div>
  )
}
