import { z } from 'zod'
import type { TurnOutcome } from './activities/turn.js'
import type { CandidateCompany } from './sweep-rules.js'

const Evidence = z.object({ url: z.string().url(), excerpt: z.string().trim().min(10).max(4000) }).strict()
const Result = z.object({
  decision: z.enum(['accept', 'reject', 'uncertain']),
  name: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(2000),
  identity: Evidence.optional(), geography: Evidence.optional(), sector: Evidence.optional(),
}).strict()
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
const domain = (raw: string) => {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid intake source authority.')
  return url.hostname.toLowerCase().replace(/^www\./, '')
}

/** Semantic judgments require a real fetched quote for each independent check.
 * Reject/uncertain receipts cannot publish a company. Redirected identities need
 * explicit review rather than silently changing the candidate domain. */
export function validateDiscoveryIntake(outcome: TurnOutcome, candidate: CandidateCompany) {
  if (outcome.haltNotice) throw new Error(outcome.haltNotice)
  const fenced = outcome.reply.match(/```intake-result\s*\n([\s\S]*?)```/)
  const result = Result.parse(JSON.parse(fenced?.[1] ?? outcome.reply))
  const evidence = [result.identity, result.geography, result.sector].filter((entry) => entry !== undefined)
  for (const entry of evidence) {
    if (domain(entry.url) !== domain(candidate.url)) throw new Error('Intake evidence is outside the candidate domain.')
    if (!outcome.sources?.some((source) => source.url === entry.url && normalize(source.text).includes(normalize(entry.excerpt)))) throw new Error('Intake quote is not supported by fetched source text.')
  }
  if (result.decision === 'accept') {
    if (!result.identity || !result.geography || !result.sector) throw new Error('Accepted intake is missing identity, geography or sector evidence.')
    if (!normalize(result.identity.excerpt).toLowerCase().includes(normalize(result.name).toLowerCase())) throw new Error('Company name is not supported by its identity quote.')
  }
  return result
}
