// [F:frontend.hook.useResource]
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useResource } from '@/data/useResource'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useResource superseded attempts', () => {
  it('surfaces a slow failure even when a poll supersedes it', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const loads = [first.promise, second.promise]
    let calls = 0
    const { result } = renderHook(() =>
      useResource(() => loads[calls++] ?? Promise.resolve('late'), 'key'),
    )
    expect(result.current.status).toBe('loading')
    // A silent poll supersedes the slow first attempt before it settles.
    act(() => {
      result.current.refresh()
    })
    // The superseded attempt fails slowly: the error must surface, not
    // vanish behind the live flag (a persistently slow endpoint would
    // otherwise spin forever with stale rows and no error UI).
    await act(async () => {
      first.reject(new Error('slow timeout'))
    })
    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })
    await act(async () => {
      second.resolve('fresh')
    })
  })

  it('ignores a superseded failure once a newer attempt succeeded', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const loads = [first.promise, second.promise]
    let calls = 0
    const { result } = renderHook(() =>
      useResource(() => loads[calls++] ?? Promise.resolve('late'), 'key'),
    )
    act(() => {
      result.current.refresh()
    })
    await act(async () => {
      second.resolve('fresh')
    })
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    // The older attempt fails after the newer one succeeded: the fresh
    // rows stand, the stale failure stays silent.
    await act(async () => {
      first.reject(new Error('stale timeout'))
    })
    await waitFor(() => {
      expect(result.current.data).toBe('fresh')
    })
    expect(result.current.status).toBe('ready')
  })
})
