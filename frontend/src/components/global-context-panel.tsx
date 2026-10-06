// Global context panel: versioned sections, proposals, file blocks,
// usage, and the context editor.
import { FileTypeIcon } from './FileTypeIcon'
import { useState } from 'react'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { formatCount, humanizeKey, relativeAge } from '../lib/format'
import { focusRingInset } from '../lib/interaction'
import { BodySm, Caption, Numeric, Overline, SectionTitle } from './text'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { CollapsiblePanel, CollapsibleRoot, CollapsibleTrigger } from './ui/collapsible'
import { FieldControl, FieldDescription, FieldLabel, FieldRoot } from './ui/field'
import { List, ListRow, listRowClassName } from './ui/list'
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from './ui/menu'
import { PopoverPopup, PopoverRoot, PopoverTitle, PopoverTrigger } from './ui/popover'
import { ProgressRoot } from './ui/progress'
import { Textarea } from './ui/textarea'
import { Markdown } from './Markdown'
import type { Resource } from '../data/useWorkspace'
import type { ContextChange, ContextFileBlock, ContextPreview, GlobalContext, GlobalContextUsage, Sections } from '../data/useContexts'
import { IconButton } from './IconButton'
import { ConfirmAction } from './ui/alert-dialog'

import { ResourceNotice, WorkspaceOverlay } from './workspace-parts'

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
      <PopoverTrigger aria-label={`Global context token usage: ${formatCount(usage.total)} of ${formatCount(usage.budget)} tokens. Show breakdown.`} className="flex min-h-10 w-full flex-col justify-center rounded-md text-left outline-none min-[481px]:min-h-8">
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
            {/* No hover rows here, so skip the bleed recipe's -mx-2. */}
            <List aria-label="Pending context updates" className="mx-0">
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
