// Local context editor: per-thread notes, compaction, and rebuild.
import { useEffect, useId, useRef, useState } from 'react'
import { Icons } from '@/lib/icons'
import { formatCount, humanizeKey } from '../lib/format'
import { notify } from '../lib/toast'
import { BodySm, Caption, Description, Numeric, Overline } from './text'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { CheckboxRoot } from './ui/checkbox'
import { CollapsiblePanel, CollapsibleRoot, CollapsibleTrigger } from './ui/collapsible'
import { FieldControl, FieldDescription, FieldLabel, FieldRoot } from './ui/field'
import { ProgressRoot } from './ui/progress'
import { Textarea } from './ui/textarea'
import { Markdown } from './Markdown'
import type { Resource } from '../data/useWorkspace'
import type { LocalContext } from '../data/useContexts'
import type { OperationReceipt } from '../data/useThreads'

import { ResourceNotice, WorkspaceOverlay } from './workspace-parts'

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
