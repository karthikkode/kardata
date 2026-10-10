// Finished children read honestly (F6e/R0-13b guards): the directory
// badges them finished with no Pause/Resume/Stop, and an open finished
// child offers Send, never Steer (Steer needs a live turn).
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SectorWorkspace } from '@/components/SectorWorkspace'
import type { SectorWorkspaceModel } from '@/data/sector-workspace'
import type { Session } from '@/data/api/sessions'
import type { StagingConfig } from '@/data/api/client'
import type { ThreadView } from '@/data/api/threads'

vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }))

const config: StagingConfig = { baseUrl: 'https://test.invalid', apiKey: 'TEST owner' }
const sector = { id: 'sec-1', name: 'Foods', topic: '', state: 'draft', companiesFound: 0 } as never
const actions = { busy: false, error: null, plan: vi.fn(), approve: vi.fn(), start: vi.fn(), pause: vi.fn(), resume: vi.fn(), edit: vi.fn(async () => true) }

function ready<T>(data: T) {
  return { status: 'ready' as const, data, refresh: vi.fn() }
}

const selected: Session = { id: 'chat-1', title: 'Evening chat', createdAt: '2026-10-01', updatedAt: '2026-10-01', sectorId: 'sec-1', kind: 'normal' as const, useGlobalContext: true }
const doneChild: ThreadView = { key: 'agent:done-1', sessionId: 'chat-1', kind: 'subagent', name: 'Done child', status: 'FINISHED', acceptingSteer: false, queueDepth: 0, updatedAt: '2026-10-01' }

function stubModel() {
  const chat = {
    status: 'ready' as const, messages: [], draft: 'hello', busy: false, live: null, error: null,
    missedInstructions: [], phase: 'idle' as const, echo: null, retry: vi.fn(), setDraft: vi.fn(), send: vi.fn(),
  }
  return {
    sessions: ready([selected]), selected, activeThread: doneChild.key, threads: ready([doneChild]), child: doneChild,
    global: ready(null), files: ready([]), progress: ready(null), plan: ready(null), local: ready(null),
    chat: chat as never, operation: null, preview: { status: 'loading' as const, refresh: vi.fn() },
    reviewProposal: vi.fn(), fileBody: { status: 'loading' as const, refresh: vi.fn() }, fileUnits: undefined,
    fileHasPrevious: false, browseFileUnits: vi.fn(), nextFileUnits: vi.fn(), previousFileUnits: vi.fn(),
    previewFileId: null, previewFile: vi.fn(),
    error: null, openSession: vi.fn(), openThread: vi.fn(), createChat: vi.fn(), renameChat: vi.fn(),
    setUseGlobalContext: vi.fn(async () => true), deleteChat: vi.fn(), stop: vi.fn(async () => true), resume: vi.fn(),
    stopSubagent: vi.fn(async () => true), saveGlobal: vi.fn(),
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

describe('finished children (F6e guards)', () => {
  it('directory badges a finished child finished with no controls', async () => {
    const user = userEvent.setup()
    render(<SectorWorkspace sector={sector} model={stubModel()} config={config} actions={actions} onBack={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'View all 1' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Finished')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Pause Done child/ })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Resume Done child/ })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Stop Done child/ })).not.toBeInTheDocument()
  })

  it('open finished child offers Send, never Steer', () => {
    render(<SectorWorkspace sector={sector} model={stubModel()} config={config} actions={actions} onBack={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Steer' })).not.toBeInTheDocument()
  })
})
