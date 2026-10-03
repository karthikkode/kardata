import { FileProcessingStatus } from './FileProcessingStatus'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { formatCount, formatDurationMs } from '../lib/format'
import { BodySm, Caption, CardTitle, Description, Label, Numeric, SectionTitle } from './text'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { CheckboxRoot } from './ui/checkbox'
import { CollapsiblePanel, CollapsibleRoot, CollapsibleTrigger } from './ui/collapsible'
import { List, ListRow } from './ui/list'
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
import type { ContextPreview, GlobalContext, LibraryFile, LocalContext, OperationReceipt, ResearchProgress, Sections } from '../data/workspace-api'
import { IconButton } from './IconButton'

export function WorkspaceOverlay({ title, titleBadge, children, onClose, side = false, footer, open = true, size = 'default' }: { title: string; titleBadge?: ReactNode; children: ReactNode; onClose(): void; side?: boolean; footer?: ReactNode; open?: boolean; size?: 'default' | 'large' }) {
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
 <DialogPopup side={side} className={side ? undefined : size === 'large' ? 'w-[min(92vw,880px)] max-w-220' : 'w-[min(92vw,720px)] max-w-2xl'}>
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
export function GlobalContextPanel({ resource, preview, busy, error, onReview, onSave, onDecision }: { resource: Resource<GlobalContext>; preview: Resource<ContextPreview>; busy: boolean; error?: string | null; onReview(id: string | null): void; onSave(sections: Sections, version: number): Promise<boolean>; onDecision(id: string, approve: boolean): Promise<boolean> }) {
 const [editor, setEditor] = useState(false), [history, setHistory] = useState(false), [proposal, setProposal] = useState<string | null>(null)
 const pending = resource.data?.changes.filter((change) => change.state === 'pending' || change.state === 'parent-review') ?? []
 const [editContext, setEditContext] = useState<GlobalContext | null>(null)
 if (editor && !resource.data) { setEditor(false); setEditContext(null) }
 return <section aria-label="Global context" className="flex min-h-0 flex-1 flex-col">
 <div className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-3"><h2 className="min-w-0 flex-1 text-sm font-medium">Global context</h2><IconButton label="Context history" size="icon-sm" disabled={!resource.data} onClick={() => setHistory(true)}><Icons.history className="size-4" aria-hidden /></IconButton><IconButton label="Edit global context" size="icon-sm" disabled={!resource.data} onClick={() => { setEditContext(resource.data ?? null); setEditor(true) }}><Icons.edit className="size-4" aria-hidden /></IconButton></div>
 <div className="scroll-slim min-h-0 flex-1 space-y-4 overflow-y-auto p-4"><ResourceNotice resource={resource} label="Global context" />{resource.status === 'ready' && resource.data ? <>
 <div className="rounded-lg border border-border/60 bg-muted/20 p-3"><Markdown text={resource.data.markdown || 'No shared context yet. Add the sector scope and decisions here.'} /></div>
 {pending.length ? <div className="space-y-2"><p className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{pending.length} pending {pending.length === 1 ? 'update' : 'updates'}</p>{pending.map((change) => <button key={change.id} type="button" onClick={() => { setProposal(change.id); onReview(change.id) }} className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-border p-3 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span>{change.fileRef ? 'File context inclusion' : change.sourceRefs?.length ? 'File-derived context update' : 'Shared context update'}</span><span className="text-primary">Review</span></button>)}</div> : null}
 </> : null}</div>
 <WorkspaceOverlay title="Edit global context" open={editor && editContext !== null} onClose={() => setEditor(false)}>{editor && editContext ? <ContextEditor key={editContext.version} sections={editContext.sections} busy={busy} error={error} onSave={async (sections) => { if (await onSave(sections, editContext.version)) setEditor(false) }} /> : null}</WorkspaceOverlay>
 <WorkspaceOverlay title="Context history" open={history && resource.data !== undefined && resource.data !== null} onClose={() => setHistory(false)}>{history && resource.data ? (<ol className="space-y-3">{resource.data.changes.length ? resource.data.changes.map((change) => <li key={change.id} className="rounded-lg border border-border p-3"><div className="flex justify-between gap-2 text-xs"><span>{change.author} · {change.state}</span><time>{new Date(change.at).toLocaleString()}</time></div><Markdown text={Object.entries(change.sections).filter(([, text]) => text).map(([key, text]) => `### ${key}\n${text}`).join('\n\n')} /></li>) : <p className="rounded-lg border border-dashed border-border p-4 text-sm">No revisions yet.</p>}</ol>) : null}</WorkspaceOverlay>
 <WorkspaceOverlay title="Review context update" open={proposal !== null && resource.data != null} onClose={() => { setProposal(null); onReview(null) }}>{resource.data ? resource.data.changes.filter((change) => change.id === proposal).map((change) => <div key={change.id} className="space-y-4"><p className="rounded-lg bg-muted p-3 text-xs">Based on v{change.baseVersion} · Current v{resource.data?.version}{change.fileRef ? `· ${change.fileRef.filename}` : ''}</p>{change.fileRef || change.sourceRefs?.length ? <FileDependencyPreview resource={preview} /> : null}{(['scope','decisions','findings','questions'] as const).filter((key) => change.sections[key] !== resource.data?.sections[key]).map((key) => <section key={key} className="rounded-lg border border-border p-3"><h3 className="text-sm font-medium capitalize">{key}</h3><div className="mt-2 rounded bg-muted p-2 text-xs"><span className="font-medium">Current</span><Markdown text={resource.data?.sections[key] || 'Empty'} /></div><div className="mt-2 rounded border border-primary/30 p-2 text-xs"><span className="font-medium">Proposed</span><Markdown text={change.sections[key] || 'Empty'} /></div></section>)}{error ? <p role="alert" className="rounded-lg bg-muted p-3 text-xs">{error}</p> : null}<div className="flex gap-2"><Button disabled={busy || change.baseVersion !== resource.data?.version || ((Boolean(change.fileRef) || Boolean(change.sourceRefs?.length)) && preview.status !== 'ready')} onClick={async () => { if (await onDecision(change.id, true)) setProposal(null) }}><Icons.approve className="size-4" aria-hidden />Approve</Button><Button variant="outline" disabled={busy} onClick={async () => { if (await onDecision(change.id, false)) setProposal(null) }}>Reject</Button></div></div>) : null}</WorkspaceOverlay>
 </section>
}
function FileDependencyPreview({ resource }: { resource: Resource<ContextPreview> }) {
 const [limit, setLimit] = useState(50)
 const sources = resource.data?.sources ?? (resource.data?.change.fileRef ? [{ ref: resource.data.change.fileRef, units: resource.data.units }] : [])
 const units = sources.flatMap((source) => source.units.map((unit) => ({ ...unit, ref: source.ref })))
 return <section aria-label="File dependencies" className="space-y-3"><ResourceNotice resource={resource} label="Source review" />{resource.status === 'ready' ? <><p className="rounded-lg bg-muted p-3 text-xs">Approval includes these exact {sources.length} file versions and {units.length} source units.</p>{sources.map(({ ref }) => <CollapsibleRoot key={`${ref.fileId}:${ref.hash}`} className="rounded-lg border border-border p-3 text-xs"><CollapsibleTrigger><span className="min-w-0 flex-1 break-words text-left font-medium">{ref.filename} · {ref.ords.length} units</span><Icons.chevronDown data-chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden /></CollapsibleTrigger><CollapsiblePanel><code className="mt-2 block break-all">{ref.hash}</code></CollapsiblePanel></CollapsibleRoot>)}{units.slice(0, limit).map((unit) => <section key={`${unit.ref.fileId}:${unit.ref.hash}:${unit.ord}`} className="rounded-lg border border-border p-3"><h3 className="mb-2 break-words text-xs font-medium">{unit.ref.filename}:{unit.ord}{unit.uncertain ? ' · Uncertain extraction' : ''}</h3><Markdown text={unit.text} /></section>)}{units.length > limit ? <Button variant="outline" onClick={() => setLimit((value) => value + 50)}>Show more source units</Button> : null}</> : null}</section>
}
function ContextEditor({ sections, busy, error, onSave }: { sections: Sections; busy: boolean; error?: string | null; onSave(sections: Sections): Promise<void> }) {
 const [draft, setDraft] = useState(sections)
 return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void onSave(draft) }}>{(['scope','decisions','findings','questions'] as const).map((key) => <label key={key} className="block text-sm font-medium capitalize">{{ scope: 'Scope', decisions: 'Decisions', findings: 'Findings', questions: 'Open questions' }[key]}<textarea value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} rows={3} className="mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>)}{error ? <p role="alert" className="rounded-lg bg-muted p-3 text-xs">{error}</p> : null}<Button type="submit" disabled={busy}>Save context</Button></form>
}
export function WorkspaceFiles({ resource, busy, onUpload, onHide, onInclude, onPreview, onRetry }: { resource: Resource<LibraryFile[]>; busy: boolean; onUpload(file: File): void; onHide(id: string, hidden: boolean): void; onInclude(id: string): void; onPreview?(id: string): void; onRetry?(file: LibraryFile): void }) {
 const [search, setSearch] = useState(''), [hidden, setHidden] = useState(false)
 const [limit, setLimit] = useState(50)
 const fileInput = useRef<HTMLInputElement>(null)
 const rows = resource.data?.filter((file) => (hidden || !file.hidden) && file.filename.toLowerCase().includes(search.toLowerCase())) ?? []
 const statusLabels = new Map([['processing', 'Processing'], ['failed', 'Failed'], ['needs-ocr', 'Needs OCR'], ['needs_ocr', 'Needs OCR']])
 return <section aria-label="Sector files" className="flex min-h-0 flex-1 flex-col"><div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3"><h2 className="text-sm font-medium">Files</h2><IconButton label="Upload file" size="icon-sm" disabled={busy} onClick={() => fileInput.current?.click()}><Icons.upload className="size-4" aria-hidden /></IconButton><input ref={fileInput} type="file" className="hidden" accept=".md,.txt,.csv,.json,.pdf,.docx,.png,.jpg,.jpeg,.webp,.gif" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onUpload(file) }} /></div>
 <div className="flex shrink-0 items-center gap-2 px-4 pt-3"><div className="min-w-0 flex-1"><SearchField value={search} onChange={(value) => { setSearch(value); setLimit(50) }} label="Search files" /></div><IconButton label={hidden ? 'Hide hidden files' : 'Show hidden files'} size="icon" aria-pressed={hidden} onClick={() => { setHidden(!hidden); setLimit(50) }}><Icons.hide className="size-4" aria-hidden /></IconButton></div>
 <div className="scroll-slim min-h-0 flex-1 space-y-1 overflow-y-auto p-3"><ResourceNotice resource={resource} label="Files" />{resource.status === 'ready' ? rows.length ? rows.slice(0, limit).map((file) => <div key={file.id} className="group rounded-lg border border-transparent px-2 py-2.5 hover:border-border hover:bg-muted/30"><div className="flex items-start gap-2"><Icons.fileDocs className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden /><div className="min-w-0 flex-1"><button type="button" disabled={file.hidden || !onPreview} onClick={() => onPreview?.(file.id)} title={file.filename} className="block w-full cursor-pointer truncate text-left text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default">{file.filename}</button><p className="mt-1 truncate text-xs text-muted-foreground">{file.hidden ? 'Hidden from agents' : file.processing ? file.source : file.status === 'indexed' ? file.included ? 'In shared context' : file.source : statusLabels.get(file.status) ?? file.status}</p>{file.processing ? <FileProcessingStatus progress={file.processing} hidden={file.hidden} busy={busy} onRetry={onRetry ? () => onRetry(file) : undefined} /> : null}</div><IconButton label={`${file.hidden ? 'Reveal' : 'Hide'} ${file.filename}`} size="icon-sm" disabled={busy} onClick={() => onHide(file.id, !file.hidden)}>{file.hidden ? <Icons.hide className="size-3.5" aria-hidden /> : <Icons.reveal className="size-3.5" aria-hidden />}</IconButton>{!file.hidden && !file.included && file.status === 'indexed' ? <IconButton label={`Request context inclusion for ${file.filename}`} size="icon-sm" disabled={busy} onClick={() => onInclude(file.id)}><Icons.plus className="size-3.5" aria-hidden /></IconButton> : null}</div></div>) : <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">{search ? 'No matching files.' : 'Upload source material or ask an agent to create a file.'}</div> : null}</div>
 {resource.status === 'ready' ? <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2"><p aria-live="polite" className="text-xs text-muted-foreground">Showing {Math.min(limit, rows.length)} of {rows.length} files</p>{rows.length > limit ? <Button variant="ghost" size="sm" onClick={() => setLimit((value) => value + 50)}>Show more files</Button> : null}</div> : null}
 </section>
}
export function LocalContextEditor({ resource, busy, error, onSave, onCompact, inspection, onInspectOperation, onInspectExecution, onRebuild }: { resource: Resource<LocalContext>; busy: boolean; error?: string | null; onSave(notes: string, version: number): void; onCompact(): void; inspection?: Resource<OperationReceipt>; onInspectOperation?(id: string): void; onInspectExecution?(): void; onRebuild?(summary: string, version: number): Promise<boolean> }) {
 const [notes, setNotes] = useState(resource.data?.notes ?? '')
 const [version, setVersion] = useState<number | null>(resource.data?.version ?? null)
 const [rebuildSource, setRebuildSource] = useState<LocalContext | null>(null)
 const [rebuildDraft, setRebuildDraft] = useState('')
 if (version === null && resource.data) { setVersion(resource.data.version); setNotes(resource.data.notes) }
 return <div className="space-y-4">{onInspectExecution ? <div className="flex justify-end"><Button variant="ghost" size="sm" onClick={onInspectExecution}><Icons.history className="size-3.5" aria-hidden />Execution records</Button></div> : null}<ResourceNotice resource={resource} label="Local context" />{resource.status === 'ready' && resource.data ? <><div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">Private working memory for this conversation. The visible transcript stays intact.</div>{resource.data.usage ? <div className="rounded-lg border border-border p-3"><p className="text-xs font-medium">Last request {resource.data.usage.method === 'estimated' ? 'estimate' : 'input'}</p><p className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">{resource.data.usage.inputTokens.toLocaleString()} / {resource.data.usage.budget.toLocaleString()} budget · {resource.data.usage.window.toLocaleString()} window</p></div> : null}{resource.data.pendingResponse ? <p role="status" className="rounded-lg border border-border bg-muted/30 p-3 text-xs">Provider reply for round {resource.data.pendingResponse.round} is saved locally. Resume the original turn after storage and source availability recover to finish recording it before further work.</p> : null}{resource.data.pendingOperations?.length ? <section aria-label="Pending operation recovery" className="space-y-3 rounded-lg border border-border p-3"><h3 className="text-sm font-medium">Operation needs review</h3><p className="text-xs text-muted-foreground">The agent paused to avoid repeating a change. Resume checks the same operation; compaction keeps its receipt.</p>{inspection ? <ResourceNotice resource={inspection} label="Operation receipt" /> : null}<ul className="space-y-3">{resource.data.pendingOperations.map((operation) => <li key={operation.operationId} className="min-w-0 space-y-1"><p className="break-words text-xs font-medium">{operation.toolName}</p><p className="break-words text-xs text-muted-foreground">{operation.reason}</p><Button variant="outline" size="sm" onClick={() => onInspectOperation?.(operation.operationId)} disabled={!onInspectOperation}>Inspect receipt</Button>{inspection && inspection.data?.operationId === operation.operationId ? <div className="rounded-md bg-muted/30 p-3 text-xs"><p className="font-medium">{inspection.data.state === 'confirmed' ? 'Result confirmed' : 'Effect unresolved'}</p><p className="mt-1 break-words text-muted-foreground">{inspection.data.reason}</p></div> : null}<CollapsibleRoot><CollapsibleTrigger><span className="min-w-0 flex-1 text-left text-xs">Operation identity</span><Icons.chevronDown data-chevron className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /></CollapsibleTrigger><CollapsiblePanel keepMounted><code tabIndex={0} aria-label="Operation identity value" className="mt-1 block max-h-32 overflow-y-auto break-all text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{operation.operationId}</code></CollapsiblePanel></CollapsibleRoot></li>)}</ul></section> : null}{resource.data.contextBlocked ? <div role="alert" className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-xs"><p className="font-medium">Context needs source review</p><p className="break-words text-muted-foreground">{resource.data.contextBlocked}</p><p className="text-muted-foreground">Reveal the exact source in Files and resume, or start a new conversation. Stored history stays intact.</p>{onRebuild ? <Button variant="outline" disabled={busy} onClick={() => setRebuildSource(resource.data ?? null)}>Review safe rebuild</Button> : null}</div> : null}{resource.data.summary ? <div className="rounded-lg border border-border p-3"><h3 className="mb-2 text-xs font-medium">Working summary</h3><Markdown text={resource.data.summary} /></div> : null}<label className="block text-sm font-medium">Local notes<Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={6} className="mt-2" /></label>{error ? <p role="alert" className="rounded-lg bg-muted p-3 text-xs">{error}</p> : null}<div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => onSave(notes, version ?? 0)}>Save notes</Button><Button variant="outline" disabled={busy || Boolean(resource.data.contextBlocked)} onClick={onCompact}><Icons.layersCompact className="size-4" aria-hidden />{busy ? 'Working…' : 'Compact context'}</Button></div></> : null}{onRebuild ? <OwnerContextRebuild summary={rebuildDraft} onSummaryChange={setRebuildDraft} onReviewLatest={() => { if (resource.status === 'ready' && resource.data) setRebuildSource(resource.data); else resource.refresh() }} onClose={() => setRebuildSource(null)} source={rebuildSource} currentVersion={resource.data?.version} busy={busy} error={error} onSubmit={async (summary) => { if (rebuildSource && await onRebuild(summary, rebuildSource.version)) { setRebuildSource(null); setRebuildDraft('') } }} /> : null}</div>
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
 return <WorkspaceOverlay title="Rebuild private context" open={source !== null} onClose={onClose} footer={source ? <div className="flex flex-wrap justify-end gap-2">{source.version !== currentVersion ? <Button type="button" variant="outline" aria-label="Review latest context" disabled={busy} onClick={onReviewLatest}>Review latest</Button> : null}<Button type="submit" form={formId} disabled={busy || !independent || !summary.trim() || source.version !== currentVersion}>Confirm safe rebuild</Button></div> : undefined}>{source ? <form id={formId} className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (!busy && independent && summary.trim()) void onSubmit(summary.trim()) }}><p className="rounded-lg bg-muted p-3 text-xs">This replaces private working context only. Restate the objectives, completed work, identifiers and unresolved questions that must survive. Original history, budgets, source archives, steering and operation receipts remain stored.</p><p className="text-xs text-muted-foreground">Reviewing v{source.version} · Current v{currentVersion}</p>{source.task ? <CollapsibleRoot className="rounded-lg border border-border p-3"><CollapsibleTrigger><span className="min-w-0 flex-1 text-left text-sm font-medium">Original task</span><Icons.chevronDown data-chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden /></CollapsibleTrigger><CollapsiblePanel><div className="mt-2 max-h-48 overflow-y-auto"><Markdown text={source.task} /></div></CollapsiblePanel></CollapsibleRoot> : null}<CollapsibleRoot className="rounded-lg border border-border p-3"><CollapsibleTrigger><span className="min-w-0 flex-1 text-left text-sm font-medium">Stored summary and source dependencies</span><Icons.chevronDown data-chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden /></CollapsibleTrigger><CollapsiblePanel><div className="mt-2 max-h-64 space-y-3 overflow-y-auto"><Markdown text={source.summary || 'No summary stored.'} />{source.sourceRefs?.map((ref) => <div key={`${ref.fileId}:${ref.hash}`} className="min-w-0 text-xs"><p className="break-words font-medium">{ref.filename} · Units {ref.ords.join(', ')}</p><code className="block break-all text-muted-foreground">{ref.hash}</code></div>)}</div></CollapsiblePanel></CollapsibleRoot><label className="block text-sm font-medium">Independent replacement<Textarea value={summary} onChange={(event) => onSummaryChange(event.target.value)} rows={7} maxLength={48000} required className="mt-2 block w-full rounded-lg border border-border bg-background p-3 text-sm focus-visible:ring-2 focus-visible:ring-ring" /></label>{summary.trim() ? <section aria-label="Replacement preview" className="rounded-lg border border-border p-3"><h3 className="mb-2 text-sm font-medium">Replacement preview</h3><Markdown text={summary} /></section> : null}<div className="flex items-start gap-2 text-xs"><CheckboxRoot aria-label="I reviewed this replacement" checked={source !== null && independent} disabled={source === null} onCheckedChange={(checked) => setConfirmedVersion(checked === true && source ? source.version : null)} className="mt-0.5" /><span>I reviewed this replacement. It preserves the required objectives and contains no hidden or changed-source content.</span></div>{error ? <p ref={failure} tabIndex={-1} role="alert" className="rounded-lg bg-muted p-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{error}</p> : null}{source.version !== currentVersion ? <p role="alert" className="text-xs">Context changed. This draft is kept; review the latest sources and confirm again before submitting.</p> : null}</form> : null}</WorkspaceOverlay>
}
