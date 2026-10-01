import type { Resource } from '../data/useWorkspace'
import type { SectorFileBody } from '../data/workspace-api'
import { Markdown } from './Markdown'
import { ResourceNotice } from './workspace-parts'
import { downloadBlob } from '../lib/download'
import { Button } from './ui/button'

export function SectorFilePreview({ resource }: { resource: Resource<SectorFileBody> }) {
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
      }}>{resource.data.originalAvailable ? 'Download original file' : 'Download extracted text'}</Button>
      {!resource.data.originalAvailable ? <p className="rounded-lg bg-muted p-3 text-xs">The original upload was not archived. This preview and download contain the retained extracted text.</p> : null}
      {resource.data.text ? <section aria-label="Extracted file content" className="min-w-0 rounded-lg border border-border p-4"><Markdown text={resource.data.text} /></section> : <p className="rounded-lg bg-muted p-3 text-sm">No extracted text is available. Download the original file to inspect it.</p>}
    </> : null}
  </div>
}
