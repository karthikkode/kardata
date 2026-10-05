import { describe, expect, it } from 'vitest'
import { ExecutablePlan, parseExecutablePlan } from '../../backend/src/research-plan.js'

const plan = { researchDepth: 'discovery', discoveryTarget: 2000, discovery: [{ id: 'australia', title: 'Australian SMEs', queries: ['Australian manufacturing SMEs'], maxPages: 2 }], companyBrief: 'Verify identities and provenance', budgets: { maxCompanies: 2000, maxWallMinutes: 60, concurrency: 2 }, acceptance: ['Source-backed company identities'] }
describe('executable approval contract', () => {
  it('accepts the 2000-company discovery target and rejects higher limits', () => {
    expect(ExecutablePlan.parse(plan).discoveryTarget).toBe(2000)
    expect(ExecutablePlan.safeParse({ ...plan, budgets: { ...plan.budgets, maxCompanies: 2001 } }).success).toBe(false)
  })
  it('rejects targets above the approved company cap', () => {
    expect(ExecutablePlan.safeParse({ ...plan, budgets: { ...plan.budgets, maxCompanies: 1000 } }).success).toBe(false)
  })
  it('rejects duplicate direction identities and blank queries', () => {
    expect(ExecutablePlan.safeParse({ ...plan, discovery: [plan.discovery[0], plan.discovery[0]] }).success).toBe(false)
    expect(ExecutablePlan.safeParse({ ...plan, discovery: [{ ...plan.discovery[0], queries: ['   '] }] }).success).toBe(false)
  })
  it('bounds coordinator concurrency to the 1..64 plan budget', () => {
    expect(ExecutablePlan.safeParse({ ...plan, budgets: { ...plan.budgets, concurrency: 1 } }).success).toBe(true)
    expect(ExecutablePlan.safeParse({ ...plan, budgets: { ...plan.budgets, concurrency: 64 } }).success).toBe(true)
    expect(ExecutablePlan.safeParse({ ...plan, budgets: { ...plan.budgets, concurrency: 0 } }).success).toBe(false)
    expect(ExecutablePlan.safeParse({ ...plan, budgets: { ...plan.budgets, concurrency: 65 } }).success).toBe(false)
    expect(ExecutablePlan.safeParse({ ...plan, budgets: { ...plan.budgets, concurrency: 2.5 } }).success).toBe(false)
  })
  it('refuses ambiguous executable blocks instead of silently approving the first one', () => {
    const block = `\`\`\`research-plan\n${JSON.stringify(plan)}\n\`\`\``
    expect(() => parseExecutablePlan(`${block}\n\n${block}`)).toThrow(/exactly one/i)
  })
})
