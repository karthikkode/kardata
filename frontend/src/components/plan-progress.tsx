// Research plan progress: counters, work review dialog, and the plan
// progress section.
import { ResourceNotice, WorkspaceOverlay } from './workspace-parts'
import { useId, useState, type ReactNode } from 'react'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { formatCount, formatDurationMs } from '../lib/format'
import { BodySm, Caption, CardTitle, Description, Label, Numeric, SectionTitle } from './text'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { List, ListRow } from './ui/list'
import { ProgressRoot } from './ui/progress'
import { Skeleton } from './ui/skeleton'
import { Textarea } from './ui/textarea'
import { safeExternalUrl } from './Markdown'
import { ResourceState, SearchField } from './shells'
import type { Resource } from '../data/useWorkspace'
import type { ResearchProgress } from '../data/useSectors'
import { IconButton } from './IconButton'

export type WorkReview = { busy: boolean; error: string | null; clearError(): void; decide(id: string, version: number, receipt: string, decision: 'retry' | 'exclude', reason: string): Promise<boolean> }

type WorkItemState = ResearchProgress['items'][number]['state']

const workDot: Record<WorkItemState, string> = {
 pending: 'bg-border-strong',
 running: 'bg-info',
 complete: 'bg-success',
 blocked: 'bg-warning',
 failed: 'bg-danger',
 excluded: 'bg-border-strong',
}

/** Work-item state badge: only failed/blocked wear one (scannable lifecycle). */
function WorkStateBadge({ state }: { state: 'failed' | 'blocked' }) {
 return <Badge tone={state === 'failed' ? 'danger' : 'warning'}>{state === 'failed' ? 'Failed' : 'Blocked'}</Badge>
}

export function CounterTile({ label, value, tone }: { label: string; value: number | string; tone?: 'warning' | 'danger' }) {
 return (
  <div className="rounded-lg border border-border bg-card px-3 py-2">
   <Label>{label}</Label>
   <Numeric className={cn('mt-0.5 block text-md font-medium', tone === 'warning' && 'text-warning', tone === 'danger' && 'text-danger')}>{typeof value === 'number' ? formatCount(value) : value}</Numeric>
  </div>
 )
}

function ProgressSkeleton() {
 return (
  <div className="flex min-w-0 flex-col gap-4" aria-hidden>
   <div className="flex items-center justify-between gap-3">
    <Skeleton className="h-3.5 w-24" />
    <Skeleton className="h-3 w-20" />
   </div>
   <Skeleton className="h-1.5 w-full rounded-full" />
   <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {[0, 1, 2, 3].map((index) => (
     <div key={index} className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-5 w-8" />
     </div>
    ))}
   </div>
   <Skeleton className="h-10 w-full rounded-md" />
   {[0, 1, 2].map((index) => (
    <div key={index} className="flex min-h-11 items-center gap-3 px-2">
     <Skeleton className="size-2 shrink-0 rounded-full" />
     <Skeleton className="h-3.5 min-w-0 flex-1" />
     <Skeleton className="h-5 w-16 rounded-sm" />
    </div>
   ))}
  </div>
 )
}

function ReviewNotice({ tone, children }: { tone: 'warning' | 'danger'; children: ReactNode }) {
 const Icon = tone === 'warning' ? Icons.alertWarning : Icons.alertError
 return (
  <div role="alert" className={cn('flex gap-2 rounded-md border p-3', tone === 'warning' ? 'border-warning-border bg-warning-soft' : 'border-danger-border bg-danger-soft')}>
   <span className="flex h-5 shrink-0 items-center">
    <Icon aria-hidden className={cn('size-4', tone === 'warning' ? 'text-warning' : 'text-danger')} />
   </span>
   <BodySm as="span" className="min-w-0 flex-1">{children}</BodySm>
  </div>
 )
}

function capitalize(value: string): string {
 return value.charAt(0).toUpperCase() + value.slice(1)
}

function isHttpUrl(value: string): boolean {
 return value.startsWith('http://') || value.startsWith('https://')
}

interface WorkReviewSelection {
 item: ResearchProgress['items'][number]
 version: number
}

/** Intake review dialog (PL-09, shared with SL-04): candidate evidence on
 * the left, the owner's decision on the right. */
