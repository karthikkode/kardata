// Sector state transition contract: the plan-mandatory lifecycle.
// Failing-first: SECTOR_TRANSITIONS does not exist yet. Legal edges:
// draft plans or (interim) queues; planning lands planned or failed;
// planned approves or fails; approved starts; failures re-plan;
// restart jumps failed to running; pause/resume cycle running/paused;
// complete is terminal. draft→queued stays legal only until P4 (approval
// enforcement) removes it.
import { describe, expect, it } from 'vitest'
import { assertSectorTransition, SECTOR_TRANSITIONS } from '../../backend/src/db/sectors.js'

describe('SECTOR_TRANSITIONS', () => {
  it('plans every sector including old drafts, and approves before start', () => {
    expect(SECTOR_TRANSITIONS.draft).toContain('planning')
    expect(SECTOR_TRANSITIONS.planning).toContain('planned')
    expect(SECTOR_TRANSITIONS.planned).toContain('approved')
    expect(SECTOR_TRANSITIONS.approved).toContain('queued')
    expect(SECTOR_TRANSITIONS.failed).toContain('planning')
  })

  it('keeps existing lifecycle edges intact', () => {
    expect(SECTOR_TRANSITIONS.running).toEqual(expect.arrayContaining(['paused', 'complete', 'failed']))
    expect(SECTOR_TRANSITIONS.paused).toContain('running')
    expect(SECTOR_TRANSITIONS.failed).toContain('running')
    expect(SECTOR_TRANSITIONS.queued).toEqual(expect.arrayContaining(['running', 'failed']))
    expect(SECTOR_TRANSITIONS.complete).toEqual([])
  })

  it('rejects jumps that skip approval or resurrect terminals', () => {
    expect(() => assertSectorTransition('draft', 'running')).toThrow(/not a legal sector transition/)
    expect(() => assertSectorTransition('planned', 'running')).toThrow(/not a legal sector transition/)
    expect(() => assertSectorTransition('complete', 'draft')).toThrow(/not a legal sector transition/)
    expect(() => assertSectorTransition('running', 'approved')).toThrow(/not a legal sector transition/)
    expect(() => assertSectorTransition('draft', 'queued')).not.toThrow()
  })
})
