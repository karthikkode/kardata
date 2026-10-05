// Session artifact index: list, preview, download, and create. Rows come
// from the backend artifact index; creating a file refreshes the parent.
import { useRef, useState } from 'react'
import { Icons, fileIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { humanizeKey } from '../../lib/format'
import { notify } from '../../lib/toast'
import { downloadBlob } from '../../lib/download'
import { createArtifact, getArtifactBody } from '../../data/api/artifacts'
import { type StagingConfig } from '../../data/api/client'
import { Markdown } from '../Markdown'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { WorkspaceOverlay } from '../workspace-parts'
import { OperationNotice } from '../shells'
import { BodySm, Caption, Description, Label } from '../text'
import { List, listRowClassName } from '../ui/list'
import { Skeleton } from '../ui/skeleton'
import { IconButton } from '../IconButton'
import type { ChatFile } from './messages'

export function SessionFilesView({
  config,
  sessionId,
  files,
  onRefresh,
}: {
  config: StagingConfig | null
  sessionId: string
  files: ChatFile[]
  onRefresh: () => void
}) {
  const [selectedFile, setSelectedFile] = useState<ChatFile | null>(null)
  const [fileBody, setFileBody] = useState<string | null>(null)
  const [loadingBody, setLoadingBody] = useState(false)
  const [bodyError, setBodyError] = useState<string | null>(null)
  const previewRequest = useRef(0)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [newFileContent, setNewFileContent] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  function openPreview(file: ChatFile) {
    setSelectedFile(file)
    setFileBody(null)
    setBodyError(null)
    if (!config) {
      setBodyError('Preview needs a backend connection.')
      return
    }
    // A preview request for file A must never overwrite file B after
    // switching: only the latest request may settle into state.
    const request = previewRequest.current + 1
    previewRequest.current = request
    setLoadingBody(true)
    getArtifactBody(config, sessionId, file.id)
      .then((res) => {
        if (previewRequest.current !== request) return
        setFileBody(res.body)
      })
      .catch(() => {
        if (previewRequest.current !== request) return
        setBodyError('Could not load the file preview. Existing files are kept. Try again.')
      })
      .finally(() => {
        if (previewRequest.current === request) setLoadingBody(false)
      })
  }

  function downloadFile(file: ChatFile) {
    if (!config) {
      notify.error(`Download of ${file.name} needs a backend connection.`)
      return
    }
    getArtifactBody(config, sessionId, file.id)
      .then((res) => {
        const blob = new Blob([res.body], { type: 'text/plain;charset=utf-8' })
        downloadBlob(blob, file.name)
      })
      .catch(() => {
        notify.error(`Download of ${file.name} failed. The file is kept. Try again.`)
      })
  }

  // fileIcon() is a pure extension lookup returning a stable lucide
  // reference, never a per-render component definition.
  const PreviewFileIcon = selectedFile ? fileIcon(selectedFile.name) : Icons.fileDocs

  async function handleCreateFile() {
    if (!config || !newFileName.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      await createArtifact(config, sessionId, {
        name: newFileName.trim(),
        content: newFileContent,
        kind: 'file',
        reason: 'user_upload',
      })
      setNewFileName('')
      setNewFileContent('')
      setCreateOpen(false)
      onRefresh()
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Could not create file.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex h-full flex-col px-3 py-3">
      <div className="flex items-center gap-2 px-1 pb-2">
        <Caption className="min-w-0 flex-1 truncate tabular-nums">
          Session files · {files.length} {files.length === 1 ? 'file' : 'files'}
        </Caption>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setCreateOpen(true)}
        >
          <Icons.plus className="size-3.5" aria-hidden />
          New file
        </Button>
      </div>

      {createOpen ? (
        <WorkspaceOverlay
          title="New file"
          size="small"
          onClose={() => setCreateOpen(false)}
          initialFocus={nameInputRef}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="button" variant="primary" pending={creating} disabled={!newFileName.trim()} onClick={() => void handleCreateFile()}>Create file</Button>
            </>
          }
        >
          <form aria-label="New file" className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void handleCreateFile() }}>
            <div>
              <Label as="label" htmlFor="session-file-name">File name</Label>
              <Input
                ref={nameInputRef}
                id="session-file-name"
                value={newFileName}
                disabled={creating}
                onChange={(event) => setNewFileName(event.target.value)}
                placeholder="notes.md"
                className="mt-1.5 font-mono"
              />
              <Caption className="mt-1.5">Include an extension, e.g. notes.md</Caption>
            </div>
            <div>
              <Label as="label" htmlFor="session-file-content">Content</Label>
              <Textarea
                id="session-file-content"
                value={newFileContent}
                disabled={creating}
                onChange={(event) => setNewFileContent(event.target.value)}
                rows={12}
                className="scroll-slim mt-1.5 font-mono text-xs"
              />
            </div>
            {createError ? <OperationNotice phase="error" title="Could not create the file." detail={createError} /> : null}
          </form>
        </WorkspaceOverlay>
      ) : null}

      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-1">
        {files.length === 0 ? (
          <div className="px-1 py-6 text-center">
            <Description>No files yet. Files Karbot or subagents create appear here.</Description>
          </div>
        ) : (
          <List aria-label="Session files">
            {files.map((file) => {
              const FileIcon = fileIcon(file.name)
              const extension = file.name.includes('.') ? file.name.split('.').pop()?.toUpperCase() ?? 'FILE' : 'FILE'
              const sourceLabel = humanizeKey(file.source)
              const detailLabel = file.detail && file.detail.toLowerCase() !== file.source.toLowerCase() ? file.detail : null
              return (
                <li key={file.id} className="group relative">
                  <button
                    type="button"
                    aria-label={`Preview ${file.name}`}
                    title={file.name}
                    onClick={() => openPreview(file)}
                    className={cn(listRowClassName({ density: 'comfortable' }), 'w-full pr-12 text-left')}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-muted-foreground">
                      <FileIcon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <BodySm as="span" className="block truncate font-medium">{file.name}</BodySm>
                      <Description as="span" className="block truncate">
                        {extension} · {sourceLabel}{detailLabel ? ` · ${detailLabel}` : ''}
                      </Description>
                    </span>
                  </button>
                  <IconButton
                    label={`Download ${file.name}`}
                    size="icon-sm"
                    type="button"
                    onClick={() => downloadFile(file)}
                    className="absolute top-1/2 right-1 -translate-y-1/2 transition-opacity duration-120 pointer-coarse:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100"
                  >
                    <Icons.download className="size-4" aria-hidden />
                  </IconButton>
                </li>
              )
            })}
          </List>
        )}
      </div>

      {selectedFile ? (
        <WorkspaceOverlay
          title="File preview"
          size="large"
          onClose={() => setSelectedFile(null)}
          titleBadge={
            <Button type="button" variant="secondary" size="sm" onClick={() => { if (selectedFile) downloadFile(selectedFile) }}>
              <Icons.download className="size-3.5" aria-hidden />
              Download
            </Button>
          }
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-muted-foreground">
              {/* eslint-disable-next-line react-hooks/static-components -- stable lookup result, see above */}
              <PreviewFileIcon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <BodySm as="p" title={selectedFile.name} className="truncate font-medium">{selectedFile.name}</BodySm>
              <Description as="p" className="truncate">
                {humanizeKey(selectedFile.source)}{selectedFile.detail && selectedFile.detail.toLowerCase() !== selectedFile.source.toLowerCase() ? ` · ${selectedFile.detail}` : ''}
              </Description>
            </div>
          </div>
          <div className="scroll-slim mt-3 max-h-[50vh] overflow-y-auto">
            {loadingBody ? (
              <div role="status" aria-label="Loading file preview" className="flex flex-col gap-2">
                <Skeleton className="h-3.5 w-11/12" />
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-3/4" />
              </div>
            ) : bodyError ? (
              <div role="alert" className="flex gap-2 rounded-md border border-danger-border bg-danger-soft p-3">
                <span className="flex h-5 shrink-0 items-center">
                  <Icons.alertError className="size-4 text-danger" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <BodySm as="p">{bodyError}</BodySm>
                  <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => { if (selectedFile) openPreview(selectedFile) }}>
                    Try again
                  </Button>
                </div>
              </div>
            ) : fileBody !== null && fileBody !== '' ? (
              <Markdown text={fileBody} />
            ) : (
              <Description as="p">Empty file.</Description>
            )}
          </div>
        </WorkspaceOverlay>
      ) : null}
    </div>
  )
}