function WorkReviewDialog({
 open, onClose, selected, latest, stale, safe, resource, review, reason, onReasonChange, onReviewLatest, onDecided,
}: {
 open: boolean
 onClose(): void
 selected: WorkReviewSelection | null
 latest: ResearchProgress['items'][number] | undefined
 stale: boolean
 safe: boolean
 resource: Resource<ResearchProgress>
 review: WorkReview
 reason: string
 onReasonChange(value: string): void
 onReviewLatest(item: ResearchProgress['items'][number]): void
 onDecided(): void
}) {
 const baseId = useId()
 const reasonId = `${baseId}-reason`
 const countId = `${baseId}-reason-count`
 const item = selected?.item
 const version = selected?.version ?? 0
 const candidateHref = `/?section=SectorChat&sector=${encodeURIComponent(resource.data?.sectorId ?? '')}${item?.childId ? `&thread=${encodeURIComponent(`agent:${item.childId}`)}` : ''}`
 const decidable = Boolean(item && item.receiptVersion && ['blocked', 'failed'].includes(item.state) && reason.trim() && !review.busy && safe && !stale)

 async function decide(decision: 'retry' | 'exclude'): Promise<void> {
  if (!item || !item.receiptVersion) return
  if (await review.decide(item.id, version, item.receiptVersion, decision, reason.trim())) onDecided()
 }

 return (
  <WorkspaceOverlay title="Review candidate intake" size="large" open={open} onClose={onClose}>
   {item ? (
    <div className="grid gap-6 md:grid-cols-2">
     <section aria-label="Candidate" className="min-w-0 space-y-3">
      <div>
       <CardTitle>{item.title}</CardTitle>
       <Caption className="mt-1 tabular-nums">
        Plan v{version} · {capitalize(item.state)} · {item.attempts} {item.attempts === 1 ? 'attempt' : 'attempts'}
       </Caption>
      </div>
      <Description>{item.detail || 'No reason recorded.'}</Description>
      {item.sourceUrl ? (
       <div>
        <Button type="button" variant="link" render={<a href={safeExternalUrl(item.sourceUrl)} target="_blank" rel="noopener noreferrer" />}>
         Open source
         <Icons.openExternal className="size-3.5" aria-hidden />
        </Button>
       </div>
      ) : null}
      <Caption>Fetched quotes remain in the saved intake report in Files and the candidate child conversation.</Caption>
      <div>
       <Button type="button" variant="link" render={<a href={candidateHref} target="_blank" rel="noopener noreferrer" />}>
        {item.childId ? 'Open candidate conversation and Files' : 'Open research workspace Files'}
        <Icons.openExternal className="size-3.5" aria-hidden />
       </Button>
      </div>
      <section aria-label="Saved intake evidence" className="space-y-2">
       <Label>Saved evidence</Label>
       {item.evidence.length > 0 ? (
        <List>
         {item.evidence.map((entry, index) =>
          isHttpUrl(entry) ? (
           <ListRow key={`${index}:${entry}`} density="dense" href={safeExternalUrl(entry)} target="_blank" rel="noopener noreferrer">
            <Icons.openExternal aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <BodySm as="span" className="min-w-0 flex-1 truncate">{entry}</BodySm>
           </ListRow>
          ) : (
           <ListRow key={`${index}:${entry}`} density="dense">
            <Icons.openExternal aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <BodySm as="span" className="min-w-0 flex-1 [overflow-wrap:anywhere]">{entry}</BodySm>
           </ListRow>
          ),
         )}
        </List>
       ) : (
        <Caption>No validated evidence recorded for this candidate.</Caption>
       )}
      </section>
      <Caption>Exclude resolves this candidate only. Retry keeps its identity, attempts and budget usage. Source receipts and history remain saved. Scope, acceptance and budgets require plan approval.</Caption>
     </section>
     <section aria-label="Decision" className="min-w-0 space-y-3">
      <div className="flex flex-col gap-1.5">
       <Label as="label" htmlFor={reasonId}>Owner reason</Label>
       <Textarea id={reasonId} value={reason} onChange={(event) => onReasonChange(event.target.value)} maxLength={4000} rows={4} aria-describedby={countId} />
       <Caption id={countId} className="tabular-nums">{reason.length} / 4000</Caption>
      </div>
      <ResourceNotice resource={resource} label="Current work receipt" />
      {stale ? <ReviewNotice tone="warning">Work changed. Your reason is kept; review the latest receipt before deciding.</ReviewNotice> : null}
      {!safe ? <ReviewNotice tone="warning">Pause research and wait for the candidate child to stop before deciding.</ReviewNotice> : null}
      {review.error ? <ReviewNotice tone="danger">{review.error}</ReviewNotice> : null}
      <div className="flex flex-wrap gap-2">
       <Button type="button" variant="primary" pending={review.busy} disabled={!decidable} onClick={() => void decide('retry')}>Retry candidate</Button>
       <Button type="button" variant="secondary" disabled={!decidable} onClick={() => void decide('exclude')}>Exclude candidate</Button>
       <Button type="button" variant="ghost" size="sm" disabled={review.busy} onClick={() => resource.refresh()}>Reload latest</Button>
       {stale && latest ? (
        <Button type="button" variant="secondary" size="sm" disabled={review.busy} onClick={() => onReviewLatest(latest)}>Review latest receipt</Button>
       ) : null}
      </div>
     </section>
    </div>
   ) : null}
  </WorkspaceOverlay>
 )
}

