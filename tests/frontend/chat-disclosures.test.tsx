// Shared chat disclosure proofs (CV-05/06/07/09): thinking row, reasoning
// handoff across the live -> settled boundary, tool activity, empty states.
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { ConversationEmpty } from '@/components/chat/ConversationEmpty'
import { ReasoningDisclosure, useReasoningOpen } from '@/components/chat/ReasoningDisclosure'
import { ThinkingRow } from '@/components/chat/ThinkingRow'
import { ToolActivity } from '@/components/chat/ToolActivity'

vi.mock('sonner', () => {
  const toastFn = vi.fn()
  return { toast: Object.assign(toastFn, { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }
})

describe('ThinkingRow', () => {
  it('announces the reply with an elapsed clock and no chrome', () => {
    render(<ThinkingRow />)
    expect(screen.getByRole('status', { name: 'Agent is replying' })).toBeInTheDocument()
    expect(screen.getByText('Thinking')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('expands live reasoning when the trace exists', () => {
    render(<ThinkingRow reasoning="checking the roster" />)
    expect(screen.queryByText('checking the roster')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show live reasoning' }))
    expect(screen.getByText('checking the roster')).toBeInTheDocument()
  })
})

describe('ReasoningDisclosure', () => {
  it('collapses the settled trace behind a ghost row', () => {
    render(<ReasoningDisclosure reasoning="weighed both crews" />)
    expect(screen.getByText('Reasoning')).toBeInTheDocument()
    expect(screen.queryByText('weighed both crews')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show reasoning' }))
    expect(screen.getByText('weighed both crews')).toBeInTheDocument()
  })

  it('names the duration when the caller knows it', () => {
    render(<ReasoningDisclosure reasoning="trace" durationText="12s" />)
    expect(screen.getByText('Thought for 12s')).toBeInTheDocument()
  })

  it('renders nothing without a trace', () => {
    const { container } = render(<ReasoningDisclosure reasoning="" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('reasoning handoff (CV-06)', () => {
  function Harness({ live, busy }: { live: boolean; busy: boolean }) {
    const [open, setOpen] = useReasoningOpen(busy)
    return live
      ? <ThinkingRow reasoning="live trace" open={open} onOpenChange={setOpen} />
      : <ReasoningDisclosure reasoning="live trace" open={open} onOpenChange={setOpen} />
  }

  it('keeps an expansion made during the stream after the reply settles', () => {
    const view = render(<Harness live busy />)
    fireEvent.click(screen.getByRole('button', { name: 'Show live reasoning' }))
    expect(screen.getByText('live trace')).toBeInTheDocument()
    view.rerender(<Harness live={false} busy={false} />)
    expect(screen.getByRole('button', { name: 'Hide reasoning' })).toBeInTheDocument()
    expect(screen.getByText('live trace')).toBeInTheDocument()
  })

  it('resets when the next turn starts', () => {
    const view = render(<Harness live busy />)
    fireEvent.click(screen.getByRole('button', { name: 'Show live reasoning' }))
    view.rerender(<Harness live={false} busy={false} />)
    expect(screen.getByRole('button', { name: 'Hide reasoning' })).toBeInTheDocument()
    view.rerender(<Harness live busy />)
    expect(screen.getByRole('button', { name: 'Show live reasoning' })).toBeInTheDocument()
    expect(screen.queryByText('live trace')).not.toBeInTheDocument()
  })
})

describe('ToolActivity', () => {
  const tools = [
    { id: 't1', name: 'db.kb_search', detail: 'searched 40 units', state: 'done' as const },
    { id: 't2', name: 'domain.scan', detail: '', state: 'done' as const },
  ]

  it('summarizes settled tools and expands humanized rows', () => {
    render(<ToolActivity tools={tools} />)
    expect(screen.getByText('Used 2 tools')).toBeInTheDocument()
    expect(screen.queryByText('Searched knowledge base')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show tool activity' }))
    expect(screen.getByText('Searched knowledge base')).toBeInTheDocument()
    expect(screen.getByText('Scan')).toBeInTheDocument()
  })

  it('names the running tool while live', () => {
    render(<ToolActivity tools={[{ id: 't1', name: 'db.kb_search', detail: '', state: 'running' as const }]} live />)
    expect(screen.getByText('Using Searched knowledge base...')).toBeInTheDocument()
  })

  it('keeps raw ids inside the detail block and copies them', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    try {
      render(<ToolActivity tools={tools} defaultOpen />)
      fireEvent.click(screen.getByRole('button', { name: 'Show Searched knowledge base detail' }))
      expect(screen.getByText('db.kb_search')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Copy Searched knowledge base detail' }))
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('id: db.kb_search'))
      expect(toast.success).toHaveBeenCalledWith('Copied', expect.anything())
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('marks failed rows without failing the group', () => {
    render(<ToolActivity tools={[{ id: 't1', name: 'domain.scan', detail: 'timeout', state: 'failed' as const }]} defaultOpen />)
    expect(screen.getByText('Used 1 tool')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('renders nothing without tools', () => {
    const { container } = render(<ToolActivity tools={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ConversationEmpty', () => {
  it.each([
    ['research', 'Ask about this research', 'Summarize progress so far'],
    ['chat', 'Start a conversation', 'Brainstorm search directions'],
    ['karbot', 'Ask Karbot anything', 'What is running right now?'],
  ] as const)('suggests first prompts for %s', (variant, title, first) => {
    const onSuggest = vi.fn()
    render(<ConversationEmpty variant={variant} onSuggest={onSuggest} />)
    expect(screen.getByText(title)).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: first }))
    expect(onSuggest).toHaveBeenCalledWith(first)
  })
})
