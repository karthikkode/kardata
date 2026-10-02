import { describe, expect, it } from 'vitest'
import { discoverySample, validateDiscoveryAcceptance } from '../../backend/src/temporal/discovery-acceptance.js'
import type { WorkItem } from '../../backend/src/temporal/research-plan.js'

const companies: WorkItem[] = ['b', 'a'].map((id) => ({ id, title: `TEST company ${id}`, sourceUrl: `https://${id}.example.test/`, kind: 'company', state: 'complete', attempts: 0, childId: null, evidence: [], detail: '' }))
const criteria = ['Verified Australian company identities']
function valid() {
  return { checks: [{ criterion: criteria[0]!, met: true, evidence: companies.map((item) => item.sourceUrl!) }], sample: companies.map((item) => ({ id: item.id, url: item.sourceUrl!, excerpt: `TEST Australian manufacturer ${item.id}`, isCompany: true, inGeography: true, inSector: true })) }
}
const sources = companies.map((item) => ({ url: item.sourceUrl!, text: `Source content: TEST Australian manufacturer ${item.id}.` }))
const outcome = (value: unknown) => ({ reply: `Readable review\n\n\`\`\`discovery-result\n${JSON.stringify(value)}\n\`\`\``, sources, toolCalls: [] })

describe('evidence-backed discovery acceptance', () => {
  it('accepts exact sample coverage, approved criteria and fetched quotes', () => {
    expect(validateDiscoveryAcceptance(outcome(valid()), companies, criteria).sample).toHaveLength(2)
  })
  it('selects the same bounded sample regardless of discovery completion order', () => {
    expect(discoverySample(companies, 1).map((item) => item.id)).toEqual(['a'])
    expect(discoverySample([...companies].reverse(), 1).map((item) => item.id)).toEqual(['a'])
  })
  it.each(['isCompany', 'inGeography', 'inSector'] as const)('refuses a failed %s check', (field) => {
    const result = valid(); result.sample[0]![field] = false
    expect(() => validateDiscoveryAcceptance(outcome(result), companies, criteria)).toThrow(/failed identity, geography or sector/)
  })
  it('refuses omitted/duplicate samples and omitted/unmet criteria', () => {
    const result = valid()
    expect(() => validateDiscoveryAcceptance(outcome({ ...result, sample: [result.sample[0], result.sample[0]] }), companies, criteria)).toThrow(/incomplete or duplicated/)
    expect(() => validateDiscoveryAcceptance(outcome({ ...result, checks: [] }), companies, criteria)).toThrow(/criteria were not met/)
    result.checks[0]!.met = false
    expect(() => validateDiscoveryAcceptance(outcome(result), companies, criteria)).toThrow(/criteria were not met/)
  })
  it('refuses invented quotes, unfetched pages, foreign-domain evidence and extraneous acceptance sources', () => {
    const result = valid()
    result.sample[0]!.excerpt = 'Invented evidence'
    expect(() => validateDiscoveryAcceptance(outcome(result), companies, criteria)).toThrow(/fetched source text/)
    expect(() => validateDiscoveryAcceptance({ ...outcome(valid()), sources: [] }, companies, criteria)).toThrow(/fetched source text/)
    result.sample[0]!.url = 'https://foreign.example.test/'
    expect(() => validateDiscoveryAcceptance(outcome(result), companies, criteria)).toThrow(/does not belong/)
    const extraneous = valid(); extraneous.checks[0]!.evidence.push('https://foreign.example.test/')
    expect(() => validateDiscoveryAcceptance(outcome(extraneous), companies, criteria)).toThrow(/outside the verified sample/)
  })
  it('never accepts an empty population or budget-halted reviewer', () => {
    expect(() => validateDiscoveryAcceptance(outcome(valid()), [], criteria)).toThrow(/No discovered companies/)
    expect(() => validateDiscoveryAcceptance({ ...outcome(valid()), haltNotice: 'Budget exhausted' }, companies, criteria)).toThrow('Budget exhausted')
  })
  it.each([' ', '\n\t '])('rejects whitespace-only evidence instead of matching every fetched page', (excerpt) => {
    const result = valid()
    result.sample[0]!.excerpt = excerpt
    expect(() => validateDiscoveryAcceptance(outcome(result), companies, criteria)).toThrow(/fetched source text/)
  })
})
