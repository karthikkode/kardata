// Assistant chat over the real backend. Sessions, threads, messages,
// files, and runs come from the API; sends go through commands; replies
// arrive on the thread stream. No fixtures, no simulated replies, no local
// uploads: every row on screen was served by the backend.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { m } from 'motion/react'
import { Icons } from '@/lib/icons'
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
import { PanelError, SkeletonRows, ToolRow, UnavailableNotice } from './research-parts'
import { Button } from './ui/button'
import { CollapsiblePanel, CollapsibleRoot, CollapsibleTrigger } from './ui/collapsible'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { ConfirmAction } from './ui/alert-dialog'
import { ConversationComposer, OperationNotice } from './shells'
import { AgentBubble, UserBubble } from './chat-parts'
import { IconButton } from './IconButton'

export type ChatScope = { id: string; name: string } | null

export type ChatText = {
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
        className={`absolute left-4 top-full z-50 mb-2 max-h-64 w-72 scroll-slim overflow-y-auto rounded-xl border border-border bg-muted p-2 shadow-xl ${closing ? popoverExit : popoverEnter}`}
      >
        <div className="flex items-center gap-2 px-2 py-1.5">
          <p className="min-w-0 flex-1 text-sm font-medium">Chats</p>
          <IconButton label="New session" size="icon" type="button" autoFocus onClick={onNew}>
            <Icons.newChat className="size-4" aria-hidden />
          </IconButton>
        </div>
        {sessions.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            No sessions yet. Start one with New session.
          </p>
        ) : null}
        {ordered.map((session) => (
          <div
            key={session.id}
            className={`group flex items-center gap-1 rounded-lg px-1 py-0.5 ${
              session.id === activeId ? 'bg-background' : 'hover:bg-background'
            }`}
          >
            <button
              type="button"
              role="menuitem"
              aria-current={session.id === activeId ? 'true' : undefined}
              aria-label={`Open ${session.title}`}
              onClick={() => onOpen(session)}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-left"
            >
              {pinnedId !== null && session.id === pinnedId ? (
                <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Icons.pin className="size-3.5" aria-hidden />
                  Research
                </span>
              ) : null}
              <span className="min-w-0 flex-1"><span className="block truncate text-sm">{session.title}</span><span className="block break-all text-xs text-muted-foreground">{session.id}</span></span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {sessionAge(session.updatedAt)}
              </span>
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
            <IconButton label={`Delete ${session.title}`} size="icon-sm" type="button" disabled={deleting} onClick={() => setConfirmingId(session.id)}
            >
              <Icons.delete className="size-4" aria-hidden />
            </IconButton>
          </div>
        ))}
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
        aria-label="Add files"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onEscape()
          }
        }}
        className={`absolute bottom-full left-4 z-50 mb-2 max-h-64 w-72 scroll-slim overflow-y-auto rounded-xl border border-border bg-muted p-2 shadow-xl ${closing ? popoverExit : popoverEnter}`}
      >
        {files.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            No files indexed in this session yet.
          </p>
        ) : null}
        {files.map((file) => (
          <button
            key={file.id}
            type="button"
            role="menuitem"
            onClick={() => onPick(file)}
            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-background"
          >
            <Icons.fileDocs className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{file.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{file.source}</span>
            </span>
          </button>
        ))}
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

function toolLabel(name: string): string {
  const action = (name.split('.').at(-1) ?? name).replaceAll('_', ' ')
  return action.charAt(0).toUpperCase() + action.slice(1)
}

// Instant ack: mounted while the reply streams nothing yet (accepted but
// no frames). The elapsed clock proves the app is alive during provider
// silence; the stable aria-label keeps the existing screen-reader contract.
export function ThinkingPlaceholder() {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <m.div
      role="status"
      aria-label="Agent is replying"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs text-primary shadow-2xs"
    >
      <Icons.thinking className="size-3.5 shrink-0 motion-safe:animate-pulse" aria-hidden />
      <span aria-hidden className="flex gap-1">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse"
          />
        ))}
      </span>
      <span className="font-medium">Thinking{elapsed > 0 ? ` · ${elapsed}s` : null}</span>
    </m.div>
  )
}

