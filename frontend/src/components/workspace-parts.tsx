import { FileProcessingStatus } from './FileProcessingStatus'
import { FileTypeIcon } from './FileTypeIcon'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { formatCount, formatDurationMs, humanizeKey, relativeAge } from '../lib/format'
import { fileStatusLabel } from '../lib/labels'
import { focusRingInset } from '../lib/interaction'
import { notify } from '../lib/toast'
import { BodySm, Caption, CardTitle, Description, Label, Numeric, Overline, SectionTitle } from './text'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { CheckboxRoot } from './ui/checkbox'
import { CollapsiblePanel, CollapsibleRoot, CollapsibleTrigger } from './ui/collapsible'
import { FieldControl, FieldDescription, FieldLabel, FieldRoot } from './ui/field'
import { List, ListRow, listRowClassName } from './ui/list'
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from './ui/menu'
import { PopoverPopup, PopoverRoot, PopoverTitle, PopoverTrigger } from './ui/popover'
import { ProgressRoot } from './ui/progress'
import { Skeleton } from './ui/skeleton'
import { Textarea } from './ui/textarea'
import {
 DialogBody,
 DialogClose,
 DialogFooter,
 DialogHeader,
 DialogPopup,
 DialogRoot,
 DialogTitle,
} from './ui/dialog'
import { Markdown, safeExternalUrl } from './Markdown'
import { ResourceState, SearchField } from './shells'
import { EXIT_MS, prefersReducedMotion } from '../lib/motion'
import { useTopmostOverlay } from '../lib/overlay'
import type { Resource } from '../data/useWorkspace'
import type { ContextChange, ContextFileBlock, ContextPreview, GlobalContext, GlobalContextUsage, LibraryFile, LocalContext, OperationReceipt, ResearchProgress, Sections } from '../data/workspace-api'
import { IconButton } from './IconButton'
import { ConfirmAction } from './ui/alert-dialog'

export function WorkspaceOverlay({ title, titleBadge, children, onClose, side = false, footer, open = true, size = 'default', popupClassName, initialFocus }: { title: string; titleBadge?: ReactNode; children: ReactNode; onClose(): void; side?: boolean; footer?: ReactNode; open?: boolean; size?: 'default' | 'large' | 'small'; popupClassName?: string; initialFocus?: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null> }) {
 // Single overlay ownership: the shared dialog owns the focus trap, Esc,
 // and trigger restoration. The root stays mounted through a controlled
 // closing so Base UI can retain and animate the exiting popup before
 // unmounting; content freezes at close-start so the exit never plays on
 // emptied state, and reopening during the exit cancels the stale
 // unmount. No independent close timer runs alongside it. The topmost
 // guard keeps one Escape from dismissing two sibling overlays (e.g. the
 // inspector above local context).
 const topmost = useTopmostOverlay(open)
 const [visible, setVisible] = useState(open)
 const content = useRef({ title, titleBadge, children, footer })
 // Adjust state during render (not in an effect): reopening shows at
 // once with fresh content, and the exit keeps playing on the frozen
 // close-start content instead of emptied state. The ref below is
 // written before it is read in the same commit and never leaves this
 // component, so the render-phase access is idempotent and StrictMode
 // safe (same exemption shape as the exhaustive-deps disables elsewhere).
 if (open) {
 // eslint-disable-next-line react-hooks/refs
 content.current = { title, titleBadge, children, footer }
 if (!visible) setVisible(true)
 }
 useEffect(() => {
 if (open || !visible) return
 const timer = window.setTimeout(() => setVisible(false), prefersReducedMotion() ? 0 : EXIT_MS)
 return () => window.clearTimeout(timer)
 }, [open, visible])
 // eslint-disable-next-line react-hooks/refs -- frozen at close-start above
 const shown = open ? { title, titleBadge, children, footer } : content.current
 if (!visible) return null
 return (
 <DialogRoot open={open} onOpenChange={(next) => { if (!next) topmost.guard(onClose) }}>
 <DialogPopup side={side} {...(initialFocus ? { initialFocus } : {})} className={popupClassName ?? (side ? undefined : size === 'large' ? 'w-[min(92vw,880px)] max-w-220' : size === 'small' ? 'w-[min(92vw,480px)] max-w-120' : 'w-[min(92vw,720px)] max-w-2xl')}>
 <DialogHeader>
 <div className="flex min-w-0 flex-1 items-center gap-2">
 <DialogTitle>{shown.title}</DialogTitle>
 {shown.titleBadge}
 </div>
 <DialogClose aria-label={`Close ${shown.title}`} />
 </DialogHeader>
 <DialogBody>{shown.children}</DialogBody>
 {shown.footer ? <DialogFooter>{shown.footer}</DialogFooter> : null}
 </DialogPopup>
 </DialogRoot>
 )
}
export function ResourceNotice({ resource, label, hideTitle, skeleton }: { resource: Resource<unknown>; label: string; hideTitle?: boolean; skeleton?: ReactNode }) {
 // Single ownership: every async resource renders through the shared
 // ResourceState. Copy and roles are preserved exactly.
 return <ResourceState resource={resource} label={label} hideTitle={hideTitle} skeleton={skeleton} />
}
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

export interface WorkReviewSelection {
 item: ResearchProgress['items'][number]
 version: number
}

/** Intake review dialog (PL-09, shared with SL-04): candidate evidence on
 * the left, the owner's decision on the right. */
