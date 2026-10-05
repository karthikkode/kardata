// Assistant chat over the real backend. Sessions, threads, messages,
// files, and runs come from the API; sends go through commands; replies
// arrive on the thread stream. No fixtures, no simulated replies, no local
// uploads: every row on screen was served by the backend.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Icons, fileIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { humanizeKey } from '../lib/format'
import { notify } from '../lib/toast'
import { focusRingInset } from '../lib/interaction'
import { downloadBlob } from '../lib/download'
import { dockEnter, dockExit, popoverEnter, popoverExit, useExitState } from '@/lib/motion'
import {
  cancelRun,
  compactSession,
  createArtifact,
  createSession,
  deleteSession,
  followThread,
  getArtifactBody,
  listMessages,
  listRuns,
  pauseRun,
  resumeRun,
  listSessionArtifacts,
  listSessions,
  listSkills,
  listThreads,
  renameSession,
  sendThreadText,
  steerThread,
  apiErrorStatus,
  StagingApiError,
  type ArtifactSummary,
  type LiveMessage,
  type Session,
  type SkillSummary,
  type StagingConfig,
  type ThreadView,
  type ToolPayload,
} from '../data/staging-api'
import { Markdown } from './Markdown'
import { ThreadPrimitive } from '@assistant-ui/react'
import { AssistantRuntimeAdapter } from './chat/AssistantRuntimeAdapter'
import { toThreadSegments } from './chat/assistantAdapter'
import { ModelToolbar } from './ModelToolbar'
import { SubagentsPanel } from './SubagentsPanel'
import { PanelError, ToolRow, UnavailableNotice } from './research-parts'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { ConfirmAction } from './ui/alert-dialog'
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from './ui/menu'
import { WorkspaceOverlay } from './workspace-parts'
import { ConversationComposer, OperationNotice } from './shells'
import { AgentBubble, UserBubble } from './chat-parts'
import { ConversationEmpty } from './chat/ConversationEmpty'
import { ReasoningDisclosure, useReasoningOpen } from './chat/ReasoningDisclosure'
import { ThinkingRow } from './chat/ThinkingRow'
import { ToolActivity } from './chat/ToolActivity'
import { BodySm, Caption, CardTitle, Description, Label, Mono } from './text'
import { List, listRowClassName } from './ui/list'
import { Skeleton } from './ui/skeleton'
import { Composer } from './chat/Composer'
import { IconButton } from './IconButton'

export type ChatScope = { id: string; name: string } | null

type ChatText = {
  id: string
  kind: 'text'
  role: 'user' | 'agent'
  text: string
  /** Provider thinking trace; rendered as a collapsible block. */
  reasoning?: string
  failed?: boolean
  missedSteer?: boolean
  /** Server stamp; rendered as relative age, omitted when absent. */
  at?: string
}

export type ChatTool = {
  id: string
  kind: 'tool'
  name: string
  detail: string
  state: 'running' | 'done' | 'failed'
  /** Client-side first-seen stamp (live rows only) for elapsed display. */
  seenAt?: number
  /** Server stamp; rendered as relative age, omitted when absent. */
  at?: string
}

export type ChatMessage = ChatText | ChatTool

export function messageSeq(message: ChatMessage): number {
  return Number(message.id.slice(2)) || 0
}

// Dead-stream bound: consecutive error snapshots before the tail stops
// waiting silently and fails visible instead of spinning Replying forever
// (a turn that dies server-side with no terminal message otherwise wedges
// the indicator: the hold-open tail never ends on its own).
const STREAM_ERROR_LIMIT = 3

export type ChatFile = {
  id: string
  name: string
  detail: string
  source: string
}

type LoadState = 'loading' | 'ready' | 'error' | 'denied' | 'offline'

function offlineNow(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function loadStateOf(error: unknown): LoadState {
  return apiErrorStatus(error)
}

/** Relative age for session rows, computed from real timestamps. */
export function sessionAge(at: string, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - Date.parse(at))
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Server message records to chat rows. Unknown kinds are skipped, never
 * rendered as guesswork. Approval cards have no server producer, so only
 * text and tool rows exist. */
export function toChatMessages(raw: unknown[]): ChatMessage[] {
  const rows: ChatMessage[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const kind = textOf(entry['kind'])
    const seq = typeof entry['seq'] === 'number' ? entry['seq'] : undefined
    if (seq === undefined) continue
    const id = `m-${seq}`
    const at = textOf(entry['at'])
    if (kind === 'text') {
      const role = textOf(entry['role'])
      const text = textOf(entry['text'])
      if ((role === 'user' || role === 'agent') && text !== undefined) {
        const row: ChatText = { id, kind: 'text', role, text }
        const reasoning = textOf(entry['reasoning'])
        if (reasoning !== undefined && role === 'agent') row.reasoning = reasoning
        if (entry['failed'] === true) row.failed = true
        if (entry['missedSteer'] === true) row.missedSteer = true
        if (at !== undefined) row.at = at
        rows.push(row)
      }
    } else if (kind === 'tool') {
      const name = textOf(entry['name']) ?? 'Tool call'
      const detail = textOf(entry['detail']) ?? ''
      const state = textOf(entry['state'])
      rows.push({
        id,
        kind: 'tool',
        name,
        detail,
        state: state === 'done' || state === 'failed' ? state : 'running',
        ...(at === undefined ? {} : { at }),
      })
    }
  }
  return rows
}

export type MessageSegment = { key: string; tools: ChatTool[]; reply?: ChatText } | { key: string; message: ChatMessage }

/** Fold consecutive tool rows into one collapsible group per turn; text
 * rows pass through untouched. Grouping is purely presentational: the
 * message order from the server never changes. Segments are not a wire
 * shape, so they must not join the contract parity table. */
export function groupMessageSegments(messages: ChatMessage[]): MessageSegment[] {
  const segments: MessageSegment[] = []
  for (const message of messages) {
    const last = segments[segments.length - 1]
    if (message.kind === 'tool' && last !== undefined && 'tools' in last) {
      last.tools.push(message)
    } else if (message.kind === 'tool') {
      segments.push({ key: message.id, tools: [message] })
    } else if (message.kind === 'text' && message.role === 'agent' && last !== undefined && 'tools' in last && !last.reply) {
      last.reply = message
    } else {
      segments.push({ key: message.id, message })
    }
  }
  return segments
}

export function toLiveMessages(raw: LiveMessage[]): ChatMessage[] {
  return toChatMessages(
    raw.map((message, index) => ({
      seq: message.seq ?? 1_000_000 + index,
      kind: message.kind,
      role: message.role,
      text: message.text,
      ...(message.reasoning === undefined ? {} : { reasoning: message.reasoning }),
      // Tool rows stream with their identity and lifecycle attached;
      // dropping them here is what rendered every live tool as a
      // nameless, permanently-running row.
      ...(message.name === undefined ? {} : { name: message.name }),
      ...(message.detail === undefined ? {} : { detail: message.detail }),
      ...(message.state === undefined ? {} : { state: message.state }),
      at: message.at ?? '',
    })),
  )
}

/** REST and SSE can finish in either order. Merge by the shared thread seq
 * so a slower history request never erases a newly streamed reply. */
export function mergeChatMessages(left: ChatMessage[], right: ChatMessage[]): ChatMessage[] {
  const byId = new Map(left.map((message) => [message.id, message]))
  for (const message of right) byId.set(message.id, message)
  return [...byId.values()].sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)))
}

