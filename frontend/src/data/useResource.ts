// Shared data-hook primitives: every data/use*.ts seam builds its hooks
// on these instead of hand-rolling fetch effects or re-exporting raw
// api calls. Queries carry data + status + retry; actions carry invoke +
// pending + error. Statuses match the api error mapping exactly.
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiErrorStatus } from './api/client'

export type ResourceStatus = 'loading' | 'ready' | 'error' | 'denied' | 'offline'

/** Query hook: runs load while key is non-null, resets during render on
 * key change (never in the effect) so stale rows from another scope
 * never flash. reload() refetches with a loading flash (retry buttons);
 * refresh() refetches silently (polling). onData runs in the fetch
 * callback (same commit as the data), for follow-ups that must not live
 * in an effect body. */
export function useResource<T>(
  load: () => Promise<T> | null,
  key: string | null,
  onData?: (data: T) => void,
): {
  data: T | undefined
  status: ResourceStatus
  reload: () => void
  refresh: () => void
} {
  const [data, setData] = useState<T | undefined>(undefined)
  const [status, setStatus] = useState<ResourceStatus>(() => (key === null ? 'ready' : 'loading'))
  const [activeKey, setActiveKey] = useState<string | null>(key)
  const keyRef = useRef(key)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  if (activeKey !== key) {
    setActiveKey(key)
    keyRef.current = key
    if (key === null) {
      setData(undefined)
      setStatus('ready')
    } else {
      setStatus('loading')
    }
  }
  const [attempt, setAttempt] = useState(0)
  // Polls supersede slow attempts: a success counts only from the latest
  // attempt, but a failure surfaces unless a newer attempt already
  // succeeded. Otherwise a persistently slow endpoint (every attempt
  // outlived by the next poll) spins forever with stale rows and no
  // error UI.
  const latestAttempt = useRef(0)
  const lastSuccess = useRef(0)
  const onDataRef = useRef(onData)
  useEffect(() => {
    onDataRef.current = onData
  })
  const reload = useCallback(() => {
    setStatus('loading')
    setAttempt((value) => value + 1)
  }, [])
  const refresh = useCallback(() => {
    setAttempt((value) => value + 1)
  }, [])
  useEffect(() => {
    const pending = load()
    if (!pending) return undefined
    const mine = latestAttempt.current + 1
    latestAttempt.current = mine
    const startedKey = activeKey
    // Mounted + same key only: superseded attempts (an older poll)
    // still settle through the guards below, never through a dead flag.
    const fresh = (): boolean => mounted.current && startedKey === keyRef.current
    pending.then(
      (value) => {
        if (!fresh()) return
        lastSuccess.current = mine
        if (mine !== latestAttempt.current) return
        setData(value)
        setStatus('ready')
        onDataRef.current?.(value)
      },
      (cause: unknown) => {
        if (!fresh()) return
        if (mine < lastSuccess.current) return
        setStatus(apiErrorStatus(cause))
      },
    )
    return undefined
    // The key encodes every load input; the loader identity is
    // intentionally untracked, like the query keys it replaces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, attempt])
  return { data, status, reload, refresh }
}

/** Action hook: binds an api mutation with pending + last-error state.
 * run() rethrows after recording, so call-site .then/.catch chains keep
 * their exact control flow. */
export function useAction<TResult, TArgs extends unknown[]>(
  invoke: (...args: TArgs) => Promise<TResult>,
): {
  run: (...args: TArgs) => Promise<TResult>
  pending: boolean
  error: unknown
  reset: () => void
} {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(undefined)
  const invokeRef = useRef(invoke)
  useEffect(() => {
    invokeRef.current = invoke
  })
  const run = useCallback(async (...args: TArgs): Promise<TResult> => {
    setPending(true)
    setError(undefined)
    try {
      return await invokeRef.current(...args)
    } catch (cause: unknown) {
      setError(cause)
      throw cause
    } finally {
      setPending(false)
    }
  }, [])
  const reset = useCallback(() => {
    setError(undefined)
  }, [])
  return { run, pending, error, reset }
}
