import { z } from 'zod'
import { ResearchPlanVersion } from './research-plan'
import { request, StagingApiError, type Session, type StagingConfig } from './staging-api'

export const Sections = z.object({ scope: z.string(), decisions: z.string(), findings: z.string(), questions: z.string() })
export type Sections = z.infer<typeof Sections>
const Change = z.object({ id: z.string(), baseVersion: z.number(), sections: Sections, sourceThread: z.string(), author: z.string(), state: z.enum(['pending','parent-review','approved','denied']), version: z.number().nullable(), at: z.string(), fileRef: z.object({ fileId: z.string(), filename: z.string(), hash: z.string(), ords: z.array(z.number()) }).nullable() })
const Global = z.object({ sectorId: z.string(), version: z.number(), sections: Sections, markdown: z.string(), researchSessionId: z.string().nullable(), changes: z.array(Change) })
export type GlobalContext = z.infer<typeof Global>
export type ContextChange = z.infer<typeof Change>
const Preview = z.object({ change: Change, units: z.array(z.object({ ord: z.number(), text: z.string(), uncertain: z.boolean() })) })
export type ContextPreview = z.infer<typeof Preview>
export const getContextPreview = (config: StagingConfig, id: string, proposal: string) => read(config, 'GET', `${sectorPath(id)}/global-context/proposals/${encodeURIComponent(proposal)}`, Preview)
const File = z.object({ id: z.string(), filename: z.string(), status: z.string(), source: z.string(), hash: z.string(), hidden: z.boolean(), included: z.boolean(), kind: z.enum(['document','artifact']), sessionId: z.string().optional() })
export type LibraryFile = z.infer<typeof File>
const FileBody = z.object({ filename: z.string(), mediaType: z.string(), text: z.string(), originalAvailable: z.boolean(), contentBase64: z.string().optional() })
export type SectorFileBody = z.infer<typeof FileBody>
const Local = z.object({ threadKey: z.string(), notes: z.string(), summary: z.string(), coveredSeq: z.number(), version: z.number(), usage: z.object({ inputTokens: z.number(), budget: z.number(), window: z.number(), method: z.enum(['exact','estimated']) }).optional() })
export type LocalContext = z.infer<typeof Local>
const WorkItem = z.object({ id: z.string(), kind: z.enum(['discovery','company']), title: z.string(), state: z.enum(['pending','running','complete','blocked','failed']), attempts: z.number(), childId: z.string().nullable(), evidence: z.array(z.string()), detail: z.string(), sourceUrl: z.string().url().optional() })
const PlanVersion = ResearchPlanVersion
const Progress = z.object({ budgetUsedMs: z.number().int().nonnegative().optional(), sectorId: z.string(), state: z.string(), planVersion: z.number(), plan: z.object({ latest: PlanVersion.nullable(), versions: z.array(PlanVersion), approvals: z.array(z.number()), approvedVersion: z.number().nullable() }).optional(), items: z.array(WorkItem), completed: z.number(), total: z.number(), unresolved: z.number(), discoveryClosed: z.boolean(), estimatedPercent: z.number().nullable() })
export type ResearchProgress = z.infer<typeof Progress>
const sectorPath = (id: string) => `/v1/sectors/${encodeURIComponent(id)}`
const threadPath = (id: string) => `/v1/threads/${encodeURIComponent(id)}/context`
async function read<T>(config: StagingConfig, method: string, path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  const result = schema.safeParse(await request(config, method, path, body))
  if (!result.success) throw new StagingApiError(502, 'invalid_response', 'The server returned an invalid workspace response.')
  return result.data
}
export const getGlobalContext = (config: StagingConfig, id: string) => read(config, 'GET', `${sectorPath(id)}/global-context`, Global)
export const saveGlobalContext = (config: StagingConfig, id: string, baseVersion: number, sections: Sections) => read(config, 'PATCH', `${sectorPath(id)}/global-context`, Change, { baseVersion, sections })
export const proposeGlobalContext = (config: StagingConfig, id: string, baseVersion: number, sections: Sections, sourceThread: string) => read(config, 'POST', `${sectorPath(id)}/global-context/proposals`, Change, { baseVersion, sections, sourceThread })
export const decideGlobalContext = (config: StagingConfig, id: string, proposalId: string, approve: boolean) => read(config, 'POST', `${sectorPath(id)}/global-context/proposals/${encodeURIComponent(proposalId)}/decision`, Change, { approve })
export const getSectorFiles = (config: StagingConfig, id: string) => read(config, 'GET', `${sectorPath(id)}/files`, z.array(File))
export const getSectorFileBody = (config: StagingConfig, id: string, fileId: string) => read(config, 'GET', `${sectorPath(id)}/files/${encodeURIComponent(fileId)}/body`, FileBody)
export const hideSectorFile = (config: StagingConfig, id: string, fileId: string, hidden: boolean) => read(config, 'PATCH', `${sectorPath(id)}/files/${encodeURIComponent(fileId)}`, File, { hidden })
export const includeSectorFile = (config: StagingConfig, id: string, fileId: string, baseVersion: number, sourceThread: string) => read(config, 'POST', `${sectorPath(id)}/files/${encodeURIComponent(fileId)}/context`, Change, { baseVersion, sourceThread })
export const getLocalContext = (config: StagingConfig, thread: string) => read(config, 'GET', threadPath(thread), Local)
export const saveLocalContext = (config: StagingConfig, thread: string, version: number, notes: string) => read(config, 'PATCH', threadPath(thread), Local, { version, notes })
export const compactLocalContext = (config: StagingConfig, thread: string) => read(config, 'POST', `${threadPath(thread)}/compact`, z.object({ compacted: z.boolean(), reason: z.string().optional(), context: Local }))
export const getResearchProgress = (config: StagingConfig, id: string) => read(config, 'GET', `${sectorPath(id)}/progress`, Progress)
export const ensureResearchSession = (config: StagingConfig, id: string): Promise<Session> => read(config, 'POST', `${sectorPath(id)}/research-session`, z.object({ id: z.string(), title: z.string(), sectorId: z.string(), kind: z.literal('research'), createdAt: z.string(), updatedAt: z.string() }).passthrough())
