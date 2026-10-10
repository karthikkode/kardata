// A control-paused thread always shows Resume (F6b/R0-12). The paused
// banner used to lose branch precedence to the queued/reconnecting
// states: a paused thread with owed sends (or a broken stream) showed
// "Queued, waiting" / "Reconnect now" with no way to resume. Paused
// (live phase or projected thread status) now wins the branch chain.
import { render, screen } from '@testing-library/react'
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
const pausedSession: ThreadView = { key: 'chat-1', sessionId: 'chat-1', kind: 'session', name: 'Evening chat', status: 'PAUSED', acceptingSteer: false, queueDepth: 0, updatedAt: '2026-10-01' }

function stubModel(phase: string) {
  const chat = {
    status: 'ready' as const, messages: [], draft: '', busy: false, live: null, error: null,
    missedInstructions: [], phase, echo: null, retry: vi.fn(), setDraft: vi.fn(), send: vi.fn(),
  }
  return {
    sessions: ready([selected]), selected, activeThread: selected.id, threads: ready([pausedSession]), child: undefined,
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

function renderWorkspace(model: SectorWorkspaceModel) {
  render(<SectorWorkspace sector={sector} model={model} config={config} actions={actions} onBack={vi.fn()} />)
}

describe('paused conversation always offers Resume (F6b)', () => {
  it.each(['queued', 'reconnecting'] as const)('shows Resume on a paused thread in %s phase', (phase) => {
    renderWorkspace(stubModel(phase))
    expect(screen.getByText('This conversation is paused.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
  })

  it('shows Resume on a paused thread in idle phase', () => {
    renderWorkspace(stubModel('idle'))
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
  })
})
