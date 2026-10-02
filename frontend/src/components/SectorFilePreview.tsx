import type { Resource } from '../data/useWorkspace'
import type { SectorFileBody, FileUnitsPage } from '../data/workspace-api'
import { Markdown } from './Markdown'
import { ResourceNotice } from './workspace-parts'
import { downloadBlob } from '../lib/download'
import { Button } from './ui/button'

export function SectorFilePreview({ resource, units, hasPrevious = false, onBrowse, onNext, onPrevious }: { resource: Resource<SectorFileBody>; units?: Resource<FileUnitsPage>; hasPrevious?: boolean; onBrowse?(): void; onNext?(): void; onPrevious?(): void }) {
  return <div className="space-y-4">
    <ResourceNotice resource={resource} label="File preview" />
    {resource.status === 'ready' && resource.data ? <>
      <p className="text-sm font-medium break-words">{resource.data.filename}</p>
      <Button variant="outline" onClick={() => {
        const data = resource.data
        if (!data) return
        const original = data.originalAvailable && data.contentBase64 !== undefined
        const bytes = original ? Uint8Array.from(atob(data.contentBase64!), (char) => char.charCodeAt(0)) : new TextEncoder().encode(data.text)
        downloadBlob(new Blob([bytes], { type: original ? data.mediaType : 'text/plain;charset=utf-8' }), original ? data.filename : `${data.filename}.extracted.txt`)
      }}>{resource.data.originalAvailable ? 'Download original file' : resource.data.textTruncated ? 'Download preview text' : 'Download extracted text'}</Button>
      {!resource.data.originalAvailable ? <p className="rounded-lg bg-muted p-3 text-xs">{resource.data.textTruncated ? 'The original upload was not archived. This download contains the displayed preview; browse indexed sections for remaining content.' : 'The original upload was not archived. This preview and download contain the retained extracted text.'}</p> : null}
      {resource.data.textTruncated ? <div className="rounded-lg bg-muted p-3 text-sm"><p>This is a bounded preview of {resource.data.fullChars?.toLocaleString()} indexed characters. All indexed sections remain available.</p>{!units && onBrowse ? <Button className="mt-2" variant="outline" onClick={onBrowse}>Browse indexed sections</Button> : null}</div> : null}
      {units ? <div className="space-y-3"><ResourceNotice resource={units} label="Indexed sections" />{units.status === 'ready' ? <>{units.data?.units.map((unit) => <section key={unit.ord} aria-label={`Indexed section ${unit.ord + 1}`} className="rounded-lg border border-border p-3"><p className="mb-2 text-xs text-muted-foreground">{unit.page ? `Page ${unit.page} · ` : ''}Section {unit.ord + 1}{unit.uncertain ? ' · AI-derived, uncertain' : ''}</p><Markdown text={unit.text} /></section>)}<div className="flex justify-between gap-2"><Button variant="outline" disabled={!hasPrevious} onClick={onPrevious}>Previous sections</Button><Button variant="outline" disabled={units.data?.nextOrd === null || units.data?.nextOrd === undefined} onClick={onNext}>Next sections</Button></div></> : null}</div> : resource.data.text ? <section aria-label="Extracted file content" className="min-w-0 rounded-lg border border-border p-4"><Markdown text={resource.data.text} /></section> : <p className="rounded-lg bg-muted p-3 text-sm">No extracted text is available. Download the original file to inspect it.</p>}
    </> : null}
  </div>
}
