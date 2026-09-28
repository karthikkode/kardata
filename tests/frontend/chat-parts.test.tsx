// chat-parts proofs: divider gaps, bubble shells, and the agent mark.
// No API stubs; pure render and pure-function assertions.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AgentBubble, AgentMark, TimeDivider, UserBubble, splitAfter } from '@/components/chat-parts'
import { toolGroupSummary } from '@/components/ChatPanel'

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

  it('shrink-wraps the user bubble in a soft tint', () => {
    render(<UserBubble>hey</UserBubble>)
    const bubble = screen.getByText('hey')
    expect(bubble.className).toContain('w-fit')
    expect(bubble.className).toContain('bg-primary/10')
  })

  it('summarizes grouped tool calls and stays quiet for one', () => {
    expect(toolGroupSummary([])).toBe(null)
    expect(
      toolGroupSummary([{ id: 't1', kind: 'tool', name: 'db.kb_search', detail: '', state: 'done' }]),
    ).toBe(null)
    expect(
      toolGroupSummary([
        { id: 't1', kind: 'tool', name: 'db.kb_search', detail: '', state: 'done' },
        { id: 't2', kind: 'tool', name: 'db.kb_search', detail: '', state: 'done' },
        { id: 't3', kind: 'tool', name: 'domain.scan', detail: '', state: 'running' },
      ]),
    ).toBe('2 Kb search, Scan')
  })

  it('marks the agent with the chat initial', () => {
    render(<AgentMark name="Speciality Foods chat" />)
    expect(screen.getByText('Speciality Foods chat')).toBeInTheDocument()
    expect(screen.getByText('S')).toBeInTheDocument()
  })
})
