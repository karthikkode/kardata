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
interface ConversationState {
  messages: ReturnType<typeof toChatMessages>; live: LiveThread | null; draft: string; busy: boolean; echo: string | null
  status: Resource<unknown>['status']; error: string | null; basis: number
}
const emptyConversation = (): ConversationState => ({ messages: [], live: null, draft: '', busy: false, echo: null, status: 'loading', error: null, basis: 0 })
export function useWorkspaceConversation(config: StagingConfig | null, threadKey: string | null) {
  const [threads, setThreads] = useState<Record<string, ConversationState>>({})
  const identity = config ? `${config.baseUrl}:${config.apiKey}` : null
  const [scope, setScope] = useState(identity)
  if (scope !== identity) { setScope(identity); setThreads({}) }
  const controllers = useRef(new Map<string, AbortController>())
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
        for await (const live of followThread(config, key, controller.signal)) {
          if (controller.signal.aborted) return
          failures = live.error ? failures + 1 : 0
          if (failures >= 3) {
            const reread = toChatMessages(await listMessages(config, key))
            update(key, (state) => ({ ...state, messages: mergeChatMessages(state.messages, reread), busy: false, draft: state.draft || state.echo || '', echo: null, error: 'Connection lost. Review the conversation before retrying.' }))
            break
          }
          update(key, (state) => {
            const messages = mergeChatMessages(state.messages, toChatMessages(live.messages))
            const settled = messages.some((message) => message.kind === 'text' && message.role === 'agent' && messageSeq(message) > state.basis) && !live.pendingText && !live.pendingReasoning && !live.pendingTools.some((tool) => tool.state === 'running')
            const echoArrived = state.echo && messages.some((message) => message.kind === 'text' && message.role === 'user' && message.text === state.echo && messageSeq(message) > state.basis)
            return { ...state, messages, live, busy: settled ? false : state.busy, echo: settled || echoArrived ? null : state.echo }
          })
        }
      } catch (error) {
        if (!controller.signal.aborted) update(key, (state) => ({ ...state, ...(apiErrorStatus(error) === 'denied' ? { messages: [], live: null } : {}), status: apiErrorStatus(error), busy: false, error: error instanceof Error ? error.message : 'Chat did not load.' }))
      } finally { controllers.current.delete(key) }
    })()
  }, [config, update])
  useEffect(() => { if (threadKey) start(threadKey) }, [threadKey, start])
  useEffect(() => {
    const active = controllers.current
    return () => { for (const controller of active.values()) controller.abort(); active.clear() }
  }, [config])
  const state = threadKey ? threads[threadKey] ?? emptyConversation() : emptyConversation()
  async function send(steer = false) {
    if (!config || !threadKey || !state.draft.trim()) return
    if (!navigator.onLine) { update(threadKey, (old) => ({ ...old, error: 'No connection. Your draft is saved.' })); return }
    const key = threadKey, text = state.draft.trim()
    const basis = Math.max(0, ...state.messages.map(messageSeq))
    update(key, (old) => ({ ...old, draft: '', busy: true, echo: text, basis, error: null }))
    try {
      const result = steer ? await steerThread(config, key, text) : await sendThreadText(config, key, text)
      if (result.state === 'missed_steer') update(key, (old) => ({ ...old, busy: false, echo: null, draft: text, error: 'The turn finished before steering. Send this as the next turn.' }))
      start(key)
    } catch (error) {
      update(key, (old) => ({ ...old, busy: false, echo: null, draft: text, error: error instanceof Error ? error.message : 'Send failed. Your draft is saved.' }))
    }
  }
  return { ...state, setDraft: (draft: string) => { if (threadKey) update(threadKey, (old) => ({ ...old, draft })) }, send,
    retry: () => { if (threadKey) start(threadKey) }, stopped: () => { if (threadKey) update(threadKey, (old) => ({ ...old, busy: false, echo: null })) } }
}
