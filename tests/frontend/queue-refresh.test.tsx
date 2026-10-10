// Queue view freshness (F6d/R0-11): the queue re-reads on send, pause
// and resume, and polls while it holds items (stopping when empty).
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSectorWorkspace } from '@/data/sector-workspace'
import type { StagingConfig } from '@/data/api/client'

const mocked = vi.hoisted(() => ({
  listSessions: vi.fn(), getGlobalContext: vi.fn(), listThreads: vi.fn(), listQueue: vi.fn(),
  getFiles: vi.fn(), getProgress: vi.fn(), readPlan: vi.fn(), getLocal: vi.fn(),
  history: vi.fn(), follow: vi.fn(), sendText: vi.fn(), pause: vi.fn(), resume: vi.fn(),
}))
vi.mock('@/data/api/sessions', async (importOriginal) => ({ ...await importOriginal<typeof import('@/data/api/sessions')>(), listSessions: mocked.listSessions }))
vi.mock('@/data/api/context', async (importOriginal) => ({ ...await importOriginal<typeof import('@/data/api/context')>(), getGlobalContext: mocked.getGlobalContext, getLocalContext: mocked.getLocal }))
vi.mock('@/data/api/threads', async (importOriginal) => ({ ...await importOriginal<typeof import('@/data/api/threads')>(), listThreads: mocked.listThreads, listThreadQueue: mocked.listQueue, listMessages: mocked.history }))
vi.mock('@/data/api/files', async (importOriginal) => ({ ...await importOriginal<typeof import('@/data/api/files')>(), getSectorFiles: mocked.getFiles }))
vi.mock('@/data/api/progress', async (importOriginal) => ({ ...await importOriginal<typeof import('@/data/api/progress')>(), getResearchProgress: mocked.getProgress }))
vi.mock('@/data/api/plans', async (importOriginal) => ({ ...await importOriginal<typeof import('@/data/api/plans')>(), readSectorPlan: mocked.readPlan }))
vi.mock('@/data/api/live', async (importOriginal) => ({ ...await importOriginal<typeof import('@/data/api/live')>(), followThread: mocked.follow }))
vi.mock('@/data/api/commands', async (importOriginal) => ({ ...await importOriginal<typeof import('@/data/api/commands')>(), sendThreadText: mocked.sendText, pauseRun: mocked.pause, resumeRun: mocked.resume }))

const config: StagingConfig = { baseUrl: 'https://test.invalid', apiKey: 'test' }
const research = { id: 'research-1', title: 'Research', createdAt: '2026-10-01', updatedAt: '2026-10-01', sectorId: 'sec-1', kind: 'research' }
const chat = { id: 'chat-1', title: 'Evening chat', createdAt: '2026-10-01', updatedAt: '2026-10-01', sectorId: 'sec-1', kind: 'normal' }

function defaults() {
  mocked.listSessions.mockResolvedValue([research, chat])
  mocked.getGlobalContext.mockResolvedValue({ researchSessionId: null })
  mocked.listThreads.mockResolvedValue([])
  mocked.getFiles.mockResolvedValue([])
  mocked.getProgress.mockResolvedValue(null)
  mocked.readPlan.mockResolvedValue(null)
  mocked.getLocal.mockResolvedValue(null)
  mocked.history.mockResolvedValue([])
  mocked.follow.mockImplementation(() => (async function* () { /* quiet stream */ })())
  mocked.sendText.mockResolvedValue({ commandId: 'send-1', state: 'accepted' })
  mocked.pause.mockResolvedValue({ commandId: 'pause-1', state: 'accepted' })
  mocked.resume.mockResolvedValue({ commandId: 'resume-1', state: 'accepted' })
}

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers() })

async function load(result: { readonly current: { queue: { status: string } } }) {
  for (let i = 0; i < 30 && result.current.queue.status !== 'ready'; i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  }
  expect(result.current.queue.status).toBe('ready')
}

describe('queue freshness (F6d)', () => {
  it('re-reads the queue after a send', async () => {
    vi.useFakeTimers()
    defaults()
    mocked.listQueue.mockResolvedValue([])
    const { result, unmount } = renderHook(() => useSectorWorkspace(config, 'sec-1', 'chat-1', null, vi.fn()))
    await load(result)
    expect(mocked.listQueue).toHaveBeenCalledTimes(1)
    act(() => { result.current.chat.setDraft('hello') })
    await act(async () => { await result.current.chat.send() })
    expect(mocked.listQueue).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('re-reads the queue after pause and resume', async () => {
    vi.useFakeTimers()
    defaults()
    mocked.listQueue.mockResolvedValue([])
    const { result, unmount } = renderHook(() => useSectorWorkspace(config, 'sec-1', 'chat-1', null, vi.fn()))
    await load(result)
    expect(mocked.listQueue).toHaveBeenCalledTimes(1)
    await act(async () => { await result.current.pauseSubagent('child-1') })
    expect(mocked.listQueue).toHaveBeenCalledTimes(2)
    await act(async () => { await result.current.resumeSubagent('child-1') })
    expect(mocked.listQueue).toHaveBeenCalledTimes(3)
    await act(async () => { await result.current.resume() })
    expect(mocked.listQueue).toHaveBeenCalledTimes(4)
    unmount()
  })

  it('polls while items remain and stops when empty', async () => {
    vi.useFakeTimers()
    defaults()
    mocked.listQueue.mockResolvedValue([{ id: 'q-1', text: 'waiting' }])
    const { result, unmount } = renderHook(() => useSectorWorkspace(config, 'sec-1', 'chat-1', null, vi.fn()))
    await load(result)
    const initial = mocked.listQueue.mock.calls.length
    expect(initial).toBeGreaterThanOrEqual(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    expect(mocked.listQueue.mock.calls.length).toBeGreaterThan(initial)
    mocked.listQueue.mockResolvedValue([])
    const beforeDrain = mocked.listQueue.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    // One poll observes the drain; the next tick stays quiet.
    expect(mocked.listQueue.mock.calls.length).toBe(beforeDrain + 1)
    await act(async () => { await vi.advanceTimersByTimeAsync(9200) })
    expect(mocked.listQueue.mock.calls.length).toBe(beforeDrain + 1)
    unmount()
  })
})