export function WorkReviewDialog({
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
const CONTEXT_SECTION_LABELS = { scope: 'Scope', instructions: 'Instructions', decisions: 'Decisions', findings: 'Findings', questions: 'Open questions' } as const
type ContextSectionKey = keyof typeof CONTEXT_SECTION_LABELS
const CONTEXT_SECTION_HELPERS: Record<ContextSectionKey, string> = {
  scope: 'What this sector covers, and what stays out.',
  instructions: 'How agents should work, for example what to focus on or avoid.',
  decisions: 'Owner rulings the agents must follow.',
  findings: 'Established facts from finished research.',
  questions: 'Open questions for later research.',
}

function changeKind(change: ContextChange): string {
  if (change.fileRef) return 'File context inclusion'
  if (change.sourceRefs?.length) return 'File-derived context update'
  return 'Shared context update'
}

function changeTone(change: ContextChange): 'success' | 'danger' | 'warning' {
  if (change.state === 'approved') return 'success'
  if (change.state === 'denied') return 'danger'
  return 'warning'
}

/** One context section (GC-02/GC-05): overline label plus compact markdown,
 * clamped with an expander when long. */
function ContextSection({ label, text }: { label: string; text: string }) {
  const [expanded, setExpanded] = useState(false)
  if (!text) {
    return (
      <div>
        <Overline>{label}</Overline>
        <Caption className="mt-1">Not set yet</Caption>
      </div>
    )
  }
  const long = text.length > 300
  return (
    <div>
      <Overline>{label}</Overline>
      <div className={cn('mt-1 min-w-0', !expanded && long && 'line-clamp-6')}>
        <Markdown text={text} variant="section" />
      </div>
      {long ? <Button type="button" variant="ghost" size="sm" aria-label={`${expanded ? 'Show less' : 'Show more'} ${label}`} onClick={() => setExpanded((value) => !value)}>{expanded ? 'Show less' : 'Show more'}</Button> : null}
    </div>
  )
}

function ContextFileBlockRow({ block, busy, onSummarize, onRemove }: { block: ContextFileBlock; busy: boolean; onSummarize?(id: string): void; onRemove?(id: string): void }) {
  const [expanded, setExpanded] = useState(false)
  const ready = block.state === 'ready'
  return (
    <li>
      <div data-list-row="" className={cn('group', listRowClassName({ density: 'comfortable', interactive: false }), 'flex-col items-stretch gap-0 py-2')}>
        <div className="flex min-w-0 items-start gap-1">
          <button
            type="button"
            aria-label={`${block.filename}, ${block.state === 'legacy' ? 'needs summary' : block.state}`}
            aria-expanded={ready ? expanded : undefined}
            disabled={!ready}
            onClick={() => setExpanded((value) => !value)}
            className={cn('flex min-w-0 flex-1 items-start gap-3 rounded-md px-2 py-1 text-left outline-none', focusRingInset, ready && 'cursor-pointer')}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken">
              <FileTypeIcon filename={block.filename} aria-hidden className="size-4 text-muted-foreground" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-2">
                <BodySm as="span" className="min-w-0 flex-1 truncate font-medium">{block.filename}</BodySm>
                {block.state === 'summarizing' ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Icons.loading aria-hidden className="size-4 text-muted-foreground motion-safe:animate-spin" />
                    <Badge tone="info">Summarizing</Badge>
                  </span>
                ) : null}
                {block.state === 'failed' ? <Badge tone="danger" className="shrink-0">Failed</Badge> : null}
                {block.state === 'legacy' ? <Badge tone="warning" className="shrink-0">Needs summary</Badge> : null}
              </span>
              <Caption as="span" className="mt-0.5 block truncate tabular-nums">
                {ready ? `${formatCount(block.tokens)} tokens` : block.state === 'failed' ? (block.error || 'Summary failed') : block.state === 'legacy' ? 'Not summarized yet' : 'Writing summary'}
              </Caption>
            </span>
          </button>
          <span className="flex shrink-0 items-center gap-1">
            {block.state === 'failed' ? <Button type="button" variant="ghost" size="sm" disabled={busy || !onSummarize} onClick={() => onSummarize?.(block.fileId)}>Retry</Button> : null}
            {block.state === 'legacy' ? <Button type="button" variant="ghost" size="sm" disabled={busy || !onSummarize} onClick={() => onSummarize?.(block.fileId)}>Summarize</Button> : null}
            {onRemove ? (
              <IconButton label={`Remove ${block.filename} from global context`} size="icon-sm" disabled={busy} onClick={() => onRemove(block.fileId)}>
                <Icons.delete className="size-4" aria-hidden />
              </IconButton>
            ) : null}
          </span>
        </div>
        {ready && expanded ? <div className="min-w-0 py-1 pr-2 pl-15"><Markdown text={block.summary} variant="compact" /></div> : null}
      </div>
    </li>
  )
}

function ContextUsageBar({ usage, files }: { usage: GlobalContextUsage; files: ContextFileBlock[] }) {
  const ratio = usage.budget > 0 ? usage.total / usage.budget : 0
  const tone = ratio >= 1 ? '[&_[data-slot=progress-indicator]]:bg-danger' : ratio >= 0.7 ? '[&_[data-slot=progress-indicator]]:bg-warning' : ''
  const names = new Map(files.map((file) => [file.fileId, file.filename]))
  return (
    <PopoverRoot>
      <PopoverTrigger aria-label={`Global context token usage: ${formatCount(usage.total)} of ${formatCount(usage.budget)} tokens. Show breakdown.`} className="block w-full rounded-md text-left outline-none">
        <Caption as="span" className="block"><Numeric>{formatCount(usage.total)} of {formatCount(usage.budget)} tokens</Numeric></Caption>
        <ProgressRoot value={Math.min(100, ratio * 100)} max={100} aria-hidden className={cn('mt-1', tone)} />
      </PopoverTrigger>
      <PopoverPopup>
        <PopoverTitle>Token usage</PopoverTitle>
        <List aria-label="Token usage breakdown" className="mt-2">
          {(Object.keys(CONTEXT_SECTION_LABELS) as ContextSectionKey[]).map((key) => (
            <ListRow key={key} density="dense">
              <BodySm as="span" className="min-w-0 flex-1 truncate">{CONTEXT_SECTION_LABELS[key]}</BodySm>
              <Numeric className="shrink-0">{formatCount(usage.bySection[key])}</Numeric>
            </ListRow>
          ))}
          {usage.byFile.map((file) => (
            <ListRow key={file.fileId} density="dense">
              <BodySm as="span" title={names.get(file.fileId) ?? file.fileId} className="min-w-0 flex-1 truncate">{names.get(file.fileId) ?? file.fileId}</BodySm>
              <Numeric className="shrink-0">{formatCount(file.tokens)}</Numeric>
            </ListRow>
          ))}
        </List>
      </PopoverPopup>
    </PopoverRoot>
  )
}

export function GlobalContextPanel({ resource, preview, busy, error, onReview, onSave, onDecision, onSummarize, onRemove, onCompact, onRestore, onRewrite, onCopied }: { resource: Resource<GlobalContext>; preview: Resource<ContextPreview>; busy: boolean; error?: string | null; onReview(id: string | null): void; onSave(sections: Sections, version: number): Promise<boolean>; onDecision(id: string, approve: boolean): Promise<boolean>; onSummarize?(id: string): void; onRemove?(id: string): void; onCompact?(): void; onRestore?(version: number): Promise<boolean>; onRewrite?(instruction: string): Promise<boolean>; onCopied?(): void }) {
  const [editor, setEditor] = useState(false), [history, setHistory] = useState(false), [proposal, setProposal] = useState<string | null>(null)
  const [restoreVersion, setRestoreVersion] = useState<number | null>(null)
  const [rewriteOpen, setRewriteOpen] = useState(false)
  const [rewriteDraft, setRewriteDraft] = useState('')
  const [viewerOpen, setViewerOpen] = useState(false)
  const pending = resource.data?.changes.filter((change) => change.state === 'pending' || change.state === 'parent-review') ?? []
  const [editContext, setEditContext] = useState<GlobalContext | null>(null)
  if (editor && !resource.data) { setEditor(false); setEditContext(null) }
  const data = resource.status === 'ready' ? resource.data : undefined
  return (
  <section aria-label="Global context" className="flex min-h-0 flex-1 flex-col">
  <div className="flex shrink-0 items-center gap-1 border-b border-border-subtle px-4 py-3">
    <SectionTitle className="min-w-0 flex-1">Global context</SectionTitle>
    {data ? <Caption as="span" className="shrink-0 tabular-nums">v{data.version}</Caption> : null}
    <IconButton label="Context history" size="icon-sm" disabled={!data} onClick={() => setHistory(true)}><Icons.history className="size-4" aria-hidden /></IconButton>
    <IconButton label="Open full view" size="icon-sm" disabled={!data} onClick={() => setViewerOpen(true)}><Icons.openExternal className="size-4" aria-hidden /></IconButton>
    <IconButton label="Edit global context" size="icon-sm" disabled={!data} onClick={() => { setEditContext(data ?? null); setEditor(true) }}><Icons.edit className="size-4" aria-hidden /></IconButton>
    {data && (onCompact || onRewrite) ? (
      <MenuRoot>
        <MenuTrigger
          render={
            <IconButton label="Global context options" size="icon-sm">
              <Icons.moreActions className="size-4" aria-hidden />
            </IconButton>
          }
        />
        <MenuPopup>
          {onCompact ? (
            <MenuItem disabled={busy} onClick={() => onCompact()}>
              <Icons.minimize aria-hidden />
              Compact now
            </MenuItem>
          ) : null}
          {onRewrite ? (
            <MenuItem disabled={busy} onClick={() => { setRewriteDraft(''); setRewriteOpen(true) }}>
              <Icons.edit aria-hidden />
              Rewrite with a direction…
            </MenuItem>
          ) : null}
        </MenuPopup>
      </MenuRoot>
    ) : null}
  </div>
  {data ? <div className="shrink-0 border-b border-border-subtle px-4 py-2"><ContextUsageBar usage={data.usage} files={data.files} /></div> : null}
  <div className="scroll-slim min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
    <ResourceNotice resource={resource} label="Global context" />
    {data ? (
      <>
        <div className="space-y-4">
          {(Object.keys(CONTEXT_SECTION_LABELS) as ContextSectionKey[]).map((key) => (
            <ContextSection key={key} label={CONTEXT_SECTION_LABELS[key]} text={data.sections[key]} />
          ))}
        </div>
        <div>
          <Overline>Files</Overline>
          {data.files.length ? (
            <List aria-label="Context files" className="mt-1">
              {data.files.map((block) => (
                <ContextFileBlockRow key={block.fileId} block={block} busy={busy} onSummarize={onSummarize} onRemove={onRemove} />
              ))}
            </List>
          ) : (
            <Caption className="mt-1">No files in global context yet</Caption>
          )}
        </div>
        {pending.length ? (
          <div className="space-y-2">
            <div role="note" className="flex gap-2 rounded-md border border-warning-border bg-warning-soft p-3">
              <span className="flex h-5 shrink-0 items-center"><Icons.alertWarning aria-hidden className="size-4 text-warning" /></span>
              <BodySm as="span" className="min-w-0 flex-1">{pending.length} {pending.length === 1 ? 'update' : 'updates'} waiting for review</BodySm>
            </div>
            <List aria-label="Pending context updates">
              {pending.map((change) => (
                <li key={change.id} className="flex items-center gap-2 py-1">
                  <div className="min-w-0 flex-1">
                    <BodySm as="span" className="block truncate">{changeKind(change)}</BodySm>
                    <Caption as="span" className="block truncate">by {change.author}</Caption>
                  </div>
                  <Button type="button" variant="ghost" size="sm" aria-label={`Review ${changeKind(change)}`} onClick={() => { setProposal(change.id); onReview(change.id) }}>Review</Button>
                </li>
              ))}
            </List>
          </div>
        ) : null}
      </>
    ) : null}
  </div>
  <WorkspaceOverlay title="Edit global context" open={editor && editContext !== null} onClose={() => setEditor(false)}>
    {editor && editContext ? <ContextEditor key={editContext.version} sections={editContext.sections} baseVersion={editContext.version} currentVersion={data?.version} busy={busy} error={error} onSave={async (sections) => { if (await onSave(sections, editContext.version)) setEditor(false) }} onClose={() => setEditor(false)} /> : null}
  </WorkspaceOverlay>
  <WorkspaceOverlay title="Context history" open={history && data !== undefined} onClose={() => setHistory(false)}>
    {history && data ? (
      data.changes.length ? (
        <ol aria-label="Context revisions" className="space-y-3">
          {data.changes.map((change) => (
            <li key={change.id} className="rounded-lg border border-border p-3">
              <CollapsibleRoot>
                <CollapsibleTrigger>
                  <span className="min-w-0 flex-1 text-left text-xs">{change.author === 'system:compaction' ? (change.sourceThread === 'compaction:auto' ? 'Auto-compacted' : 'Compacted') : change.author}{change.version !== null ? ` · v${change.version}` : ''}</span>
                  <Badge tone={changeTone(change)}>{humanizeKey(change.state)}</Badge>
                  <Caption as="span" className="shrink-0">{relativeAge(change.at)}</Caption>
                  <Icons.chevronDown data-chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </CollapsibleTrigger>
                <CollapsiblePanel>
                  <div className="mt-3 space-y-4">
                    {(Object.keys(CONTEXT_SECTION_LABELS) as ContextSectionKey[]).filter((key) => change.sections[key]).map((key) => (
                      <ContextSection key={key} label={CONTEXT_SECTION_LABELS[key]} text={change.sections[key]} />
                    ))}
                    {change.state === 'approved' && change.version !== null && onRestore ? (
                      <div>
                        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setRestoreVersion(change.version)}>Restore this version</Button>
                      </div>
                    ) : null}
                  </div>
                </CollapsiblePanel>
              </CollapsibleRoot>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-lg border border-border p-4 text-sm">No revisions yet.</p>
      )
    ) : null}
  </WorkspaceOverlay>
  <WorkspaceOverlay title="Review context update" open={proposal !== null && data != null} onClose={() => { setProposal(null); onReview(null) }}>
    {data ? data.changes.filter((change) => change.id === proposal).map((change) => {
      const stale = change.baseVersion !== data.version
      const depsReady = !(change.fileRef || change.sourceRefs?.length) || preview.status === 'ready'
      return (
        <div key={change.id} className="space-y-4">
          <Caption>Based on v{change.baseVersion} · Current v{data.version}</Caption>
          {change.fileRef || change.sourceRefs?.length ? <FileDependencyPreview resource={preview} /> : null}
          {(Object.keys(CONTEXT_SECTION_LABELS) as ContextSectionKey[]).filter((key) => change.sections[key] !== data.sections[key]).map((key) => (
            <section key={key} aria-label={`${CONTEXT_SECTION_LABELS[key]} change`}>
              <Overline>{CONTEXT_SECTION_LABELS[key]}</Overline>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div className="min-w-0 rounded-lg bg-surface-sunken p-3">
                  <Caption>Current</Caption>
                  <div className="mt-1"><Markdown text={data.sections[key] || 'Empty'} variant="section" /></div>
                </div>
                <div className="min-w-0 rounded-lg border border-primary-border bg-primary-soft p-3">
                  <Caption>Proposed</Caption>
                  <div className="mt-1"><Markdown text={change.sections[key] || 'Empty'} variant="section" /></div>
                </div>
              </div>
            </section>
          ))}
          {error ? <p role="alert" className="rounded-lg bg-muted p-3 text-xs">{error}</p> : null}
          {stale ? (
            <div role="note" className="flex gap-2 rounded-md border border-warning-border bg-warning-soft p-3">
              <span className="flex h-5 shrink-0 items-center"><Icons.alertWarning aria-hidden className="size-4 text-warning" /></span>
              <BodySm as="span" className="min-w-0 flex-1">This update is based on v{change.baseVersion}; the current version is v{data.version}. Ask for a refreshed proposal.</BodySm>
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={async () => { if (await onDecision(change.id, false)) setProposal(null) }}>Reject</Button>
            <span title={stale ? 'This update is based on an older version.' : undefined}>
              <Button type="button" variant="primary" disabled={busy || stale || !depsReady} onClick={async () => { if (await onDecision(change.id, true)) setProposal(null) }}><Icons.approve className="size-4" aria-hidden />Approve</Button>
            </span>
          </div>
        </div>
      )
    }) : null}
  </WorkspaceOverlay>
  <ConfirmAction open={restoreVersion !== null} onOpenChange={(next) => { if (!next) setRestoreVersion(null) }} title={restoreVersion !== null ? `Restore version ${restoreVersion}?` : 'Restore version?'} description="The text sections return to this revision as a new version. File summaries stay as they are." confirmLabel="Restore version" pending={busy} onConfirm={async () => { if (restoreVersion !== null && onRestore && await onRestore(restoreVersion)) setRestoreVersion(null) }} />
  <WorkspaceOverlay
    title="Global context"
    size="large"
    open={viewerOpen && data !== undefined}
    onClose={() => setViewerOpen(false)}
    titleBadge={data ? <Caption>v{data.version} · {formatCount(data.usage.total)} tokens</Caption> : undefined}
    footer={data ? (
      <>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void (async () => {
              try {
                await navigator.clipboard.writeText(data.markdown)
                onCopied?.()
              } catch { /* clipboard unavailable: the text stays visible */ }
            })()
          }}
        >
          Copy as Markdown
        </Button>
        <Button type="button" variant="ghost" onClick={() => setViewerOpen(false)}>Close</Button>
      </>
    ) : undefined}
  >
    {data ? <div className="mx-auto w-full max-w-prose-kd overflow-y-auto"><Markdown text={data.markdown} variant="chat" /></div> : null}
  </WorkspaceOverlay>
  <WorkspaceOverlay title="Rewrite with a direction" open={rewriteOpen && onRewrite !== undefined} onClose={() => setRewriteOpen(false)}>
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void (async () => { if (onRewrite && await onRewrite(rewriteDraft)) setRewriteOpen(false) })() }}>
      <FieldRoot>
        <FieldLabel>What should change?</FieldLabel>
        <FieldDescription>For example: the context leans toward X, give more weight to Y.</FieldDescription>
        <FieldControl render={<Textarea value={rewriteDraft} onChange={(event) => setRewriteDraft(event.target.value)} rows={4} />} />
      </FieldRoot>
      {error ? <p role="alert" className="rounded-lg bg-muted p-3 text-xs">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" disabled={busy} onClick={() => setRewriteOpen(false)}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy || !rewriteDraft.trim()}>Start rewrite</Button>
      </div>
    </form>
  </WorkspaceOverlay>
  </section>
  )
}
function FileDependencyPreview({ resource }: { resource: Resource<ContextPreview> }) {
  const [limit, setLimit] = useState(50)
  const sources = resource.data?.sources ?? (resource.data?.change.fileRef ? [{ ref: resource.data.change.fileRef, units: resource.data.units }] : [])
  const units = sources.flatMap((source) => source.units.map((unit) => ({ ...unit, ref: source.ref })))
  return (
    <section aria-label="File dependencies" className="space-y-3">
      <ResourceNotice resource={resource} label="Source review" />
      {resource.status === 'ready' ? (
        <>
          <Caption>Includes {sources.length} file {sources.length === 1 ? 'version' : 'versions'} and {units.length} source {units.length === 1 ? 'unit' : 'units'}</Caption>
          {sources.map(({ ref }) => (
            <CollapsibleRoot key={`${ref.fileId}:${ref.hash}`} className="rounded-lg border border-border p-3 text-xs">
              <CollapsibleTrigger>
                <FileTypeIcon filename={ref.filename} aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 break-words text-left font-medium">{ref.filename} · {ref.ords.length} units</span>
                <Icons.chevronDown data-chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </CollapsibleTrigger>
              <CollapsiblePanel><code className="mt-2 block break-all">{ref.hash}</code></CollapsiblePanel>
            </CollapsibleRoot>
          ))}
          {units.slice(0, limit).map((unit) => (
            <section key={`${unit.ref.fileId}:${unit.ref.hash}:${unit.ord}`} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Caption>{unit.ref.filename}:{unit.ord}</Caption>
                {unit.uncertain ? <Badge tone="warning">Uncertain</Badge> : null}
              </div>
              <Markdown text={unit.text} variant="compact" />
            </section>
          ))}
          {units.length > limit ? <Button variant="outline" onClick={() => setLimit((value) => value + 50)}>Show more source units</Button> : null}
        </>
      ) : null}
    </section>
  )
}
function ContextEditor({ sections, baseVersion, currentVersion, busy, error, onSave, onClose }: { sections: Sections; baseVersion: number; currentVersion?: number; busy: boolean; error?: string | null; onSave(sections: Sections): Promise<void>; onClose(): void }) {
  const [draft, setDraft] = useState(sections)
  const stale = currentVersion !== undefined && baseVersion !== currentVersion
  const dirty = (Object.keys(CONTEXT_SECTION_LABELS) as ContextSectionKey[]).some((key) => draft[key] !== sections[key])
  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void onSave(draft) }}>
      {(Object.keys(CONTEXT_SECTION_LABELS) as ContextSectionKey[]).map((key) => (
        <FieldRoot key={key}>
          <FieldLabel>{CONTEXT_SECTION_LABELS[key]}</FieldLabel>
          <FieldDescription>{CONTEXT_SECTION_HELPERS[key]}</FieldDescription>
          <FieldControl render={<Textarea value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} rows={3} />} />
        </FieldRoot>
      ))}
      {stale ? <div role="note" className="flex gap-2 rounded-md border border-warning-border bg-warning-soft p-3"><span className="flex h-5 shrink-0 items-center"><Icons.alertWarning aria-hidden className="size-4 text-warning" /></span><BodySm as="span" className="min-w-0 flex-1">Editing v{baseVersion} · current is v{currentVersion}. Saving submits the older base; the server may reject it.</BodySm></div> : null}
      {error ? <p role="alert" className="rounded-lg bg-muted p-3 text-xs">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={busy || !dirty}>Save context</Button>
      </div>
    </form>
  )
}
/** Badge tone for abnormal file states; indexed files wear no badge. */
function fileBadgeTone(file: LibraryFile): 'neutral' | 'info' | 'warning' | 'danger' {
 if (file.hidden) return 'neutral'
 if (file.status === 'failed') return 'danger'
 if (file.status === 'needs-ocr' || file.status === 'needs_ocr' || file.status === 'uncertain') return 'warning'
 if (file.status === 'processing' || file.status === 'queued') return 'info'
 return 'neutral'
}

