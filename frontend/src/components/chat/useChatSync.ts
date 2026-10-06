// Chat data sync: sessions, skills, threads, file index, message pages,
// and the live thread tail. Query keys reset during render (never in the
// fetch effects) so stale rows from another session never flash.
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { followThread, isFreshTerminalStatus, listMessages, listThreads, type ThreadView, type ToolPayload } from '../../data/useThreads'
import { useRunsList } from '../../data/useRuns'
import { useResource, type ResourceStatus } from '../../data/useResource'
import { listSessionArtifacts } from '../../data/useFiles'
import { useSessionsList, type Session } from '../../data/useSessions'
import { useSkillsList, type SkillSummary } from '../../data/useSkills'
import { type StagingConfig } from '../../data/useApi'
import {
  loadStateOf,
  mergeChatMessages,
  messageSeq,
  STREAM_ERROR_LIMIT,
  toChatFile,
  toChatMessages,
  toLiveMessages,
  type ChatFile,
  type ChatMessage,
  type LoadState,
} from './messages'

/** One threads state from the threads/files joint fetch plus the runs
 * query: loading dominates, then the first failure. (ResourceStatus is
 * the identical union, so it feeds straight in.) */
function combineLoadStates(joint: LoadState, runs: LoadState): LoadState {
  if (joint === 'loading' || runs === 'loading') return 'loading'
  if (joint !== 'ready') return joint
  return runs
}

/** Mirror a query status into panel state, render-time with an applied
 * guard (effects must not setState synchronously). */
function useMirrorStatus(status: ResourceStatus, apply: (status: ResourceStatus) => void): void {
  const [applied, setApplied] = useState<ResourceStatus | null>(null)
  if (status !== applied) {
    setApplied(status)
    apply(status)
  }
}

/** Clear panel rows when their query key unsets (was: query
 * render-reset), render-time with an edge guard. */
function useClearOnUnset(keyed: boolean, clear: () => void): void {
  const [wasKeyed, setWasKeyed] = useState(keyed)
  if (keyed !== wasKeyed) {
    setWasKeyed(keyed)
    if (!keyed) clear()
  }
}

interface ChatSyncInput {
  config: StagingConfig | null
  sessionsAttempt: number
  threadsAttempt: number
  streamAttempt: number
  activeSessionId: string | null
  threadKey: string | null
  setSessions: Dispatch<SetStateAction<Session[] | null>>
  setSessionsState: Dispatch<SetStateAction<LoadState>>
  setActiveSessionId: Dispatch<SetStateAction<string | null>>
  setSkills: Dispatch<SetStateAction<SkillSummary[]>>
  setSkillsFailed: Dispatch<SetStateAction<boolean>>
  setThreads: Dispatch<SetStateAction<ThreadView[]>>
  setRuns: Dispatch<SetStateAction<Array<{ id: string; threadKey: string }>>>
  setFiles: Dispatch<SetStateAction<ChatFile[]>>
  setThreadsState: Dispatch<SetStateAction<LoadState>>
  setMessagesState: Dispatch<SetStateAction<LoadState>>
  setCaches: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>
  setPendingText: Dispatch<SetStateAction<string | null>>
  setPendingReasoning: Dispatch<SetStateAction<string | null>>
  setPendingTools: Dispatch<SetStateAction<Array<ToolPayload & { seenAt?: number }>>>
  setAwaitingReply: Dispatch<SetStateAction<{ basis: number; statusSeq?: number } | null>>
  setPendingSend: Dispatch<SetStateAction<string | null>>
  setSendError: Dispatch<SetStateAction<string | null>>
  setEcho: Dispatch<SetStateAction<{ text: string; basis: number } | null>>
  setThreadStateReason: Dispatch<SetStateAction<string | null>>
  streamControllers: { current: Record<string, AbortController> }
  awaitingRef: { current: { basis: number; statusSeq?: number } | null }
  echoRef: { current: { text: string; basis: number } | null }
}

