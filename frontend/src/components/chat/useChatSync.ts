// Chat data sync: sessions, skills, threads, file index, message pages,
// and the live thread tail. Query keys reset during render (never in the
// fetch effects) so stale rows from another session never flash.
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { followThread, type ToolPayload } from '../../data/api/live'
import { listMessages, listThreads, type ThreadView } from '../../data/api/threads'
import { listRuns } from '../../data/api/runs'
import { listSessionArtifacts } from '../../data/api/artifacts'
import { listSessions, type Session } from '../../data/api/sessions'
import { listSkills, type SkillSummary } from '../../data/api/skills'
import { type StagingConfig } from '../../data/api/client'
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
  setCaches: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>
  setPendingText: Dispatch<SetStateAction<string | null>>
  setPendingReasoning: Dispatch<SetStateAction<string | null>>
  setPendingTools: Dispatch<SetStateAction<Array<ToolPayload & { seenAt?: number }>>>
  setAwaitingReply: Dispatch<SetStateAction<{ basis: number } | null>>
  setPendingSend: Dispatch<SetStateAction<string | null>>
  setSendError: Dispatch<SetStateAction<string | null>>
  setEcho: Dispatch<SetStateAction<{ text: string; basis: number } | null>>
  streamControllers: { current: Record<string, AbortController> }
  awaitingRef: { current: { basis: number } | null }
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
  setCaches,
  setPendingText,
  setPendingReasoning,
  setPendingTools,
  setAwaitingReply,
  setPendingSend,
  setSendError,
  setEcho,
  streamControllers,
  awaitingRef,
  echoRef,
}: ChatSyncInput) {
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
        // eslint-disable-next-line react-hooks/immutability -- shared abort registry ref
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
}
