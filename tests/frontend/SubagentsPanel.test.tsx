// SubagentsPanel proofs over real thread rows: counts, rows, stop with
// announcement, tag/open callbacks by thread key. No fixtures: launching
// and staged completions have no backend primitive and are gone.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SubagentsPanel } from '@/components/SubagentsPanel'
import type { ThreadView } from '@/data/staging-api'

const THREADS: ThreadView[] = [
  { key: 'agent:child-1', sessionId: 's-1', kind: 'subagent', status: 'running', acceptingSteer: true, queueDepth: 2, updatedAt: '' },
  { key: 'agent:child-2', sessionId: 's-1', kind: 'subagent', status: 'done', acceptingSteer: false, queueDepth: 0, updatedAt: '' },
]

describe('SubagentsPanel', () => {
  it('shows a count toggle and expands the thread list', () => {
    render(<SubagentsPanel threads={THREADS} />)
    expect(screen.getByRole('button', { name: '2 subagents, 1 running' })).toBeInTheDocument()
    expect(screen.queryByText('agent:child-1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '2 subagents, 1 running' }))
    expect(screen.getByText('agent:child-1')).toBeInTheDocument()
    expect(screen.getByText('agent:child-2')).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: 'Stop agent:child-1' }))
    expect(onStopThread).toHaveBeenCalledWith('agent:child-1')
    expect(screen.getByText('agent:child-1 stopped.')).toBeInTheDocument()
  })

  it('tags a thread through a callback', () => {
    const onTagThread = vi.fn()
    render(<SubagentsPanel threads={THREADS} onTagThread={onTagThread} />)
    fireEvent.click(screen.getByRole('button', { name: /subagents/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Chat with agent:child-1' }))
    expect(onTagThread).toHaveBeenCalledWith('agent:child-1')
  })

  it('opens a thread chat without stopping it', () => {
    const onOpenThread = vi.fn()
    render(<SubagentsPanel threads={THREADS} onOpenThread={onOpenThread} />)
    fireEvent.click(screen.getByRole('button', { name: /subagents/ }))
    expect(screen.getByRole('button', { name: 'Stop agent:child-1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open agent:child-1 chat' }))
    expect(onOpenThread).toHaveBeenCalledWith('agent:child-1')
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.queryByText('agent:child-1 stopped.')).not.toBeInTheDocument()
  })
})
