import { describe, expect, it } from 'vitest'
import { composeSystemPrompt, modePromptFor } from './prompt.js'

describe('composeSystemPrompt', () => {
  it('returns the base alone when no parts are given', () => {
    expect(composeSystemPrompt('base')).toBe('base')
  })

  it('orders base, skill prepend, mode, and preloaded references', () => {
    const composed = composeSystemPrompt('base facts', {
      prepend: ['skill: brainstorm sectors'],
      modePrompt: 'mode: open discussion',
      preload: ['chunk one', 'chunk two'],
    })
    const base = composed.indexOf('base facts')
    const skill = composed.indexOf('skill: brainstorm sectors')
    const mode = composed.indexOf('mode: open discussion')
    const refs = composed.indexOf('Reference material')
    expect([base, skill, mode, refs]).toEqual([...[base, skill, mode, refs]].sort((a, b) => a - b))
    expect(composed).toContain('chunk one')
    expect(composed).toContain('chunk two')
  })

  it('drops blank parts without leaving empty sections', () => {
    const composed = composeSystemPrompt('base', { prepend: ['  ', ''], preload: [] })
    expect(composed).toBe('base')
  })

  it('resolves mode prompts: default empty, brainstorm open, plan strategist', () => {
    expect(modePromptFor('default')).toBe('')
    expect(modePromptFor('brainstorm')).toContain('thought partner')
    expect(modePromptFor('plan')).toContain('Planning posture')
    const composed = composeSystemPrompt('base', { modePrompt: modePromptFor('plan') })
    expect(composed.indexOf('base')).toBeLessThan(composed.indexOf('Planning posture'))
  })
})
