import { useCallback, useEffect, useRef, useState } from 'react'
import { apiErrorStatus, followThread, listMessages, sendThreadText, steerThread, type LiveThread, type StagingConfig } from './staging-api'
import { mergeChatMessages, messageSeq, toChatMessages } from '../components/ChatPanel'

export interface Resource<T> { data?: T; status: 'loading' | 'ready' | 'error' | 'denied' | 'offline'; error?: string; refresh(): void }
export function useWorkspaceResource<T>(config: StagingConfig | null, key: string | null, load: (config: StagingConfig) => Promise<T>, poll = false): Resource<T> {
  const [state, setState] = useState<Omit<Resource<T>, 'refresh'>>({ status: config ? 'loading' : 'offline' })
  const [attempt, setAttempt] = useState(0)
  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])
  const identity = config && key ? `${config.baseUrl}:${config.apiKey}:${key}` : null
  const [current, setCurrent] = useState(identity)
  if (identity !== current) { setCurrent(identity); setState({ status: identity ? 'loading' : 'offline' }) }
  useEffect(() => {
    if (!config || !key) return
    let live = true
    loadRef.current(config).then((data) => { if (live) setState({ status: 'ready', data }) }, (error: unknown) => {
      if (live) setState((old) => ({ ...(apiErrorStatus(error) === 'denied' ? {} : old), status: apiErrorStatus(error), error: error instanceof Error ? error.message : 'Could not load. Try again.' }))
    })
    return () => { live = false }
  }, [config, key, attempt])
  useEffect(() => {
    if (!poll || !config || !key) return
    const timer = setInterval(() => setAttempt((value) => value + 1), 5000)
    return () => clearInterval(timer)
  }, [poll, config, key])
  return { ...state, refresh: useCallback(() => setAttempt((value) => value + 1), []) }
}
interface PendingRequest {
  key: number
  text: string
  basis: number
  steer: boolean
  userSeq?: number
  commandId?: string
}
interface ConversationState {
  phase: 'idle' | 'queued' | 'working' | 'reconnecting' | 'paused' | 'failed' | 'stopped' | 'complete'
  missedInstructions: string[]
  messages: ReturnType<typeof toChatMessages>; live: LiveThread | null; draft: string; busy: boolean; echo: string | null
  status: Resource<unknown>['status']; error: string | null; basis: number; pending: PendingRequest[]; acknowledgedUsers: number[]
}
const emptyConversation = (): ConversationState => ({ phase: 'idle', missedInstructions: [], messages: [], live: null, draft: '', busy: false, echo: null, status: 'loading', error: null, basis: 0, pending: [], acknowledgedUsers: [] })

function reconcileConversation(state: ConversationState, live: LiveThread, additional = toChatMessages(live.messages)): ConversationState {
  const messages = mergeChatMessages(state.messages, additional)
  const inFlight = Boolean(live.pendingText || live.pendingReasoning || live.pendingTools.some((tool) => tool.state === 'running'))
  const acknowledgedUsers = new Set(state.acknowledgedUsers)
  const missed = state.pending.filter((request) => request.steer && live.steering?.some((receipt) => receipt.id === request.commandId && receipt.state === 'missed'))
  const pending = state.pending.map((request) => {
    const user = request.userSeq === undefined ? messages.find((message) => message.kind === 'text' && message.role === 'user' && message.text === request.text && messageSeq(message) > request.basis && !acknowledgedUsers.has(messageSeq(message))) : undefined
    const userSeq = request.userSeq ?? (user ? messageSeq(user) : undefined)
    if (userSeq !== undefined) acknowledgedUsers.add(userSeq)
    return { ...request, userSeq }
  }).filter((request) => {
    if (missed.some((entry) => entry.key === request.key)) return false
    // Accepted steering is not applied until its durable consumption receipt.
    if (request.steer && !live.steering?.some((receipt) => receipt.id === request.commandId && receipt.state === 'consumed')) return true
    // Only this request's user message can establish its matching reply.
    const replyBasis = request.steer ? request.basis : request.userSeq ?? null
    return replyBasis === null || inFlight || !messages.some((message) => message.kind === 'text' && message.role === 'agent' && messageSeq(message) > replyBasis)
  })
  const echoed = pending.find((request) => !request.steer && request.userSeq === undefined)
  const paused = live.threadStatus === 'PAUSED'
  const phase = paused ? 'paused' : live.error ? 'reconnecting' : inFlight ? 'working' : pending.length ? pending.every((request) => request.userSeq === undefined && !request.steer) ? 'queued' : 'working' : state.pending.length ? 'complete' : state.phase === 'reconnecting' ? 'idle' : state.phase
  return { ...state, phase, messages, live, busy: !paused && (pending.length > 0 || inFlight), pending, acknowledgedUsers: [...acknowledgedUsers], echo: echoed?.text ?? null, ...(state.phase === 'reconnecting' && !live.error ? { error: null } : {}), ...(missed.length ? { missedInstructions: [...state.missedInstructions, ...missed.map((request) => request.text)], draft: state.draft || missed.map((request) => request.text).join('\n\n'), error: 'The turn finished before steering was applied. The instruction is saved; send it as the next turn.' } : {}) }
}

function reconnectDelay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, 1000)
    signal.addEventListener('abort', done, { once: true })
    if (signal.aborted) done()
  })
}

