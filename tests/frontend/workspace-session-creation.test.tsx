import { act, renderHook, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { useSectorWorkspace } from '@/data/sector-workspace'
import { useWorkspaceResource } from '@/data/useWorkspace'
import type { StagingConfig } from '@/data/staging-api'

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), global: vi.fn(), settings: vi.fn() }))
vi.mock('@/data/staging-api', async (original) => ({ ...await original<typeof import('@/data/staging-api')>(), listSessions: api.list, createSession: api.create, setSessionSettings: api.settings, listThreads: vi.fn(async () => []), listMessages: vi.fn(async () => []), followThread: vi.fn(async function* () {}) }))
vi.mock('@/data/workspace-api', async (original) => ({ ...await original<typeof import('@/data/workspace-api')>(), getGlobalContext: api.global, getSectorFiles: vi.fn(async () => []), getResearchProgress: vi.fn(async () => ({})), readSectorPlan: vi.fn(async () => null), getLocalContext: vi.fn(async () => ({})) }))
const config: StagingConfig = { baseUrl: 'https://test.invalid', apiKey: 'TEST owner' }
const research = { id: 'TEST research', title: 'Research', kind: 'research', sectorId: 'TEST sector' }
afterEach(() => vi.clearAllMocks())

it('opens the acknowledged new conversation while its session-list refresh is still pending', async () => {
  api.global.mockResolvedValue({ researchSessionId: research.id })
  api.list.mockResolvedValueOnce([research]).mockImplementation(() => new Promise(() => {}))
  api.create.mockResolvedValue({ id: 'TEST new conversation', title: 'New conversation', sectorId: 'TEST sector' })
  const { result, unmount } = renderHook(() => {
    const [selected, setSelected] = useState<string | null>(research.id)
    return useSectorWorkspace(config, 'TEST sector', selected, selected, (session) => setSelected(session))
  })
  await waitFor(() => expect(result.current.sessions.status).toBe('ready'))
  await act(async () => { await result.current.createChat() })
  expect(api.list).toHaveBeenCalledTimes(2)
  expect(result.current.selected?.id).toBe('TEST new conversation')
  expect(result.current.activeThread).toBe('TEST new conversation')
  expect(result.current.error).toBeNull()
  unmount()
})

it('still rejects a foreign conversation after an authoritative session-list read', async () => {
  api.global.mockResolvedValue({ researchSessionId: research.id })
  api.list.mockResolvedValue([research])
  const { result, unmount } = renderHook(() => useSectorWorkspace(config, 'TEST sector', 'TEST foreign session', 'TEST foreign session', vi.fn()))
  await waitFor(() => expect(result.current.sessions.status).toBe('ready'))
  expect(result.current.activeThread).toBeNull()
  expect(result.current.error).toBe('This conversation is not available in this sector.')
  unmount()
})

it('does not publish an old mutation acknowledgement after the resource scope changes', async () => {
  const load = vi.fn(async () => ['TEST current list'])
  const view = renderHook(({ key }) => useWorkspaceResource(config, key, load), { initialProps: { key: 'TEST original sector' } })
  await waitFor(() => expect(view.result.current.status).toBe('ready'))
  const oldAcknowledgement = view.result.current.acknowledge
  view.rerender({ key: 'TEST another sector' })
  await waitFor(() => expect(view.result.current.status).toBe('ready'))
  act(() => oldAcknowledgement(['TEST old acknowledged conversation']))
  expect(view.result.current.data).toEqual(['TEST current list'])
  expect(load).toHaveBeenCalledTimes(2)
  view.unmount()
})

it('does not navigate to a late-created conversation after switching sectors', async () => {
  api.global.mockResolvedValue({ researchSessionId: research.id })
  api.list.mockResolvedValue([research])
  let finish: (session: unknown) => void = () => undefined
  api.create.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const navigate = vi.fn()
  const view = renderHook(({ sector }) => useSectorWorkspace(config, sector, research.id, research.id, navigate), { initialProps: { sector: 'TEST sector' } })
  await waitFor(() => expect(view.result.current.sessions.status).toBe('ready'))
  let creating: Promise<boolean>
  act(() => { creating = view.result.current.createChat() })
  view.rerender({ sector: 'TEST another sector' })
  await waitFor(() => expect(view.result.current.sessions.status).toBe('ready'))
  await act(async () => { finish({ id: 'TEST late creation', title: 'New conversation', sectorId: 'TEST sector' }); await creating })
  expect(navigate).not.toHaveBeenCalled()
  expect(view.result.current.sessions.data?.some((session) => session.id === 'TEST late creation')).toBe(false)
  view.unmount()
})

it('sends the global context switch to the API and refreshes the sessions', async () => {
  api.global.mockResolvedValue({ researchSessionId: research.id })
  api.list.mockResolvedValue([research])
  api.settings.mockResolvedValue({ useGlobalContext: false, purpose: 'chat' })
  const { result, unmount } = renderHook(() => useSectorWorkspace(config, 'TEST sector', research.id, research.id, vi.fn()))
  await waitFor(() => expect(result.current.sessions.status).toBe('ready'))
  await act(async () => { await result.current.setUseGlobalContext(false) })
  expect(api.settings).toHaveBeenCalledWith(config, research.id, false)
  expect(api.list).toHaveBeenCalledTimes(2)
  unmount()
})
