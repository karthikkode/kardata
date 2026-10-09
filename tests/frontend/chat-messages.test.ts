// [F:frontend.src.components.chat.messages]
import { describe, expect, it } from 'vitest'
import {
  groupMessageSegments,
  mergeChatMessages,
  messageSeq,
  sessionAge,
  toChatMessages,
} from '@/components/chat/messages'

describe('chat message helpers', () => {
  it('reads sequence numbers from row ids', () => {
    expect(messageSeq({ id: 'm-41', kind: 'text', role: 'user', text: 'hi' })).toBe(41)
    expect(messageSeq({ id: 'm-x', kind: 'text', role: 'user', text: 'hi' })).toBe(0)
  })

  it('keeps only user/agent text and tool rows with known states', () => {
    const rows = toChatMessages([
      { seq: 1, kind: 'text', role: 'user', text: 'q' },
      { seq: 2, kind: 'text', role: 'assistant', text: 'dropped role' },
      { seq: 3, kind: 'text', role: 'agent' },
      { seq: 4, kind: 'tool', name: 'db.list_sectors', detail: '', state: 'done' },
      { seq: 5, kind: 'tool', state: 'weird' },
      { seq: 6, kind: 'mystery' },
      { kind: 'text', role: 'user', text: 'no seq' },
      'not a record',
    ])
    expect(rows.map((row) => row.id)).toEqual(['m-1', 'm-4', 'm-5'])
    expect(rows[1]).toMatchObject({ kind: 'tool', name: 'db.list_sectors', state: 'done' })
    expect(rows[2]).toMatchObject({ kind: 'tool', name: 'Tool call', state: 'running' })
  })

  it('attaches reasoning to agent replies only', () => {
    const rows = toChatMessages([
      { seq: 1, kind: 'text', role: 'agent', text: 'a', reasoning: 'why' },
      { seq: 2, kind: 'text', role: 'user', text: 'q', reasoning: 'dropped' },
    ])
    expect(rows[0]).toMatchObject({ reasoning: 'why' })
    expect(rows[1]).not.toHaveProperty('reasoning')
  })

  it('merges histories by id with right winning, sorted by seq', () => {
    const left = toChatMessages([{ seq: 1, kind: 'text', role: 'user', text: 'old' }])
    const right = toChatMessages([
      { seq: 2, kind: 'text', role: 'agent', text: 'new' },
      { seq: 1, kind: 'text', role: 'user', text: 'fresh' },
    ])
    const merged = mergeChatMessages(left, right)
    expect(merged.map((row) => row.id)).toEqual(['m-1', 'm-2'])
    expect(merged[0]).toMatchObject({ text: 'fresh' })
  })

  it('folds tool runs with their reply and passes user text through', () => {
    const [tool, reply, user] = toChatMessages([
      { seq: 1, kind: 'tool', name: 't', state: 'done' },
      { seq: 2, kind: 'text', role: 'agent', text: 'done' },
      { seq: 3, kind: 'text', role: 'user', text: 'next' },
    ])
    const segments = groupMessageSegments([tool!, reply!, user!])
    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({ key: 'm-1' })
    expect(segments[1]).toMatchObject({ key: 'm-3' })
  })

  it('renders relative session ages', () => {
    const now = Date.parse('2026-10-05T12:00:00.000Z')
    expect(sessionAge('2026-10-05T11:59:30.000Z', now)).toBe('now')
    expect(sessionAge('2026-10-05T11:55:00.000Z', now)).toBe('5m')
    expect(sessionAge('2026-10-05T09:00:00.000Z', now)).toBe('3h')
    expect(sessionAge('2026-10-03T12:00:00.000Z', now)).toBe('2d')
  })
})