export function useChatSync({
  config,
  sessionsAttempt,
  threadsAttempt,
  streamAttempt,
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
}: ChatSyncInput) {
  // Latest outbox status seq per thread, kept by the tail below; the
  // panel reads it as the stale-status basis at send time. Keyed by
  // thread because outbox seqs restart per thread (no reset needed).
  // Latest outbox status seq per thread, kept by the tail below; the
  // panel reads it as the stale-status basis at send time. Keyed by
  // thread because outbox seqs restart per thread (no reset needed).
  const statusSeqRef = useRef<Record<string, number>>({})
  // Sessions follow-ups run in the fetch callback (same commit as the
  // data). The first session activates; an id that no longer exists
  // falls back to the first row.
  const sessionsQuery = useSessionsList(config, {
    refreshSignal: sessionsAttempt,
    onData: (rows) => {
      setSessions(rows)
      setActiveSessionId((current) => {
        if (current && rows.some((row) => row.id === current)) return current
        return rows[0]?.id ?? null
      })
    },
  })
  // Skill catalogue for the slash picker: a failed load hides the picker
  // (plain text still sends).
  const skillsQuery = useSkillsList(config, {
    onData: (rows) => {
      setSkills(rows)
      setSkillsFailed(false)
    },
  })
  // Null config while a session is active fetches nothing: the runs key
  // stays null with it.
  const runsQuery = useRunsList(config && activeSessionId ? config : null, {
    sessionId: activeSessionId ?? undefined,
    refreshSignal: threadsAttempt,
    onData: (rows) => {
      setRuns(rows.map((run) => ({ id: run.id, threadKey: run.threadKey })))
    },
  })
  // Threads/files joint status (raw fetch below); combined with the runs
  // query status into the panel's single threads state.
  const [jointState, setJointState] = useState<LoadState>('ready')

  // Sessions state mirrors the query status (the query resets to
  // loading/ready during its own render).
  useMirrorStatus(sessionsQuery.status, setSessionsState)
  // Sessions clear when the config disconnects (was: query render-reset).
  useClearOnUnset(!!config, () => setSessions([]))
  // Runs clear when their key unsets (was: query render-reset).
  useClearOnUnset(!!config && !!activeSessionId, () => setRuns([]))
  // A failed skills load hides the picker.
  useMirrorStatus(skillsQuery.status, (status) => {
    if (status !== 'loading' && status !== 'ready') setSkillsFailed(true)
  })

  // Threads and the file index reset during render, never in the fetch
  // effect: when the query changes the previous rows belong to another
  // session. (Runs reset through the runs query above.)
  const threadQuery =
    config && activeSessionId ? `${config.baseUrl} ${config.apiKey} ${activeSessionId} ${threadsAttempt}` : null
  const [activeThreadQuery, setActiveThreadQuery] = useState<string | null>(null)
  if (activeThreadQuery !== threadQuery) {
    setActiveThreadQuery(threadQuery)
    if (threadQuery === null) {
      setThreads([])
      setFiles([])
      setJointState(activeSessionId ? 'loading' : 'ready')
    } else {
      setJointState('loading')
    }
  }

  // Threads and the file index follow the active session.
  useEffect(() => {
    if (!config || !activeSessionId) return
    let live = true
    Promise.all([listThreads(config, activeSessionId), listSessionArtifacts(config, activeSessionId)])
      .then(([threadRows, artifacts]) => {
        if (!live) return
        setThreads(threadRows)
        setFiles(artifacts.map(toChatFile))
        setJointState('ready')
      })
      .catch((error: unknown) => {
        if (!live) return
        setJointState(loadStateOf(error))
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.baseUrl, config?.apiKey, activeSessionId, threadsAttempt])

  // One threads state from both fetches: loading dominates, then the
  // first failure.
  useMirrorStatus(combineLoadStates(jointState, runsQuery.status), setThreadsState)

  // Message pages follow the visible thread through the shared query
  // hook (data + status + retry); the fetch key carries the thread so
  // the merge lands on the thread that was read, not the visible one.
  const messagesQuery = useResource(
    () => {
      if (!config || !threadKey) return null
      const key = threadKey
      return listMessages(config, key).then((raw) => ({ key, rows: toChatMessages(raw) }))
    },
    config && threadKey ? `${config.baseUrl} ${config.apiKey} ${threadKey}` : null,
    ({ key, rows }) => {
      setCaches((current) => ({ ...current, [key]: mergeChatMessages(current[key] ?? [], rows) }))
    },
  )
  useMirrorStatus(messagesQuery.status, setMessagesState)

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
    const controller = new AbortController()
    // Ref-sharing: the registry ref is owned by the panel and shared so stop
    // handlers can abort tails; writing .current is the ref's purpose.
    // eslint-disable-next-line react-hooks/immutability -- shared abort registry ref
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
          if (snapshot.threadStatusSeq !== undefined) statusSeqRef.current = { ...statusSeqRef.current, [key]: snapshot.threadStatusSeq }
          setThreadStateReason(snapshot.stateReason ?? null)
          setAwaitingReply((current) => {
            // A fresh terminal status ends the wait: the run is over and no
            // agent message will arrive (orphan, honest failure). Stale
            // statuses (seq at or below the send basis) never release.
            if (current && isFreshTerminalStatus(snapshot.threadStatus, snapshot.threadStatusSeq, current.statusSeq ?? 0)) {
              const inFlight = Boolean(snapshot.pendingText) || Boolean(snapshot.pendingReasoning) || snapshot.pendingTools.some((tool) => tool.state === 'running')
              if (!inFlight) return null
            }
            return current && snapshot.messages.some((message) =>
              message.role === 'agent' && typeof message.seq === 'number' && message.seq > current.basis,
            )
              ? null
              : current
          })
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
        // eslint-disable-next-line react-hooks/immutability -- shared abort registry ref
        delete streamControllers.current[key]
      }
      setPendingText(null)
      setPendingReasoning(null)
      setPendingTools([])
      setAwaitingReply(null)
      setThreadStateReason(null)
      // The echo belongs to the previous thread: its confirmation can
      // never arrive here, so drop it instead of showing stale text.
      setPendingSend(null)
      setEcho(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.baseUrl, config?.apiKey, threadKey, streamAttempt])
  return { statusSeqRef, reloadMessages: messagesQuery.reload }
}
