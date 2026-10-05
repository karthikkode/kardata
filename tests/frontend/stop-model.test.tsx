import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useSectorWorkspace } from '@/data/sector-workspace'
import type { StagingConfig } from '@/data/api/client'

const api = vi.hoisted(() => ({ list: vi.fn(), threads: vi.fn(), cancel: vi.fn(), global: vi.fn() }))
vi.mock('@/data/api/sessions', async (original) => ({ ...await original<typeof import('@/data/api/sessions')>(), listSessions: api.list }))
vi.mock('@/data/api/threads', async (original) => ({ ...await original<typeof import('@/data/api/threads')>(), listThreads: api.threads, listThreadQueue: vi.fn(async () => []), listMessages: vi.fn(async () => []) }))
vi.mock('@/data/api/commands', async (original) => ({ ...await original<typeof import('@/data/api/commands')>(), cancelRun: api.cancel }))
vi.mock('@/data/api/live', async (original) => ({ ...await original<typeof import('@/data/api/live')>(), followThread: vi.fn(async function* () {}) }))
vi.mock('@/data/api/context', async (original) => ({ ...await original<typeof import('@/data/api/context')>(), getGlobalContext: api.global, getLocalContext: vi.fn(async () => ({})) }))
vi.mock('@/data/api/files', async (original) => ({ ...await original<typeof import('@/data/api/files')>(), getSectorFiles: vi.fn(async () => []) }))
vi.mock('@/data/api/progress', async (original) => ({ ...await original<typeof import('@/data/api/progress')>(), getResearchProgress: vi.fn(async () => ({})) }))

const config: StagingConfig = { baseUrl: 'https://test.invalid', apiKey: 'TEST owner' }
const research = { id: 'TEST research', title: 'Research', kind: 'research', sectorId: 'TEST sector' }
const chat = { id: 'TEST chat', title: 'Chat', kind: 'normal', sectorId: 'TEST sector' }
const accepted = { commandId: 'TEST command', state: 'accepted' as const }
afterEach(() => vi.clearAllMocks())

async function readyHook(sessionId: string, threadKey: string, threads: unknown[] = []) {
  api.global.mockResolvedValue({ researchSessionId: research.id })
  api.list.mockResolvedValue([research, chat])
  api.threads.mockResolvedValue(threads)
  api.cancel.mockResolvedValue(accepted)
  const hook = renderHook(() => useSectorWorkspace(config, 'TEST sector', sessionId, threadKey, vi.fn()))
  await waitFor(() => expect(hook.result.current.sessions.status).toBe('ready'))
  await waitFor(() => expect(hook.result.current.threads.status).toBe('ready'))
  return hook
}

it('stops the session run from a chat thread', async () => {
  const { result, unmount } = await readyHook(chat.id, chat.id)
  expect(result.current.activeThread).toBe(chat.id)
  await act(async () => { await result.current.stop() })
  expect(api.cancel).toHaveBeenCalledWith(config, `session-run-${chat.id}`)
  unmount()
})

it('stops the child run from a subagent thread', async () => {
  const thread = { key: 'agent:child-1', sessionId: chat.id, kind: 'subagent', name: 'Child', status: 'RUNNING', acceptingSteer: true, queueDepth: 0, updatedAt: '2026-10-01' }
  const { result, unmount } = await readyHook(chat.id, 'agent:child-1', [thread])
  expect(result.current.activeThread).toBe('agent:child-1')
  await act(async () => { await result.current.stop() })
  expect(api.cancel).toHaveBeenCalledWith(config, 'child-1')
  unmount()
})

it('stops any subagent by child id', async () => {
  const { result, unmount } = await readyHook(chat.id, chat.id)
  await act(async () => { await result.current.stopSubagent('child-9') })
  expect(api.cancel).toHaveBeenCalledWith(config, 'child-9')
  unmount()
})
