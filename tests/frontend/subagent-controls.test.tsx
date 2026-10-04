import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SectorWorkspace } from '@/components/SectorWorkspace'
import type { SectorWorkspaceModel } from '@/data/sector-workspace'
import type { Session, StagingConfig, ThreadView } from '@/data/staging-api'

const config: StagingConfig = { baseUrl: 'https://test.invalid', apiKey: 'TEST owner' }
const sector = { id: 'sec-1', name: 'Foods', topic: '', state: 'draft', companiesFound: 0 } as never

function ready<T>(data: T) {
  return { status: 'ready' as const, data, refresh: vi.fn() }
}

const selected: Session = { id: 'chat-1', title: 'Evening chat', createdAt: '2026-10-01', updatedAt: '2026-10-01', sectorId: 'sec-1', kind: 'normal' as const, useGlobalContext: true }

function child(key: string, status: string): ThreadView {
  return { key, kind: 'subagent', name: `Child ${key}`, status, queueDepth: 0, acceptingSteer: true } as ThreadView
}

function stubModel(overrides: { threads?: ThreadView[]; pauseSubagent?: (childId: string) => Promise<boolean>; resumeSubagent?: (childId: string) => Promise<boolean> }) {
  const chat = {
    status: 'ready' as const, messages: [], draft: '', busy: false, live: null, error: null,
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
    setUseGlobalContext: vi.fn(async () => true), deleteChat: vi.fn(), stop: vi.fn(), resume: vi.fn(), saveGlobal: vi.fn(),
    stopSubagent: vi.fn(async () => true),
    decide: vi.fn(), retryFile: vi.fn(), hideFile: vi.fn(), includeFile: vi.fn(), upload: vi.fn(),
    saveLocal: vi.fn(), rebuildLocal: vi.fn(), compact: vi.fn(),
    spawnSubagent: vi.fn(async () => true),
    pauseSubagent: overrides.pauseSubagent ?? vi.fn(async () => true),
    resumeSubagent: overrides.resumeSubagent ?? vi.fn(async () => true),
    queue: ready([]), removeQueued: vi.fn(async () => true), reorderQueue: vi.fn(async () => true),
    inspectExecution: vi.fn(), executionOpen: false, executionPage: { status: 'loading' as const, refresh: vi.fn() },
    executionBody: { status: 'loading' as const, refresh: vi.fn() }, executionSeq: null, executionHasPrevious: false,
    selectExecution: vi.fn(), nextExecutionPage: vi.fn(), previousExecutionPage: vi.fn(), closeExecution: vi.fn(),
    inspectOperation: vi.fn(), operationReceipt: undefined,
  } as unknown as SectorWorkspaceModel
}

const actions = { busy: false, error: null, plan: vi.fn(), approve: vi.fn(), start: vi.fn(), pause: vi.fn(), resume: vi.fn(), edit: vi.fn(async () => true) }

describe('subagent pause and resume (A16)', () => {
  it('pauses a running child from the strip and shows the Paused badge', async () => {
    const user = userEvent.setup()
    const pauseSubagent = vi.fn(async () => true)
    render(<SectorWorkspace sector={sector} model={stubModel({ threads: [child('agent:child-1', 'RUNNING')], pauseSubagent })} config={config} actions={actions} onBack={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Pause Child agent:child-1' }))
    expect(pauseSubagent).toHaveBeenCalledWith('child-1')
  })

  it('resumes a paused child from the directory', async () => {
    const user = userEvent.setup()
    const resumeSubagent = vi.fn(async () => true)
    render(<SectorWorkspace sector={sector} model={stubModel({ threads: [child('agent:child-1', 'PAUSED')], resumeSubagent })} config={config} actions={actions} onBack={vi.fn()} />)
    expect(screen.getByText('Paused')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View all 1' }))
    const dialog = screen.getByRole('dialog', { name: 'Subagents' })
    await user.click(within(dialog).getByRole('button', { name: 'Resume Child agent:child-1' }))
    expect(resumeSubagent).toHaveBeenCalledWith('child-1')
  })
})
