import { describe, expect, it } from 'vitest'
import { getSkill, isValidSkillName, listSkills } from './skills.js'

describe('skill registry', () => {
  it('lists the built-in skills with valid names', () => {
    const names = listSkills().map((skill) => skill.name)
    expect(names).toContain('brainstorm')
    expect(names).toContain('sector-draft')
    for (const skill of listSkills()) {
      expect(isValidSkillName(skill.name)).toBe(true)
      expect(skill.description.length).toBeGreaterThan(0)
      expect(skill.prompt.length).toBeGreaterThan(0)
      expect(skill.tools.length).toBeGreaterThan(0)
    }
  })

  it('rejects bad slash names', () => {
    expect(isValidSkillName('Brainstorm')).toBe(false)
    expect(isValidSkillName('sector draft')).toBe(false)
    expect(isValidSkillName('/brainstorm')).toBe(false)
    expect(isValidSkillName('')).toBe(false)
  })

  it('resolves known skills and misses unknown ones', () => {
    expect(getSkill('brainstorm')?.tools).toContain('db.kb_search')
    expect(getSkill('sector-draft')?.tools).toContain('db.create_sector')
    expect(getSkill('nope')).toBeUndefined()
  })

  it('never grants sensitive plumbing to chat skills', () => {
    const sensitive = ['db.find_key', 'db.project_batch', 'db.claim_idempotency', 'db.complete_idempotency', 'db.release_idempotency']
    for (const skill of listSkills()) {
      for (const tool of sensitive) expect(skill.tools, `${skill.name} ${tool}`).not.toContain(tool)
    }
  })
})
