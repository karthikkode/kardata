// Planning brief shape (P2). Hermetic: the brief is pure text over the
// sector identity — no Temporal server, no database, no provider.
import { describe, expect, it } from 'vitest'
import { planningBrief } from '../../backend/src/temporal/workflows/plan.js'

describe('planningBrief', () => {
  it('demands the six readable plan sections with evidence-or-uncertain discipline (B3)', () => {
    const brief = planningBrief('Speciality foods', 'Artisanal packaged foods')
    for (const heading of ['## Goal', '## Search directions', '## Steps', '## Budget and limits', '## Risks', '## Open questions']) {
      expect(brief).toContain(heading)
    }
    expect(brief).toContain('single word')
    expect(brief).toContain('research-plan')
    expect(brief).toContain('uncertain')
    expect(brief).toContain('Speciality foods')
  })

  it('falls back to the name when the topic is empty', () => {
    expect(planningBrief('Fintech', '')).toContain('topic: Fintech')
  })
})
