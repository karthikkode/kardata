// Workspace files: sector file library rows and states.
import { FileProcessingStatus } from './FileProcessingStatus'
import { FileTypeIcon } from './FileTypeIcon'
import { useMemo, useRef, useState } from 'react'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { formatCount, humanizeKey } from '../lib/format'
import { fileStatusLabel } from '../lib/labels'
import { focusRingInset } from '../lib/interaction'
import { notify } from '../lib/toast'
import { BodySm, Caption, Description, SectionTitle } from './text'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { List, listRowClassName } from './ui/list'
import { SearchField } from './shells'
import type { Resource } from '../data/useWorkspace'
import type { LibraryFile } from '../data/useFiles'
import { IconButton } from './IconButton'

import { ResourceNotice } from './workspace-parts'

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
 const needle = search.toLowerCase()
 const rows = useMemo(() => resource.data?.filter((file) => (hidden || !file.hidden) && file.filename.toLowerCase().includes(needle)) ?? [], [resource.data, hidden, needle])
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