export function fileTypeLabel(filename: string): string {
 const dot = filename.lastIndexOf('.')
 if (dot < 0 || dot === filename.length - 1) return 'File'
 return filename.slice(dot + 1).toUpperCase()
}

/** One library row (FL-02): the row body is the preview target (unless
 * hidden); processing state and row actions live beside it, never nested
 * inside the preview button. Actions reveal on hover/focus, always on
 * touch. */
function FileRow({ file, busy, onPreview, onHide, onInclude, onRemove, onRetry }: {
 file: LibraryFile; busy: boolean; onPreview?(id: string): void; onHide(id: string, hidden: boolean): void; onInclude(id: string): void; onRemove?(id: string): void; onRetry?(file: LibraryFile): void
}) {
 const previewable = !file.hidden && onPreview !== undefined
 const badge = file.hidden ? 'Hidden' : file.status === 'indexed' ? null : fileStatusLabel(file.status)
 const description = [fileTypeLabel(file.filename), humanizeKey(file.source), file.included ? 'In global context' : null].filter((part): part is string => Boolean(part)).join(' · ')
 return (
 <li>
 <div data-list-row="" className={cn('group', listRowClassName({ density: 'comfortable', interactive: false }), 'flex-col items-stretch gap-0 py-2')}>
 <div className="flex min-w-0 items-start gap-1">
 <button
 type="button"
 aria-label={file.filename}
 title={file.filename}
 disabled={!previewable}
 onClick={() => onPreview?.(file.id)}
 className={cn('flex min-w-0 flex-1 items-start gap-3 rounded-md px-2 py-1 text-left outline-none', focusRingInset, previewable && 'cursor-pointer')}
 >
 <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken">
 <FileTypeIcon filename={file.filename} aria-hidden className="size-4 text-muted-foreground" />
 </span>
 <span className="min-w-0 flex-1">
 <span className="flex min-w-0 items-center gap-2">
 <BodySm as="span" className="min-w-0 flex-1 truncate font-medium">{file.filename}</BodySm>
 {badge ? <Badge tone={fileBadgeTone(file)} className="shrink-0">{badge}</Badge> : null}
 </span>
 <Description as="span" title={description} className="mt-0.5 block truncate">{description}</Description>
 </span>
 </button>
 <span className="flex shrink-0 items-center gap-1 transition-opacity duration-120 pointer-coarse:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
 {file.included ? (
 <>
 <span role="img" aria-label="In global context" title="In global context" className="flex size-8 items-center justify-center">
 <Icons.includedInContext aria-hidden className="size-4 text-primary-text" />
 </span>
 {onRemove ? (
 <IconButton label={`Remove ${file.filename} from global context`} size="icon-sm" disabled={busy} onClick={() => onRemove(file.id)}>
 <Icons.delete className="size-4" aria-hidden />
 </IconButton>
 ) : null}
 </>
 ) : !file.hidden && file.status === 'indexed' ? (
 <IconButton label={`Add ${file.filename} to global context`} size="icon-sm" disabled={busy} onClick={() => onInclude(file.id)}>
 <Icons.includeInContext className="size-4" aria-hidden />
 </IconButton>
 ) : null}
 <IconButton label={file.hidden ? `Reveal ${file.filename} to agents` : `Hide ${file.filename} from agents`} size="icon-sm" disabled={busy} onClick={() => onHide(file.id, !file.hidden)}>
 {file.hidden ? <Icons.reveal className="size-4" aria-hidden /> : <Icons.hide className="size-4" aria-hidden />}
 </IconButton>
 </span>
 </div>
 {file.processing ? (
 <div className="min-w-0 py-1 pr-2 pl-15">
 <FileProcessingStatus progress={file.processing} hidden={file.hidden} busy={busy} onRetry={onRetry ? () => onRetry(file) : undefined} />
 </div>
 ) : null}
 </div>
 </li>
 )
}

