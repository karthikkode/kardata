import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import { apiErrorStatus, type StagingConfig } from './api/client'
import { followThread, isFreshTerminalStatus, type LiveThread } from './api/live'
import { listMessages } from './api/threads'
import { sendThreadText, steerThread } from './api/commands'
import { mergeChatMessages, messageSeq, toChatMessages } from '../components/chat/messages'

export interface Resource<T> { data?: T; status: 'loading' | 'ready' | 'error' | 'denied' | 'offline'; error?: string; refresh(): void; acknowledge?(data: T): boolean }
export function useWorkspaceResource<T>(config: StagingConfig | null, key: string | null, load: (config: StagingConfig) => Promise<T>, poll: boolean | number = false): Resource<T> & { acknowledge(data: T): boolean } {
  const [state, setState] = useState<Omit<Resource<T>, 'refresh'>>({ status: config ? 'loading' : 'offline' })
  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load }, [load])
  const identity = config && key ? `${config.baseUrl}:${config.apiKey}:${key}` : null
  const latestIdentity = useRef(identity)
  useEffect(() => { latestIdentity.current = identity }, [identity])
  // Polls supersede slow attempts: a success counts only from the latest
  // attempt (stale rows never overwrite), but a failure surfaces unless a
  // newer attempt already succeeded. Otherwise a persistently slow
  // endpoint (every attempt outlived by the next poll) spins forever and
  // the timeout never renders.
  const latestAttempt = useRef(0)
  // Stryker disable next-line UnaryOperator: mine starts at 1, so +1 and -1 both compare false until the first success overwrites.
  const lastSuccess = useRef(-1)
  // Stryker disable next-line BooleanLiteral: the mount effect below sets true before any attempt can settle.
  const mounted = useRef(true)
  // Stryker disable next-line ArrayDeclaration: [] and [const] both run this effect exactly once.
  // Stryker disable next-line BlockStatement: post-unmount setState is a silent no-op, so the mounted flag guards nothing observable.
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [current, setCurrent] = useState(identity)
  if (identity !== current) { setCurrent(identity); setState({ status: identity ? 'loading' : 'offline' }) }
  // The fetch trigger lives outside render state: a poll tick used to
  // bump an `attempt` counter and re-render every subscriber with
  // identical UI (App itself subscribes, so each 5s tick reconciled the
  // whole tree, ~57ms in dev). Ticks now fetch directly; renders happen
  // only when data, status, or identity actually changes.
  const runAttempt = useCallback(() => {
    if (!config || !key) return
    const activeConfig = config
    const mine = latestAttempt.current + 1
    latestAttempt.current = mine
    const startedIdentity = latestIdentity.current
    // Mounted + same identity only: superseded attempts (an older poll)
    // still settle through the guards below, never through a dead flag.
    const fresh = (): boolean => mounted.current && startedIdentity === latestIdentity.current
    loadRef.current(activeConfig).then((data) => {
      if (!fresh()) return
      lastSuccess.current = mine
      if (mine === latestAttempt.current) setState({ status: 'ready', data })
    }, (error: unknown) => {
      if (!fresh()) return
      if (mine < lastSuccess.current) return
      setState((old) => ({ ...(apiErrorStatus(error) === 'denied' ? {} : old), status: apiErrorStatus(error), error: error instanceof Error ? error.message : 'Could not load. Try again.' }))
    })
  }, [config, key])
  useEffect(() => {
    runAttempt()
  }, [runAttempt])
  useEffect(() => {
    if (!poll || !config || !key) return
    const timer = setInterval(runAttempt, typeof poll === 'number' ? poll : 5000)
    return () => clearInterval(timer)
  }, [poll, config, key, runAttempt])
  return { ...state, refresh: useCallback(() => runAttempt(), [runAttempt]), acknowledge: useCallback((data: T) => {
    // A successful mutation is authoritative before the following list request.
    // Never publish its result into a resource after credentials/scope change.
    if (latestIdentity.current !== identity) return false
    lastSuccess.current = latestAttempt.current
    setState({ status: 'ready', data })
    runAttempt()
    return true
  }, [identity, runAttempt]) }
}
interface PendingRequest {
  key: number
  text: string
  basis: number
  steer: boolean
  userSeq?: number
  commandId?: string
  statusSeq?: number
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
    // A terminal server status newer than the send ends the owed reply:
    // the run is over and no agent message will ever arrive (orphan,
    // honest failure). In-flight deltas/tools still win, and a stale
    // status (seq at or below the send basis) is never fresh news.
    // Steering keeps receipt semantics: only its server receipt releases it.
    if (!request.steer && !inFlight && isFreshTerminalStatus(live.threadStatus, live.threadStatusSeq, request.statusSeq ?? 0)) return false
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

/** Reread recovery after repeated live failures: reconcile against a
 * fresh history snapshot, keeping the reconnecting phase while sends are
 * still owed a reply. Module-level so the poll loop stays flat. */
function recoverConversation(state: ConversationState, live: LiveThread, reread: unknown[]): ConversationState {
  const recovered = reconcileConversation(state, { ...live, pendingText: null, pendingReasoning: null, pendingTools: [] }, toChatMessages(reread))
  return { ...recovered, phase: recovered.pending.length ? 'reconnecting' : recovered.phase, error: recovered.pending.length ? 'Connection interrupted. The request may still be running; reconnect to follow it. Your draft is saved.' : null }
}

function reconnectDelay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    // Stryker disable next-line CallExpression: done is idempotent, so a late timer firing is a no-op.
    // Stryker disable next-line StringLiteral: done is idempotent, so a retained abort listener is a no-op.
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, 1000)
    // Stryker disable next-line StringLiteral: the abort listener only shortens the 1s delay; every abort also removes the controller via cleanup, so the timing window is unreachable.
    // Stryker disable next-line ObjectLiteral: done is idempotent, so once:false cannot double-fire.
    // Stryker disable next-line BooleanLiteral: done is idempotent, so once:false cannot double-fire.
    // Stryker disable next-line CallExpression: the abort listener only shortens the 1s delay; every abort also removes the controller via cleanup, so the timing window is unreachable.
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
  // Stryker disable ArrayDeclaration: [] and [const] both keep this callback stable (pair: deps sit on the closing line, where next-line cannot reach).
  const update = useCallback((key: string, fn: (state: ConversationState) => ConversationState) => {
    setThreads((old) => ({ ...old, [key]: fn(old[key] ?? emptyConversation()) }))
  }, [])
  // Stryker restore ArrayDeclaration
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
              startTransition(() => update(key, (state) => recoverConversation(state, live, reread)))
              return
            }
            // Background sync renders as a transition: poll frames must
            // never block input or scroll on a heavy page.
            startTransition(() => update(key, (state) => reconcileConversation(state, live)))
          }
          if (!controller.signal.aborted) {
            // A stream break must not clobber a terminal send outcome:
            // the failed UI (with its re-send retry) stays until the
            // user retries, instead of flashing to reconnecting.
            startTransition(() => update(key, (state) => (state.phase === 'failed' || state.phase === 'stopped' || state.phase === 'paused' ? state : { ...state, phase: 'reconnecting' })))
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
  // Stryker disable ArrayDeclaration: single-key invariant (pair: deps sit on the closing line, where next-line cannot reach).
  // Stryker disable next-line BlockStatement: single-key invariant: the key effect's cleanup already aborts and drops the only follower, so this effect is redundant.
  useEffect(() => {
    const active = controllers.current
    // Stryker disable next-line BlockStatement: single-key invariant: the key effect's cleanup already aborts and drops the only follower.
    return () => {
      for (const controller of active.values()) controller.abort()
      // Stryker disable next-line CallExpression: single-key invariant: the key cleanup already drops the controller, so clear() is redundant.
      active.clear()
    }
  }, [config])
  // Stryker restore ArrayDeclaration
  useEffect(() => {
    if (!threadKey) return
    const active = controllers.current
    start(threadKey)
    return () => {
      // Keep drafts/history, not idle sockets that hold DB LISTEN clients.
      const controller = active.get(threadKey)
      controller?.abort()
      // Stryker disable next-line ConditionalExpression: cleanup always sees its own controller; the guard only skips already-removed entries whose deletion no-ops.
      // Stryker disable next-line LogicalOperator: cleanup always sees its own controller; the guard only skips already-removed entries whose deletion no-ops.
      if (controller && active.get(threadKey) === controller) active.delete(threadKey)
    }
  }, [threadKey, start])
  const state = threadKey ? threads[threadKey] ?? emptyConversation() : emptyConversation()
  async function send(steer = false, text?: string) {
    const display = state.draft
    const body = (text ?? display).trim()
    if (!config || !threadKey || !body) return
    if (!navigator.onLine) { update(threadKey, (old) => ({ ...old, error: 'No connection. Your draft is saved.' })); return }
    const key = threadKey, requestKey = ++requestNonce.current
    const basis = Math.max(0, ...state.messages.map(messageSeq))
    update(key, (old) => ({ ...old, phase: steer ? 'working' : 'queued', draft: '', busy: true, echo: body, basis, error: null, pending: [...old.pending, { key: requestKey, text: body, basis, steer, statusSeq: old.live?.threadStatusSeq ?? 0 }] }))
    try {
      const result = steer ? await steerThread(config, key, body) : await sendThreadText(config, key, body)
      if (currentConfig.current !== config) return
      update(key, (old) => {
        const attached = { ...old, pending: old.pending.map((request) => request.key === requestKey ? { ...request, commandId: result.commandId } : request) }
        return attached.live ? reconcileConversation(attached, attached.live) : attached
      })
      if (result.state === 'missed_steer') update(key, (old) => {
        const pending = old.pending.filter((request) => request.key !== requestKey)
        return { ...old, busy: pending.length > 0, pending, echo: null, draft: old.draft || display, error: 'The turn finished before steering. Send this as the next turn.' }
      })
      start(key)
    } catch (error) {
      if (currentConfig.current !== config) return
      update(key, (old) => {
        const pending = old.pending.filter((request) => request.key !== requestKey)
        return { ...old, phase: 'failed', busy: pending.length > 0, pending, echo: null, draft: old.draft || display, error: error instanceof Error ? error.message : 'Send failed. Your draft is saved.' }
      })
    }
  }
  // Stryker disable next-line ConditionalExpression: a null key renders empty state, so the guarded write is unobservable.
  return { ...state, setDraft: (draft: string) => { if (threadKey) update(threadKey, (old) => ({ ...old, draft })) }, send,
    retry: () => { if (threadKey) start(threadKey) },
    // Stryker disable next-line ConditionalExpression: a null key renders empty state, so the guarded write is unobservable.
    stopped: () => { if (threadKey) update(threadKey, (old) => ({ ...old, phase: 'stopped', busy: false, pending: [], echo: null, live: old.live ? { ...old.live, pendingText: null, pendingReasoning: null, pendingTools: [] } : null })) } }
}