function toChatFile(summary: ArtifactSummary): ChatFile {
  return {
    id: summary.artifactId,
    name: summary.name ?? summary.artifactId,
    detail: summary.detail ?? summary.kind ?? '',
    source: summary.kind ?? 'artifact',
  }
}

// Past sessions: titles with ages, one active row, and a new-session
// action. Switching swaps the visible thread.
export function SessionsPanel({
  sessions,
  activeId,
  pinnedId = null,
  closing,
  deleting,
  onOpen,
  onNew,
  onDelete,
  onClose,
  onEscape,
}: {
  sessions: Session[]
  activeId: string | null
  /** Research session: pinned first with a marker. Null in Karbot. */
  pinnedId?: string | null
  closing: boolean
  deleting: boolean
  onOpen: (session: Session) => void
  onNew: () => void
  onDelete: (session: Session) => void
  onClose: () => void
  onEscape: () => void
}) {
  // Row with its delete armed. Stays local: confirming never fires the
  // request, and a successful delete removes the row from the list.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const ordered = [...sessions].sort((a, b) => {
    const aPinned = pinnedId !== null && a.id === pinnedId
    const bPinned = pinnedId !== null && b.id === pinnedId
    if (aPinned === bPinned) return 0
    return aPinned ? -1 : 1
  })
  return (
    <>
      <button
        type="button"
        aria-label="Dismiss sessions"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-transparent"
      />
      <div
        role="menu"
        aria-label="Chat sessions"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onEscape()
          }
        }}
        className={`absolute left-0 top-full z-50 mt-1 max-h-80 w-80 scroll-slim overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md ${closing ? popoverExit : popoverEnter}`}
      >
        <button
          type="button"
          role="menuitem"
          aria-label="New chat"
          autoFocus
          onClick={onNew}
          className={`flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-ui hover:bg-surface-hover ${focusRingInset}`}
        >
          <Icons.newChat className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">New chat</span>
        </button>
        <div aria-hidden className="mx-1 my-1 border-t border-border-subtle" />
        {sessions.length === 0 ? (
          <p className="px-2 py-1.5 text-ui text-muted-foreground">
            No chats yet.
          </p>
        ) : null}
        {ordered.map((session) => {
          const active = session.id === activeId
          return (
            <div
              key={session.id}
              className={`group flex min-h-11 items-center gap-1 rounded-md px-1 py-0.5 ${
                active ? 'bg-surface-active' : 'hover:bg-surface-hover'
              }`}
            >
              {active ? (
                <Icons.approve className="size-4 shrink-0 text-primary-text" aria-hidden />
              ) : (
                <span aria-hidden className="size-4 shrink-0" />
              )}
              <button
                type="button"
                role="menuitem"
                aria-current={active ? 'true' : undefined}
                aria-label={`Open ${session.title}`}
                onClick={() => onOpen(session)}
                className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-left ${focusRingInset}`}
              >
                {pinnedId !== null && session.id === pinnedId ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
                    <Icons.pin className="size-3.5" aria-hidden />
                    Research
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">
                  <BodySm as="span" className={`block truncate ${active ? 'font-medium' : ''}`}>{session.title}</BodySm>
                  <Mono className="block truncate text-xs text-muted-foreground">{session.id}</Mono>
                </span>
                <Caption as="span" className="shrink-0 tabular-nums">
                  {sessionAge(session.updatedAt)}
                </Caption>
              </button>
              {confirmingId === session.id ? (
                <ConfirmAction
                  open
                  onOpenChange={(open) => {
                    if (!open) setConfirmingId(null)
                  }}
                  title={`Delete "${session.title}"?`}
                  description="This removes the chat from the session list. Its history is retained in the audit log."
                  confirmLabel="Delete conversation"
                  pending={deleting}
                  onConfirm={() => {
                    onDelete(session)
                    setConfirmingId(null)
                  }}
                />
              ) : null}
              <IconButton
                label={`Delete ${session.title}`}
                size="icon-sm"
                type="button"
                disabled={deleting}
                onClick={() => setConfirmingId(session.id)}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
              >
                <Icons.delete className="size-4" aria-hidden />
              </IconButton>
            </div>
          )
        })}
      </div>
    </>
  )
}

// The + menu: every file in the session's artifact index. Uploads have no
// backend endpoint, so the menu lists indexed files only.
export function FilesMenu({
  files,
  closing,
  onPick,
  onClose,
  onEscape,
}: {
  files: ChatFile[]
  closing: boolean
  onPick: (file: ChatFile) => void
  onClose: () => void
  onEscape: () => void
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Dismiss files"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-transparent"
      />
      <div
        role="menu"
        aria-label="Attach file"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onEscape()
          }
        }}
        className={`absolute bottom-full left-0 z-50 mb-2 max-h-64 w-72 scroll-slim overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md ${closing ? popoverExit : popoverEnter}`}
      >
        {files.length === 0 ? (
          <p className="px-2 py-1.5 text-ui text-muted-foreground">
            No files indexed in this session yet.
          </p>
        ) : null}
        {files.map((file) => {
          const FileTypeIcon = fileIcon(file.name)
          return (
            <button
              key={file.id}
              type="button"
              role="menuitem"
              onClick={() => onPick(file)}
              className={`flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-ui hover:bg-surface-hover ${focusRingInset}`}
            >
              <FileTypeIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{file.name}</span>
                <Caption as="span" className="block truncate">{file.source}</Caption>
              </span>
            </button>
          )
        })}
      </div>
    </>
  )
}

// @-references to indexed files render as chips inside the user's own
// words. Unknown @-words stay plain text.
function renderMentionChips(text: string, files: ChatFile[]) {
  return text.split(/(@[\w.-]+)/g).map((part, index) => {
    const name = part.startsWith('@') ? part.slice(1) : ''
    if (name && files.some((file) => file.name === name)) {
      return (
        <span
          key={index}
          className="mx-0.5 inline-flex items-center rounded-md border border-border bg-background px-1.5 font-medium"
        >
          @{name}
        </span>
      )
    }
    return part
  })
}

interface ReasoningControl {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function MessageBubble({ message, files, live = false, latest = false, reasoningControl }: { message: ChatText; files: ChatFile[]; live?: boolean; latest?: boolean; reasoningControl?: ReasoningControl }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <UserBubble>
          {renderMentionChips(message.text, files)}
        </UserBubble>
      </div>
    )
  }
  return (
    <div className="min-w-0 space-y-2">
      {message.reasoning ? <ReasoningDisclosure reasoning={message.reasoning} open={reasoningControl?.open} onOpenChange={reasoningControl?.onOpenChange} /> : null}
      {message.text ? (
        <AgentBubble copyText={live ? undefined : message.text} timestamp={message.at} latest={latest && !live}>
          <Markdown text={message.text} />
          {message.failed ? (
            <BodySm as="span" className="mt-1 block text-muted-foreground">This reply failed.</BodySm>
          ) : null}
          {message.missedSteer ? (
            <BodySm as="span" className="mt-1 block text-muted-foreground">
              Sent after the run moved on: shown, not relaunched.
            </BodySm>
          ) : null}
        </AgentBubble>
      ) : null}
    </div>
  )
}

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

export function ChatPanel({
  config,
  scope,
  closing = false,
  onClose,
  // Backend-owned context summary, rendered verbatim. The backend recomputes
  // it as the research changes; this chip only displays and announces it.
  // contextDetails are the backend-owned breakdown rows shown on demand.
  contextSummary,
  contextDetails = [],
}: {
  /** Null until the staging flag carries credentials: chat is backend-only,
   * so without a config the panel explains instead of inventing a thread. */
  config: StagingConfig | null
  scope: ChatScope
  closing?: boolean
  onClose: () => void
  contextSummary: string | null
  contextDetails?: { label: string; value: string }[]
}) {
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [sessionsState, setSessionsState] = useState<LoadState>('loading')
  const [sessionsAttempt, setSessionsAttempt] = useState(0)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [threads, setThreads] = useState<ThreadView[]>([])
  const [threadsState, setThreadsState] = useState<LoadState>('loading')
  const [threadsAttempt, setThreadsAttempt] = useState(0)
  const [openThreadKey, setOpenThreadKey] = useState<string | null>(null)
  const [caches, setCaches] = useState<Record<string, ChatMessage[]>>({})
  const [pendingText, setPendingText] = useState<string | null>(null)
  const [pendingReasoning, setPendingReasoning] = useState<string | null>(null)
  // Live tool rows carry a client-side first-seen stamp so running calls
  // can show elapsed time. The wire ToolPayload is unchanged.
  const [pendingTools, setPendingTools] = useState<Array<ToolPayload & { seenAt?: number }>>([])
  const [awaitingReply, setAwaitingReply] = useState<{ basis: number } | null>(null)
  const [streamAttempt, setStreamAttempt] = useState(0)
  const [working, setWorking] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [pendingSend, setPendingSend] = useState<string | null>(null)
  // Optimistic echo: the run appends the user message seconds later, so
  // the sent text renders instantly. It hides the moment the confirmed
  // copy lands (any list growth past the send-time basis), never a
  // duplicate, never guesswork beyond the user's own words. Unlike
  // pendingSend (the retry payload, cleared on accept), the echo must
  // survive until confirmation arrives over the stream, so it lives in
  // its own state written only from event handlers and cleanup.
  const [echo, setEcho] = useState<{ text: string; basis: number } | null>(null)
  const [runs, setRuns] = useState<Array<{ id: string; threadKey: string }>>([])
  const [files, setFiles] = useState<ChatFile[]>([])
  const [activeTab, setActiveTab] = useState<'conversation' | 'files'>('conversation')
  const [planMode, setPlanMode] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [compactStatus, setCompactStatus] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [savingName, setSavingName] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deletingSession, setDeletingSession] = useState(false)
  const [mentionClosed, setMentionClosed] = useState(false)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [skillsFailed, setSkillsFailed] = useState(false)
  const [skillClosed, setSkillClosed] = useState(false)
  const [skillIndex, setSkillIndex] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const streamControllers = useRef<Record<string, AbortController>>({})
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const sessionsButtonRef = useRef<HTMLButtonElement>(null)
  const contextButtonRef = useRef<HTMLButtonElement>(null)
  const sessionsPanel = useExitState()
  const filesMenu = useExitState()
  const contextPanel = useExitState()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreOpenRef = useRef(false)
  function setMoreOpenState(next: boolean) {
    moreOpenRef.current = next
    setMoreOpen(next)
  }
  const renameInputRef = useRef<HTMLInputElement>(null)
  const renameSelectedRef = useRef(false)

  // The visible thread: an opened subagent thread, else the session thread.
  // The session thread key is the session id (sessions.ts: create starts it).
  const threadKey = openThreadKey ?? activeSessionId
  const threadKeyRef = useRef<string | null>(threadKey)
  useEffect(() => {
    threadKeyRef.current = threadKey
  }, [threadKey])
  // Fresh mirrors for the hold-open tail: its closure must read the reply
  // wait and the sent text as of the failure, not as of subscribe time.
  const awaitingRef = useRef<{ basis: number } | null>(null)
  useEffect(() => {
    awaitingRef.current = awaitingReply
  }, [awaitingReply])
  const echoRef = useRef<{ text: string; basis: number } | null>(null)
  useEffect(() => {
    echoRef.current = echo
  }, [echo])
  const messages = (threadKey ? caches[threadKey] : undefined) ?? []
  const activeSession = sessions?.find((session) => session.id === activeSessionId) ?? null
  const openThread = openThreadKey ? threads.find((thread) => thread.key === openThreadKey) : undefined
  const subagentThreads = threads.filter((thread) => thread.kind === 'subagent')

  const mentionMatch = mentionClosed ? null : draft.match(/@([\w.-]*)$/)
  const mentionQuery = mentionMatch ? mentionMatch[1].toLowerCase() : ''
  // One @ index: subagent threads first, then files.
  const mentionOptions =
    mentionMatch && !filesMenu.mounted
      ? [
          ...subagentThreads
            .filter((thread) => thread.key.toLowerCase().includes(mentionQuery))
            .map((thread) => ({ id: thread.key, name: thread.key, hint: 'Thread', kind: 'thread' as const })),
          ...files
            .filter((file) => file.name.toLowerCase().includes(mentionQuery))
            .map((file) => ({ id: file.id, name: file.name, hint: humanizeKey(file.source), kind: 'file' as const })),
        ]
      : []
  const mentionOpen = mentionMatch !== null && mentionOptions.length > 0 && !filesMenu.mounted
  const mentionNoMatch = mentionMatch !== null && mentionOptions.length === 0 && !filesMenu.mounted
  // Slash skills: a leading `/` opens the skill picker. Picking inserts
  // `/name `; the server parses and validates on send.
  const skillMatch = skillClosed ? null : draft.match(/^\/([\w-]*)$/)
  const skillQuery = skillMatch ? skillMatch[1].toLowerCase() : ''
  const skillOptions =
    skillMatch !== null
      ? skills.filter((skill) => skill.name.toLowerCase().includes(skillQuery))
      : []
  const skillOpen = skillMatch !== null && !skillsFailed && skillOptions.length > 0
  const skillNoMatch = skillMatch !== null && !skillsFailed && skillOptions.length === 0

  function insertSkill(skill: SkillSummary) {
    setDraft(`/${skill.name} `)
    setSkillClosed(true)
    inputRef.current?.focus()
  }
  const taggedThread = subagentThreads.find((thread) => draft.includes(`@${thread.key}`)) ?? null

  // Stick-to-bottom autoscroll: new content pins the log only while the
  // user is already at the bottom. Scrolling up reveals a back-to-latest
  // button instead of yanking the reader.
  const logRef = useRef<HTMLDivElement>(null)
  const stuckRef = useRef(true)
  const [showLatest, setShowLatest] = useState(false)

  function stickToBottom() {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }

  function resetScroll() {
    stuckRef.current = true
    setShowLatest(false)
  }

  function onLogScroll() {
    const log = logRef.current
    if (!log) return
    const stuck = log.scrollHeight - log.scrollTop - log.clientHeight < 48
    stuckRef.current = stuck
    setShowLatest(!stuck && log.scrollHeight > log.clientHeight)
  }

  useEffect(() => {
    if (stuckRef.current) stickToBottom()
  }, [messages, pendingText, pendingTools, working])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape' && !moreOpenRef.current) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Sessions reset during render, never in the fetch effect: when the
  // query changes the previous rows no longer belong to it. The first
  // session activates; an id that no longer exists falls back to the
  // first row.
  const sessionQuery = config ? `${config.baseUrl} ${config.apiKey} ${sessionsAttempt}` : null
  const [activeSessionQuery, setActiveSessionQuery] = useState<string | null>(null)
  if (activeSessionQuery !== sessionQuery) {
    setActiveSessionQuery(sessionQuery)
    if (sessionQuery === null) {
      setSessions([])
      setSessionsState('ready')
    } else {
      setSessionsState('loading')
    }
  }

  // Sessions load once per config.
  useEffect(() => {
    if (!config) return
    let live = true
    listSessions(config)
      .then((rows) => {
        if (!live) return
        setSessions(rows)
        setSessionsState('ready')
        setActiveSessionId((current) => {
          if (current && rows.some((row) => row.id === current)) return current
          return rows[0]?.id ?? null
        })
      })
      .catch((error: unknown) => {
        if (!live) return
        setSessionsState(loadStateOf(error))
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.baseUrl, config?.apiKey, sessionsAttempt])

  // Skill catalogue for the slash picker: loaded once per config, filtered
  // locally. A failed load hides the picker (plain text still sends).
  useEffect(() => {
    if (!config) return
    let live = true
    listSkills(config)
      .then((rows) => {
        if (!live) return
        setSkills(rows)
        setSkillsFailed(false)
      })
      .catch(() => {
        if (!live) return
        setSkillsFailed(true)
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.baseUrl, config?.apiKey])

  // Threads, runs, and the file index reset during render, never in the
  // fetch effect: when the query changes the previous rows belong to
  // another session.
  const threadQuery =
    config && activeSessionId ? `${config.baseUrl} ${config.apiKey} ${activeSessionId} ${threadsAttempt}` : null
  const [activeThreadQuery, setActiveThreadQuery] = useState<string | null>(null)
  if (activeThreadQuery !== threadQuery) {
    setActiveThreadQuery(threadQuery)
    if (threadQuery === null) {
      setThreads([])
      setRuns([])
      setFiles([])
      setThreadsState(activeSessionId ? 'loading' : 'ready')
    } else {
      setThreadsState('loading')
    }
  }

  // Threads, runs, and the file index follow the active session.
  useEffect(() => {
    if (!config || !activeSessionId) return
    let live = true
    Promise.all([
      listThreads(config, activeSessionId),
      listRuns(config, activeSessionId),
      listSessionArtifacts(config, activeSessionId),
    ])
      .then(([threadRows, runRows, artifacts]) => {
        if (!live) return
        setThreads(threadRows)
        setRuns(runRows.map((run) => ({ id: run.id, threadKey: run.threadKey })))
        setFiles(artifacts.map(toChatFile))
        setThreadsState('ready')
      })
      .catch((error: unknown) => {
        if (!live) return
        setThreadsState(loadStateOf(error))
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.baseUrl, config?.apiKey, activeSessionId, threadsAttempt])

  // Stream state resets during render, never in the tail effect: the
  // pending delta/reasoning/tools belong to the previous thread.
  const streamQuery =
    config && threadKey ? `${config.baseUrl} ${config.apiKey} ${threadKey} ${streamAttempt}` : null
  const [activeStreamQuery, setActiveStreamQuery] = useState<string | null>(null)
  if (activeStreamQuery !== streamQuery) {
    setActiveStreamQuery(streamQuery)
    setPendingText(null)
    setPendingReasoning(null)
    setPendingTools([])
  }

  // Message pages follow the visible thread; the stream tails live frames.
  // The tail never sets working: it runs silently in the background while
  // deltas render through pendingText. followThread self-heals dropped
  // connections, so the only exits are thread switches and unmount.
  useEffect(() => {
    if (!config || !threadKey) return
    let live = true
    const key = threadKey
    listMessages(config, key)
      .then((raw) => {
        if (!live) return
        const rows = toChatMessages(raw)
        setCaches((current) => ({ ...current, [key]: mergeChatMessages(current[key] ?? [], rows) }))
      })
      .catch(() => {
        if (!live) return
      })
    const controller = new AbortController()
    streamControllers.current[key] = controller
    let deadErrors = 0
    let streamDead = false
    void (async () => {
      try {
        for await (const snapshot of followThread(config, key, controller.signal, { reconnectOnEOF: true })) {
          if (!live || controller.signal.aborted) return
          if (snapshot.error) {
            deadErrors += 1
            if (deadErrors >= STREAM_ERROR_LIMIT) {
              streamDead = true
              break
            }
            continue
          }
          deadErrors = 0
          setCaches((current) => ({ ...current, [key]: mergeChatMessages(current[key] ?? [], toLiveMessages(snapshot.messages)) }))
          setPendingText(snapshot.pendingText)
          setPendingReasoning(snapshot.pendingReasoning)
          setPendingTools((current) => {
            const seen = new Map(current.map((tool) => [tool.id, tool.seenAt]))
            const now = Date.now()
            return snapshot.pendingTools.map((tool) => ({ ...tool, seenAt: seen.get(tool.id) ?? now }))
          })
          setAwaitingReply((current) =>
            current && snapshot.messages.some((message) =>
              message.role === 'agent' && typeof message.seq === 'number' && message.seq > current.basis,
            )
              ? null
              : current,
          )
        }
      } catch {
        if (!live) return
      } finally {
        if (streamDead && live) {
          // The stream died while a reply was owed: re-read once (the
          // reply may have landed without a frame), else fail visible
          // with the sent text restored for Retry instead of spinning.
          const owed = awaitingRef.current
          setAwaitingReply(null)
          if (owed) {
            let recovered = false
            try {
              const rows = toChatMessages(await listMessages(config, key))
              setCaches((current) => ({ ...current, [key]: mergeChatMessages(current[key] ?? [], rows) }))
              recovered = rows.some(
                (message) => message.kind === 'text' && message.role === 'agent' && messageSeq(message) > owed.basis,
              )
            } catch {
              // Unreadable thread: fail visible below.
            }
            if (!recovered) {
              const text = echoRef.current?.text
              if (text) setPendingSend(text)
              setSendError('The reply never arrived.')
            }
          }
        }
        if (live && !controller.signal.aborted) {
          setPendingText(null)
          setPendingReasoning(null)
          setPendingTools([])
          listMessages(config, key)
            .then((raw) => {
              if (!live) return
              setCaches((current) => ({ ...current, [key]: mergeChatMessages(current[key] ?? [], toChatMessages(raw)) }))
            })
            .catch(() => undefined)
        }
      }
    })()
    return () => {
      live = false
      controller.abort()
      if (streamControllers.current[key] === controller) {
        delete streamControllers.current[key]
      }
      setPendingText(null)
      setPendingReasoning(null)
      setPendingTools([])
      setAwaitingReply(null)
      // The echo belongs to the previous thread: its confirmation can
      // never arrive here, so drop it instead of showing stale text.
      setPendingSend(null)
      setEcho(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.baseUrl, config?.apiKey, threadKey, streamAttempt])

  function openSession(session: Session) {
    setActiveSessionId(session.id)
    setOpenThreadKey(null)
    sessionsPanel.set(false)
    resetScroll()
  }

  // Session rename: the More menu opens a dialog (SO-01 style) and
  // saving writes through the rename command.
  function startRename() {
    if (!activeSession) return
    setRenameDraft(activeSession.title)
    setRenameError(null)
    renameSelectedRef.current = false
    setRenaming(true)
  }

  function cancelRename() {
    setRenaming(false)
    setRenameError(null)
  }

  function saveRename() {
    const title = renameDraft.trim()
    if (!title) return
    if (!config || !activeSession) return
    const sessionId = activeSession.id
    setSavingName(true)
    setRenameError(null)
    renameSession(config, sessionId, title)
      .then((updated) => {
        setSessions((current) =>
          current ? current.map((row) => (row.id === sessionId ? updated : row)) : current,
        )
        setRenaming(false)
      })
      .catch((error: unknown) => {
        if (error instanceof StagingApiError && (error.status === 401 || error.status === 403)) {
          setSessionsState('denied')
          setRenaming(false)
          return
        }
        setRenameError('Could not rename. Try again.')
      })
      .finally(() => {
        setSavingName(false)
      })
  }

  // Session delete: two-step confirm in the header (delete arm, then
  // confirm). Confirming stops the workflow and tombstones the session;
  // the panel drops back to no active session and reloads the list.
  function confirmDelete() {
    if (!activeSession) return
    setConfirmingDelete(true)
    setDeleteError(null)
  }

  function cancelDelete() {
    setConfirmingDelete(false)
    setDeleteError(null)
  }

  function runDelete(sessionId: string) {
    if (!config || deletingSession) return
    setDeletingSession(true)
    setDeleteError(null)
    deleteSession(config, sessionId)
      .then(() => {
        setSessions((current) => (current ? current.filter((row) => row.id !== sessionId) : current))
        if (sessionId === activeSessionId) {
          setActiveSessionId(null)
          setOpenThreadKey(null)
          setThreadsAttempt((attempt) => attempt + 1)
        }
        setConfirmingDelete(false)
      })
      .catch((error: unknown) => {
        if (error instanceof StagingApiError && (error.status === 401 || error.status === 403)) {
          setSessionsState('denied')
          setConfirmingDelete(false)
          return
        }
        setDeleteError('Could not delete. Try again.')
      })
      .finally(() => {
        setDeletingSession(false)
      })
  }

  function newSession() {
    if (!config) return
    createSession(config, 'New chat')
      .then((session) => {
        setSessions((current) => (current ? [session, ...current] : [session]))
        setActiveSessionId(session.id)
        setOpenThreadKey(null)
        resetScroll()
        sessionsPanel.set(false)
        inputRef.current?.focus()
      })
      .catch(() => {
        setSessionsState('error')
      })
  }

  // Take-from-here: open the subagent thread as served. Threads arrive
  // whole from the backend; nothing is seeded locally. Back restores the
  // session view with both threads intact.
  function openThreadChat(key: string) {
    setOpenThreadKey(key)
    sessionsPanel.set(false)
    contextPanel.set(false)
    resetScroll()
    setDraft('')
    setMentionClosed(false)
    setMentionIndex(0)
    inputRef.current?.focus()
  }

  function backToSession() {
    setOpenThreadKey(null)
    resetScroll()
    inputRef.current?.focus()
  }

  async function handleCompactSession() {
    if (!config || !activeSessionId || compacting) return
    setCompacting(true)
    setCompactStatus(null)
    try {
      const res = await compactSession(config, activeSessionId)
      if (res.compacted) {
        setCompactStatus('Session context compacted: history condensed, token budget restored.')
      } else {
        setCompactStatus('Context already optimal. No compaction needed.')
      }
    } catch {
      setCompactStatus('Compaction failed. Check connection.')
    } finally {
      setCompacting(false)
    }
  }

  function steerRunningAgent(text: string) {
    const trimmed = text.trim()
    if (!trimmed || !config) return
    const key = threadKeyRef.current
    if (!key) return
    setDraft('')
    setSendError(null)
    steerThread(config, key, trimmed)
      .then((result) => {
        if (result.state === 'missed_steer') {
          setSendError('Steer arrived after the run moved on: shown, not relaunched.')
        }
      })
      .catch(() => {
        setSendError('The steer request failed.')
      })
  }

  // Echo the user's text until the server confirms it; keep a separate
  // reply state through the provider's first token and terminal message.
  // Start-on-send: with no session (all deleted or none yet) the composer
  // creates one first, so the empty state never swallows a message.
  function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || !config || working) return
    // Offline short-circuit: never fire a doomed request; the draft stays
    // so Try again works the moment the connection returns.
    if (offlineNow()) {
      setSendError('No connection.')
      return
    }
    const payloadText = planMode && !trimmed.startsWith('/') ? `/plan ${trimmed}` : trimmed
    const key = threadKeyRef.current
    if (!key) {
      setWorking(true)
      setSendError(null)
      const title = trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed
      createSession(config, title)
        .then((session) => {
          setSessions((current) => (current ? [session, ...current] : [session]))
          setActiveSessionId(session.id)
          setOpenThreadKey(null)
          resetScroll()
          postToThread(session.id, payloadText)
        })
        .catch(() => {
          setWorking(false)
          setSendError(offlineNow() ? 'No connection.' : 'The request failed.')
        })
      return
    }
    postToThread(key, payloadText)
  }

  function postToThread(key: string, trimmed: string) {
    if (!config) return
    setDraft('')
    setMentionClosed(false)
    setMentionIndex(0)
    setSendError(null)
    setPendingSend(trimmed)
    const basis = Math.max(0, ...(caches[key] ?? []).map(messageSeq))
    setEcho({ text: trimmed, basis })
    setAwaitingReply({ basis })
    setWorking(true)
    inputRef.current?.focus()
    sendThreadText(config, key, trimmed)
      .then(() => {
        // Accepted means the run owns the reply now: the input unlocks
        // and the stream (pendingText) carries the replying state until
        // the terminal message lands. Leaving working set would wedge
        // every later send behind the first one.
        setWorking(false)
        setPendingSend(null)
      })
      .catch((error: unknown) => {
        setWorking(false)
        setAwaitingReply(null)
        if (error instanceof StagingApiError && (error.status === 401 || error.status === 403)) {
          setThreadsState('denied')
          setPendingSend(null)
          return
        }
        // The draft was cleared optimistically: restore it so the text can
        // be edited and resent (Retry reuses the pending payload).
        setDraft(trimmed)
        setSendError(offlineNow() ? 'No connection.' : 'The request failed.')
      })
  }

  function retrySend() {
    if (pendingSend) send(pendingSend)
    else setSendError(null)
  }

  // Stop cancels the thread's run when one exists, aborts the local
  // tail, and restarts it so later frames still arrive. Without a run
  // there is nothing server-side to stop.
  function stopReply() {
    if (!config || !threadKey) return
    const run = runs.find((entry) => entry.threadKey === threadKey)
    if (run) {
      cancelRun(config, run.id).catch(() => undefined)
    }
    streamControllers.current[threadKey]?.abort()
    setWorking(false)
    setPendingReasoning(null)
    setPendingText(null)
    setPendingTools([])
    setAwaitingReply(null)
    setStreamAttempt((attempt) => attempt + 1)
    setThreadsAttempt((attempt) => attempt + 1)
  }

  function stopThread(key: string) {
    if (!config) return
    const run = runs.find((entry) => entry.threadKey === key)
    if (run) {
      cancelRun(config, run.id)
        .then(() => setThreadsAttempt((attempt) => attempt + 1))
        .catch(() => undefined)
    }
  }

  function pauseThread(key: string) {
    if (!config) return
    const run = runs.find((entry) => entry.threadKey === key)
    if (run) {
      pauseRun(config, run.id)
        .then(() => setThreadsAttempt((attempt) => attempt + 1))
        .catch(() => undefined)
    }
  }

  function resumeThread(key: string) {
    if (!config) return
    const run = runs.find((entry) => entry.threadKey === key)
    if (run) {
      resumeRun(config, run.id)
        .then(() => setThreadsAttempt((attempt) => attempt + 1))
        .catch(() => undefined)
    }
  }

  function insertMention(pick: { name: string }) {
    if (!mentionMatch || mentionMatch.index === undefined) return
    setDraft(`${draft.slice(0, mentionMatch.index)}@${pick.name} `)
    setMentionIndex(0)
    inputRef.current?.focus()
  }

  // Tagging writes @key into the draft itself, replacing any other thread
  // mention. Deleting the mention text untags back to the session thread.
  function tagThread(key: string) {
    setDraft((current) => {
      let text = current
      for (const thread of subagentThreads) {
        text = text.split(`@${thread.key}`).join('')
      }
      text = text.replace(/\s{2,}/g, ' ').trim()
      return text ? `${text} @${key} ` : `@${key} `
    })
    inputRef.current?.focus()
  }

  function composerKeys(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape' && (filesMenu.open || mentionOpen || mentionNoMatch || skillOpen || skillNoMatch)) {
      event.stopPropagation()
      filesMenu.set(false)
      setMentionClosed(true)
      setSkillClosed(true)
      return
    }
    if (skillOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSkillIndex((index) => (index + 1) % skillOptions.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSkillIndex((index) => (index - 1 + skillOptions.length) % skillOptions.length)
      } else if (event.key === 'Enter') {
        const picked = skillOptions[skillIndex]
        if (picked) {
          event.preventDefault()
          insertSkill(picked)
        }
      }
      return
    }
    // The multiline composer never submits implicitly, so Enter always
    // sends explicitly (a no-op on an empty draft or a send in flight).
    // Shift+Enter keeps its newline.
    if (event.key === 'Enter' && !event.shiftKey && !mentionOpen) {
      event.preventDefault()
      send(draft)
      return
    }
    if (!mentionOpen) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setMentionIndex((index) => (index + 1) % mentionOptions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setMentionIndex((index) => (index - 1 + mentionOptions.length) % mentionOptions.length)
    } else if (event.key === 'Enter') {
      const picked = mentionOptions[mentionIndex]
      if (picked) {
        event.preventDefault()
        insertMention(picked)
      }
    }
  }

  const denied = sessionsState === 'denied' || threadsState === 'denied'
  const loading = sessionsState === 'loading' || (activeSessionId !== null && threadsState === 'loading')
  const failed =
    sessionsState === 'error' ? () => setSessionsAttempt((attempt) => attempt + 1)
    : threadsState === 'error' ? () => setThreadsAttempt((attempt) => attempt + 1)
    : null
  const offline =
    sessionsState === 'offline' || threadsState === 'offline'
  const retryOffline =
    sessionsState === 'offline'
      ? () => setSessionsAttempt((attempt) => attempt + 1)
      : () => setThreadsAttempt((attempt) => attempt + 1)
  const awaitingCurrentReply = awaitingReply !== null && !messages.some((message) =>
    message.kind === 'text' && message.role === 'agent' && messageSeq(message) > awaitingReply.basis,
  )
  const replying = working || awaitingCurrentReply || Boolean(pendingText) || Boolean(pendingReasoning) || pendingTools.length > 0
  const segments = groupMessageSegments(messages)
  const lastKey = segments.length ? segments[segments.length - 1]?.key : undefined
  // The latest reasoning disclosure shares its open state with the live
  // thinking row (CV-06); older disclosures stay uncontrolled.
  const [reasoningOpen, setReasoningOpen] = useReasoningOpen(replying)
  const reasoningControl = { open: reasoningOpen, onOpenChange: setReasoningOpen }
  const lastReasoningKey = [...segments].reverse().find((segment) =>
    'tools' in segment ? Boolean(segment.reply?.reasoning) : segment.message.kind === 'text' && Boolean(segment.message.reasoning),
  )?.key

  return (
    <div
      role="complementary"
      aria-label="Assistant chat"
      className={`fixed inset-y-0 right-0 z-40 flex w-full max-w-110 flex-col border-l border-border bg-popover shadow-lg ${closing ? dockExit : dockEnter}`}
    >
      <div className="relative flex h-12 items-center gap-1 border-b border-border-subtle px-2">
        {openThread ? (
          <>
            <IconButton label="Back to chat" size="icon-sm" type="button" onClick={backToSession}>
              <Icons.back className="size-4" aria-hidden />
            </IconButton>
            <BodySm as="p" className="min-w-0 flex-1 truncate font-medium">{openThread.key}</BodySm>
          </>
        ) : (
          <>
            <Icons.karbot className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="relative min-w-0 flex-1">
              <button
                type="button"
                ref={sessionsButtonRef}
                aria-haspopup="menu"
                aria-expanded={sessionsPanel.open}
                aria-label="Chat sessions"
                onClick={() => sessionsPanel.set(!sessionsPanel.open)}
                title={activeSession ? activeSession.title : scope ? scope.name : 'Assistant'}
                className={`flex h-8 w-full min-w-0 cursor-pointer items-center gap-1 rounded-md px-2 text-left text-ui transition-colors duration-120 ease-out hover:bg-surface-hover ${focusRingInset}`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {activeSession ? activeSession.title : scope ? scope.name : 'Assistant'}
                </span>
                <Icons.chevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
              {sessionsPanel.mounted ? (
                <SessionsPanel
                  sessions={sessions ?? []}
                  activeId={activeSessionId}
                  closing={sessionsPanel.closing}
                  deleting={deletingSession}
                  onOpen={openSession}
                  onNew={newSession}
                  onDelete={(session) => runDelete(session.id)}
                  onClose={() => sessionsPanel.set(false)}
                  onEscape={() => {
                    sessionsPanel.set(false)
                    sessionsButtonRef.current?.focus()
                  }}
                />
              ) : null}
            </div>
            {activeSession ? (
              <ConfirmAction
                open={confirmingDelete}
                onOpenChange={(open) => {
                  if (!open) cancelDelete()
                }}
                title={`Delete "${activeSession.title}"?`}
                description="This removes the chat from the session list. Its history is retained in the audit log."
                confirmLabel="Delete conversation"
                pending={deletingSession}
                error={deleteError}
                onConfirm={() => {
                  runDelete(activeSession.id)
                }}
              />
            ) : null}
            {renaming ? (
              <WorkspaceOverlay
                title="Rename chat"
                size="small"
                onClose={cancelRename}
                initialFocus={renameInputRef}
                footer={
                  <>
                    <Button type="button" variant="secondary" onClick={cancelRename}>Cancel</Button>
                    <Button type="button" variant="primary" pending={savingName} disabled={!renameDraft.trim()} onClick={() => saveRename()}>Save</Button>
                  </>
                }
              >
                <form aria-label="Rename chat" onSubmit={(event) => { event.preventDefault(); saveRename() }}>
                  <Label as="label" htmlFor="karbot-rename-name">Chat name</Label>
                  <Input
                    ref={renameInputRef}
                    id="karbot-rename-name"
                    value={renameDraft}
                    disabled={savingName}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onFocus={(event) => {
                      if (!renameSelectedRef.current) {
                        renameSelectedRef.current = true
                        event.currentTarget.select()
                      }
                    }}
                    aria-describedby={renameError ? 'karbot-rename-error' : undefined}
                    className="mt-1.5"
                  />
                  {renameError ? (
                    <Caption id="karbot-rename-error" role="alert" className="mt-1.5 text-danger">{renameError}</Caption>
                  ) : null}
                </form>
              </WorkspaceOverlay>
            ) : null}
            {scope ? (
              <button
                type="button"
                ref={contextButtonRef}
                aria-expanded={contextPanel.open}
                onClick={() => contextPanel.set(!contextPanel.open)}
                className={`h-8 shrink-0 cursor-pointer rounded-md px-2 text-xs text-muted-foreground transition-colors duration-120 ease-out hover:bg-surface-hover hover:text-foreground ${focusRingInset}`}
              >
                Context
              </button>
            ) : null}
            <IconButton label="New chat" size="icon-sm" type="button" disabled={!config} onClick={newSession}>
              <Icons.newChat className="size-4" aria-hidden />
            </IconButton>
            <span className="relative inline-flex shrink-0">
              <IconButton
                label="Session files"
                size="icon-sm"
                type="button"
                aria-pressed={activeTab === 'files'}
                onClick={() => setActiveTab(activeTab === 'files' ? 'conversation' : 'files')}
                className={activeTab === 'files' ? 'bg-surface-active text-foreground' : undefined}
              >
                <Icons.fileDocs className="size-4" aria-hidden />
              </IconButton>
              {files.length > 0 ? (
                <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
              ) : null}
            </span>
            <MenuRoot open={moreOpen} onOpenChange={setMoreOpenState}>
              <MenuTrigger render={<IconButton label="More actions" size="icon-sm" type="button" disabled={!activeSession}><Icons.moreActions className="size-4" aria-hidden /></IconButton>} />
              <MenuPopup>
                <MenuItem onClick={startRename}><Icons.edit aria-hidden />Rename</MenuItem>
                <MenuItem disabled={compacting || !activeSessionId} onClick={() => void handleCompactSession()}><Icons.minimize aria-hidden className={compacting ? 'animate-spin' : undefined} />Compact context</MenuItem>
                <MenuItem onClick={confirmDelete} className="text-danger"><Icons.delete aria-hidden />Delete</MenuItem>
              </MenuPopup>
            </MenuRoot>
          </>
        )}
        <IconButton label="Close" size="icon-sm" type="button" onClick={onClose}>
          <Icons.deny className="size-4" aria-hidden />
        </IconButton>
        {(scope !== null && contextPanel.mounted) ? (
          <>
            <button
              type="button"
              aria-label="Dismiss context"
              onClick={() => contextPanel.set(false)}
              className="fixed inset-0 z-40 cursor-default bg-transparent"
            />
            <div
              role="region"
              aria-label="Chat context"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  contextPanel.set(false)
                  contextButtonRef.current?.focus()
                }
              }}
              className={`absolute inset-x-2 top-full z-50 mt-1 rounded-lg border border-border bg-popover p-3 shadow-md ${contextPanel.closing ? popoverExit : popoverEnter}`}
            >
          <div className="flex items-center gap-2">
            <BodySm as="p" className="min-w-0 flex-1 font-medium">What this chat knows</BodySm>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              autoFocus
              onClick={() => contextPanel.set(false)}
            >
              Close context
            </Button>
          </div>
          {contextSummary ? (
            <Description as="p" aria-live="polite" className="mt-1">
              {contextSummary}
            </Description>
          ) : null}
          {contextDetails.length > 0 ? (
            <dl className="mt-2 flex flex-col gap-1.5">
              {contextDetails.map((item) => (
                <div key={item.label} className="flex items-baseline gap-2">
                  <dt className="shrink-0 text-xs text-foreground-subtle">{item.label}</dt>
                  <dd className="min-w-0 flex-1 truncate text-ui text-foreground">{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <Description as="p" className="mt-1">No breakdown yet.</Description>
          )}
            </div>
          </>
          ) : null}
      </div>
      {compactStatus ? (
        <div role="status" className="flex items-center gap-2 border-b border-border-subtle bg-surface-sunken py-1 pr-1 pl-3">
          <Caption as="span" className="min-w-0 flex-1 truncate">{compactStatus}</Caption>
          <IconButton label="Dismiss" size="icon-sm" type="button" onClick={() => setCompactStatus(null)}>
            <Icons.deny className="size-4" aria-hidden />
          </IconButton>
        </div>
      ) : null}
      {!config ? (
        <div className="flex flex-1 flex-col items-center px-6 py-12 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted">
            <Icons.notConnected className="size-5 text-muted-foreground" aria-hidden />
          </span>
          <CardTitle as="span" className="mt-3 block">Chat needs a backend connection.</CardTitle>
          <Description className="mt-1 max-w-80">Set the staging API URL and key, then reload.</Description>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      ) : denied ? (
        <div className="flex flex-1 flex-col items-center px-6 py-12 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted">
            <Icons.denied className="size-5 text-muted-foreground" aria-hidden />
          </span>
          <CardTitle as="span" className="mt-3 block">Chat is not shared with this key.</CardTitle>
          <Description className="mt-1 max-w-80">Ask an admin for access to use it.</Description>
        </div>
      ) : loading ? (
        <div role="status" aria-label="Chat history is loading" className="flex flex-1 flex-col gap-6 px-4 py-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3.5 w-3/4" />
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-10 w-2/3 rounded-xl rounded-br-sm" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        </div>
      ) : failed ? (
        <div className="p-4">
          <PanelError
            heading="Chat history did not load."
            detail="Check your connection and try again."
            onRetry={failed}
          />
        </div>
      ) : offline ? (
        <div className="p-4">
          <UnavailableNotice onRetry={retryOffline} />
        </div>
      ) : activeTab === 'files' ? (
        <SessionFilesView
          config={config}
          sessionId={activeSessionId ?? ''}
          files={files}
          onRefresh={() => setThreadsAttempt((a) => a + 1)}
        />
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
          <div
            role="log"
            aria-live="polite"
            aria-label="Chat messages"
            ref={logRef}
            onScroll={onLogScroll}
            className="scroll-slim h-full space-y-6 overflow-y-auto px-4 py-3"
          >
            <AssistantRuntimeAdapter
              messages={toThreadSegments(segments)}
              isRunning={replying}
              onSend={() => undefined}
            >
            <ThreadPrimitive.Root>
            {messages.length === 0 && !replying ? (
              <ThreadPrimitive.Empty>
                <ConversationEmpty variant="karbot" onSuggest={(text) => { setDraft(text); inputRef.current?.focus() }} />
              </ThreadPrimitive.Empty>
            ) : null}
            <ThreadPrimitive.Messages>
              {({ message: runtimeMessage }) => {
                const segment = segments.find((entry) => entry.key === runtimeMessage.id)
                if (!segment) return null
                const control = segment.key === lastReasoningKey ? reasoningControl : undefined
                return 'tools' in segment ? (
                <div key={segment.key} className="space-y-2">
                  <ToolActivity tools={segment.tools} />
                  {segment.reply ? (
                    <>
                      {segment.reply.reasoning ? <ReasoningDisclosure reasoning={segment.reply.reasoning} open={control?.open} onOpenChange={control?.onOpenChange} /> : null}
                      <MessageBubble message={{ ...segment.reply, reasoning: undefined }} files={files} latest={segment.key === lastKey} />
                    </>
                  ) : null}
                </div>
              ) : (
                <div key={segment.key} className="space-y-2">
                  {segment.message.kind === 'text' ? (
                    <MessageBubble message={segment.message} files={files} latest={segment.key === lastKey} reasoningControl={control} />
                  ) : (
                    <ToolRow
                      name={segment.message.name}
                      detail={segment.message.detail}
                      state={segment.message.state}
                    />
                  )}
                </div>
                )
              }}
            </ThreadPrimitive.Messages>
            </ThreadPrimitive.Root>
            </AssistantRuntimeAdapter>
            {echo && !sendError && !messages.some((message) =>
              message.kind === 'text' && message.role === 'user' &&
              message.text === echo.text && messageSeq(message) > echo.basis,
            ) ? (
              <div key="pending-send">
                <div className="flex justify-end">
                  <div className="max-w-[85%]">
                    <UserBubble>
                      {renderMentionChips(echo.text, files)}
                    </UserBubble>
                    {working ? (
                      <p className="mt-0.5 text-right text-xs text-muted-foreground">Sending…</p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            {pendingTools.length > 0 || (pendingReasoning != null && pendingReasoning !== '') || (pendingText != null && pendingText !== '') ? (
              <div key="live-pending" className="space-y-2">
                {pendingTools.length > 0 ? (
                  <ToolActivity
                    tools={pendingTools.map((tool) => ({ id: tool.id, name: tool.name, detail: '', state: tool.state, seenAt: tool.seenAt }))}
                    live
                  />
                ) : null}
                {pendingReasoning != null && pendingReasoning !== '' ? (
                  <ThinkingRow reasoning={pendingReasoning} open={reasoningOpen} onOpenChange={setReasoningOpen} />
                ) : null}
                {pendingText != null && pendingText !== '' ? (
                  <MessageBubble
                    message={{
                      id: 'pending',
                      kind: 'text',
                      role: 'agent',
                      text: pendingText,
                    }}
                    files={files}
                    live
                  />
                ) : null}
              </div>
            ) : null}
            {replying && !working && !pendingText && !pendingReasoning && pendingTools.length === 0 ? (
              <ThinkingRow />
            ) : null}
          </div>
          {showLatest ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className={`pointer-events-auto rounded-full shadow-sm ${popoverEnter}`}
                onClick={() => {
                  stuckRef.current = true
                  setShowLatest(false)
                  stickToBottom()
                  inputRef.current?.focus()
                }}
              >
                <Icons.latest aria-hidden />
                Latest
              </Button>
            </div>
          ) : null}
          </div>
          {subagentThreads.length > 0 ? <SubagentsPanel
            threads={subagentThreads}
            taggedKey={taggedThread?.key ?? openThreadKey}
            onTagThread={tagThread}
            onOpenThread={openThreadChat}
            onStopThread={stopThread}
            onPauseThread={pauseThread}
            onResumeThread={resumeThread}
          /> : null}
          <ConversationComposer label="Message the agent" surface="bg-popover" input={<form
            onSubmit={(event) => {
              event.preventDefault()
              send(draft)
            }}
          >
            <Composer
              id="karbot-composer"
              label="Message the agent"
              value={draft}
              onChange={(value) => {
                setDraft(value)
                setMentionClosed(false)
                setMentionIndex(0)
                setSkillClosed(false)
                setSkillIndex(0)
              }}
              onKeyDown={composerKeys}
              placeholder="Ask Karbot..."
              textareaRef={inputRef}
              autoFocus
              listboxes={<>
            {filesMenu.mounted ? (
              <FilesMenu
                files={files}
                closing={filesMenu.closing}
                onPick={(file) => {
                  filesMenu.set(false)
                  setDraft((current) => `${current}@${file.name} `)
                  inputRef.current?.focus()
                }}
                onClose={() => filesMenu.set(false)}
                onEscape={() => {
                  filesMenu.set(false)
                  addButtonRef.current?.focus()
                }}
              />
            ) : null}
            {mentionOpen || mentionNoMatch ? (
              <ul
                role="listbox"
                aria-label="Mention a thread or file"
                className={`absolute bottom-full left-0 z-50 mb-2 max-h-56 w-72 scroll-slim overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md ${popoverEnter}`}
              >
                {mentionNoMatch ? (
                  <li className="px-2 py-1.5 text-ui text-muted-foreground">
                    No threads or files match &quot;@{mentionMatch?.[1] ?? ''}&quot;.
                  </li>
                ) : null}
                {mentionOptions.map((option, index) => {
                  const OptionIcon = option.kind === 'thread' ? Icons.agents : fileIcon(option.name)
                  return (
                    <li key={option.id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === mentionIndex}
                        onClick={() => insertMention(option)}
                        className={`flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-ui ${index === mentionIndex ? 'bg-surface-active' : 'hover:bg-surface-hover'} ${focusRingInset}`}
                      >
                        <OptionIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">@{option.name}</span>
                        <Caption as="span" className="shrink-0">{option.hint}</Caption>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : null}
            {skillOpen || skillNoMatch ? (
              <ul
                role="listbox"
                aria-label="Invoke a skill"
                className={`absolute bottom-full left-0 z-50 mb-2 max-h-56 w-72 scroll-slim overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md ${popoverEnter}`}
              >
                {skillNoMatch ? (
                  <li className="px-2 py-1.5 text-ui text-muted-foreground">
                    No skills match &quot;/{skillMatch?.[1] ?? ''}&quot;.
                  </li>
                ) : null}
                {skillOptions.map((option, index) => (
                  <li key={option.name} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === skillIndex}
                      onClick={() => insertSkill(option)}
                      className={`flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-ui ${index === skillIndex ? 'bg-surface-active' : 'hover:bg-surface-hover'} ${focusRingInset}`}
                    >
                      <Icons.planMode className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="shrink-0">/{option.name}</span>
                      <Caption as="span" className="min-w-0 flex-1 truncate text-right">{option.description}</Caption>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
              </>}
              left={<>
                <IconButton label="Attach file" type="button" ref={addButtonRef} aria-expanded={filesMenu.open} disabled={working} onClick={() => filesMenu.set(!filesMenu.open)}>
                  <Icons.attachFile className="size-4" aria-hidden />
                </IconButton>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Toggle plan mode"
                  aria-pressed={planMode}
                  onClick={() => setPlanMode((val) => !val)}
                  className={planMode ? 'bg-primary-soft text-primary-text hover:bg-primary-soft hover:text-primary-text' : undefined}
                >
                  <Icons.planMode className="size-3.5" aria-hidden />
                  <span>Plan</span>
                </Button>
                {activeSessionId && !openThreadKey ? (
                  <ModelToolbar
                    key={`models-${activeSessionId}`}
                    compact
                    bare
                    display="model"
                    config={config}
                    sessionId={activeSessionId}
                  />
                ) : null}
              </>}
              right={replying ? <>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={!draft.trim()}
                  onClick={() => steerRunningAgent(draft)}
                >
                  <Icons.steer className="size-3.5" aria-hidden />
                  Steer
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!draft.trim()}
                  onClick={() => send(draft)}
                >
                  Queue
                </Button>
                <IconButton label="Stop reply" type="button" onClick={stopReply} className="text-danger hover:text-danger">
                  <Icons.stopRun className="size-4" aria-hidden />
                </IconButton>
              </> : (
                <IconButton label="Send message" shortcut="Enter" type="submit" variant="default" size="icon-sm" disabled={!draft.trim()} className="rounded-full">
                  <Icons.send className="size-4" aria-hidden />
                </IconButton>
              )}
              error={sendError}
              onRetry={retrySend}
            />
          </form>} />
          </div>
        </>
      )}
    </div>
  )
}
