// Sector chat: a dedicated conversation surface for one sector, embedded
// in the sector detail page. Unlike the global Karbot panel, sessions here
// are created with the sector link and listed through the server-side
// sector filter, so general chats never leak in. Turns run through the
// same commands/send + thread-stream path as Karbot (thread key defaults
// to the session id); only the session pool is scoped.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, MessagesSquare, Pause, Pencil, Play, RotateCcw, Send, Square, X } from 'lucide-react'
import { AgentBubble, AgentMark, TimeDivider, UserBubble, splitAfter, useChatStick } from './chat-parts'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Markdown } from './Markdown'
import { ModelToolbar } from './ModelToolbar'
import { stateLabel, SkeletonRows } from './research-parts'
import {
  ActivityGroup,
  groupMessageSegments,
  mergeChatMessages,
  sessionAge,
  SessionsPanel,
  ThinkingPlaceholder,
  toChatMessages,
  type MessageSegment,
} from './ChatPanel'
import {
  cancelRun,
  createSession,
  deleteSession,
  followThread,
  listMessages,
  listRuns,
  listSessions,
  renameSession,
  sendThreadText,
  type LiveThread,
  type ResearchState,
  type Session,
  type StagingConfig,
} from '../data/staging-api'

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

// Settle budget: the tail can end before the terminal append lands, so the
// first refetch may predate the reply. Poll until a fresh agent reply
// appears or the budget runs out; never longer than one slow turn.
const SETTLE_BUDGET_MS = 45_000
const SETTLE_POLL_MS = 1_500

/** Re-read the thread until the run's agent reply lands (or budget ends). */
async function settleThread(
  config: StagingConfig,
  threadKey: string,
  knownIds: ReadonlySet<string>,
): Promise<ReturnType<typeof toChatMessages>> {
  const deadline = Date.now() + SETTLE_BUDGET_MS
  let rows = toChatMessages(await listMessages(config, threadKey))
  while (
    !rows.some((message) => !knownIds.has(message.id) && message.kind === 'text' && message.role === 'agent')
  ) {
    if (Date.now() >= deadline) break
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS))
    rows = toChatMessages(await listMessages(config, threadKey))
  }
  return rows
}

/** Newest clock on a segment for divider gaps; undefined stays gapless. */
function segmentStamp(segment: MessageSegment): string | undefined {
  if ('tools' in segment) return segment.reply?.at ?? segment.tools[0]?.at
  return segment.message.kind === 'text' ? segment.message.at : undefined
}

/** One message row: user right in primary, agent left in muted, both wrapping. */
function segmentRow(segment: MessageSegment, live: boolean): ReactNode {
  if ('tools' in segment) {
    return (
      <div key={segment.key}>
        <ActivityGroup tools={segment.tools} reasoning={segment.reply?.reasoning} live={live} />
        {segment.reply ? (
          <AgentBubble>
            <Markdown text={segment.reply.text} />
            {segment.reply.at ? (
              <time className="mt-1 block text-xs text-muted-foreground">{sessionAge(segment.reply.at)}</time>
            ) : null}
          </AgentBubble>
        ) : null}
      </div>
    )
  }
  if (segment.message.kind !== 'text') return null
  // A thinking trace with no tool calls still gets its disclosure row;
  // tool-backed replies carry it inside their activity group instead.
  const loneReasoning =
    segment.message.role === 'agent' && segment.message.reasoning ? (
      <ActivityGroup tools={[]} reasoning={segment.message.reasoning} />
    ) : null
  const body =
    segment.message.role === 'user' ? (
      segment.message.text
    ) : (
      <Markdown text={segment.message.text} />
    )
  const stamped = segment.message.at ? (
    <time
      className="mt-1 block text-xs text-muted-foreground"
    >
      {sessionAge(segment.message.at)}
    </time>
  ) : null
  return segment.message.role === 'user' ? (
    <UserBubble key={segment.message.id}>
      {body}
      {stamped}
    </UserBubble>
  ) : (
    <div key={segment.message.id}>
      {loneReasoning}
      <AgentBubble>
        {body}
        {stamped}
      </AgentBubble>
    </div>
  )
}