export function PlanProgress({ resource, review }: { resource: Resource<ResearchProgress>; review?: WorkReview }) {
 const [selected, setSelected] = useState<{ item: ResearchProgress['items'][number]; version: number } | null>(null)
 const [reason, setReason] = useState('')
 const [search, setSearch] = useState('')
 const [limit, setLimit] = useState(50)
 const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
 const latest = resource.data?.items.find((item) => item.id === selected?.item.id)
 const stale = selected !== null && (selected.version !== resource.data?.planVersion || latest?.receiptVersion !== selected.item.receiptVersion)
 const safe = resource.status === 'ready' && Boolean(resource.data && ['paused','failed'].includes(resource.data.state))
 const data = resource.status === 'ready' ? resource.data : undefined
 const terminalWithoutLedger = Boolean(data && ['complete', 'failed'].includes(data.state) && data.items.length === 0)
 const rows = data?.items.filter((item) => `${item.title} ${item.detail}`.toLowerCase().includes(search.toLowerCase())) ?? []
 const completed = data?.items.filter((item) => item.state === 'complete').length ?? 0
 const running = data?.items.filter((item) => item.state === 'running').length ?? 0
 const attention = data?.items.filter((item) => item.state === 'blocked' || item.state === 'failed').length ?? 0
 const excluded = data?.items.filter((item) => item.state === 'excluded').length ?? 0

 function toggleExpanded(id: string): void {
   setExpanded((current) => {
     const next = new Set(current)
     if (next.has(id)) next.delete(id)
     else next.add(id)
     return next
   })
 }

 function openReview(item: ResearchProgress['items'][number]): void {
   if (!review || !data) return
   setSelected({ item, version: data.planVersion })
   setReason('')
   review.clearError()
 }
 return (
  <section aria-label="Research progress" className="flex min-w-0 flex-col gap-4">
   <ResourceState resource={resource} label="Research progress" skeleton={<ProgressSkeleton />}>
    {data ? (
     <>
      <div className="flex flex-wrap items-center justify-between gap-2">
       <SectionTitle>Progress</SectionTitle>
       <Caption className={cn('tabular-nums', data.state === 'failed' && 'text-danger')}>
        {data.state === 'complete' ? 'Finished' : data.state === 'failed' ? 'Stopped' : data.estimatedPercent !== null ? `${data.estimatedPercent}% estimated` : 'Not estimated yet'}
       </Caption>
      </div>
      {data.estimatedPercent !== null ? (
       <ProgressRoot aria-label="Estimated completion" max={100} value={data.estimatedPercent} />
      ) : null}
      <div role="group" aria-label="Work counters" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
       <CounterTile label="Completed" value={completed} />
       <CounterTile label="Running" value={running} />
       <CounterTile label="Needs attention" value={attention} tone={attention > 0 ? 'warning' : undefined} />
       <CounterTile label="Excluded" value={excluded} />
      </div>
      {data.budgetUsedMs !== undefined ? (
       <Caption className="tabular-nums">{formatDurationMs(data.budgetUsedMs)} active time across runs</Caption>
      ) : null}
      {data.items.length > 0 ? (
       <>
        <div className="flex flex-col gap-2">
         <SearchField value={search} onChange={(value) => { setSearch(value); setLimit(50) }} label="Search work items" />
         <Caption aria-live="polite" className="tabular-nums">
          Showing {formatCount(Math.min(limit, rows.length))} of {formatCount(rows.length)} work items
         </Caption>
        </div>
        {rows.length > 0 ? (
         <List aria-label="Work items">
          {rows.slice(0, limit).map((item) => {
           const open = expanded.has(item.id)
           return (
            <ListRow key={item.id} density="default" className="items-start">
             <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', workDot[item.state])} />
             <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
               <BodySm as="span" className="min-w-0 flex-1 [overflow-wrap:anywhere]">{item.title}</BodySm>
               {item.state === 'failed' || item.state === 'blocked' ? <WorkStateBadge state={item.state} /> : null}
              </span>
              {item.detail ? (
               <Description as="span" className={cn('mt-0.5 block [overflow-wrap:anywhere]', !open && 'line-clamp-1')}>
                {item.detail}
               </Description>
              ) : null}
             </span>
             <span className="flex shrink-0 items-center gap-1">
              {review && item.kind === 'discovery' && item.id.includes(':intake:') && ['blocked', 'failed'].includes(item.state) && item.receiptVersion ? (
               <Button type="button" variant="secondary" size="sm" onClick={() => openReview(item)}>Review</Button>
              ) : null}
              {item.sourceUrl ? (
               <IconButton label="Open source" size="icon-sm" render={<a href={safeExternalUrl(item.sourceUrl)} target="_blank" rel="noopener noreferrer" />}>
                <Icons.openExternal className="size-4" aria-hidden />
               </IconButton>
              ) : null}
              {item.detail ? (
               <IconButton label={open ? 'Hide details' : 'Show details'} size="icon-sm" aria-expanded={open} onClick={() => toggleExpanded(item.id)}>
                <Icons.chevronDown className={cn('size-4 transition-transform duration-180', open && 'rotate-180')} aria-hidden />
               </IconButton>
              ) : null}
             </span>
            </ListRow>
           )
          })}
         </List>
        ) : (
         <div className="flex min-w-0 flex-col items-center py-6 text-center">
          <CardTitle>No matching work items.</CardTitle>
          <Description className="mt-1 max-w-80">Try a different search.</Description>
          <div className="mt-4">
           <Button type="button" variant="ghost" size="sm" onClick={() => { setSearch(''); setLimit(50) }}>Clear search</Button>
          </div>
         </div>
        )}
        {rows.length > limit ? (
         <div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setLimit((value) => value + 50)}>Show more</Button>
         </div>
        ) : null}
       </>
      ) : (
       <div className="flex min-w-0 flex-col items-center py-12 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted">
         <Icons.inbox aria-hidden className="size-5 text-muted-foreground" />
        </span>
        <CardTitle className="mt-3">{terminalWithoutLedger ? 'No work ledger for this run' : 'No work items yet'}</CardTitle>
        <Description className="mt-1 max-w-80">
         {terminalWithoutLedger ? 'No work-item ledger was recorded for this run. Saved companies and conversations remain available.' : 'Work items appear when the approved research starts.'}
        </Description>
       </div>
      )}
     </>
    ) : null}
   </ResourceState>
   {review ? (
    <WorkReviewDialog
     open={selected !== null}
     onClose={() => { if (!review.busy) setSelected(null) }}
     selected={selected}
     latest={latest}
     stale={stale}
     safe={safe}
     resource={resource}
     review={review}
     reason={reason}
     onReasonChange={setReason}
     onReviewLatest={(item) => {
       if (!resource.data) return
       setSelected({ item, version: resource.data.planVersion })
       review.clearError()
     }}
     onDecided={() => { setSelected(null); setReason('') }}
    />
   ) : null}
  </section>
 )
}
