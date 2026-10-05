import { useEffect, useMemo, useRef, useState } from 'react'
import { Icons } from '@/lib/icons'
import { relativeAge } from '@/lib/format'
import type { Resource } from '../data/useWorkspace'
import type { ExecutionRecordBody, ExecutionRecordPage } from '../data/api/execution-records'
import { ResourceNotice, WorkspaceOverlay } from './workspace-parts'
import { Button } from './ui/button'
import { IconButton } from './IconButton'
import { Caption } from './text'

const labels = { request: 'Request', response: 'Response', 'tool-result': 'Tool result' }
const kindTone = { request: 'bg-info', response: 'bg-success', 'tool-result': 'bg-border-strong' }
const DISPLAY_CHARS = 64_000

/** Seconds-aware age for the entries caption (relativeAge floors under a minute). */
function updatedAgo(at: string): string {
  const seconds = Math.round((Date.now() - new Date(at).getTime()) / 1000)
  if (!Number.isFinite(seconds)) return 'updated Unknown'
  if (seconds < 60) return `updated ${Math.max(0, seconds)}s ago`
  return `updated ${relativeAge(at)}`
}

export function ExecutionInspector({ page, body, selectedSeq, hasPrevious, onSelect, onNext, onPrevious, onClose, open = true }: {
  page: Resource<ExecutionRecordPage>; body: Resource<ExecutionRecordBody>; selectedSeq: number | null; hasPrevious: boolean
  onSelect(seq: number): void; onNext(): void; onPrevious(): void; onClose(): void; open?: boolean
}) {
  const selected = page.data?.records.find((record) => record.seq === selectedSeq)
  const details = useRef<HTMLElement>(null)
  const [limit, setLimit] = useState(DISPLAY_CHARS)
  const [viewed, setViewed] = useState(selectedSeq)
  if (viewed !== selectedSeq) { setViewed(selectedSeq); setLimit(DISPLAY_CHARS) }
  useEffect(() => {
    if (selectedSeq !== null && page.status === 'ready' && body.status !== 'loading') { details.current?.focus(); details.current?.scrollIntoView?.({ block: 'nearest' }) }
  }, [selectedSeq, body.status, page.status])
  const record = body.data?.record
  const boundary = record?.boundary && typeof record.boundary === 'object' && !Array.isArray(record.boundary) ? record.boundary as Record<string, unknown> : undefined
  const json = useMemo(() => record ? JSON.stringify(record, null, 2) : '', [record])
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(record)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = `execution-${selectedSeq}.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const latest = page.data?.records[0]
  return (
    <WorkspaceOverlay title="Execution records" side open={open} onClose={onClose} footer={<div className="flex justify-end"><Button type="button" variant="outline" onClick={onClose}>Close</Button></div>}>
      <div className="space-y-4">
        {selected ? <Caption>Execution {selected.seq} · {labels[selected.kind]}</Caption> : null}
        <div className="flex items-start justify-between gap-3"><p className="text-xs leading-relaxed text-muted-foreground">Saved normalized adapter inputs, results and tool boundaries. Historical snapshots retain the content seen at that time. Inspection requires an approver key.</p><IconButton label="Refresh execution records" size="icon-sm" onClick={page.refresh}><Icons.refresh className="size-4" aria-hidden /></IconButton></div>
        <ResourceNotice resource={page} label="Execution inspection" />
        {page.status === 'ready' ? page.data?.records.length ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Caption>{page.data.records.length} {page.data.records.length === 1 ? 'entry' : 'entries'} · {latest ? updatedAgo(latest.at) : 'updated Unknown'}</Caption>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={!hasPrevious} onClick={onPrevious}><Icons.chevronRight aria-hidden className="size-4 rotate-180" />Previous records</Button>
                <Button type="button" variant="outline" size="sm" disabled={page.data?.nextAfterSeq == null} onClick={onNext}>Next records<Icons.chevronRight aria-hidden className="size-4" /></Button>
              </div>
            </div>
            <ol aria-label="Recorded boundaries" className="scroll-slim max-h-56 space-y-2 overflow-y-auto">
              {page.data.records.map((entry) => (
                <li key={entry.seq}>
                  <button type="button" aria-label={`${labels[entry.kind]} · Round ${entry.round} · #${entry.seq}`} aria-pressed={entry.seq === selectedSeq} onClick={() => onSelect(entry.seq)} className={`w-full cursor-pointer rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${entry.seq === selectedSeq ? 'border-primary bg-primary-soft' : 'border-border hover:bg-surface-hover'}`}>
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span aria-hidden className={`size-2 shrink-0 rounded-full ${kindTone[entry.kind]}`} />
                      <span>#{entry.seq}</span>
                      <span className="min-w-0 truncate">{labels[entry.kind]} · Round {entry.round}</span>
                    </span>
                    <time dateTime={entry.at} className="mt-1 block text-xs text-muted-foreground">{new Date(entry.at).toLocaleString()}</time>
                  </button>
                </li>
              ))}
            </ol>
          </>
        ) : <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No execution records have been saved for this conversation.</p> : null}
        {selectedSeq !== null && page.status === 'ready' ? (
          <section ref={details} tabIndex={-1} aria-label="Execution record detail" className="space-y-3 rounded-lg border border-border p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ResourceNotice resource={body} label="Execution record" />
            {body.status === 'ready' && record ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">{selected ? labels[selected.kind] : 'Record'} · Round {selected?.round ?? 'Not recorded'}</h3><Button variant="outline" size="sm" onClick={download}><Icons.download className="size-3.5" aria-hidden />Download JSON</Button></div>
                <dl className="grid grid-cols-2 gap-2 text-xs"><dt className="text-muted-foreground">Provider</dt><dd className="break-words">{typeof record.provider === 'string' ? record.provider : 'Not recorded'}</dd><dt className="text-muted-foreground">Model</dt><dd className="break-all">{typeof record.model === 'string' ? record.model : 'Not recorded'}</dd>{(['contextVersion', 'planVersion', 'localVersion'] as const).filter((key) => typeof boundary?.[key] === 'number').map((key) => <div key={key} className="contents"><dt className="text-muted-foreground">{{ contextVersion: 'Global context observed', planVersion: 'Shared plan observed', localVersion: 'Local context observed' }[key]}</dt><dd>v{String(boundary?.[key])}</dd></div>)}</dl>
                {selected ? <details className="rounded border border-border p-3 text-xs"><summary className="cursor-pointer font-medium focus-visible:ring-2 focus-visible:ring-ring">Execution identity</summary><dl className="mt-2 space-y-2">{Object.entries({ 'Turn': selected.runKey, 'Attempt lease': selected.attemptLease, 'Workflow': selected.workflowId, 'Execution': selected.executionId, 'Owner epoch': selected.ownerEpoch, 'Archive hash': selected.ref.hash }).filter(([, value]) => value !== undefined).map(([name, value]) => <div key={name}><dt className="text-muted-foreground">{name}</dt><dd className="break-all font-mono">{value}</dd></div>)}<div><dt className="text-muted-foreground">Archived bytes</dt><dd>{selected.ref.bytes.toLocaleString()}</dd></div></dl></details> : null}
                <pre aria-label="Normalized execution JSON" tabIndex={0} className="scroll-slim max-h-72 overflow-auto rounded-lg bg-codeblock p-3 font-mono text-xs text-codeblock-foreground whitespace-pre-wrap [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{json.slice(0, limit)}</pre>
                {json.length > limit ? <div className="space-y-2"><p className="text-xs text-muted-foreground">Showing {limit.toLocaleString()} of {json.length.toLocaleString()} characters. Download JSON includes the complete record.</p><Button variant="outline" size="sm" onClick={() => setLimit((value) => value + DISPLAY_CHARS)}>Show more record text</Button></div> : null}
              </>
            ) : null}
          </section>
        ) : null}
      </div>
    </WorkspaceOverlay>
  )
}
