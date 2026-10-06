// Assistant chat over the real backend. Sessions, threads, messages,
// files, and runs come from the API; sends go through commands; replies
// arrive on the thread stream. No fixtures, no simulated replies, no local
// uploads: every row on screen was served by the backend.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Icons } from '@/lib/icons'
import { humanizeKey } from '../lib/format'
import { threadStateReasonLabel } from '../lib/labels'
import { dockEnter, dockExit, useExitState } from '@/lib/motion'
import { useRunActions } from '../data/useRuns'
import { sendThreadText, steerThread, type ThreadView, type ToolPayload } from '../data/useThreads'
import { useSessionActions, type Session } from '../data/useSessions'
import { isAuthError, type StagingConfig } from '../data/useApi'
import { type SkillSummary } from '../data/useSkills'
import { useReasoningOpen } from './chat/ReasoningDisclosure'
import { Caption } from './text'
import { IconButton } from './IconButton'
import { SessionFilesView } from './chat/SessionFiles'
import {
  groupMessageSegments,
  messageSeq,
  offlineNow,
  type ChatFile,
  type ChatMessage,
  type ChatScope,
  type LoadState,
} from './chat/messages'
import { useChatSync } from './chat/useChatSync'
import { useChatScroll } from './chat/useChatScroll'
import { ChatHeader } from './chat/ChatHeader'
import { ChatStates } from './chat/ChatStates'
import { ChatLog } from './chat/ChatLog'
import { ChatComposer } from './chat/ChatComposer'

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
  const sessionActions = useSessionActions(config)
  const runActions = useRunActions(config)
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [sessionsState, setSessionsState] = useState<LoadState>('loading')
  const [sessionsAttempt, setSessionsAttempt] = useState(0)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [threads, setThreads] = useState<ThreadView[]>([])
  const [threadsState, setThreadsState] = useState<LoadState>('loading')
  const [threadsAttempt, setThreadsAttempt] = useState(0)
  const [messagesState, setMessagesState] = useState<LoadState>('loading')
  const [messagesAttempt, setMessagesAttempt] = useState(0)
  const [openThreadKey, setOpenThreadKey] = useState<string | null>(null)
  const [caches, setCaches] = useState<Record<string, ChatMessage[]>>({})
  const [pendingText, setPendingText] = useState<string | null>(null)
  const [pendingReasoning, setPendingReasoning] = useState<string | null>(null)
  // Live tool rows carry a client-side first-seen stamp so running calls
  // can show elapsed time. The wire ToolPayload is unchanged.
  const [pendingTools, setPendingTools] = useState<Array<ToolPayload & { seenAt?: number }>>([])
  const [awaitingReply, setAwaitingReply] = useState<{ basis: number; statusSeq?: number } | null>(null)
  const [threadStateReason, setThreadStateReason] = useState<string | null>(null)
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
  const awaitingRef = useRef<{ basis: number; statusSeq?: number } | null>(null)
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
  const { logRef, stuckRef, showLatest, setShowLatest, stickToBottom, resetScroll, onLogScroll } = useChatScroll({
    messages,
    pendingText,
    pendingTools,
    working,
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape' && !moreOpenRef.current) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const statusSeqRef = useChatSync({
    config,
    sessionsAttempt,
    threadsAttempt,
    streamAttempt,
    messagesAttempt,
    activeSessionId,
    threadKey,
    setSessions,
    setSessionsState,
    setActiveSessionId,
    setSkills,
    setSkillsFailed,
    setThreads,
    setRuns,
    setFiles,
    setThreadsState,
    setMessagesState,
    setCaches,
    setPendingText,
    setPendingReasoning,
    setPendingTools,
    setAwaitingReply,
    setPendingSend,
    setSendError,
    setEcho,
    setThreadStateReason,
    streamControllers,
    awaitingRef,
    echoRef,
  })


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
    sessionActions.rename
      .run(sessionId, title)
      .then((updated) => {
        setSessions((current) =>
          current ? current.map((row) => (row.id === sessionId ? updated : row)) : current,
        )
        setRenaming(false)
      })
      .catch((error: unknown) => {
        if (isAuthError(error)) {
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
    sessionActions.remove
      .run(sessionId)
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
        if (isAuthError(error)) {
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
    sessionActions.create
      .run('New chat')
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
      const res = await sessionActions.compact.run(activeSessionId)
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
      sessionActions.create
        .run(title)
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
    setAwaitingReply({ basis, statusSeq: statusSeqRef.current[key] ?? 0 })
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
        if (isAuthError(error)) {
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
      runActions.cancel.run(run.id).catch(() => undefined)
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
      runActions.cancel
        .run(run.id)
        .then(() => setThreadsAttempt((attempt) => attempt + 1))
        .catch(() => undefined)
    }
  }

  function pauseThread(key: string) {
    if (!config) return
    const run = runs.find((entry) => entry.threadKey === key)
    if (run) {
      runActions.pause
        .run(run.id)
        .then(() => setThreadsAttempt((attempt) => attempt + 1))
        .catch(() => undefined)
    }
  }

  function resumeThread(key: string) {
    if (!config) return
    const run = runs.find((entry) => entry.threadKey === key)
    if (run) {
      runActions.resume
        .run(run.id)
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

  const denied = sessionsState === 'denied' || threadsState === 'denied' || messagesState === 'denied'
  const loading = sessionsState === 'loading' || (activeSessionId !== null && threadsState === 'loading') || (threadKey !== null && messagesState === 'loading')
  const failed =
    sessionsState === 'error' ? () => setSessionsAttempt((attempt) => attempt + 1)
    : threadsState === 'error' ? () => setThreadsAttempt((attempt) => attempt + 1)
    : messagesState === 'error' ? () => setMessagesAttempt((attempt) => attempt + 1)
    : null
  const offline =
    sessionsState === 'offline' || threadsState === 'offline' || messagesState === 'offline'
  const retryOffline =
    sessionsState === 'offline'
      ? () => setSessionsAttempt((attempt) => attempt + 1)
      : threadsState === 'offline' ? () => setThreadsAttempt((attempt) => attempt + 1)
      : () => setMessagesAttempt((attempt) => attempt + 1)
  const retryDenied =
    sessionsState === 'denied'
      ? () => setSessionsAttempt((attempt) => attempt + 1)
      : threadsState === 'denied' ? () => setThreadsAttempt((attempt) => attempt + 1)
      : () => setMessagesAttempt((attempt) => attempt + 1)
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
      <ChatHeader
        saveRename={saveRename}
        sessions={sessions}
        activeSession={activeSession}
        activeSessionId={activeSessionId}
        openThread={openThread}
        scope={scope}
        files={files}
        contextSummary={contextSummary}
        contextDetails={contextDetails}
        config={config}
        activeTab={activeTab}
        moreOpen={moreOpen}
        deletingSession={deletingSession}
        renaming={renaming}
        savingName={savingName}
        compacting={compacting}
        confirmingDelete={confirmingDelete}
        renameDraft={renameDraft}
        renameError={renameError}
        deleteError={deleteError}
        sessionsPanel={sessionsPanel}
        contextPanel={contextPanel}
        sessionsButtonRef={sessionsButtonRef}
        contextButtonRef={contextButtonRef}
        renameInputRef={renameInputRef}
        renameSelectedRef={renameSelectedRef}
        backToSession={backToSession}
        openSession={openSession}
        newSession={newSession}
        runDelete={runDelete}
        cancelDelete={cancelDelete}
        cancelRename={cancelRename}
        startRename={startRename}
        confirmDelete={confirmDelete}
        handleCompactSession={handleCompactSession}
        setMoreOpenState={setMoreOpenState}
        setRenameDraft={setRenameDraft}
        setActiveTab={setActiveTab}
        onClose={onClose}
      />
      {compactStatus ? (
        <div role="status" className="flex items-center gap-2 border-b border-border-subtle bg-surface-sunken py-1 pr-1 pl-3">
          <Caption as="span" className="min-w-0 flex-1 truncate">{compactStatus}</Caption>
          <IconButton label="Dismiss" size="icon-sm" type="button" onClick={() => setCompactStatus(null)}>
            <Icons.deny className="size-4" aria-hidden />
          </IconButton>
        </div>
      ) : null}
      {!config || denied || loading || failed || offline ? (
        <ChatStates
          config={config}
          denied={denied}
          loading={loading}
          failed={failed}
          offline={offline}
          retryOffline={retryOffline}
          retryDenied={retryDenied}
        />
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
          <ChatLog
            logRef={logRef}
            onLogScroll={onLogScroll}
            segments={segments}
            replying={replying}
            messages={messages}
            setDraft={setDraft}
            inputRef={inputRef}
            lastReasoningKey={lastReasoningKey}
            reasoningControl={reasoningControl}
            files={files}
            lastKey={lastKey}
            echo={echo}
            sendError={sendError}
            orphanNotice={threadStateReasonLabel(threadStateReason ?? undefined)}
            working={working}
            pendingTools={pendingTools}
            pendingReasoning={pendingReasoning}
            pendingText={pendingText}
            reasoningOpen={reasoningOpen}
            setReasoningOpen={setReasoningOpen}
            showLatest={showLatest}
            stuckRef={stuckRef}
            setShowLatest={setShowLatest}
            stickToBottom={stickToBottom}
          />
          <ChatComposer
            subagentThreads={subagentThreads}
            taggedThread={taggedThread}
            openThreadKey={openThreadKey}
            tagThread={tagThread}
            openThreadChat={openThreadChat}
            stopThread={stopThread}
            pauseThread={pauseThread}
            resumeThread={resumeThread}
            send={send}
            draft={draft}
            setDraft={setDraft}
            setMentionClosed={setMentionClosed}
            setMentionIndex={setMentionIndex}
            setSkillClosed={setSkillClosed}
            setSkillIndex={setSkillIndex}
            composerKeys={composerKeys}
            inputRef={inputRef}
            filesMenu={filesMenu}
            files={files}
            addButtonRef={addButtonRef}
            mentionOpen={mentionOpen}
            mentionNoMatch={mentionNoMatch}
            mentionMatch={mentionMatch}
            mentionOptions={mentionOptions}
            mentionIndex={mentionIndex}
            insertMention={insertMention}
            skillOpen={skillOpen}
            skillNoMatch={skillNoMatch}
            skillMatch={skillMatch}
            skillOptions={skillOptions}
            skillIndex={skillIndex}
            insertSkill={insertSkill}
            working={working}
            planMode={planMode}
            setPlanMode={setPlanMode}
            activeSessionId={activeSessionId}
            config={config}
            replying={replying}
            steerRunningAgent={steerRunningAgent}
            stopReply={stopReply}
            sendError={sendError}
            retrySend={retrySend}
          />
          </div>
        </>
      )}
    </div>
  )
}
