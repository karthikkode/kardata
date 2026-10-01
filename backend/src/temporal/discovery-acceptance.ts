import { z } from 'zod'
import type { WorkItem } from './research-plan.js'
import type { TurnOutcome } from './activities/turn.js'

const Result = z.object({
  checks: z.array(z.object({ criterion: z.string().min(1), met: z.boolean(), evidence: z.array(z.string().url()).min(1) }).strict()),
  sample: z.array(z.object({ id: z.string().min(1), url: z.string().url(), excerpt: z.string().min(1), isCompany: z.boolean(), inGeography: z.boolean(), inSector: z.boolean() }).strict()),
}).strict()

/** Stable hashed company ids make this reproducible across resumes. */
export function discoverySample(items: WorkItem[], count = 50): WorkItem[] {
  return items.filter((item) => item.kind === 'company').sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, count)
}
export function validateDiscoveryAcceptance(outcome: TurnOutcome, expected: WorkItem[], criteria: string[]) {
  if (outcome.haltNotice) throw new Error(outcome.haltNotice)
  if (!expected.length) throw new Error('No discovered companies are available for validation.')
  const fenced = outcome.reply.match(/```discovery-result\s*\n([\s\S]*?)```/)
  const result = Result.parse(JSON.parse(fenced?.[1] ?? outcome.reply))
  if (result.checks.length !== criteria.length || new Set(result.checks.map((check) => check.criterion)).size !== criteria.length || criteria.some((criterion) => !result.checks.some((check) => check.criterion === criterion && check.met))) throw new Error('Approved discovery acceptance criteria were not met.')
  if (result.sample.length !== expected.length || new Set(result.sample.map((entry) => entry.id)).size !== expected.length) throw new Error('Discovery sample coverage is incomplete or duplicated.')
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
  const domain = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  for (const item of expected) {
    const check = result.sample.find((entry) => entry.id === item.id)
    if (!check || !check.isCompany || !check.inGeography || !check.inSector) throw new Error(`Discovered company ${item.title} failed identity, geography or sector validation.`)
    if (!item.sourceUrl || domain(check.url) !== domain(item.sourceUrl)) throw new Error('Sample evidence does not belong to the discovered company.')
    const excerpt = normalize(check.excerpt)
    if (!excerpt || !outcome.sources?.some((source) => source.url === check.url && normalize(source.text).includes(excerpt))) throw new Error('Sample evidence was not supported by fetched source text.')
  }
  for (const check of result.checks) if (check.evidence.some((url) => !result.sample.some((entry) => entry.url === url))) throw new Error('Acceptance evidence is outside the verified sample.')
  return result
}
