import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SectorWorkspace } from '@/components/SectorWorkspace'
import type { SectorWorkspaceModel } from '@/data/sector-workspace'
import type { Session } from '@/data/api/sessions'
import type { StagingConfig } from '@/data/api/client'

const config: StagingConfig = { baseUrl: 'https://test.invalid', apiKey: 'TEST owner' }
const sector = { id: 'sec-1', name: 'Foods', topic: '', state: 'draft', companiesFound: 0 } as never

function ready<T>(data: T) {
  return { status: 'ready' as const, data, refresh: vi.fn() }
}

const selected: Session = { id: 'chat-1', title: 'Evening chat', createdAt: '2026-10-01', updatedAt: '2026-10-01', sectorId: 'sec-1', kind: 'normal' as const, useGlobalContext: true }

interface QueueItem { id: string; text: string; queuedAt: number }

function stubModel(overrides: { queue?: QueueItem[]; busy?: boolean; removeQueued?: (id: string) => Promise<boolean>; reorderQueue?: (ids: string[]) => Promise<boolean> }) {
  const chat = {
    status: 'ready' as const, messages: [], draft: '', busy: overrides.busy ?? true, live: null, error: null,
    missedInstructions: [], phase: 'idle' as const, echo: null, retry: vi.fn(), setDraft: vi.fn(), send: vi.fn(),
  }
  return {
    sessions: ready([selected]), selected, activeThread: selected.id, threads: ready([]), child: undefined,
    global: ready(null), files: ready([]), progress: ready(null), plan: ready(null), local: ready(null),
    chat: chat as never, operation: null, preview: { status: 'loading' as const, refresh: vi.fn() },
    reviewProposal: vi.fn(), fileBody: { status: 'loading' as const, refresh: vi.fn() }, fileUnits: undefined,
    fileHasPrevious: false, browseFileUnits: vi.fn(), nextFileUnits: vi.fn(), previousFileUnits: vi.fn(),
    previewFileId: null, previewFile: vi.fn(),
    error: null, openSession: vi.fn(), openThread: vi.fn(), createChat: vi.fn(), renameChat: vi.fn(),
    setUseGlobalContext: vi.fn(async () => true), deleteChat: vi.fn(), stop: vi.fn(), resume: vi.fn(), saveGlobal: vi.fn(),
    stopSubagent: vi.fn(async () => true),
    decide: vi.fn(), retryFile: vi.fn(), hideFile: vi.fn(), includeFile: vi.fn(), upload: vi.fn(),
    saveLocal: vi.fn(), rebuildLocal: vi.fn(), compact: vi.fn(),
    spawnSubagent: vi.fn(async () => true),
    pauseSubagent: vi.fn(async () => true),
    resumeSubagent: vi.fn(async () => true),
    queue: ready(overrides.queue ?? []),
    removeQueued: overrides.removeQueued ?? vi.fn(async () => true),
    reorderQueue: overrides.reorderQueue ?? vi.fn(async () => true),
    inspectExecution: vi.fn(), executionOpen: false, executionPage: { status: 'loading' as const, refresh: vi.fn() },
    executionBody: { status: 'loading' as const, refresh: vi.fn() }, executionSeq: null, executionHasPrevious: false,
    selectExecution: vi.fn(), nextExecutionPage: vi.fn(), previousExecutionPage: vi.fn(), closeExecution: vi.fn(),
    inspectOperation: vi.fn(), operationReceipt: undefined,
  } as unknown as SectorWorkspaceModel
}

const actions = { busy: false, error: null, plan: vi.fn(), approve: vi.fn(), start: vi.fn(), pause: vi.fn(), resume: vi.fn(), edit: vi.fn(async () => true) }
const items: QueueItem[] = [
  { id: 'q-one', text: 'ONE', queuedAt: 3 },
  { id: 'q-two', text: 'TWO', queuedAt: 2 },
  { id: 'q-three', text: 'THREE', queuedAt: 1 },
]

describe('queued messages (A17)', () => {
  it('hides the disclosure when the queue is empty', () => {
    render(<SectorWorkspace sector={sector} model={stubModel({ queue: [] })} config={config} actions={actions} onBack={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Queued/ })).not.toBeInTheDocument()
  })

  it('removes an item', async () => {
    const user = userEvent.setup()
    const removeQueued = vi.fn(async () => true)
    render(<SectorWorkspace sector={sector} model={stubModel({ queue: items, removeQueued })} config={config} actions={actions} onBack={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Queued (3)' }))
    const row = screen.getByRole('button', { name: 'Remove TWO' }).closest('li')!
    expect(within(row).getByText('TWO')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove TWO' }))
    expect(removeQueued).toHaveBeenCalledWith('q-two')
  })

  it('moves an item up by reordering', async () => {
    const user = userEvent.setup()
    const reorderQueue = vi.fn(async () => true)
    render(<SectorWorkspace sector={sector} model={stubModel({ queue: items, reorderQueue })} config={config} actions={actions} onBack={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Queued (3)' }))
    await user.click(screen.getByRole('button', { name: 'Move TWO up' }))
    expect(reorderQueue).toHaveBeenCalledWith(['q-two', 'q-one', 'q-three'])
  })
})
