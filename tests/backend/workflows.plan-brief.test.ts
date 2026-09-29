// Planning brief shape (P2). Hermetic: the brief is pure text over the
// sector identity — no Temporal server, no database, no provider.
import { describe, expect, it } from 'vitest'
import { planningBrief } from '../../backend/src/temporal/workflows/plan.js'

describe('planningBrief', () => {
  it('demands the six plan headings with evidence-or-uncertain discipline', () => {
    const brief = planningBrief('Speciality foods', 'Artisanal packaged foods')
    for (const heading of ['scope', 'direction shards', 'query shapes', 'budgets', 'risks', 'open questions']) {
      expect(brief).toContain(heading)
    }
    expect(brief).toContain('uncertain')
    expect(brief).toContain('Speciality foods')
  })

  it('falls back to the name when the topic is empty', () => {
    expect(planningBrief('Fintech', '')).toContain('topic: Fintech')
  })
})
