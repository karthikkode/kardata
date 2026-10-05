import { describe, expect, it } from 'vitest'
import { frozenClock } from './clock.js'
import { TranscriptWriter } from './transcript.js'
import { assertReplayMatches, extractCalls, LearningStore } from './replay.js'

describe('TranscriptWriter [F:agents.transcript.TranscriptWriter]', () => {
  it('round-trips JSONL byte-identically with sequences and timestamps', () => {
    const clock = frozenClock(5_000)
    const writer = new TranscriptWriter('run-1', clock)
    writer.append('session', { provider: 'fake' })
    clock.advance(10)
    writer.append('tool_call', { name: 'read', args: { path: 'a' } })
    writer.append('event', { ui: 'spinner' })
    const text = writer.toJsonl()
    const parsed = TranscriptWriter.fromJsonl(text)
    expect(parsed.map((line) => line.seq)).toEqual([0, 1, 2])
    expect(parsed.map((line) => line.ts)).toEqual([5_000, 5_010, 5_010])
    expect(TranscriptWriter.fromJsonl(TranscriptWriter.fromJsonl(text).map((line) => JSON.stringify(line)).join('\n'))).toEqual(parsed)
    expect(writer.replayable().map((line) => line.kind)).toEqual(['session', 'tool_call'])
  })

  it('rejects malformed lines, versions, and shapes', () => {
    expect(() => TranscriptWriter.fromJsonl('nope')).toThrow('not JSON')
    expect(() => TranscriptWriter.fromJsonl('{"v":99,"ts":1,"seq":0,"runId":"r","kind":"turn","payload":{}}')).toThrow('unsupported version')
    expect(() => TranscriptWriter.fromJsonl('{"v":1,"ts":"x","seq":0,"runId":"r","kind":"turn","payload":{}}')).toThrow('schema validation')
    expect(() => TranscriptWriter.fromJsonl('{"v":1,"ts":1,"seq":0,"runId":"r","kind":"nope","payload":{}}')).toThrow('schema validation')
    expect(TranscriptWriter.fromJsonl('')).toEqual([])
  })

  it('scrubs secrets from nested payloads at write time', () => {
    const writer = new TranscriptWriter('run-1', frozenClock(0), ['sk-secret'])
    const line = writer.append('provider_envelope', {
      key: 'sk-secret',
      nested: { list: ['sk-secret', 'clean'] },
    })
    expect(JSON.stringify(line.payload)).not.toContain('sk-secret')
    expect(JSON.stringify(line.payload)).toContain('[redacted]')
  })
})

describe('assertReplayMatches [F:agents.replay.assertReplayMatches]', () => {
  function lines() {
    const writer = new TranscriptWriter('run-1', frozenClock(0))
    writer.append('session', {})
    writer.append('tool_call', { name: 'read', args: { path: 'a' } })
    writer.append('tool_result', { name: 'read' })
    writer.append('event', { ui: 'x' })
    writer.append('tool_call', { name: 'edit', args: { path: 'b', extra: [1, 2] } })
    return writer.all()
  }

  it('matches golden call order and args regardless of key order', () => {
    expect(() =>
      assertReplayMatches(lines(), [
        { name: 'read', args: { path: 'a' } },
        { name: 'edit', args: { extra: [1, 2], path: 'b' } },
      ]),
    ).not.toThrow()
  })

  it('fails on count, name, and arg mismatches', () => {
    expect(() => assertReplayMatches(lines(), [{ name: 'read', args: { path: 'a' } }])).toThrow('count')
    expect(() =>
      assertReplayMatches(lines(), [
        { name: 'read', args: { path: 'a' } },
        { name: 'write', args: { path: 'b', extra: [1, 2] } },
      ]),
    ).toThrow('mismatch')
    expect(() =>
      assertReplayMatches(lines(), [
        { name: 'read', args: { path: 'a' } },
        { name: 'edit', args: { path: 'b', extra: [1, 3] } },
      ]),
    ).toThrow('mismatch')
  })
})

describe('extractCalls [F:agents.replay.extractCalls]', () => {
  it('keeps tool_call lines in order and rejects nameless ones', () => {
    const writer = new TranscriptWriter('run-1', frozenClock(0))
    writer.append('session', {})
    writer.append('tool_call', { name: 'read', args: { path: 'a' } })
    writer.append('tool_result', { name: 'read' })
    writer.append('tool_call', { name: 'edit' })
    expect(extractCalls(writer.all())).toEqual([
      { name: 'read', args: { path: 'a' } },
      { name: 'edit', args: {} },
    ])
    const broken = new TranscriptWriter('run-2', frozenClock(0))
    broken.append('tool_call', { args: {} })
    expect(() => extractCalls(broken.all())).toThrow('has no name')
  })
})

describe('LearningStore [F:agents.replay.LearningStore]', () => {
  it('proposes, promotes, rejects, and refuses double transitions', () => {
    const store = new LearningStore()
    const candidate = store.propose('run-1:turn-3', 'prefer snippet search first')
    expect(candidate.status).toBe('candidate')
    expect(() => store.propose('', 'x')).toThrow()
    store.promote(candidate.id)
    expect(store.list('promoted')).toHaveLength(1)
    expect(() => store.reject(candidate.id)).toThrow('already promoted')
    const second = store.propose('run-1:turn-4', 'nope')
    store.reject(second.id)
    expect(store.list()).toHaveLength(2)
    expect(() => store.promote('missing')).toThrow()
  })
})
