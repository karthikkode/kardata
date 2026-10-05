import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SectorWorkspace } from '@/components/SectorWorkspace'
import type { SectorWorkspaceModel } from '@/data/sector-workspace'
import type { Session, StagingConfig } from '@/data/staging-api'

const config: StagingConfig = { baseUrl: 'https://test.invalid', apiKey: 'TEST owner' }
const sector = { id: 'sec-1', name: 'Foods', topic: '', state: 'draft', companiesFound: 0 } as never

function ready<T>(data: T) {
  return { status: 'ready' as const, data, refresh: vi.fn() }
}

function session(overrides: Partial<Session> = {}): Session {
  return { id: 'chat-1', title: 'Evening chat', createdAt: '2026-10-01', updatedAt: '2026-10-01', sectorId: 'sec-1', kind: 'normal' as const, useGlobalContext: true, ...overrides }
}

function stubModel(selected: Session, setUseGlobalContext = vi.fn(async () => true)): SectorWorkspaceModel {
  const chat = {
    status: 'ready' as const, messages: [], draft: '', busy: false, live: null, error: null,
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
    setUseGlobalContext, deleteChat: vi.fn(), stop: vi.fn(), resume: vi.fn(), saveGlobal: vi.fn(),
    stopSubagent: vi.fn(async () => true),
    queue: ready([]), removeQueued: vi.fn(async () => true), reorderQueue: vi.fn(async () => true),
    decide: vi.fn(), retryFile: vi.fn(), hideFile: vi.fn(), includeFile: vi.fn(), upload: vi.fn(),
    saveLocal: vi.fn(), rebuildLocal: vi.fn(), compact: vi.fn(),
    inspectExecution: vi.fn(), executionOpen: false, executionPage: { status: 'loading' as const, refresh: vi.fn() },
    executionBody: { status: 'loading' as const, refresh: vi.fn() }, executionSeq: null, executionHasPrevious: false,
    selectExecution: vi.fn(), nextExecutionPage: vi.fn(), previousExecutionPage: vi.fn(), closeExecution: vi.fn(),
    inspectOperation: vi.fn(), operationReceipt: undefined,
  } as unknown as SectorWorkspaceModel
}

const actions = { busy: false, error: null, plan: vi.fn(), approve: vi.fn(), start: vi.fn(), pause: vi.fn(), resume: vi.fn(), edit: vi.fn(async () => true) }

describe('per-chat global context switch (A5)', () => {
  it('toggles the switch from the conversation options menu', async () => {
    const user = userEvent.setup()
    const setUseGlobalContext = vi.fn(async () => true)
    render(<SectorWorkspace sector={sector} model={stubModel(session(), setUseGlobalContext)} config={config} actions={actions} onBack={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Conversation options' }))
    const toggle = screen.getByRole('switch', { name: 'Use global context' })
    expect(toggle).toBeChecked()
    await user.click(toggle)
    expect(setUseGlobalContext).toHaveBeenCalledWith(false)
  })

  it('shows the off chip under the composer and turns the switch back on', async () => {
    const user = userEvent.setup()
    const setUseGlobalContext = vi.fn(async () => true)
    render(<SectorWorkspace sector={sector} model={stubModel(session({ useGlobalContext: false }), setUseGlobalContext)} config={config} actions={actions} onBack={vi.fn()} />)
    const chip = screen.getByRole('button', { name: 'Global context off. Turn it back on.' })
    expect(within(chip).getByText('Global context off')).toBeInTheDocument()
    await user.click(chip)
    expect(setUseGlobalContext).toHaveBeenCalledWith(true)
  })

  it('hides the chip while the switch is on', () => {
    render(<SectorWorkspace sector={sector} model={stubModel(session())} config={config} actions={actions} onBack={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Global context off. Turn it back on.' })).not.toBeInTheDocument()
  })
})