export function SectorChatPanel({
  config,
  sectorId,
  sectorName,
  researchState,
  researchSessionId,
  researchBusy,
  researchError,
  onPauseResearch,
  onResumeResearch,
  onStartResearch,
  onRestartResearch,
}: {
  config: StagingConfig | null
  sectorId: string
  sectorName: string
  /** Live research state (drives the chat strip); null while loading. */
  researchState: ResearchState | null
  /** Session that started the research: pinned first in Chats. */
  researchSessionId: string | null
  researchBusy: boolean
  researchError: string | null
  onPauseResearch: () => void
  onResumeResearch: () => void
  onStartResearch: () => void
  onRestartResearch: () => void
}) {
  const [sessions, setSessions] = useState<Session[] | undefined>(undefined)
  const [sessionsFailed, setSessionsFailed] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [persisted, setPersisted] = useState<ReturnType<typeof toChatMessages>>([])
  const [live, setLive] = useState<LiveThread | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [sessionsClosing, setSessionsClosing] = useState(false)
  const [deletingSession, setDeletingSession] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const streamAbort = useRef<AbortController | null>(null)
  // Optimistic echo: the run appends the user message seconds later, so the
  // sent text renders instantly until the first stream frame lands.
  const [echo, setEcho] = useState<string | null>(null)
  // First-seen stamps for live tool rows (elapsed age); cleared per turn.
  const [toolSeenAt, setToolSeenAt] = useState<Record<string, number>>({})

  // Scoped session pool reset during render (ChatPanel sessionQuery
  // pattern): selecting a sector never shows general chats, and effects
  // only synchronize with the fetch that follows.
  const sessionPoolKey = config ? `${config.baseUrl} ${config.apiKey} ${sectorId}` : null
  const [activePoolKey, setActivePoolKey] = useState<string | null>(null)
  if (activePoolKey !== sessionPoolKey) {
    setActivePoolKey(sessionPoolKey)
    setSessions(undefined)
    setSessionsFailed(false)
    setActiveId(null)
  }
  useEffect(() => {
    let live = true
    if (!config) return
    listSessions(config, sectorId).then(
      (rows) => {
        if (!live) return
        setSessions(rows)
        setActiveId(rows[0]?.id ?? null)
      },
      () => {
        if (!live) return
        setSessionsFailed(true)
      },
    )
    return () => {
      live = false
    }
  }, [config?.baseUrl, config?.apiKey, sectorId])

  // Persisted messages reset during render when the thread changes; a live
  // stream replaces in-flight text the moment its terminal frame lands.
  const [activeThreadKey, setActiveThreadKey] = useState<string | null>(null)
  if (activeThreadKey !== activeId) {
    setActiveThreadKey(activeId)
    setPersisted([])
    setLive(null)
  }
  useEffect(() => {
    streamAbort.current?.abort()
    streamAbort.current = null
    if (!config || !activeId) return
    let live = true
    listMessages(config, activeId).then(
      (rows) => {
        if (live) setPersisted(toChatMessages(rows))
      },
      () => {
        if (live) setFailure('Sector chats did not load.')
      },
    )
    return () => {
      live = false
    }
  }, [config?.baseUrl, config?.apiKey, activeId])

  useEffect(
    () => () => {
      streamAbort.current?.abort()
    },
    [],
  )

  async function newChat() {
    if (busy) return
    setBusy(true)
    setFailure(null)
    try {
      const session = await createSession(config as StagingConfig, `${sectorName} chat`, sectorId)
      setSessions((rows) => (rows ? [session, ...rows.filter((row) => row.id !== session.id)] : [session]))
      setActiveId(session.id)
      setSessionsOpen(false)
    } catch (error: unknown) {
      setFailure(errorText(error, 'New sector chat failed.'))
    } finally {
      setBusy(false)
    }
  }

  function openSession(session: Session) {
    setActiveId(session.id)
    setSessionsOpen(false)
    setRenaming(false)
    setEcho(null)
  }

  async function removeSession(session: Session) {
    if (!config || deletingSession) return
    setDeletingSession(true)
    try {
      await deleteSession(config, session.id)
      const remaining = (sessions ?? []).filter((row) => row.id !== session.id)
      setSessions(remaining)
      if (activeId === session.id) {
        setActiveId(remaining[0]?.id ?? null)
      }
      if (remaining.length === 0) setSessionsOpen(false)
    } catch (error: unknown) {
      setFailure(errorText(error, 'Could not delete the chat.'))
    } finally {
      setDeletingSession(false)
    }
  }

  function startRename() {
    if (!active) return
    setRenameDraft(active.title)
    setNameError(null)
    setRenaming(true)
  }

  function cancelRename() {
    setRenaming(false)
    setRenameDraft('')
    setNameError(null)
  }

  async function saveRename() {
    if (!config || !active || savingName) return
    const title = renameDraft.trim()
    if (!title) {
      setNameError('Name cannot be empty.')
      return
    }
    setSavingName(true)
    try {
      const renamed = await renameSession(config, active.id, title)
      setSessions((rows) => (rows ?? []).map((row) => (row.id === active.id ? { ...row, title: renamed.title } : row)))
      setRenaming(false)
    } catch (error: unknown) {
      setNameError(errorText(error, 'Could not rename the chat.'))
    } finally {
      setSavingName(false)
    }
  }

  async function sendText(text: string) {
    if (!activeId || !text || busy) return
    setDraft('')
    setBusy(true)
    setFailure(null)
    setEcho(text)
    resetPin()
    const knownIds = new Set(persisted.map((message) => message.id))
    const controller = new AbortController()
    streamAbort.current?.abort()
    streamAbort.current = controller
    // True once the tail itself delivers an agent message: the terminal
    // refetch then cannot predate the reply and no settling is needed.
    let landedLiveReply = false
    try {
      await sendThreadText(config as StagingConfig, activeId, text)
      for await (const state of followThread(config as StagingConfig, activeId, controller.signal)) {
        const now = Date.now()
        setToolSeenAt((prev) => {
          let changed = false
          const next = { ...prev }
          for (const tool of state.pendingTools) {
            if (!(tool.id in next)) {
              next[tool.id] = now
              changed = true
            }
          }
          return changed ? next : prev
        })
        setLive(state)
        if (!landedLiveReply && state.messages.some((message) => message.role === 'agent')) {
          landedLiveReply = true
        }
        if (state.error) throw state.error
        // The server tail is an infinite hold-open (replay then pings), so
        // the loop must end on the reply itself: a fresh agent message with
        // nothing still in flight. Otherwise `busy` never clears and the
        // thinking indicator counts forever beside the delivered reply.
        const settled =
          !state.pendingText &&
          !state.pendingReasoning &&
          !state.pendingTools.some((tool) => tool.state === 'running')
        const freshReply = state.messages.some(
          (message) =>
            message.role === 'agent' &&
            message.kind === 'text' &&
            typeof message.seq === 'number' &&
            !knownIds.has(`m-${message.seq}`),
        )
        if (freshReply && settled) break
      }
      setLive(null)
      setPersisted(
        landedLiveReply
          ? toChatMessages(await listMessages(config as StagingConfig, activeId))
          : await settleThread(config as StagingConfig, activeId, knownIds),
      )
    } catch (error: unknown) {
      if ((error as { name?: string }).name !== 'AbortError') {
        setFailure(errorText(error, 'Send failed.'))
      }
      setLive(null)
    } finally {
      if (streamAbort.current === controller) streamAbort.current = null
      setBusy(false)
      setEcho(null)
      setToolSeenAt({})
    }
  }

  async function send() {
    const text = draft.trim()
    if (!text) return
    await sendText(text)
  }

  // Stop cancels the session run when one is live, then detaches the local
  // tail. Retry resends the last user message; nothing is invented.
  async function stop() {
    streamAbort.current?.abort()
    streamAbort.current = null
    if (config && activeId) {
      try {
        const runs = await listRuns(config, activeId)
        const live = runs.find((run) => run.threadKey === activeId && run.state === 'RUNNING')
        if (live) await cancelRun(config, live.id)
      } catch {
        // Local detach is the guarantee; server cancel is best-effort.
      }
    }
    setLive(null)
    setBusy(false)
  }

  function retry() {
    const lastUser = [...persisted].reverse().find((message) => message.kind === 'text' && message.role === 'user')
    if (lastUser && lastUser.kind === 'text') void sendText(lastUser.text)
  }

  const merged = mergeChatMessages(persisted, toChatMessages(live?.messages ?? []))
  const segments = groupMessageSegments(merged)
  const active = sessions?.find((row) => row.id === activeId) ?? null
  // Divider-aware rows: a timestamp splits the flow when the gap since the
  // previous stamped row passes the shared threshold. Unstamped rows (the
  // failure notice has no clock) never open or close a gap.
  const flow: ReactNode[] = []
  let lastStamp: string | undefined
  for (const segment of segments) {
    const stamp = segmentStamp(segment)
    if (stamp && splitAfter(lastStamp, stamp)) {
      flow.push(<TimeDivider key={`divider-${segment.key}`} at={stamp} />)
    }
    if (stamp) lastStamp = stamp
    flow.push(segmentRow(segment, busy))
  }
  // The pin key grows with every visible change, so fresh frames pin the
  // list only while the reader is already at the bottom.
  const { listRef, showLatest, onListScroll, jumpToLatest, resetPin } = useChatStick(
    [
      segments.length,
      live?.messages.length ?? 0,
      live?.pendingText?.length ?? 0,
      live?.pendingReasoning?.length ?? 0,
      live?.pendingTools.length ?? 0,
      busy,
    ].join('|'),
  )
  // Echo lives only until the first stream frame lands; confirmed rows take
  // over from there, and the turn finally clears it.
  const echoVisible =
    echo !== null &&
    busy &&
    (live?.messages.length ?? 0) === 0 &&
    !live?.pendingText &&
    !live?.pendingReasoning &&
    (live?.pendingTools.length ?? 0) === 0
  const liveTools = (live?.pendingTools ?? []).map((tool) => ({
    id: tool.id,
    kind: 'tool' as const,
    name: tool.name,
    detail: '',
    state: tool.state,
    seenAt: toolSeenAt[tool.id],
  }))

  if (!config) {
    return (
      <p className="mt-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        Sector chat needs the staging backend first.
      </p>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex items-center gap-1 border-b border-border px-4 py-2">
        {renaming && active ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault()
              void saveRename()
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
            <Button type="submit" variant="ghost" size="icon" aria-label="Save session name" disabled={savingName}>
              <Check className="size-4" aria-hidden />
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Cancel rename" onClick={cancelRename}>
              <X className="size-4" aria-hidden />
            </Button>
          </form>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Chat sessions"
              aria-expanded={sessionsOpen}
              className="shrink-0"
              onClick={() => {
                setSessionsOpen(!sessionsOpen)
                setSessionsClosing(false)
              }}
            >
              <MessagesSquare className="size-4" aria-hidden />
            </Button>
            <div className="flex min-w-0 flex-1 justify-center px-1">
              <AgentMark
                name={active ? active.title : sessions === undefined ? 'Loading chats…' : 'No sector chats yet'}
              />
            </div>
            {active ? (
              <Button type="button" variant="ghost" size="icon" aria-label={`Rename ${active.title}`} className="shrink-0" onClick={startRename}>
                <Pencil className="size-4" aria-hidden />
              </Button>
            ) : (
              <span aria-hidden className="size-9 shrink-0" />
            )}
          </>
        )}
        {sessionsOpen ? (
          <SessionsPanel
            sessions={sessions ?? []}
            activeId={activeId}
            pinnedId={researchSessionId}
            closing={sessionsClosing}
            deleting={deletingSession}
            onOpen={openSession}
            onNew={() => void newChat()}
            onDelete={(session) => void removeSession(session)}
            onClose={() => setSessionsOpen(false)}
            onEscape={() => setSessionsOpen(false)}
          />
        ) : null}
      </div>
      {researchState ? (
        <div
          aria-label={`Research state: ${stateLabel[researchState]}`}
          className="mt-3 flex items-center gap-2 rounded-full border border-border py-1 pr-1 pl-3"
        >
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            Research {stateLabel[researchState].toLowerCase()}
          </p>
          {researchState === 'draft' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Start research"
              disabled={researchBusy}
              onClick={onStartResearch}
            >
              <Play className="size-4" aria-hidden />
            </Button>
          ) : researchState === 'failed' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Restart research"
              disabled={researchBusy}
              onClick={onRestartResearch}
            >
              <RotateCcw className="size-4" aria-hidden />
            </Button>
          ) : researchState === 'running' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Pause research"
              disabled={researchBusy}
              onClick={onPauseResearch}
            >
              <Pause className="size-4" aria-hidden />
            </Button>
          ) : researchState === 'paused' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Resume research"
              disabled={researchBusy}
              onClick={onResumeResearch}
            >
              <Play className="size-4" aria-hidden />
            </Button>
          ) : null}
        </div>
      ) : null}
      {researchError ? (
        <p role="alert" className="mt-2 text-sm text-muted-foreground">
          {researchError}
        </p>
      ) : null}
      {nameError ? (
        <p role="alert" className="mt-2 text-sm text-muted-foreground">
          {nameError}
        </p>
      ) : null}
      {sessionsFailed ? (
        <p role="alert" className="mt-2 text-sm text-muted-foreground">
          Sector chats did not load.
        </p>
      ) : null}
      <div className="relative mt-3 min-h-0 flex-1">
        <div ref={listRef} onScroll={onListScroll} aria-live="polite" aria-label="Chat messages" className="scroll-slim h-full space-y-3 overflow-y-auto px-1 py-1">
          {sessions === undefined && !sessionsFailed ? (
            <SkeletonRows label="Sector chats are loading" />
          ) : null}
          {active === null && sessions !== undefined ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              Start a sector chat to discuss {sectorName} without leaving this page.
            </p>
          ) : null}
          {flow}
          {echoVisible && echo ? (
            <div className="flex justify-end">
              <div className="max-w-[85%]">
                <UserBubble>{echo}</UserBubble>
                {busy ? (
                  <p className="mt-0.5 text-right text-xs text-muted-foreground">Sending…</p>
                ) : null}
              </div>
            </div>
          ) : null}
          {liveTools.length > 0 ? (
            <ActivityGroup tools={liveTools} reasoning={live?.pendingReasoning ?? undefined} live />
          ) : live?.pendingReasoning ? (
            <ActivityGroup tools={[]} reasoning={live.pendingReasoning} live />
          ) : null}
          {live?.pendingText ? (
            <div className="max-w-[95%] rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
              <Markdown text={live.pendingText} />
            </div>
          ) : null}
          {busy && !live?.pendingText && !live?.pendingReasoning && liveTools.length === 0 ? (
            <ThinkingPlaceholder />
          ) : null}
        </div>
        {showLatest ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="pointer-events-auto shadow-md"
              onClick={jumpToLatest}
            >
              Latest
            </Button>
          </div>
        ) : null}
      </div>
      {failure ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p role="alert" className="flex-1 text-sm text-muted-foreground">
            {failure}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={retry} disabled={busy}>
            Retry
          </Button>
        </div>
      ) : null}
      <form
        className="shrink-0 bg-background pt-3 pb-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (busy) void stop()
          else void send()
        }}
      >
        <div className="flex items-center gap-1 rounded-full border border-border bg-background py-1 pr-1.5 pl-4">
          <label htmlFor="sector-chat-input" className="sr-only">
            Message the {sectorName} chat
          </label>
          <input
            id="sector-chat-input"
            type="text"
            autoFocus
            title="Enter sends, Shift plus Enter adds a line"
            className="h-8 min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder={active ? `Ask about ${sectorName}…` : 'Start a sector chat first…'}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={!active || busy}
          />
          <ModelToolbar
            key={`sector-models-${activeId ?? 'none'}`}
            compact
            bare
            display="model"
            modelLabel="generic"
            config={config}
            sessionId={activeId}
          />
          {busy ? (
            <Button type="submit" variant="outline" size="icon" aria-label="Stop reply" className="shrink-0 rounded-full">
              <Square className="size-4" aria-hidden />
            </Button>
          ) : (
            <Button type="submit" variant="default" size="icon" aria-label="Send message" disabled={!active || !draft.trim()} className="shrink-0 rounded-full">
              <Send className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}
