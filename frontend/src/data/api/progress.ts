// Research progress API: progress views, sessions, work review.
import { z } from 'zod'
import { requestValidated, sectorPath, type StagingConfig } from './client'
import { ResearchPlanVersion } from '../research-plan'
import type { Session } from './sessions'

const WorkItem = z.object({ id: z.string(), kind: z.enum(['discovery','company']), title: z.string(), receiptVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(), state: z.enum(['pending','running','complete','blocked','failed','excluded']), attempts: z.number(), childId: z.string().nullable(), evidence: z.array(z.string()), detail: z.string(), sourceUrl: z.string().url().optional() })
const PlanVersion = ResearchPlanVersion
const Progress = z.object({ budgetUsedMs: z.number().int().nonnegative().optional(), sectorId: z.string(), state: z.string(), planVersion: z.number(), plan: z.object({ latest: PlanVersion.nullable(), versions: z.array(PlanVersion), approvals: z.array(z.number()), approvedVersion: z.number().nullable() }).optional(), items: z.array(WorkItem), completed: z.number(), total: z.number(), unresolved: z.number(), discoveryClosed: z.boolean(), estimatedPercent: z.number().nullable() })
export type ResearchProgress = z.infer<typeof Progress>

export const getResearchProgress = (config: StagingConfig, id: string) => requestValidated(config, 'GET', `${sectorPath(id)}/progress`, Progress)
export const ensureResearchSession = (config: StagingConfig, id: string): Promise<Session> => requestValidated(config, 'POST', `${sectorPath(id)}/research-session`, z.object({ id: z.string(), title: z.string(), sectorId: z.string(), kind: z.literal('research'), createdAt: z.string(), updatedAt: z.string() }).passthrough())

export const reviewResearchWork = (config: StagingConfig, sectorId: string, workId: string, planVersion: number, receiptVersion: string, decision: 'retry' | 'exclude', reason: string, idempotencyKey: string = crypto.randomUUID()) => requestValidated(config, 'POST', `${sectorPath(sectorId)}/work/${encodeURIComponent(workId)}/review`, WorkItem, { planVersion, receiptVersion, decision, reason }, idempotencyKey)
