import { z } from 'zod'

// Public execution contract mirrored from OpenAPI. Unknown fields fail
// closed so the owner never reviews a reduced version of executable work.
export const ExecutableResearchPlan = z.object({
  researchDepth: z.enum(['discovery', 'company']).optional(),
  discoveryTarget: z.number().int().min(1).max(2000).optional(),
  discovery: z.array(z.object({
    id: z.string().min(1), title: z.string().min(1),
    queries: z.array(z.string().trim().min(1).max(300)).min(1).max(30),
    maxPages: z.number().int().min(1).max(10),
  }).strict()).min(1).max(30),
  companyBrief: z.string().min(1).max(12000),
  budgets: z.object({ maxCompanies: z.number().int().min(1).max(2000), maxWallMinutes: z.number().int().min(1).max(1440), concurrency: z.literal(2) }).strict(),
  acceptance: z.array(z.string().min(1)).min(1).max(20),
}).strict().superRefine((plan, ctx) => {
  if (new Set(plan.discovery.map((direction) => direction.id)).size !== plan.discovery.length) ctx.addIssue({ code: 'custom', path: ['discovery'], message: 'Discovery direction ids must be unique.' })
  if ((plan.discoveryTarget ?? 1) > plan.budgets.maxCompanies) ctx.addIssue({ code: 'custom', path: ['discoveryTarget'], message: 'Discovery target must not exceed the company limit.' })
})
export type ExecutableResearchPlan = z.infer<typeof ExecutableResearchPlan>
export const ResearchPlanVersion = z.object({ version: z.number().int().min(1), markdown: z.string(), at: z.string(), executable: ExecutableResearchPlan.optional() })
export const SectorPlanResponse = z.object({ approvedContext: z.object({ version: z.number().int().nonnegative(), scope: z.string(), decisions: z.string().optional() }).optional(), sectorId: z.string(), versions: z.array(ResearchPlanVersion), latest: ResearchPlanVersion.nullable(), approvals: z.array(z.number().int().min(1)).optional(), approvedVersion: z.number().int().min(1).nullable().optional() })
