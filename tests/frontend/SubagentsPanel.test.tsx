// SubagentsPanel proofs over real thread rows: counts, rows, stop with
// announcement, tag/open callbacks by thread key. No fixtures: launching
// and staged completions have no backend primitive and are gone.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SubagentsPanel } from '@/components/SubagentsPanel'
import type { ThreadView } from '@/data/api/threads'

const THREADS: ThreadView[] = [
  { key: 'agent:child-1', name: 'Research agent 1', sessionId: 's-1', kind: 'subagent', status: 'running', acceptingSteer: true, queueDepth: 2, updatedAt: '' },
  { key: 'agent:child-2', sessionId: 's-1', kind: 'subagent', status: 'done', acceptingSteer: false, queueDepth: 0, updatedAt: '' },
]

describe('SubagentsPanel', () => {
  it('shows a count toggle and expands the thread list', () => {
    render(<SubagentsPanel threads={THREADS} />)
    expect(screen.getByRole('button', { name: '2 subagents, 1 running' })).toBeInTheDocument()
    expect(screen.queryByText('Research agent 1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '2 subagents, 1 running' }))
    expect(screen.getByText('Research agent 1')).toBeInTheDocument()
    expect(screen.getByText('Subagent 2')).toBeInTheDocument()
  })

  it('shows humanized names and keeps raw keys in tooltips only', () => {
    render(<SubagentsPanel threads={THREADS} />)
    fireEvent.click(screen.getByRole('button', { name: /subagents/ }))
    expect(screen.queryByText('agent:child-1')).not.toBeInTheDocument()
    expect(screen.queryByText('agent:child-2')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Chat with Research agent 1' })).toHaveAttribute('title', 'agent:child-1')
    expect(screen.getByRole('button', { name: 'Chat with Subagent 2' })).toHaveAttribute('title', 'agent:child-2')
  })

  it('renders rows with the shared ListRow recipe and marks the tagged row selected', () => {
    render(<SubagentsPanel threads={THREADS} taggedKey="agent:child-1" />)
    fireEvent.click(screen.getByRole('button', { name: /subagents/ }))
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    const rows = document.querySelectorAll('[data-list-row]')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveAttribute('data-selected')
    expect(rows[1]).not.toHaveAttribute('data-selected')
  })

  it('shows one status per running row', () => {
    render(<SubagentsPanel threads={[{ ...THREADS[0]!, queueDepth: 0 }]} />)
    fireEvent.click(screen.getByRole('button', { name: /subagents/ }))
    expect(screen.getAllByText('Running')).toHaveLength(1)
  })

  it('shows queue depth beneath a running thread', () => {
    render(<SubagentsPanel threads={THREADS} />)
    fireEvent.click(screen.getByRole('button', { name: '2 subagents, 1 running' }))
    expect(screen.getByText('2 queued')).toBeInTheDocument()
  })

  it('shows no subagents yet when the list is empty', () => {
    render(<SubagentsPanel threads={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '0 subagents' }))
    expect(screen.getByText('No subagents yet.')).toBeInTheDocument()
  })

  it('stops a running thread with an announcement', () => {
    const onStopThread = vi.fn()
    render(<SubagentsPanel threads={THREADS} onStopThread={onStopThread} />)
    fireEvent.click(screen.getByRole('button', { name: /subagents/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop Research agent 1' }))
    expect(onStopThread).toHaveBeenCalledWith('agent:child-1')
    expect(screen.getByText('Research agent 1 stopped.')).toBeInTheDocument()
  })

  it('tags a thread through a callback', () => {
    const onTagThread = vi.fn()
    render(<SubagentsPanel threads={THREADS} onTagThread={onTagThread} />)
    fireEvent.click(screen.getByRole('button', { name: /subagents/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Chat with Research agent 1' }))
    expect(onTagThread).toHaveBeenCalledWith('agent:child-1')
  })

  it('opens a thread chat without stopping it', () => {
    const onOpenThread = vi.fn()
    render(<SubagentsPanel threads={THREADS} onOpenThread={onOpenThread} />)
    fireEvent.click(screen.getByRole('button', { name: /subagents/ }))
    expect(screen.getByRole('button', { name: 'Stop Research agent 1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Research agent 1 chat' }))
    expect(onOpenThread).toHaveBeenCalledWith('agent:child-1')
    expect(screen.queryByText('Running')).not.toBeInTheDocument()
    expect(screen.queryByText('Research agent 1 stopped.')).not.toBeInTheDocument()
  })

  // Queued children accept pause/stop through the parent (pilot item 3).
  it('pauses and stops a queued thread with announcements', () => {
    const queued: ThreadView[] = [
      { key: 'agent:child-9', name: 'Queued scout', sessionId: 's-1', kind: 'subagent', status: 'QUEUED', acceptingSteer: true, queueDepth: 0, updatedAt: '' },
    ]
    const onPauseThread = vi.fn()
    const onStopThread = vi.fn()
    render(<SubagentsPanel threads={queued} onPauseThread={onPauseThread} onStopThread={onStopThread} />)
    fireEvent.click(screen.getByRole('button', { name: /subagents/ }))
    expect(screen.getByText('Queued')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pause Queued scout' }))
    expect(onPauseThread).toHaveBeenCalledWith('agent:child-9')
    expect(screen.getByText('Queued scout paused.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop Queued scout' }))
    expect(onStopThread).toHaveBeenCalledWith('agent:child-9')
    expect(screen.getByText('Queued scout stopped.')).toBeInTheDocument()
  })
})