// One quiet activity disclosure per reply. Tool calls and genuine provider
// reasoning share it; the answer remains the dominant visible content.
/** Compact group label ("2 Kb search, 1 lookup"); null for a lone call. */
export function toolGroupSummary(tools: ChatTool[]): string | null {
  if (tools.length < 2) return null
  const counts = new Map<string, number>()
  for (const tool of tools) {
    const name = toolLabel(tool.name)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts].map(([name, count]) => (count > 1 ? `${count} ${name}` : name)).join(', ')
}

export function ActivityGroup({ tools, reasoning, live = false }: { tools: ChatTool[]; reasoning?: string; live?: boolean }) {
  const [open, setOpen] = useState(live)
  const failed = tools.some((tool) => tool.state === 'failed')
  const label = reasoning ? 'Reasoning' : (toolGroupSummary(tools) ?? 'Activity')
  // One shared clock for live running rows: elapsed time shows how long a
  // call has been in flight without a timer per row.
  const anyRunning = live && tools.some((tool) => tool.state === 'running')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!anyRunning) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [anyRunning])
  const elapsedFor = (tool: ChatTool): string | undefined => {
    if (tool.state !== 'running' || tool.seenAt === undefined) return undefined
    return `${Math.max(0, Math.floor((now - tool.seenAt) / 1000))}s`
  }
  return (
    <CollapsibleRoot
      open={open}
      onOpenChange={(next) => {
        if (typeof next === 'boolean') setOpen(next)
      }}
      className="mb-2 text-muted-foreground"
    >
      <CollapsibleTrigger
        aria-label={`${open ? 'Hide' : 'Show'} ${label}`}
        className="group inline-flex min-h-8 pointer-coarse:min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-border/70 bg-card/60 px-2.5 py-1 text-left text-xs transition-colors hover:border-border hover:bg-muted/50"
      >
        {reasoning ? <Icons.thinking className="size-3.5 shrink-0 text-primary" aria-hidden /> : <Icons.toolActivity className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="font-medium text-foreground">{label}</span>
        {tools.length > 0 && !reasoning ? (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
            {tools.length}
          </span>
        ) : null}
        {failed ? <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">Needs attention</span> : null}
        <Icons.chevronDown
          data-chevron
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="mt-2 ml-1 space-y-1.5 border-l-2 border-primary/20 pl-3">
          {reasoning ? (
            <div className="scroll-slim max-h-60 overflow-y-auto rounded-lg border border-border/60 bg-muted/40 p-3 text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">
              {reasoning}
            </div>
          ) : null}
          {tools.map((tool) => (
            <ToolRow
              key={tool.id}
              name={toolLabel(tool.name)}
              detail={tool.detail === `mcp:${tool.name}` ? '' : tool.detail}
              state={tool.state}
              elapsed={elapsedFor(tool)}
            />
          ))}
        </div>
      </CollapsiblePanel>
    </CollapsibleRoot>
  )
}

function MessageBubble({ message, files, live = false }: { message: ChatText; files: ChatFile[]; live?: boolean }) {
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
    <div className="min-w-0">
      <div>
        {message.reasoning ? <ActivityGroup tools={[]} reasoning={message.reasoning} live={live} /> : null}
        {message.text ? <AgentBubble copyText={live ? undefined : message.text}>
          <Markdown text={message.text} />
          {message.failed ? (
            <span className="mt-1 block text-xs text-muted-foreground">This reply failed.</span>
          ) : null}
          {message.missedSteer ? (
            <span className="mt-1 block text-xs text-muted-foreground">
              Sent after the run moved on: shown, not relaunched.
            </span>
          ) : null}
        </AgentBubble> : null}
      </div>
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
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const previewRequest = useRef(0)
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
      setDownloadError(`Download of ${file.name} needs a backend connection.`)
      return
    }
    setDownloadError(null)
    getArtifactBody(config, sessionId, file.id)
      .then((res) => {
        const blob = new Blob([res.body], { type: 'text/plain;charset=utf-8' })
        downloadBlob(blob, file.name)
      })
      .catch(() => {
        setDownloadError(`Download of ${file.name} failed. The file is kept. Try again.`)
      })
  }

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
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">Session Files</h2>
          <p className="text-xs text-muted-foreground">
            {files.length} {files.length === 1 ? 'file' : 'files'} generated in this session
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCreateOpen(true)}
          className="gap-1.5 text-xs"
        >
          <Icons.plus className="size-3.5" aria-hidden />
          Create file
        </Button>
      </div>
      {downloadError ? (
        <div className="mb-4">
          <OperationNotice phase="error" title="File download failed." detail={downloadError} onDismiss={() => setDownloadError(null)} />
        </div>
      ) : null}

      {createOpen ? (
        <div className="mb-4 rounded-xl border border-border bg-card p-3 shadow-2xs">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">New File</span>
            <IconButton label="Close file creation" size="icon-sm" type="button" onClick={() => setCreateOpen(false)}
            >
              <Icons.deny className="size-4" aria-hidden />
            </IconButton>
          </div>
          <div className="space-y-2">
            <Input
              placeholder="filename.md or data.csv"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              className="font-mono text-xs"
            />
            <Textarea
              placeholder="Enter file contents..."
              value={newFileContent}
              onChange={(e) => setNewFileContent(e.target.value)}
              className="scroll-slim min-h-[80px] font-mono text-xs"
            />
            {createError ? <OperationNotice phase="error" title="Could not create the file." detail={createError} /> : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="default"
                disabled={creating || !newFileName.trim()}
                onClick={() => void handleCreateFile()}
              >
                {creating ? 'Saving...' : 'Save File'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="scroll-slim min-h-0 flex-1 space-y-2 overflow-y-auto">
        {files.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            <Icons.folderOpen className="mx-auto mb-2 size-8 opacity-40" aria-hidden />
            <p className="font-medium">No files created yet</p>
            <p className="mt-1 text-xs">
              Every document, report, or export created by Karbot or subagents appears here.
            </p>
          </div>
        ) : (
          files.map((file) => (
            <div
              key={file.id}
              className="flex items-center justify-between rounded-lg border border-border/80 bg-card p-2.5 transition-colors hover:border-border"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Icons.fileDocs className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium font-mono text-foreground">{file.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {file.source} {file.detail ? `· ${file.detail}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <IconButton label={`Preview ${file.name}`} size="icon-sm" type="button" onClick={() => openPreview(file)}
                >
                  <Icons.reveal className="size-4" aria-hidden />
                </IconButton>
                <IconButton label={`Download ${file.name}`} size="icon-sm" type="button" onClick={() => downloadFile(file)}
                >
                  <Icons.download className="size-4" aria-hidden />
                </IconButton>
              </div>
            </div>
          ))
        )}
      </div>

      {selectedFile ? (
        <div className="mt-3 rounded-xl border border-border bg-card p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between border-b border-border pb-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <Icons.fileCode className="size-3.5 text-primary" aria-hidden />
              <span className="truncate text-xs font-mono font-medium">{selectedFile.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <IconButton label="Download open file" size="icon-sm" type="button" onClick={() => downloadFile(selectedFile)}
              >
                <Icons.download className="size-4" aria-hidden />
              </IconButton>
              <IconButton label="Close file preview" size="icon-sm" type="button" onClick={() => setSelectedFile(null)}
              >
                <Icons.deny className="size-4" aria-hidden />
              </IconButton>
            </div>
          </div>
          <div className="scroll-slim max-h-56 overflow-y-auto">
            {loadingBody ? (
              <p role="status" className="py-4 text-center text-xs text-muted-foreground">Loading file preview…</p>
            ) : bodyError ? (
              <div role="alert" className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-xs">{bodyError}</p>
                {selectedFile ? (
                  <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => openPreview(selectedFile)}>
                    Try again
                  </Button>
                ) : null}
              </div>
            ) : fileBody !== null && fileBody !== '' ? (
              <div className="text-xs">
                <Markdown text={fileBody} />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Empty file.</p>
            )}
          </div>
        </div>
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
  const inputRef = useRef<HTMLInputElement>(null)
  const streamControllers = useRef<Record<string, AbortController>>({})
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const sessionsButtonRef = useRef<HTMLButtonElement>(null)
  const contextButtonRef = useRef<HTMLButtonElement>(null)
  const sessionsPanel = useExitState()
  const filesMenu = useExitState()
  const contextPanel = useExitState()

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
            .map((thread) => ({ id: thread.key, name: thread.key, hint: 'Thread' })),
          ...files
            .filter((file) => file.name.toLowerCase().includes(mentionQuery))
            .map((file) => ({ id: file.id, name: file.name, hint: file.source })),
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
      if (event.key === 'Escape') onClose()
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
              setSendError('That did not go through. Try again.')
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

  // Session rename: the header shows the served title, the pencil swaps it
  // for an inline editor, and saving writes through the rename command.
  function startRename() {
    if (!activeSession) return
    setRenameDraft(activeSession.title)
    setRenameError(null)
    setRenaming(true)
  }

  function cancelRename() {
    setRenaming(false)
    setRenameError(null)
  }

  function saveRename() {
    const title = renameDraft.trim()
    if (!title) {
      setRenameError('Name cannot be empty.')
      return
    }
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
        setSendError('Failed to steer running agent. Try again.')
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
      setSendError('No connection. Try again.')
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
          setSendError(offlineNow() ? 'No connection. Try again.' : 'That did not go through. Try again.')
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
        setSendError(offlineNow() ? 'No connection. Try again.' : 'That did not go through. Try again.')
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

  function composerKeys(event: ReactKeyboardEvent<HTMLInputElement>) {
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
    // While replying the Stop button replaces Send, leaving the form
    // without a submit button: Enter would die silently. Send explicitly
    // only then: with Send present the native submit owns Enter, and
    // sending here too would double-post.
    if (event.key === 'Enter' && !mentionOpen && replying) {
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

  return (
    <div
      role="complementary"
      aria-label="Assistant chat"
      className={`fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-border bg-background shadow-xl ${closing ? dockExit : dockEnter}`}
    >
      <div className="relative flex items-center gap-2 border-b border-border px-4 py-3">
        {openThread ? (
          <>
            <IconButton label="Back to chat" size="icon" type="button" onClick={backToSession}>
              <Icons.back className="size-4" aria-hidden />
            </IconButton>
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{openThread.key}</p>
          </>
        ) : renaming && activeSession ? (
          <>
            <form
              className="flex min-w-0 flex-1 items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault()
                saveRename()
              }}
            >
              <Input
                aria-label="Session name"
                value={renameDraft}
                autoFocus
                disabled={savingName}
                onChange={(event) => setRenameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation()
                    cancelRename()
                  }
                }}
              />
              <IconButton label="Save session name" size="icon" type="submit" disabled={savingName}>
                <Icons.approve className="size-4" aria-hidden />
              </IconButton>
              <IconButton label="Cancel rename" size="icon" type="button" onClick={cancelRename}>
                <Icons.deny className="size-4" aria-hidden />
              </IconButton>
            </form>
          </>
        ) : (
          <>
            <Icons.agents className="size-4 shrink-0" aria-hidden />
            <p className="min-w-0 flex-1 truncate text-sm font-medium">
              {activeSession ? activeSession.title : scope ? scope.name : 'Assistant'}
            </p>
            {activeSession ? (
              <IconButton label={`Rename ${activeSession.title}`} size="icon" type="button" onClick={startRename}>
                <Icons.edit className="size-4" aria-hidden />
              </IconButton>
            ) : null}
            {activeSession ? (
              <IconButton label={`Delete ${activeSession.title}`} size="icon" type="button" onClick={confirmDelete}>
                <Icons.delete className="size-4" aria-hidden />
              </IconButton>
            ) : null}
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
            {scope ? (
              <button
                type="button"
                ref={contextButtonRef}
                aria-expanded={contextPanel.open}
                onClick={() => contextPanel.set(!contextPanel.open)}
                className="inline-flex h-8 pointer-coarse:h-10 shrink-0 cursor-pointer items-center rounded-full border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:border-muted-foreground"
              >
                Context
              </button>
            ) : null}
            <div
              role="tablist"
              aria-label="Chat panel views"
              className="flex items-center gap-0.5 rounded-lg border border-border/80 bg-muted/50 p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'conversation'}
                onClick={() => setActiveTab('conversation')}
                className={`min-h-8 pointer-coarse:min-h-10 rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
                  activeTab === 'conversation'
                    ? 'bg-background text-foreground shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Chat
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'files'}
                onClick={() => setActiveTab('files')}
                className={`min-h-8 pointer-coarse:min-h-10 rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
                  activeTab === 'files'
                    ? 'bg-background text-foreground shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Files {files.length > 0 ? `(${files.length})` : ''}
              </button>
            </div>
            <IconButton label="Compact session context" size="icon" type="button" title="Compact session context to free tokens" disabled={compacting || !activeSessionId} onClick={() => void handleCompactSession()}
            >
              <Icons.minimize className={`size-4 ${compacting ? 'animate-spin' : ''}`} aria-hidden />
            </IconButton>
            <IconButton label="Chat sessions" size="icon" type="button" ref={sessionsButtonRef} aria-expanded={sessionsPanel.open} onClick={() => sessionsPanel.set(!sessionsPanel.open)}
            >
              <Icons.history className="size-4" aria-hidden />
            </IconButton>
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
          </>
        )}
        <IconButton label="Close chat" size="icon" type="button" onClick={onClose} className="ml-auto">
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
              className={`absolute inset-x-4 top-full z-50 rounded-xl border border-border bg-muted p-4 shadow-xl ${contextPanel.closing ? popoverExit : popoverEnter}`}
            >
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-sm font-medium">What this chat knows</p>
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
            <p aria-live="polite" className="mt-1 text-sm text-muted-foreground">
              {contextSummary}
            </p>
          ) : null}
          {contextDetails.length > 0 ? (
            <dl className="mt-2 flex flex-col gap-1">
              {contextDetails.map((item) => (
                <div key={item.label} className="flex items-baseline gap-2 text-sm">
                  <dt className="shrink-0 text-muted-foreground">{item.label}</dt>
                  <dd className="min-w-0 flex-1 truncate font-medium">{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">No breakdown yet.</p>
          )}
            </div>
          </>
          ) : null}
      </div>
      {compactStatus ? (
        <div role="status" className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
          <span>{compactStatus}</span>
          <button type="button" onClick={() => setCompactStatus(null)} className="hover:text-foreground">
            <Icons.deny className="size-3" aria-hidden />
          </button>
        </div>
      ) : null}
      {renameError ? (
        <p role="alert" className="border-b border-border px-4 py-2 text-sm text-muted-foreground">
          {renameError}
        </p>
      ) : null}
      {!config ? (
        <div className="p-4">
          <div className="rounded-xl border border-dashed border-border bg-background p-4">
            <p className="text-sm font-medium">Chat needs a backend connection.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Set the staging API URL and key, then reload.
            </p>
          </div>
        </div>
      ) : denied ? (
        <div className="p-4">
          <div className="rounded-xl border border-dashed border-border bg-background p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Icons.denied className="size-4 shrink-0" aria-hidden />
              Chat is not shared with this key.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ask an admin for access to use it.
            </p>
          </div>
        </div>
      ) : loading ? (
        <div className="p-4">
          <SkeletonRows label="Chat history is loading" />
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
            className="scroll-slim h-full space-y-4 overflow-y-auto px-4 py-3"
          >
            <AssistantRuntimeAdapter
              messages={toThreadSegments(segments)}
              isRunning={replying}
              onSend={() => undefined}
            >
            <ThreadPrimitive.Root>
            {messages.length === 0 && !replying ? (
              <ThreadPrimitive.Empty>
              <div className="rounded-xl border border-dashed border-border p-4">
                <p className="text-sm text-muted-foreground">
                  {openThread
                    ? `Talk to ${openThread.key} directly.`
                    : scope
                      ? `Ask anything about ${scope.name}.`
                      : 'Ask anything.'}
                </p>
              </div>
              </ThreadPrimitive.Empty>
            ) : null}
            <ThreadPrimitive.Messages>
              {({ message: runtimeMessage }) => {
                const segment = segments.find((entry) => entry.key === runtimeMessage.id)
                if (!segment) return null
                return 'tools' in segment ? (
                <div key={segment.key}>
                  <ActivityGroup tools={segment.tools} reasoning={segment.reply?.reasoning} />
                  {segment.reply ? (
                    <MessageBubble message={{ ...segment.reply, reasoning: undefined }} files={files} />
                  ) : null}
                </div>
              ) : (
                <div key={segment.key}>
                  {segment.message.kind === 'text' ? (
                    <MessageBubble message={segment.message} files={files} />
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
                    <p className="rounded-xl rounded-br-sm bg-muted px-3 py-2 text-sm">
                      {renderMentionChips(echo.text, files)}
                    </p>
                    {working ? (
                      <p className="mt-0.5 text-right text-xs text-muted-foreground">Sending…</p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            {pendingTools.length > 0 ? (
              <ActivityGroup
                tools={pendingTools.map((tool) => ({ id: tool.id, kind: 'tool', name: tool.name, detail: '', state: tool.state, seenAt: tool.seenAt }))}
                reasoning={pendingReasoning ?? undefined}
                live
              />
            ) : null}
            {(pendingText != null && pendingText !== '') ||
            (pendingTools.length === 0 && pendingReasoning != null && pendingReasoning !== '') ? (
              <div key="live-pending">
                <MessageBubble
                  message={{
                    id: 'pending',
                    kind: 'text',
                    role: 'agent',
                    text: pendingText ?? '',
                    ...(pendingReasoning && pendingTools.length === 0 ? { reasoning: pendingReasoning } : {}),
                  }}
                  files={files}
                  live
                />
              </div>
            ) : null}
            {sendError ? (
              <div className="rounded-xl border border-dashed border-border p-3">
                <p role="alert" className="text-sm text-muted-foreground">{sendError}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={retrySend}
                >
                  Try again
                </Button>
              </div>
            ) : null}
            {replying && !working && !pendingText && !pendingReasoning && pendingTools.length === 0 ? (
              <ThinkingPlaceholder />
            ) : null}
          </div>
          {showLatest ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={`pointer-events-auto shadow-md ${popoverEnter}`}
                onClick={() => {
                  stuckRef.current = true
                  setShowLatest(false)
                  stickToBottom()
                  inputRef.current?.focus()
                }}
              >
                Back to latest
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
          /> : null}
          <ConversationComposer label="Message the agent" input={<form
            className="relative"
            onSubmit={(event) => {
              event.preventDefault()
              send(draft)
            }}
          >
            <div className="flex items-center gap-1 rounded-full border border-border bg-background py-1 pr-1.5 pl-1.5">
            <IconButton label="Add files" size="icon" type="button" ref={addButtonRef} aria-expanded={filesMenu.open} disabled={working} onClick={() => filesMenu.set(!filesMenu.open)}
              className="shrink-0 rounded-full"
            >
              <Icons.plus className="size-4" aria-hidden />
            </IconButton>
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
                className={`absolute bottom-full left-4 z-50 mb-2 max-h-56 w-72 scroll-slim overflow-y-auto rounded-xl border border-border bg-muted p-2 shadow-xl ${popoverEnter}`}
              >
                {mentionNoMatch ? (
                  <li className="px-2 py-1.5 text-sm text-muted-foreground">
                    No threads or files match &quot;@{mentionMatch?.[1] ?? ''}&quot;.
                  </li>
                ) : null}
                {mentionOptions.map((option, index) => (
                  <li key={option.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === mentionIndex}
                      onClick={() => insertMention(option)}
                      className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
                        index === mentionIndex ? 'bg-background' : 'hover:bg-background'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">@{option.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{option.hint}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {skillOpen || skillNoMatch ? (
              <ul
                role="listbox"
                aria-label="Invoke a skill"
                className={`absolute bottom-full left-4 z-50 mb-2 max-h-56 w-72 scroll-slim overflow-y-auto rounded-xl border border-border bg-muted p-2 shadow-xl ${popoverEnter}`}
              >
                {skillNoMatch ? (
                  <li className="px-2 py-1.5 text-sm text-muted-foreground">
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
                      className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
                        index === skillIndex ? 'bg-background' : 'hover:bg-background'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">/{option.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{option.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <Input
              ref={inputRef}
              aria-label="Message the agent"
              title="Enter sends, Shift plus Enter adds a line"
              className="h-8 flex-1 border-0 px-1 focus-visible:ring-0"
              placeholder={openThread ? `Message ${openThread.key}` : 'Ask anything'}
              value={draft}
              autoFocus
              onChange={(event) => {
                setDraft(event.target.value)
                setMentionClosed(false)
                setMentionIndex(0)
                setSkillClosed(false)
                setSkillIndex(0)
              }}
              onKeyDown={composerKeys}
            />
            {activeSessionId && !openThreadKey ? (
              <ModelToolbar
                key={`models-${activeSessionId}`}
                compact
                bare
                display="model"
                modelLabel="generic"
                config={config}
                sessionId={activeSessionId}
              />
            ) : null}
            <Button
              type="button"
              variant={planMode ? 'default' : 'ghost'}
              size="sm"
              aria-label="Toggle plan mode"
              aria-pressed={planMode}
              onClick={() => setPlanMode((val) => !val)}
              className={`h-8 pointer-coarse:h-10 gap-1 rounded-full px-2 text-xs ${
                planMode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icons.planMode className="size-3.5" aria-hidden />
              <span>Plan</span>
            </Button>
            {replying ? (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Steer agent"
                  title="Steer running agent mid-run"
                  disabled={!draft.trim()}
                  onClick={() => steerRunningAgent(draft)}
                  className="h-8 gap-1 rounded-full px-2.5 text-xs text-primary hover:bg-primary/10"
                >
                  <Icons.steer className="size-3.5" aria-hidden />
                  Steer
                </Button>
                <IconButton label="Stop reply" size="icon" type="button" variant="outline" onClick={stopReply} className="shrink-0 rounded-full">
                  <Icons.stopSquare className="size-4" aria-hidden />
                </IconButton>
              </div>
            ) : (
              <IconButton label="Send message" size="icon" type="submit" variant="default" className="shrink-0 rounded-full">
                <Icons.sendMessage className="size-4" aria-hidden />
              </IconButton>
            )}
            </div>
          </form>} />
          </div>
        </>
      )}
    </div>
  )
}
