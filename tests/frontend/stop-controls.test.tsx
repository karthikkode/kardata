import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SectorWorkspace } from '@/components/SectorWorkspace'
import type { SectorWorkspaceModel } from '@/data/sector-workspace'
import type { Session } from '@/data/api/sessions'
import type { StagingConfig } from '@/data/api/client'
import type { ThreadView } from '@/data/api/threads'
import { notify } from '@/lib/toast'

vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }))

const config: StagingConfig = { baseUrl: 'https://test.invalid', apiKey: 'TEST owner' }
const sector = { id: 'sec-1', name: 'Foods', topic: '', state: 'draft', companiesFound: 0 } as never

function ready<T>(data: T) {
  return { status: 'ready' as const, data, refresh: vi.fn() }
}

const selected: Session = { id: 'chat-1', title: 'Evening chat', createdAt: '2026-10-01', updatedAt: '2026-10-01', sectorId: 'sec-1', kind: 'normal' as const, useGlobalContext: true }

function child(key: string, status: string, name = 'Research agent 1'): ThreadView {
  return { key, sessionId: 'chat-1', kind: 'subagent', name, status, acceptingSteer: true, queueDepth: 0, updatedAt: '2026-10-01' }
}

function stubModel(overrides: { busy?: boolean; threads?: ThreadView[]; stop?: () => Promise<boolean>; stopSubagent?: (childId: string) => Promise<boolean> }) {
  const chat = {
    status: 'ready' as const, messages: [], draft: '', busy: overrides.busy ?? false, live: null, error: null,
    missedInstructions: [], phase: 'idle' as const, echo: null, retry: vi.fn(), setDraft: vi.fn(), send: vi.fn(),
  }
  return {
    sessions: ready([selected]), selected, activeThread: selected.id, threads: ready(overrides.threads ?? []), child: undefined,
    global: ready(null), files: ready([]), progress: ready(null), plan: ready(null), local: ready(null),
    chat: chat as never, operation: null, preview: { status: 'loading' as const, refresh: vi.fn() },
    reviewProposal: vi.fn(), fileBody: { status: 'loading' as const, refresh: vi.fn() }, fileUnits: undefined,
    fileHasPrevious: false, browseFileUnits: vi.fn(), nextFileUnits: vi.fn(), previousFileUnits: vi.fn(),
    previewFileId: null, previewFile: vi.fn(),
    error: null, openSession: vi.fn(), openThread: vi.fn(), createChat: vi.fn(), renameChat: vi.fn(),
    setUseGlobalContext: vi.fn(async () => true), deleteChat: vi.fn(), stop: overrides.stop ?? vi.fn(async () => true), resume: vi.fn(),
    stopSubagent: overrides.stopSubagent ?? vi.fn(async () => true), saveGlobal: vi.fn(),
    decide: vi.fn(), retryFile: vi.fn(), hideFile: vi.fn(), includeFile: vi.fn(), upload: vi.fn(),
    saveLocal: vi.fn(), rebuildLocal: vi.fn(), compact: vi.fn(),
    spawnSubagent: vi.fn(async () => true),
    pauseSubagent: vi.fn(async () => true),
    resumeSubagent: vi.fn(async () => true),
    queue: ready([]), removeQueued: vi.fn(async () => true), reorderQueue: vi.fn(async () => true),
    inspectExecution: vi.fn(), executionOpen: false, executionPage: { status: 'loading' as const, refresh: vi.fn() },
    executionBody: { status: 'loading' as const, refresh: vi.fn() }, executionSeq: null, executionHasPrevious: false,
    selectExecution: vi.fn(), nextExecutionPage: vi.fn(), previousExecutionPage: vi.fn(), closeExecution: vi.fn(),
    inspectOperation: vi.fn(), operationReceipt: undefined,
  } as unknown as SectorWorkspaceModel
}

const actions = { busy: false, error: null, plan: vi.fn(), approve: vi.fn(), start: vi.fn(), pause: vi.fn(), resume: vi.fn(), edit: vi.fn(async () => true) }

function renderWorkspace(model: SectorWorkspaceModel) {
  render(<SectorWorkspace sector={sector} model={model} config={config} actions={actions} onBack={vi.fn()} />)
}

async function confirmStop() {
  const user = userEvent.setup()
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('Stop this agent?')).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'Stop agent' }))
}

describe('stop controls (A18)', () => {
  it('hides the header stop while no turn runs', () => {
    renderWorkspace(stubModel({ busy: false }))
    expect(within(screen.getByRole('banner')).queryByRole('button', { name: 'Stop agent' })).not.toBeInTheDocument()
  })

  it('stops the running chat from the header after confirming', async () => {
    const user = userEvent.setup()
    const stop = vi.fn(async () => true)
    renderWorkspace(stubModel({ busy: true, stop }))
    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Stop agent' }))
    expect(stop).not.toHaveBeenCalled()
    await confirmStop()
    expect(stop).toHaveBeenCalledTimes(1)
    expect(notify.success).toHaveBeenCalledWith('Stopped')
  })

  it('stops a running subagent from its strip chip after confirming', async () => {
    const user = userEvent.setup()
    const stopSubagent = vi.fn(async () => true)
    renderWorkspace(stubModel({ threads: [child('agent:child-1', 'RUNNING')], stopSubagent }))
    await user.click(screen.getByRole('button', { name: 'Stop Research agent 1' }))
    expect(stopSubagent).not.toHaveBeenCalled()
    await confirmStop()
    expect(stopSubagent).toHaveBeenCalledWith('child-1')
    expect(notify.success).toHaveBeenCalledWith('Stopped')
  })

  it('stops a running subagent from the directory after confirming', async () => {
    const user = userEvent.setup()
    const stopSubagent = vi.fn(async () => true)
    renderWorkspace(stubModel({ threads: [child('agent:child-1', 'RUNNING')], stopSubagent }))
    await user.click(screen.getByRole('button', { name: 'View all 1' }))
    const dialog = await screen.findByRole('dialog', { name: 'Subagents' })
    await user.click(within(dialog).getByRole('button', { name: 'Stop Research agent 1' }))
    await confirmStop()
    expect(stopSubagent).toHaveBeenCalledWith('child-1')
  })

  it('shows no stop on finished subagent rows', () => {
    renderWorkspace(stubModel({ threads: [child('agent:child-1', 'FINISHED')] }))
    expect(screen.queryByRole('button', { name: 'Stop Research agent 1' })).not.toBeInTheDocument()
  })
})
