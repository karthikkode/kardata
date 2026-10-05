import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceConversation } from '@/data/useWorkspace'
import { StagingApiError, type LiveThread, type StagingConfig } from '@/data/staging-api'

const mocked = vi.hoisted(() => ({ follow: vi.fn(), history: vi.fn(), send: vi.fn(), steer: vi.fn() }))
vi.mock('@/data/staging-api', async (importOriginal) => ({ ...await importOriginal<typeof import('@/data/staging-api')>(), followThread: mocked.follow, listMessages: mocked.history, sendThreadText: mocked.send, steerThread: mocked.steer }))

const config: StagingConfig = { baseUrl: 'https://test.invalid', apiKey: 'test' }
function channel() {
  const queue: Array<LiveThread | null> = []
  let wake: (() => void) | undefined
  return {
    push(value: LiveThread | null) { queue.push(value); wake?.() },
    async *read(signal?: AbortSignal) {
      while (!signal?.aborted) {
        if (!queue.length) await new Promise<void>((resolve) => { wake = resolve; signal?.addEventListener('abort', () => resolve(), { once: true }) })
        const value = queue.shift()
        if (value === null || signal?.aborted) return
        if (value) yield value
      }
    },
  }
}
const snapshot = (messages: LiveThread['messages']): LiveThread => ({ messages, pendingText: null, pendingReasoning: null, pendingTools: [], error: null })
afterEach(() => { vi.clearAllMocks() })

describe('workspace conversation lifecycle', () => {
  it('closes inactive streams while retaining drafts across conversation switching', async () => {
    const signals = new Map<string, AbortSignal>()
    mocked.history.mockResolvedValue([])
    mocked.follow.mockImplementation((_config, key: string, signal: AbortSignal) => { signals.set(key, signal); return channel().read(signal) })
    const view = renderHook(({ key }) => useWorkspaceConversation(config, key), { initialProps: { key: 'first' } })
    await waitFor(() => expect(view.result.current.status).toBe('ready'))
    act(() => view.result.current.setDraft('Saved first draft'))
    view.rerender({ key: 'second' })
    await waitFor(() => expect(signals.get('first')?.aborted).toBe(true))
    await waitFor(() => expect(view.result.current.status).toBe('ready'))
    view.rerender({ key: 'first' })
    expect(view.result.current.draft).toBe('Saved first draft')
    await waitFor(() => expect(signals.get('second')?.aborted).toBe(true))
    view.unmount()
  })
  it('reports accepted steering that missed consumption and retains it separately from a newer draft', async () => {
    const stream = channel()
    mocked.history.mockResolvedValue([])
    mocked.follow.mockImplementation((_config, _key, signal) => stream.read(signal))
    mocked.steer.mockResolvedValue({ commandId: 'steer-command', state: 'accepted' })
    const { result, unmount } = renderHook(() => useWorkspaceConversation(config, 'thread'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.setDraft('Change direction'))
    await act(async () => { await result.current.send(true) })
    act(() => result.current.setDraft('New brainstorming draft'))
    await act(async () => { stream.push({ ...snapshot([{ seq: 5, kind: 'text', role: 'agent', text: 'Old-direction answer' }]), steering: [{ id: 'steer-command', state: 'missed' }] }) })
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(result.current.draft).toBe('New brainstorming draft')
    expect(result.current.missedInstructions).toEqual(['Change direction'])
    expect(result.current.error).toContain('before steering was applied')
    unmount()
  })
  it('retains accepted pending requests after stream failures when no terminal answer exists', async () => {
    const stream = channel()
    mocked.history.mockResolvedValue([])
    mocked.follow.mockImplementation((_config, _key, signal) => stream.read(signal))
    mocked.send.mockResolvedValue({ commandId: 'running-command', state: 'accepted' })
    const { result, unmount } = renderHook(() => useWorkspaceConversation(config, 'thread'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.setDraft('Long research'))
    await act(async () => { await result.current.send() })
    act(() => result.current.setDraft('New draft'))
    mocked.history.mockResolvedValue([{ seq: 1, kind: 'text', role: 'user', text: 'Long research' }])
    const failure = { ...snapshot([]), error: new StagingApiError(0, 'stream_idle', 'Silent stream') }
    await act(async () => { stream.push(failure); stream.push(failure); stream.push(failure) })
    await waitFor(() => expect(result.current.error).toContain('may still be running'))
    expect(result.current.busy).toBe(true)
    expect(result.current.pending).toHaveLength(1)
    expect(result.current.draft).toBe('New draft')
    unmount()
  })
  it('does not settle a queued send when the preceding turn finishes', async () => {
    const stream = channel()
    mocked.history.mockResolvedValue([])
    mocked.follow.mockImplementation((_config, _key, signal) => stream.read(signal))
    mocked.send.mockResolvedValue({ commandId: 'queued', state: 'accepted' })
    const { result, unmount } = renderHook(() => useWorkspaceConversation(config, 'thread'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.setDraft('next request'))
    await act(async () => { await result.current.send() })
    await act(async () => { stream.push(snapshot([{ seq: 2, kind: 'text', role: 'agent', text: 'Earlier answer' }])) })
    expect(result.current.busy).toBe(true)
    await act(async () => { stream.push(snapshot([{ seq: 3, kind: 'text', role: 'user', text: 'next request' }, { seq: 4, kind: 'text', role: 'agent', text: 'Requested answer' }])) })
    await waitFor(() => expect(result.current.busy).toBe(false))
    unmount()
  })
  it('reconnects after graceful EOF rather than leaving the conversation unfollowed', async () => {
    const first = channel(), second = channel()
    mocked.history.mockResolvedValue([])
    mocked.follow.mockImplementationOnce((_config, _key, signal) => first.read(signal)).mockImplementation((_config, _key, signal) => second.read(signal))
    const { result, unmount } = renderHook(() => useWorkspaceConversation(config, 'thread'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => first.push(null))
    await waitFor(() => expect(mocked.follow).toHaveBeenCalledTimes(2), { timeout: 2500 })
    unmount()
  })
  it('does not overwrite a newer draft when a pending send fails', async () => {
    const stream = channel()
    mocked.history.mockResolvedValue([])
    mocked.follow.mockImplementation((_config, _key, signal) => stream.read(signal))
    let rejectSend: (error: Error) => void = () => undefined
    mocked.send.mockImplementation(() => new Promise((_resolve, reject) => { rejectSend = reject }))
    const { result, unmount } = renderHook(() => useWorkspaceConversation(config, 'thread'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.setDraft('first request'))
    let sending: Promise<void>
    act(() => { sending = result.current.send() })
    act(() => result.current.setDraft('new draft'))
    await act(async () => { rejectSend(new Error('network failed')); await sending })
    expect(result.current.draft).toBe('new draft')
    expect(result.current.error).toContain('network failed')
    unmount()
  })
})
