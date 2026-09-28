// Slash-command parsing and skill resolution (Phase 3). Pure unit tests:
// no database, no Temporal, no network.
import { describe, expect, it } from 'vitest'
import { parseSlashCommand, resolveSlashCommand } from '../../backend/src/skills.js'

describe('parseSlashCommand', () => {
  it('leaves plain chat text alone', () => {
    expect(parseSlashCommand('hello karbot')).toBeUndefined()
    expect(parseSlashCommand('/')).toBeUndefined()
    expect(parseSlashCommand('a/b test')).toBeUndefined()
  })

  it('splits name and rest text', () => {
    const full = parseSlashCommand('/brainstorm new sectors')
    if (!full) throw new Error('expected slash command')
    expect(full).toEqual({ name: 'brainstorm', rest: 'new sectors' })
    const bare = parseSlashCommand('/brainstorm')
    if (!bare) throw new Error('expected slash command')
    expect(bare).toEqual({ name: 'brainstorm', rest: '' })
    expect(parseSlashCommand('/sector-draft  ')?.rest).toBe('')
  })
})

describe('resolveSlashCommand', () => {
  it('resolves registered skills with prompt and tools', () => {
    const resolved = resolveSlashCommand({ name: 'brainstorm', rest: 'hi' })
    if (!('skill' in resolved)) throw new Error('expected skill')
    expect(resolved.skill.prompt.length).toBeGreaterThan(0)
    expect(resolved.skill.tools).toContain('db.kb_search')
  })

  it('rejects unknown skills with the available list, never as chat', () => {
    const resolved = resolveSlashCommand({ name: 'nope', rest: 'do it' })
    if (!('error' in resolved)) throw new Error('expected error')
    expect(resolved.error).toContain('/nope')
    expect(resolved.error).toContain('/brainstorm')
  })
})
