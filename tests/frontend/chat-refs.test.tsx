import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
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

function stubModel(selected: Session, sessions: Session[], chatOverrides: Record<string, unknown> = {}) {
  const chat = {
    status: 'ready' as const, messages: [], draft: '', busy: false, live: null, error: null,
    missedInstructions: [], phase: 'idle' as const, echo: null, retry: vi.fn(), setDraft: vi.fn(), send: vi.fn(),
    ...chatOverrides,
  }
  return {
    sessions: ready(sessions), selected, activeThread: selected.id, threads: ready([]), child: undefined,
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
    inspectExecution: vi.fn(), executionOpen: false, executionPage: { status: 'loading' as const, refresh: vi.fn() },
    executionBody: { status: 'loading' as const, refresh: vi.fn() }, executionSeq: null, executionHasPrevious: false,
    selectExecution: vi.fn(), nextExecutionPage: vi.fn(), previousExecutionPage: vi.fn(), closeExecution: vi.fn(),
    inspectOperation: vi.fn(), operationReceipt: undefined,
  } as unknown as SectorWorkspaceModel
}

const actions = { busy: false, error: null, plan: vi.fn(), approve: vi.fn(), start: vi.fn(), pause: vi.fn(), resume: vi.fn(), edit: vi.fn(async () => true) }

function Harness({ selected, sessions, messages = [] }: { selected: Session; sessions: Session[]; messages?: Array<{ id: string; kind: 'text'; role: 'user'; text: string }> }) {
  const [draft, setDraft] = useState('')
  const model = stubModel(selected, sessions, { draft, setDraft, messages })
  return <SectorWorkspace sector={sector} model={model} config={config} actions={actions} onBack={vi.fn()} />
}

const research = session({ id: 'research-1', title: 'Research', kind: 'research' as const })
const pricing = session({ id: 'chat-2', title: 'Pricing chat' })
const hiring = session({ id: 'chat-3', title: 'Hiring notes' })

describe('research @chat references (A14)', () => {
  it('offers the Chats group in the research composer and inserts @title', async () => {
    const user = userEvent.setup()
    render(<Harness selected={research} sessions={[research, pricing, hiring]} />)
    const box = screen.getByRole('textbox', { name: 'Message this conversation' })
    await user.type(box, '@')
    const listbox = screen.getByRole('listbox', { name: 'Mention a chat' })
    expect(within(listbox).getByText('Chats')).toBeInTheDocument()
    expect(within(listbox).getByRole('option', { name: 'Pricing chat' })).toBeInTheDocument()
    expect(within(listbox).getByRole('option', { name: 'Hiring notes' })).toBeInTheDocument()
    expect(within(listbox).queryByRole('option', { name: 'Research' })).not.toBeInTheDocument()
    await user.click(within(listbox).getByRole('option', { name: 'Pricing chat' }))
    expect(box).toHaveValue('@Pricing chat ')
  })

  it('converts @title to the marker on send', async () => {
    const user = userEvent.setup()
    const send = vi.fn()
    function SendHarness() {
      const [draft, setDraft] = useState('')
      const model = stubModel(research, [research, pricing, hiring], { draft, setDraft, send })
      return <SectorWorkspace sector={sector} model={model} config={config} actions={actions} onBack={vi.fn()} />
    }
    render(<SendHarness />)
    const box = screen.getByRole('textbox', { name: 'Message this conversation' })
    await user.type(box, '@')
    await user.click(within(screen.getByRole('listbox', { name: 'Mention a chat' })).getByRole('option', { name: 'Pricing chat' }))
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(send).toHaveBeenCalledWith(false, '[[session:chat-2|Pricing chat]] ')
  })

  it('drops the mapping when the @title text is deleted', async () => {
    const user = userEvent.setup()
    const send = vi.fn()
    function SendHarness() {
      const [draft, setDraft] = useState('')
      const model = stubModel(research, [research, pricing, hiring], { draft, setDraft, send })
      return <SectorWorkspace sector={sector} model={model} config={config} actions={actions} onBack={vi.fn()} />
    }
    render(<SendHarness />)
    const box = screen.getByRole('textbox', { name: 'Message this conversation' })
    await user.type(box, '@')
    await user.click(within(screen.getByRole('listbox', { name: 'Mention a chat' })).getByRole('option', { name: 'Pricing chat' }))
    await user.clear(box)
    await user.type(box, 'plain hello')
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(send).toHaveBeenCalledWith(false)
    expect(send).not.toHaveBeenCalledWith(false, expect.stringContaining('[[session:'))
  })

  it('filters chats by typed title', async () => {
    const user = userEvent.setup()
    render(<Harness selected={research} sessions={[research, pricing, hiring]} />)
    const box = screen.getByRole('textbox', { name: 'Message this conversation' })
    await user.type(box, '@hir')
    const listbox = screen.getByRole('listbox', { name: 'Mention a chat' })
    expect(within(listbox).getByRole('option', { name: 'Hiring notes' })).toBeInTheDocument()
    expect(within(listbox).queryByRole('option', { name: 'Pricing chat' })).not.toBeInTheDocument()
  })

  it('offers no Chats group in a normal chat', async () => {
    const user = userEvent.setup()
    render(<Harness selected={pricing} sessions={[research, pricing, hiring]} />)
    await user.type(screen.getByRole('textbox', { name: 'Message this conversation' }), '@')
    expect(screen.queryByRole('listbox', { name: 'Mention a chat' })).not.toBeInTheDocument()
  })

  it('renders markers as @title chips in sent user bubbles', () => {
    render(
      <Harness
        selected={research}
        sessions={[research, pricing]}
        messages={[{ id: 'm-1', kind: 'text', role: 'user', text: '[[session:chat-2|Pricing chat]] what should change?' }]}
      />,
    )
    expect(screen.getByText('@Pricing chat')).toBeInTheDocument()
    expect(screen.queryByText(/\[\[session:/)).not.toBeInTheDocument()
  })
})
