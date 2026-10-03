// chat-parts proofs: divider gaps, bubble shells, and the agent mark.
// No API stubs; pure render and pure-function assertions.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { AgentBubble, AgentMark, TimeDivider, UserBubble, splitAfter } from '@/components/chat-parts'
import { toolActivitySummary } from '@/components/chat/ToolActivity'

vi.mock('sonner', () => {
  const toastFn = vi.fn()
  return { toast: Object.assign(toastFn, { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }
})

describe('splitAfter', () => {
  it('opens a gap past five minutes', () => {
    expect(splitAfter('2026-09-27T00:00:00.000Z', '2026-09-27T00:06:00.000Z')).toBe(true)
  })

  it('stays gapless inside five minutes', () => {
    expect(splitAfter('2026-09-27T00:00:00.000Z', '2026-09-27T00:04:59.000Z')).toBe(false)
  })

  it('stays gapless without two clocks', () => {
    expect(splitAfter(undefined, '2026-09-27T00:06:00.000Z')).toBe(false)
    expect(splitAfter('2026-09-27T00:00:00.000Z', undefined)).toBe(false)
    expect(splitAfter('not-a-time', '2026-09-27T00:06:00.000Z')).toBe(false)
  })
})

describe('chat parts', () => {
  it('renders the divider with the relative timestamp', () => {
    render(<TimeDivider at="2026-09-27T00:00:00.000Z" />)
    expect(screen.getByText(/\d+[mhd]|now/)).toBeInTheDocument()
  })

  it('renders user and agent bubbles with their content', () => {
    render(
      <>
        <UserBubble>hello sector</UserBubble>
        <AgentBubble>Fresh thread.</AgentBubble>
      </>,
    )
    expect(screen.getByText('hello sector')).toBeInTheDocument()
    expect(screen.getByText('Fresh thread.')).toBeInTheDocument()
  })

  it('shrink-wraps the user bubble in a neutral tint', () => {
    render(<UserBubble>hey</UserBubble>)
    const bubble = screen.getByText('hey')
    expect(bubble.className).toContain('w-fit')
    expect(bubble.className).toContain('max-w-[85%]')
    expect(bubble.className).toContain('bg-surface-active')
    expect(bubble.className).toContain('rounded-br-sm')
  })

  it('summarizes settled and live tool activity', () => {
    const done = [
      { id: 't1', name: 'db.kb_search', detail: '', state: 'done' as const },
      { id: 't2', name: 'domain.scan', detail: '', state: 'done' as const },
    ]
    expect(toolActivitySummary(done, false)).toBe('Used 2 tools')
    expect(toolActivitySummary(done.slice(0, 1), false)).toBe('Used 1 tool')
    expect(toolActivitySummary(
      [...done, { id: 't3', name: 'db.kb_search', detail: '', state: 'running' as const }],
      true,
    )).toBe('Using Searched knowledge base...')
    expect(toolActivitySummary(done, true)).toBe('Using 2 tools...')
  })

  it('marks the agent with the chat initial', () => {
    render(<AgentMark name="Speciality Foods chat" />)
    expect(screen.getByText('Speciality Foods chat')).toBeInTheDocument()
    expect(screen.getByText('S')).toBeInTheDocument()
  })

  it('offers no copy action without settled text', () => {
    render(<AgentBubble>Streaming…</AgentBubble>)
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
  })

  it('copies settled reply text and confirms with a toast', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    try {
      render(<AgentBubble copyText="Settled answer.">Settled answer.</AgentBubble>)
      await user.click(screen.getByRole('button', { name: 'Copy' }))
      expect(writeText).toHaveBeenCalledWith('Settled answer.')
      expect(toast.success).toHaveBeenCalledWith('Copied', expect.anything())
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports clipboard rejection as a toast without touching content', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('denied') } } })
    try {
      render(<AgentBubble copyText="Settled answer.">Settled answer.</AgentBubble>)
      await user.click(screen.getByRole('button', { name: 'Copy' }))
      expect(toast.error).toHaveBeenCalledWith('Copy failed. Try again.', expect.anything())
      expect(screen.getByText('Settled answer.')).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('shows the timestamp beside Copy and keeps actions visible on the latest message', () => {
    const { container } = render(<AgentBubble copyText="Old answer." timestamp="2026-09-27T00:00:00.000Z">Old answer.</AgentBubble>)
    expect(screen.getByText(/\d+[mhd]|now/)).toBeInTheDocument()
    expect(container.querySelector('time')?.getAttribute('title')).toContain('2026')
    const { container: latest } = render(<AgentBubble copyText="New answer." latest>New answer.</AgentBubble>)
    expect(latest.querySelector('.opacity-100')).not.toBeNull()
  })
})
