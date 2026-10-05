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

function session(overrides: Partial<Session> = {}): Session {
  return { id: 'chat-1', title: 'Evening chat', createdAt: '2026-10-01', updatedAt: '2026-10-01', sectorId: 'sec-1', kind: 'normal' as const, useGlobalContext: true, ...overrides }
}

function stubModel(overrides: { spawnSubagent?: (goal: string, name?: string) => Promise<boolean>; threads?: unknown }) {
  const chat = {
    status: 'ready' as const, messages: [], draft: '', busy: false, live: null, error: null,
    missedInstructions: [], phase: 'idle' as const, echo: null, retry: vi.fn(), setDraft: vi.fn(), send: vi.fn(),
  }
  const selected = session()
  return {
    sessions: ready([selected]), selected, activeThread: selected.id, threads: ready(overrides.threads ?? []), child: undefined,
    global: ready(null), files: ready([]), progress: ready(null), plan: ready(null), local: ready(null),
    chat: chat as never, operation: null, preview: { status: 'loading' as const, refresh: vi.fn() },
    reviewProposal: vi.fn(), fileBody: { status: 'loading' as const, refresh: vi.fn() }, fileUnits: undefined,
    fileHasPrevious: false, browseFileUnits: vi.fn(), nextFileUnits: vi.fn(), previousFileUnits: vi.fn(),
    previewFileId: null, previewFile: vi.fn(),
    error: null, openSession: vi.fn(), openThread: vi.fn(), createChat: vi.fn(), renameChat: vi.fn(),
    setUseGlobalContext: vi.fn(async () => true), deleteChat: vi.fn(), stop: vi.fn(), resume: vi.fn(), saveGlobal: vi.fn(),
    stopSubagent: vi.fn(async () => true),
    queue: ready([]), removeQueued: vi.fn(async () => true), reorderQueue: vi.fn(async () => true),
    decide: vi.fn(), retryFile: vi.fn(), hideFile: vi.fn(), includeFile: vi.fn(), upload: vi.fn(),
    saveLocal: vi.fn(), rebuildLocal: vi.fn(), compact: vi.fn(),
    spawnSubagent: overrides.spawnSubagent ?? vi.fn(async () => true),
    inspectExecution: vi.fn(), executionOpen: false, executionPage: { status: 'loading' as const, refresh: vi.fn() },
    executionBody: { status: 'loading' as const, refresh: vi.fn() }, executionSeq: null, executionHasPrevious: false,
    selectExecution: vi.fn(), nextExecutionPage: vi.fn(), previousExecutionPage: vi.fn(), closeExecution: vi.fn(),
    inspectOperation: vi.fn(), operationReceipt: undefined,
  } as unknown as SectorWorkspaceModel
}

const actions = { busy: false, error: null, plan: vi.fn(), approve: vi.fn(), start: vi.fn(), pause: vi.fn(), resume: vi.fn(), edit: vi.fn(async () => true) }

describe('owner subagent spawn (A15)', () => {
  it('starts a subagent from the strip with goal and name', async () => {
    const user = userEvent.setup()
    const spawnSubagent = vi.fn(async () => true)
    render(<SectorWorkspace sector={sector} model={stubModel({ spawnSubagent })} config={config} actions={actions} onBack={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'New subagent' }))
    const dialog = screen.getByRole('dialog', { name: 'New subagent' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Goal' }), 'dig into pricing')
    await user.type(within(dialog).getByRole('textbox', { name: 'Name (optional)' }), 'Pricer')
    await user.click(within(dialog).getByRole('button', { name: 'Start subagent' }))
    expect(spawnSubagent).toHaveBeenCalledWith('dig into pricing', 'Pricer')
    expect(screen.queryByRole('dialog', { name: 'New subagent' })).not.toBeInTheDocument()
  })

  it('starts without a name and keeps the dialog open on failure', async () => {
    const user = userEvent.setup()
    const spawnSubagent = vi.fn(async () => false)
    render(<SectorWorkspace sector={sector} model={stubModel({ spawnSubagent })} config={config} actions={actions} onBack={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'New subagent' }))
    const dialog = screen.getByRole('dialog', { name: 'New subagent' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Goal' }), 'dig into pricing')
    await user.click(within(dialog).getByRole('button', { name: 'Start subagent' }))
    expect(spawnSubagent).toHaveBeenCalledWith('dig into pricing', undefined)
    expect(screen.getByRole('dialog', { name: 'New subagent' })).toBeInTheDocument()
  })

  it('offers spawn from the directory dialog', async () => {
    const user = userEvent.setup()
    const threads = [{ key: 'agent:child-1', kind: 'subagent', name: 'Pricer', status: 'RUNNING', queueDepth: 0 }]
    render(<SectorWorkspace sector={sector} model={stubModel({ threads })} config={config} actions={actions} onBack={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'View all 1' }))
    const dialog = screen.getByRole('dialog', { name: 'Subagents' })
    expect(within(dialog).getByRole('button', { name: 'New subagent' })).toBeInTheDocument()
  })

  it('shows the given name on the strip with the raw key only in the tooltip', () => {
    const threads = [{ key: 'agent:child-9', kind: 'subagent', name: 'Pricer', status: 'RUNNING', queueDepth: 0 }]
    render(<SectorWorkspace sector={sector} model={stubModel({ threads })} config={config} actions={actions} onBack={vi.fn()} />)
    expect(screen.getByText('Pricer')).toBeInTheDocument()
    expect(screen.queryByText('agent:child-9')).not.toBeInTheDocument()
    expect(screen.queryByText('child-9')).not.toBeInTheDocument()
    expect(screen.getByText('Pricer').closest('button')).toHaveAttribute('title', 'agent:child-9')
  })

  it('falls back to Subagent N on the strip and directory when the name is missing', async () => {
    const user = userEvent.setup()
    const threads = [{ key: 'agent:child-9', kind: 'subagent', status: 'RUNNING', queueDepth: 0 }]
    render(<SectorWorkspace sector={sector} model={stubModel({ threads })} config={config} actions={actions} onBack={vi.fn()} />)
    expect(screen.getByText('Subagent 1')).toBeInTheDocument()
    expect(screen.queryByText('child-9')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View all 1' }))
    const dialog = screen.getByRole('dialog', { name: 'Subagents' })
    expect(within(dialog).getByText('Subagent 1')).toBeInTheDocument()
    expect(within(dialog).queryByText('child-9')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Open Subagent 1' })).toHaveAttribute('title', 'agent:child-9')
  })

  it('treats a stored child id as a missing name', () => {
    const threads = [{ key: 'agent:child-7c78735b-0d0a', kind: 'subagent', name: 'child-7c78735b-0d0a', status: 'RUNNING', queueDepth: 0 }]
    render(<SectorWorkspace sector={sector} model={stubModel({ threads })} config={config} actions={actions} onBack={vi.fn()} />)
    expect(screen.getByText('Subagent 1')).toBeInTheDocument()
    expect(screen.queryByText('child-7c78735b-0d0a')).not.toBeInTheDocument()
    expect(screen.getByText('Subagent 1').closest('button')).toHaveAttribute('title', 'agent:child-7c78735b-0d0a')
  })
})