export function useWorkspaceConversation(config: StagingConfig | null, threadKey: string | null) {
  const [threads, setThreads] = useState<Record<string, ConversationState>>({})
  const identity = config ? `${config.baseUrl}:${config.apiKey}` : null
  const [scope, setScope] = useState(identity)
  if (scope !== identity) { setScope(identity); setThreads({}) }
  const controllers = useRef(new Map<string, AbortController>())
  const requestNonce = useRef(0)
  const currentConfig = useRef(config)
  useEffect(() => { currentConfig.current = config }, [config])
  const update = useCallback((key: string, fn: (state: ConversationState) => ConversationState) => {
    setThreads((old) => ({ ...old, [key]: fn(old[key] ?? emptyConversation()) }))
  }, [])
  const start = useCallback((key: string) => {
    if (!config || controllers.current.has(key)) return
    const controller = new AbortController()
    controllers.current.set(key, controller)
    void (async () => {
      try {
        const loaded = toChatMessages(await listMessages(config, key))
        if (controller.signal.aborted) return
        update(key, (state) => ({ ...state, messages: mergeChatMessages(state.messages, loaded), status: 'ready' }))
        let failures = 0
        const cursor = { seq: 0 }
        while (!controller.signal.aborted) {
          for await (const live of followThread(config, key, controller.signal, { cursor })) {
            if (controller.signal.aborted) return
            failures = live.error ? failures + 1 : 0
            if (failures >= 3) {
              const reread = await listMessages(config, key)
              if (controller.signal.aborted) return
              update(key, (state) => {
                const recovered = reconcileConversation(state, { ...live, pendingText: null, pendingReasoning: null, pendingTools: [] }, toChatMessages(reread))
                return { ...recovered, phase: recovered.pending.length ? 'reconnecting' : recovered.phase, error: recovered.pending.length ? 'Connection interrupted. The request may still be running; reconnect to follow it. Your draft is saved.' : null }
              })
              return
            }
            update(key, (state) => reconcileConversation(state, live))
          }
          if (!controller.signal.aborted) {
            update(key, (state) => ({ ...state, phase: 'reconnecting' }))
            await reconnectDelay(controller.signal)
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) update(key, (state) => ({ ...state, ...(apiErrorStatus(error) === 'denied' ? { messages: [], live: null } : {}), status: apiErrorStatus(error), busy: false, pending: [], error: error instanceof Error ? error.message : 'Chat did not load.' }))
      } finally {
        // An old follower must not remove a replacement after key rotation.
        if (controllers.current.get(key) === controller) controllers.current.delete(key)
      }
    })()
  }, [config, update])
  useEffect(() => {
    const active = controllers.current
    return () => { for (const controller of active.values()) controller.abort(); active.clear() }
  }, [config])
  useEffect(() => {
    if (!threadKey) return
    const active = controllers.current
    start(threadKey)
    return () => {
      // Keep drafts/history, not idle sockets that hold DB LISTEN clients.
      const controller = active.get(threadKey)
      controller?.abort()
      if (controller && active.get(threadKey) === controller) active.delete(threadKey)
    }
  }, [threadKey, start])
  const state = threadKey ? threads[threadKey] ?? emptyConversation() : emptyConversation()
  async function send(steer = false) {
    if (!config || !threadKey || !state.draft.trim()) return
    if (!navigator.onLine) { update(threadKey, (old) => ({ ...old, error: 'No connection. Your draft is saved.' })); return }
    const key = threadKey, text = state.draft.trim(), requestKey = ++requestNonce.current
    const basis = Math.max(0, ...state.messages.map(messageSeq))
    update(key, (old) => ({ ...old, phase: steer ? 'working' : 'queued', draft: '', busy: true, echo: text, basis, error: null, pending: [...old.pending, { key: requestKey, text, basis, steer }] }))
    try {
      const result = steer ? await steerThread(config, key, text) : await sendThreadText(config, key, text)
      if (currentConfig.current !== config) return
      update(key, (old) => {
        const attached = { ...old, pending: old.pending.map((request) => request.key === requestKey ? { ...request, commandId: result.commandId } : request) }
        return attached.live ? reconcileConversation(attached, attached.live) : attached
      })
      if (result.state === 'missed_steer') update(key, (old) => {
        const pending = old.pending.filter((request) => request.key !== requestKey)
        return { ...old, busy: pending.length > 0, pending, echo: null, draft: old.draft || text, error: 'The turn finished before steering. Send this as the next turn.' }
      })
      start(key)
    } catch (error) {
      if (currentConfig.current !== config) return
      update(key, (old) => {
        const pending = old.pending.filter((request) => request.key !== requestKey)
        return { ...old, phase: 'failed', busy: pending.length > 0, pending, echo: null, draft: old.draft || text, error: error instanceof Error ? error.message : 'Send failed. Your draft is saved.' }
      })
    }
  }
  return { ...state, setDraft: (draft: string) => { if (threadKey) update(threadKey, (old) => ({ ...old, draft })) }, send,
    retry: () => { if (threadKey) start(threadKey) }, stopped: () => { if (threadKey) update(threadKey, (old) => ({ ...old, phase: 'stopped', busy: false, pending: [], echo: null })) } }
}
