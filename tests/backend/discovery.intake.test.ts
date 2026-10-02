import { describe, expect, it } from 'vitest'
import { validateDiscoveryIntake } from '../../backend/src/temporal/discovery-intake.js'
const candidate = { domain: 'widgets.test', name: 'Search title', url: 'https://widgets.test/' }
const quote = 'Acme Widgets serves Australian manufacturing businesses.'
const evidence = { url: candidate.url, excerpt: quote }
const result = { decision: 'accept', name: 'Acme Widgets', reason: 'Source confirms fit', identity: evidence, geography: evidence, sector: evidence }
const outcome = (value: unknown) => ({ reply: JSON.stringify(value), toolCalls: [], sources: [{ url: candidate.url, text: quote }] })
describe('source-backed basic intake', () => {
  it('accepts independent evidence fields backed by fetched company text', () => {
    expect(validateDiscoveryIntake(outcome(result), candidate).decision).toBe('accept')
  })
  it.each(['identity', 'geography', 'sector'])('denies acceptance without %s evidence', (field) => {
    expect(() => validateDiscoveryIntake(outcome({ ...result, [field]: undefined }), candidate)).toThrow('missing')
  })
  it('denies fabricated quotes and names', () => {
    expect(() => validateDiscoveryIntake(outcome({ ...result, identity: { ...evidence, excerpt: 'Invented company evidence' } }), candidate)).toThrow('fetched')
    expect(() => validateDiscoveryIntake(outcome({ ...result, name: 'Different Widgets' }), candidate)).toThrow('name')
  })
  it('denies foreign domains, credentials and unsupported schemes', () => {
    for (const url of ['https://other.test/', 'https://secret@widgets.test/', 'ftp://widgets.test/']) {
      expect(() => validateDiscoveryIntake(outcome({ ...result, identity: { ...evidence, url } }), candidate)).toThrow()
    }
  })
  it('retains explicit rejected and uncertain receipts without inventing evidence', () => {
    for (const decision of ['reject', 'uncertain']) expect(validateDiscoveryIntake(outcome({ decision, name: 'Unknown', reason: 'No trustworthy source' }), candidate).decision).toBe(decision)
  })
  it('rejects halted, malformed, extra-policy and short-quote results', () => {
    expect(() => validateDiscoveryIntake({ ...outcome(result), haltNotice: 'Budget exhausted' }, candidate)).toThrow('Budget')
    expect(() => validateDiscoveryIntake(outcome({ ...result, ownerApproved: true }), candidate)).toThrow()
    expect(() => validateDiscoveryIntake(outcome({ ...result, identity: { ...evidence, excerpt: 'Acme' } }), candidate)).toThrow()
    expect(() => validateDiscoveryIntake({ ...outcome(result), reply: 'not JSON' }, candidate)).toThrow()
  })
})
