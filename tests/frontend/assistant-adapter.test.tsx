// SPIKE: adapter mapping proof over stubbed snapshots. No network, no
// transport. Fails if mapping drops rows, reorders, or loses pending parts.
import { describe, expect, it } from 'vitest'
import { toThreadMessages } from '@/components/chat/assistantAdapter'
import type { ChatMessage } from '@/components/ChatPanel'

function textOf(part: unknown): string | undefined {
  return typeof part === 'object' && part !== null && 'text' in part
    ? String((part as { text: unknown }).text)
    : undefined
}
function typeOf(part: unknown): string | undefined {
  return typeof part === 'object' && part !== null && 'type' in part
    ? String((part as { type: unknown }).type)
    : undefined
}

describe('assistant adapter mapping', () => {
  it('keeps settled rows in order with roles intact', () => {
    const settled: ChatMessage[] = [
      { id: 'm:1', kind: 'text', role: 'user', text: 'Find problems' },
      { id: 'm:2', kind: 'text', role: 'agent', text: 'Acme Pay mismatch' },
    ]
    const out = toThreadMessages(settled, { pendingText: null, pendingReasoning: null, pendingTools: [] })
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ role: 'user' })
    expect(textOf((out[0] as { content: unknown[] }).content[0])).toBe('Find problems')
    expect(out[1]).toMatchObject({ role: 'assistant' })
    expect(textOf((out[1] as { content: unknown[] }).content[0])).toBe('Acme Pay mismatch')
  })

  it('places reasoning before its reply text', () => {
    const settled: ChatMessage[] = [
      { id: 'm:3', kind: 'text', role: 'agent', text: 'Verdict', reasoning: 'Trace' },
    ]
    const out = toThreadMessages(settled, { pendingText: null, pendingReasoning: null, pendingTools: [] })
    const content = (out[0] as { content: unknown[] }).content
    expect(content.map(typeOf)).toEqual(['reasoning', 'text'])
    expect(textOf(content[0])).toBe('Trace')
  })

  it('marks failed replies as error without dropping text', () => {
    const settled: ChatMessage[] = [
      { id: 'm:4', kind: 'text', role: 'agent', text: 'Partial', failed: true },
    ]
    const out = toThreadMessages(settled, { pendingText: null, pendingReasoning: null, pendingTools: [] })
    expect(out[0]).toMatchObject({ status: { type: 'incomplete', reason: 'error' } })
    expect(textOf((out[0] as { content: unknown[] }).content[0])).toBe('Partial')
  })

  it('appends live pending tools, reasoning, and text as one running turn', () => {
    const out = toThreadMessages([], {
      pendingText: 'typing…',
      pendingReasoning: 'checking',
      pendingTools: [{ id: 'c:1', kind: 'tool', name: 'db.kb_search', detail: '', state: 'running' }],
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ role: 'assistant', status: { type: 'running' } })
    const content = (out[0] as { content: unknown[] }).content
    expect(content.map(typeOf)).toEqual(['tool-call', 'reasoning', 'text'])
  })

  it('emits no transient turn when nothing is pending', () => {
    const settled: ChatMessage[] = [
      { id: 'm:5', kind: 'text', role: 'user', text: 'hi' },
    ]
    expect(toThreadMessages(settled, { pendingText: null, pendingReasoning: null, pendingTools: [] })).toHaveLength(1)
  })
})

describe('assistant segment mapping', () => {
  it('keeps tool-plus-reply groups in one runtime message in order', async () => {
    const { toThreadSegments } = await import('@/components/chat/assistantAdapter')
    const { groupMessageSegments } = await import('@/components/ChatPanel')
    const segments = groupMessageSegments([
      { id: 'm:1', kind: 'text', role: 'user', text: 'go' },
      { id: 'm:2', kind: 'tool', name: 'db.kb_search', detail: '', state: 'done' },
      { id: 'm:3', kind: 'text', role: 'agent', text: 'Found it', reasoning: 'trace' },
    ])
    expect(segments).toHaveLength(2)
    const out = toThreadSegments(segments)
    expect(out.map((m) => m.id)).toEqual(['m:1', 'm:2'])
    expect(out[0]).toMatchObject({ role: 'user' })
    expect(out[1]).toMatchObject({ role: 'assistant', status: { type: 'complete', reason: 'stop' } })
  })
})