export function WorkspaceFiles({ resource, busy, onUpload, onHide, onInclude, onRemove, onPreview, onRetry }: { resource: Resource<LibraryFile[]>; busy: boolean; onUpload(file: File): void; onHide(id: string, hidden: boolean): void; onInclude(id: string): void; onRemove?(id: string): void; onPreview?(id: string): void; onRetry?(file: LibraryFile): void }) {
 const [search, setSearch] = useState('')
 const [hidden, setHidden] = useState(false)
 const [limit, setLimit] = useState(50)
 const [dragging, setDragging] = useState(false)
 const [pending, setPending] = useState<string[]>([])
 const fileInput = useRef<HTMLInputElement>(null)
 const dragDepth = useRef(0)
 const rows = resource.data?.filter((file) => (hidden || !file.hidden) && file.filename.toLowerCase().includes(search.toLowerCase())) ?? []
 // Pending uploads clear when the operation settles: landed rows arrive
 // with the refresh, failed uploads surface through the error notice.
 // Adjusted during render (React restarts the render with cleared state)
 // instead of setState-in-effect.
 const [settledBusy, setSettledBusy] = useState(busy)
 if (settledBusy !== busy) {
 setSettledBusy(busy)
 if (!busy) setPending([])
 }

 function selectFiles(list: FileList | null) {
 if (!list || !list.length) return
 if (busy) {
 notify.warning('Wait for the current upload to finish.')
 return
 }
 const picked = Array.from(list)
 if (picked.length > 1) notify.warning('Drop one file at a time. Uploading the first file.')
 const first = picked[0]
 if (!first) return
 setPending((current) => [...current, first.name])
 onUpload(first)
 }

 function clearSearch() {
 setSearch('')
 setLimit(50)
 }
 return (
 <section
 aria-label="Sector files"
 className="relative flex min-h-0 flex-1 flex-col"
 onDragEnter={(event) => { event.preventDefault(); dragDepth.current += 1; setDragging(true) }}
 onDragOver={(event) => event.preventDefault()}
 onDragLeave={(event) => { event.preventDefault(); dragDepth.current -= 1; if (dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false) } }}
 onDrop={(event) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); selectFiles(event.dataTransfer.files) }}
 >
 <div className="flex shrink-0 items-center gap-1 border-b border-border-subtle px-4 py-3">
 <SectionTitle className="min-w-0 flex-1">Files</SectionTitle>
 {resource.status === 'ready' ? (
 <Caption as="span" className="shrink-0 tabular-nums">{formatCount(rows.length)} {rows.length === 1 ? 'file' : 'files'}</Caption>
 ) : null}
 <IconButton label="Upload file" size="icon-sm" disabled={busy} onClick={() => fileInput.current?.click()}>
 <Icons.upload className="size-4" aria-hidden />
 </IconButton>
 <IconButton label={hidden ? 'Hide hidden files' : 'Show hidden files'} size="icon-sm" aria-pressed={hidden} onClick={() => { setHidden(!hidden); setLimit(50) }}>
 {hidden ? <Icons.reveal className="size-4" aria-hidden /> : <Icons.hide className="size-4" aria-hidden />}
 </IconButton>
 <input ref={fileInput} type="file" className="hidden" accept=".md,.txt,.csv,.json,.pdf,.docx,.png,.jpg,.jpeg,.webp,.gif" onChange={(event) => { selectFiles(event.target.files); event.target.value = '' }} />
 </div>
 <div className="flex shrink-0 items-center gap-2 px-4 pt-3">
 <div className="min-w-0 flex-1">
 <SearchField value={search} onChange={(value) => { setSearch(value); setLimit(50) }} label="Search files" />
 </div>
 </div>
 <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 py-3">
 <ResourceNotice resource={resource} label="Files" />
 {resource.status === 'ready' ? (
 rows.length || pending.length ? (
 <List aria-label="Files">
 {pending.map((name, index) => (
 <li key={`${index}:${name}`}>
 <div data-list-row="" className={listRowClassName({ density: 'comfortable', interactive: false })}>
 <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken">
 <Icons.loading aria-hidden className="size-4 text-muted-foreground motion-safe:animate-spin" />
 </span>
 <span className="min-w-0 flex-1">
 <BodySm as="span" className="block truncate font-medium">{name}</BodySm>
 <Caption as="span" role="status" className="mt-0.5 block">Uploading…</Caption>
 </span>
 </div>
 </li>
 ))}
 {rows.slice(0, limit).map((file) => (
 <FileRow key={file.id} file={file} busy={busy} onPreview={onPreview} onHide={onHide} onInclude={onInclude} onRemove={onRemove} onRetry={onRetry} />
 ))}
 </List>
 ) : search ? (
 <div className="flex min-w-0 flex-col items-center py-6 text-center">
 <Description>No matching files.</Description>
 <div className="mt-4">
 <Button type="button" variant="ghost" size="sm" onClick={clearSearch}>Clear search</Button>
 </div>
 </div>
 ) : (
 <div className="flex min-w-0 flex-col items-center py-6 text-center">
 <Description>Upload PDFs, documents or data, or ask an agent to create a file.</Description>
 <div className="mt-4">
 <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>Upload file</Button>
 </div>
 </div>
 )
 ) : null}
 </div>
 {resource.status === 'ready' ? (
 <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-4 py-2">
 <Caption aria-live="polite" className="tabular-nums">Showing {formatCount(Math.min(limit, rows.length))} of {formatCount(rows.length)} files</Caption>
 {rows.length > limit ? (
 <Button type="button" variant="secondary" size="sm" onClick={() => setLimit((value) => value + 50)}>Show more</Button>
 ) : null}
 </div>
 ) : null}
 {dragging ? (
 <div aria-hidden className="pointer-events-none absolute inset-2 z-10 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary-border bg-primary-soft">
 <Icons.upload aria-hidden className="size-5 text-primary-text" />
 <BodySm as="span" className="font-medium text-primary-text">Drop files to upload</BodySm>
 </div>
 ) : null}
 </section>
 )
}
export function LocalContextEditor({ resource, busy, error, onSave, onCompact, inspection, onInspectOperation, onRebuild }: { resource: Resource<LocalContext>; busy: boolean; error?: string | null; onSave(notes: string, version: number): void; onCompact(): void; inspection?: Resource<OperationReceipt>; onInspectOperation?(id: string): void; onRebuild?(summary: string, version: number): Promise<boolean> }) {
  const [notes, setNotes] = useState(resource.data?.notes ?? '')
  const [version, setVersion] = useState<number | null>(resource.data?.version ?? null)
  const [rebuildSource, setRebuildSource] = useState<LocalContext | null>(null)
  const [rebuildDraft, setRebuildDraft] = useState('')
  if (version === null && resource.data) { setVersion(resource.data.version); setNotes(resource.data.notes) }
  const data = resource.status === 'ready' ? resource.data : undefined
  function continueFresh() {
    const composer = typeof document === 'undefined' ? null : document.getElementById('karbot-composer')
    if (composer instanceof HTMLElement) { composer.scrollIntoView({ block: 'center' }); composer.focus({ preventScroll: true }) }
    else notify.info('The chat input is not on this screen.')
  }
  return (
  <div className="space-y-4">
    <ResourceNotice resource={resource} label="Local context" />
    {data ? (
      <>
        <div className="rounded-lg bg-surface-sunken p-3 text-xs text-muted-foreground">Private working memory for this conversation. The visible transcript stays intact.</div>
        {data.pendingResponse ? <p role="status" className="rounded-lg border border-border bg-surface-sunken p-3 text-xs">Provider reply for round {data.pendingResponse.round} is saved locally. Resume the original turn after storage and source availability recover to finish recording it before further work.</p> : null}
        {data.pendingOperations?.length ? (
          <section aria-label="Pending operation recovery" className="space-y-3">
            <div role="note" className="flex gap-2 rounded-md border border-warning-border bg-warning-soft p-3">
              <span className="flex h-5 shrink-0 items-center"><Icons.alertWarning aria-hidden className="size-4 text-warning" /></span>
              <BodySm as="span" className="min-w-0 flex-1">{data.pendingOperations.length === 1 ? 'An operation needs review' : `${data.pendingOperations.length} operations need review`}</BodySm>
            </div>
            <Description>The agent paused to avoid repeating a change. Resume checks the same operation; compaction keeps its receipt.</Description>
            {inspection ? <ResourceNotice resource={inspection} label="Operation receipt" /> : null}
            <ul className="space-y-3">
              {data.pendingOperations.map((operation) => {
                const receipt = inspection?.data?.operationId === operation.operationId ? inspection.data : undefined
                return (
                  <li key={operation.operationId} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <BodySm as="span" className="font-medium">{humanizeKey(operation.toolName.replace(/\./g, '_'))}</BodySm>
                      {receipt ? <Badge tone={receipt.state === 'confirmed' ? 'success' : 'warning'}>{receipt.state === 'confirmed' ? 'Confirmed' : 'Unresolved'}</Badge> : null}
                    </div>
                    <Description className="mt-1">{operation.reason}</Description>
                    <div className="mt-2"><Button variant="ghost" size="sm" onClick={() => onInspectOperation?.(operation.operationId)} disabled={!onInspectOperation}>Inspect receipt</Button></div>
                    {receipt ? <div className="mt-2 rounded-md bg-surface-sunken p-3 text-xs"><p className="font-medium">{receipt.state === 'confirmed' ? 'Result confirmed' : 'Effect unresolved'}</p><p className="mt-1 break-words text-muted-foreground">{receipt.reason}</p></div> : null}
                    <CollapsibleRoot>
                      <CollapsibleTrigger><span className="min-w-0 flex-1 text-left text-xs">Operation identity</span><Icons.chevronDown data-chevron className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /></CollapsibleTrigger>
                      <CollapsiblePanel keepMounted><code tabIndex={0} aria-label="Operation identity value" className="mt-1 block max-h-32 overflow-y-auto break-all text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{operation.operationId}</code></CollapsiblePanel>
                    </CollapsibleRoot>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}
        {data.contextBlocked ? (
          <div role="alert" className="space-y-2 rounded-lg border border-danger-border bg-danger-soft p-3">
            <p className="text-sm font-medium">Context needs source review</p>
            <Description>{data.contextBlocked}</Description>
            <Description>Reveal the exact source in Files and resume, or start a new conversation. Stored history stays intact.</Description>
            <div className="flex flex-wrap gap-2">
              {onRebuild ? <Button variant="outline" size="sm" disabled={busy} onClick={() => setRebuildSource(data)}>Review safe rebuild</Button> : null}
              <Button variant="ghost" size="sm" onClick={continueFresh}>Continue in a new conversation</Button>
            </div>
          </div>
        ) : null}
        {data.usage ? (
          <div>
            <Overline>Usage{data.usage.method === 'estimated' ? ' (estimated)' : null}</Overline>
            <div className="mt-1"><Numeric>{formatCount(data.usage.inputTokens)} of {formatCount(data.usage.budget)} tokens</Numeric></div>
            <div className="mt-2"><ProgressRoot value={data.usage.budget ? Math.min(100, Math.round((data.usage.inputTokens / data.usage.budget) * 100)) : 0} aria-label="Context usage" /></div>
            <Caption className="mt-1 block">Window {formatCount(data.usage.window)}</Caption>
          </div>
        ) : null}
        <div>
          <Overline>Working summary</Overline>
          {data.summary ? <div className="mt-1"><Markdown text={data.summary} variant="compact" /></div> : <Caption className="mt-1 block">No stored summary yet</Caption>}
        </div>
        <FieldRoot>
          <FieldLabel>Local notes</FieldLabel>
          <FieldControl render={<Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={6} />} />
        </FieldRoot>
        {error ? <p role="alert" className="rounded-lg bg-muted p-3 text-xs">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => onSave(notes, version ?? 0)}>Save notes</Button>
        </div>
        <div className="flex justify-end border-t border-border-subtle pt-3">
          <Button variant="secondary" size="sm" disabled={busy || Boolean(data.contextBlocked)} onClick={onCompact}>{busy ? 'Working…' : 'Compact context'}</Button>
        </div>
      </>
    ) : null}
    {onRebuild ? <OwnerContextRebuild summary={rebuildDraft} onSummaryChange={setRebuildDraft} onReviewLatest={() => { if (resource.status === 'ready' && resource.data) setRebuildSource(resource.data); else resource.refresh() }} onClose={() => setRebuildSource(null)} source={rebuildSource} currentVersion={resource.data?.version} busy={busy} error={error} onSubmit={async (summary) => { if (rebuildSource && await onRebuild(summary, rebuildSource.version)) { setRebuildSource(null); setRebuildDraft('') } }} /> : null}
  </div>
  )
}

function OwnerContextRebuild({ source, currentVersion, busy, error, onSubmit, onClose, summary, onSummaryChange, onReviewLatest }: { summary: string; onSummaryChange(value: string): void; onReviewLatest(): void; source: LocalContext | null; currentVersion?: number; busy: boolean; error?: string | null; onSubmit(summary: string): Promise<void>; onClose(): void }) {
 const [confirmedVersion, setConfirmedVersion] = useState<number | null>(null)
 const [confirmedFor, setConfirmedFor] = useState<number | null>(null)
 // A new rebuild target starts unconfirmed; the acknowledgement never
 // carries across sources. Compared on a normalized key so a missing
 // source settles instead of re-rendering forever.
 const sourceKey = source?.version ?? null
 if (sourceKey !== confirmedFor) {
 setConfirmedFor(sourceKey)
 setConfirmedVersion(null)
 }
 const independent = source !== null && confirmedVersion === source.version && source.version === currentVersion
 const formId = useId()
 const failure = useRef<HTMLParagraphElement>(null)
 useEffect(() => { if (error) { failure.current?.focus({ preventScroll: true }); failure.current?.scrollIntoView?.({ block: 'center' }) } }, [error, currentVersion, source?.version, busy])
 return <WorkspaceOverlay title="Rebuild private context" open={source !== null} onClose={onClose} footer={source ? <div className="flex flex-wrap justify-end gap-2">{source.version !== currentVersion ? <Button type="button" variant="outline" aria-label="Review latest context" disabled={busy} onClick={onReviewLatest}>Review latest</Button> : null}<Button type="submit" form={formId} disabled={busy || !independent || !summary.trim() || source.version !== currentVersion}>Confirm safe rebuild</Button></div> : undefined}>{source ? <form id={formId} className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (!busy && independent && summary.trim()) void onSubmit(summary.trim()) }}><p className="rounded-lg bg-muted p-3 text-xs">This replaces private working context only. Restate the objectives, completed work, identifiers and unresolved questions that must survive. Original history, budgets, source archives, steering and operation receipts remain stored.</p><Caption>Reviewing v{source.version} · Current v{currentVersion}</Caption>{source.task ? <CollapsibleRoot className="rounded-lg border border-border p-3"><CollapsibleTrigger><span className="min-w-0 flex-1 text-left text-sm font-medium">Original task</span><Icons.chevronDown data-chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden /></CollapsibleTrigger><CollapsiblePanel><div className="mt-2 max-h-48 overflow-y-auto"><Markdown text={source.task} variant="compact" /></div></CollapsiblePanel></CollapsibleRoot> : null}<CollapsibleRoot className="rounded-lg border border-border p-3"><CollapsibleTrigger><span className="min-w-0 flex-1 text-left text-sm font-medium">Stored summary and source dependencies</span><Icons.chevronDown data-chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden /></CollapsibleTrigger><CollapsiblePanel><div className="mt-2 max-h-64 space-y-3 overflow-y-auto"><Markdown text={source.summary || 'No summary stored.'} variant="compact" />{source.sourceRefs?.map((ref) => <div key={`${ref.fileId}:${ref.hash}`} className="min-w-0 text-xs"><p className="break-words font-medium">{ref.filename} · Units {ref.ords.join(', ')}</p><code className="block break-all text-muted-foreground">{ref.hash}</code></div>)}</div></CollapsiblePanel></CollapsibleRoot><FieldRoot><FieldLabel>Independent replacement</FieldLabel><FieldDescription>Restate the objectives, completed work and open questions in your own words.</FieldDescription><FieldControl render={<Textarea value={summary} onChange={(event) => onSummaryChange(event.target.value)} rows={7} maxLength={48000} required />} /></FieldRoot>{summary.trim() ? <section aria-label="Replacement preview" className="rounded-lg border border-border p-3"><h3 className="mb-2 text-sm font-medium">Replacement preview</h3><Markdown text={summary} /></section> : null}<div className="flex items-start gap-2 text-xs"><CheckboxRoot aria-label="I reviewed this replacement" checked={source !== null && independent} disabled={source === null} onCheckedChange={(checked) => setConfirmedVersion(checked === true && source ? source.version : null)} className="mt-0.5" /><span>I reviewed this replacement. It preserves the required objectives and contains no hidden or changed-source content.</span></div>{error ? <p ref={failure} tabIndex={-1} role="alert" className="rounded-lg bg-muted p-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{error}</p> : null}{source.version !== currentVersion ? <p role="alert" className="text-xs">Context changed. This draft is kept; review the latest sources and confirm again before submitting.</p> : null}</form> : null}</WorkspaceOverlay>
}
