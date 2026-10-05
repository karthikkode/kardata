import type { Resource } from '../data/useWorkspace'
import type { SectorFileBody, FileUnitsPage } from '../data/useFiles'
import { Icons } from '@/lib/icons'
import { formatCount } from '../lib/format'
import { downloadBlob } from '../lib/download'
import { notify } from '../lib/toast'
import { FileTypeIcon } from './FileTypeIcon'
import { Markdown } from './Markdown'
import { ResourceNotice } from './workspace-parts'
import { fileTypeLabel } from './workspace-files'
import { BodySm, Caption, CardTitle, Description } from './text'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from './ui/menu'

function downloadText(filename: string, text: string): void {
  downloadBlob(new Blob([new TextEncoder().encode(text)], { type: 'text/plain;charset=utf-8' }), filename)
}

function downloadOriginal(data: SectorFileBody): void {
  if (data.contentBase64 === undefined) {
    notify.error('The original file is not archived.')
    return
  }
  downloadBlob(
    new Blob([Uint8Array.from(atob(data.contentBase64), (char) => char.charCodeAt(0))], { type: data.mediaType }),
    data.filename,
  )
}

/** File preview dialog body (FL-06): header with the download menu,
 * extracted markdown or paged indexed sections, honest truncation and
 * no-text states. */
export function SectorFilePreview({ resource, units, hasPrevious = false, onBrowse, onNext, onPrevious }: { resource: Resource<SectorFileBody>; units?: Resource<FileUnitsPage>; hasPrevious?: boolean; onBrowse?(): void; onNext?(): void; onPrevious?(): void }) {
  const data = resource.status === 'ready' ? resource.data : undefined
  const originalReady = Boolean(data?.originalAvailable && data.contentBase64 !== undefined)
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ResourceNotice resource={resource} label="File preview" />
      {data ? (
        <>
          <div className="flex min-w-0 items-start gap-3">
            <PreviewIcon filename={data.filename} />
            <div className="min-w-0 flex-1">
              <CardTitle className="break-words">{data.filename}</CardTitle>
              <Description className="mt-0.5">
                {[fileTypeLabel(data.filename), data.fullChars !== undefined ? `${formatCount(data.fullChars)} characters` : null].filter((part): part is string => Boolean(part)).join(' · ')}
              </Description>
            </div>
            <MenuRoot>
              <MenuTrigger
                render={
                  <Button type="button" variant="secondary" size="sm" className="shrink-0">
                    Download
                    <Icons.chevronDown aria-hidden />
                  </Button>
                }
              />
              <MenuPopup>
                <MenuItem disabled={!originalReady} onClick={() => downloadOriginal(data)}>
                  <Icons.download aria-hidden />
                  Original file
                </MenuItem>
                <MenuItem disabled={!data.text} onClick={() => downloadText(`${data.filename}.extracted.txt`, data.text)}>
                  <Icons.download aria-hidden />
                  Extracted text
                </MenuItem>
              </MenuPopup>
            </MenuRoot>
          </div>
          {!data.originalAvailable ? (
            <div role="note" className="flex gap-2 rounded-md border border-info-border bg-info-soft p-3">
              <span className="flex h-5 shrink-0 items-center">
                <Icons.alertInfo aria-hidden className="size-4 text-info" />
              </span>
              <BodySm as="span" className="min-w-0 flex-1">
                {data.textTruncated
                  ? 'The original upload was not archived. The extracted-text download contains the displayed preview; browse indexed sections for remaining content.'
                  : 'The original upload was not archived. This preview and the extracted-text download contain the retained extracted text.'}
              </BodySm>
            </div>
          ) : null}
          {data.textTruncated ? (
            <div className="flex gap-2 rounded-md border border-info-border bg-info-soft p-3">
              <span className="flex h-5 shrink-0 items-center">
                <Icons.alertInfo aria-hidden className="size-4 text-info" />
              </span>
              <div className="min-w-0 flex-1">
                <BodySm as="span">This is a bounded preview of {data.fullChars?.toLocaleString()} indexed characters. All indexed sections remain available.</BodySm>
                {!units && onBrowse ? (
                  <div className="mt-2">
                    <Button type="button" variant="secondary" size="sm" onClick={onBrowse}>Browse indexed sections</Button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {units ? (
            <div className="flex min-w-0 flex-col gap-3">
              <ResourceNotice resource={units} label="Indexed sections" />
              {units.status === 'ready' ? <UnitsBody units={units.data} hasPrevious={hasPrevious} onNext={onNext} onPrevious={onPrevious} /> : null}
            </div>
          ) : data.text ? (
            <div className="mx-auto w-full max-w-prose-kd">
              <Markdown text={data.text} />
            </div>
          ) : (
            <div className="flex min-w-0 flex-col items-center py-12 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-muted">
                <Icons.fileDocs aria-hidden className="size-5 text-muted-foreground" />
              </span>
              <CardTitle className="mt-3">No extracted text</CardTitle>
              <Description className="mt-1 max-w-80">Download the original file to inspect it.</Description>
              {originalReady || data.text ? (
                <div className="mt-4">
                  <Button type="button" variant="secondary" size="sm" onClick={() => { if (originalReady) downloadOriginal(data); else downloadText(`${data.filename}.extracted.txt`, data.text) }}>
                    <Icons.download aria-hidden />
                    Download
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}

function PreviewIcon({ filename }: { filename: string }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken">
      <FileTypeIcon filename={filename} aria-hidden className="size-4 text-muted-foreground" />
    </span>
  )
}

function UnitsBody({ units, hasPrevious, onNext, onPrevious }: { units: FileUnitsPage | undefined; hasPrevious: boolean; onNext?(): void; onPrevious?(): void }) {
  const rows = units?.units ?? []
  if (!rows.length) {
    return <Caption>No indexed sections.</Caption>
  }
  const first = rows[0]!.ord + 1
  const last = rows[rows.length - 1]!.ord + 1
  const ended = units?.nextOrd === null || units?.nextOrd === undefined
  return (
    <>
      {rows.map((unit) => (
        <section key={unit.ord} aria-label={`Indexed section ${unit.ord + 1}`} className="rounded-lg border border-border p-3">
          <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
            <Caption className="min-w-0 flex-1">{unit.page ? `Page ${unit.page} · ` : ''}Section {unit.ord + 1}</Caption>
            {unit.uncertain ? <Badge tone="warning">Uncertain</Badge> : null}
          </div>
          <Markdown text={unit.text} />
        </section>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Caption aria-live="polite" className="tabular-nums">
          Sections {first}–{last}{ended ? ` of ${last}` : ''}
        </Caption>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={!hasPrevious} onClick={onPrevious}>Previous sections</Button>
          <Button type="button" variant="secondary" size="sm" disabled={ended} onClick={onNext}>Next sections</Button>
        </div>
      </div>
    </>
  )
}
