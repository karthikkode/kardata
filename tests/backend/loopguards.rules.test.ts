// Pure loop-guard rules (B2.6). No server, no database: the shared decideLoop
// matrix the detector activity and guarded workflow both execute.
import { describe, expect, it } from 'vitest'
import { decideLoop, type GuardVisit } from '../../backend/src/temporal/guards.js'

function visit(stage: string, acted = true, newEvidence = 1): GuardVisit {
  return { stage, acted, newEvidence }
}

describe('decideLoop (B2.6)', () => {
  it('passes fresh stages and first visits', () => {
    expect(decideLoop([visit('A'), visit('B'), visit('C')], 1)).toEqual({ verdict: 'ok' })
  })

  it('trips repeated-calls on a fruitless revisit within the bound', () => {
    const visits = [visit('A'), visit('B'), { ...visit('A'), newEvidence: 0 }]
    const verdict = decideLoop(visits, 1)
    expect(verdict).toMatchObject({ verdict: 'loop', kind: 'repeated-calls' })
    if (verdict.verdict === 'loop') expect(verdict.reason).toContain("'A'")
  })

  it('trips no-progress when the revisit never acts', () => {
    const visits = [visit('A'), visit('B'), visit('A', false, 0)]
    expect(decideLoop(visits, 1)).toMatchObject({ verdict: 'loop', kind: 'no-progress' })
  })

  it('needs consecutive fruitless revisits up to the bound', () => {
    const visits = [visit('A'), visit('B'), { ...visit('A'), newEvidence: 0 }]
    expect(decideLoop(visits, 2)).toEqual({ verdict: 'ok' })
    expect(decideLoop([...visits, { ...visit('B'), newEvidence: 0 }], 2).verdict).toBe('loop')
  })

  it('genuine new evidence resets the streak', () => {
    const visits = [
      visit('A'),
      visit('B'),
      { ...visit('A'), newEvidence: 0 },
      { ...visit('A'), newEvidence: 1 },
      { ...visit('B'), newEvidence: 0 },
    ]
    expect(decideLoop(visits, 2)).toEqual({ verdict: 'ok' })
  })

  it('a zero bound trips on the first fruitless revisit', () => {
    expect(decideLoop([visit('A'), { ...visit('A'), newEvidence: 0 }], 0).verdict).toBe('loop')
  })
})
