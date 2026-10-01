import { z } from 'zod'

export const ExecutablePlan = z.object({
  researchDepth: z.enum(['discovery', 'company']).optional(),
  discoveryTarget: z.number().int().min(1).max(2000).optional(),
  discovery: z.array(z.object({ id: z.string().min(1), title: z.string().min(1), queries: z.array(z.string().trim().min(1).max(300)).min(1).max(30), maxPages: z.number().int().min(1).max(10) }).strict()).min(1).max(30),
  companyBrief: z.string().min(1).max(12000),
  budgets: z.object({ maxCompanies: z.number().int().min(1).max(2000), maxWallMinutes: z.number().int().min(1).max(1440), concurrency: z.literal(2) }).strict(),
  acceptance: z.array(z.string().min(1)).min(1).max(20),
}).strict().superRefine((plan, ctx) => {
  if (new Set(plan.discovery.map((direction) => direction.id)).size !== plan.discovery.length) ctx.addIssue({ code: 'custom', path: ['discovery'], message: 'Discovery direction ids must be unique.' })
  if ((plan.discoveryTarget ?? 1) > plan.budgets.maxCompanies) ctx.addIssue({ code: 'custom', path: ['discoveryTarget'], message: 'Discovery target must not exceed the company limit.' })
})
export type ExecutablePlan = z.infer<typeof ExecutablePlan>
export function parseExecutablePlan(markdown: string): ExecutablePlan | undefined {
  const blocks = [...markdown.matchAll(/```research-plan\s*\n([\s\S]*?)```/g)]
  if (blocks.length > 1) throw new Error('A plan must contain exactly one executable research-plan block.')
  const block = blocks[0]
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
