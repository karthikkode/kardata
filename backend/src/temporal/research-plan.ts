import { z } from 'zod'

export const ExecutablePlan = z.object({
  discovery: z.array(z.object({ id: z.string().min(1), title: z.string().min(1), queries: z.array(z.string().min(1)).min(1).max(30), maxPages: z.number().int().min(1).max(10) }).strict()).min(1).max(30),
  companyBrief: z.string().min(1).max(12000),
  budgets: z.object({ maxCompanies: z.number().int().min(1).max(1000), maxWallMinutes: z.number().int().min(1).max(1440), concurrency: z.literal(2) }).strict(),
  acceptance: z.array(z.string().min(1)).min(1).max(20),
}).strict()
export type ExecutablePlan = z.infer<typeof ExecutablePlan>
export function parseExecutablePlan(markdown: string): ExecutablePlan | undefined {
  const block = markdown.match(/```research-plan\s*\n([\s\S]*?)```/)
  if (!block?.[1]) return undefined
  return ExecutablePlan.parse(JSON.parse(block[1]))
}
export function visiblePlan(markdown: string): string {
  return markdown.replace(/```research-plan\s*\n[\s\S]*?```/g, '').trim()
}
export interface WorkItem {
  sourceUrl?: string
  cursor?: { queryIndex: number; page: number; seenDomains: string[] }
  id: string; kind: 'discovery' | 'company'; title: string; state: 'pending' | 'running' | 'complete' | 'blocked' | 'failed'
  attempts: number; childId: string | null; evidence: string[]; detail: string
}
export function progressSummary(items: WorkItem[], discoveryClosed: boolean, acceptanceMet: boolean) {
  const completed = items.filter((item) => item.state === 'complete').length
  const unresolved = items.filter((item) => item.state === 'blocked' || item.state === 'failed').length
  return { completed, total: items.length, unresolved, discoveryClosed,
    estimatedPercent: !discoveryClosed || !items.length ? null : Math.min(acceptanceMet ? 100 : 99, Math.floor(100 * completed / items.length)),
  }
}
