import { z } from 'zod'
import { ResearchPlanVersion } from './research-plan'
import { request, StagingApiError, type Session, type StagingConfig } from './staging-api'

export const Sections = z.object({ scope: z.string(), instructions: z.string(), decisions: z.string(), findings: z.string(), questions: z.string() })
export type Sections = z.infer<typeof Sections>
const ContextFileRef = z.object({ readSectorId: z.string().optional(), fileId: z.string(), filename: z.string(), hash: z.string(), ords: z.array(z.number()) })
const Change = z.object({ sourceRefs: z.array(ContextFileRef).optional(), id: z.string(), baseVersion: z.number(), sections: Sections, sourceThread: z.string(), author: z.string(), state: z.enum(['pending','parent-review','approved','denied']), version: z.number().nullable(), at: z.string(), fileRef: z.object({ fileId: z.string(), filename: z.string(), hash: z.string(), ords: z.array(z.number()) }).nullable() })
const ContextFileBlock = z.object({ fileId: z.string(), filename: z.string(), state: z.string(), tokens: z.number(), summary: z.string(), error: z.string().nullable() })
export type ContextFileBlock = z.infer<typeof ContextFileBlock>
const Usage = z.object({ total: z.number(), budget: z.number(), method: z.enum(['exact', 'estimated']), bySection: z.object({ scope: z.number(), instructions: z.number(), decisions: z.number(), findings: z.number(), questions: z.number() }), byFile: z.array(z.object({ fileId: z.string(), tokens: z.number() })) })
export type GlobalContextUsage = z.infer<typeof Usage>
const Global = z.object({ sectorId: z.string(), version: z.number(), sections: Sections, markdown: z.string(), researchSessionId: z.string().nullable(), changes: z.array(Change), files: z.array(ContextFileBlock), usage: Usage })
export type GlobalContext = z.infer<typeof Global>
export type ContextChange = z.infer<typeof Change>
const Preview = z.object({ sources: z.array(z.object({ ref: ContextFileRef, units: z.array(z.object({ ord: z.number(), text: z.string(), uncertain: z.boolean() })) })).optional(), change: Change, units: z.array(z.object({ ord: z.number(), text: z.string(), uncertain: z.boolean() })) })
export type ContextPreview = z.infer<typeof Preview>
export const getContextPreview = (config: StagingConfig, id: string, proposal: string) => read(config, 'GET', `${sectorPath(id)}/global-context/proposals/${encodeURIComponent(proposal)}`, Preview)
export const FileProcessingProgress = z.object({ jobId: z.string(), state: z.enum(['queued','processing','paused','failed','uncertain','complete']), revision: z.number().int().nonnegative(), totalImages: z.number().int().nonnegative().nullable(), completedImages: z.number().int().nonnegative(), failedImages: z.number().int().nonnegative(), uncertainImages: z.number().int().nonnegative(), errorCode: z.string().nullable(), retryRequiresApproval: z.boolean() })
export type FileProcessingProgress = z.infer<typeof FileProcessingProgress>
const File = z.object({ id: z.string(), filename: z.string(), status: z.string(), source: z.string(), hash: z.string(), hidden: z.boolean(), included: z.boolean(), kind: z.enum(['document','artifact']), sessionId: z.string().optional(), processing: FileProcessingProgress.optional() })
export type LibraryFile = z.infer<typeof File>
const FileBody = z.object({ filename: z.string(), mediaType: z.string(), text: z.string(), originalAvailable: z.boolean(), contentBase64: z.string().optional(), fullChars: z.number().nonnegative().optional(), textTruncated: z.boolean().optional(), nextOrd: z.number().int().nonnegative().nullable().optional() })
export type SectorFileBody = z.infer<typeof FileBody>
const Local = z.object({ pendingResponse: z.object({ round: z.number() }).optional(), task: z.string().optional(), sourceRefs: z.array(ContextFileRef).optional(), contextBlocked: z.string().optional(), pendingOperations: z.array(z.object({ operationId: z.string(), toolName: z.string(), callId: z.string(), reason: z.string() })).optional(), threadKey: z.string(), notes: z.string(), summary: z.string(), coveredSeq: z.number(), version: z.number(), usage: z.object({ inputTokens: z.number(), budget: z.number(), window: z.number(), method: z.enum(['exact','estimated']) }).optional() })
export type LocalContext = z.infer<typeof Local>
const WorkItem = z.object({ id: z.string(), kind: z.enum(['discovery','company']), title: z.string(), receiptVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(), state: z.enum(['pending','running','complete','blocked','failed','excluded']), attempts: z.number(), childId: z.string().nullable(), evidence: z.array(z.string()), detail: z.string(), sourceUrl: z.string().url().optional() })
const PlanVersion = ResearchPlanVersion
const Progress = z.object({ budgetUsedMs: z.number().int().nonnegative().optional(), sectorId: z.string(), state: z.string(), planVersion: z.number(), plan: z.object({ latest: PlanVersion.nullable(), versions: z.array(PlanVersion), approvals: z.array(z.number()), approvedVersion: z.number().nullable() }).optional(), items: z.array(WorkItem), completed: z.number(), total: z.number(), unresolved: z.number(), discoveryClosed: z.boolean(), estimatedPercent: z.number().nullable() })
export type ResearchProgress = z.infer<typeof Progress>
const sectorPath = (id: string) => `/v1/sectors/${encodeURIComponent(id)}`
const threadPath = (id: string) => `/v1/threads/${encodeURIComponent(id)}/context`
async function read<T>(config: StagingConfig, method: string, path: string, schema: z.ZodType<T>, body?: unknown, idempotencyKey?: string): Promise<T> {
  const result = schema.safeParse(await request(config, method, path, body, idempotencyKey))
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
const Block = z.object({ fileId: z.string(), filename: z.string(), state: z.string(), tokens: z.number(), summary: z.string(), error: z.string().nullable() }).passthrough()
export const addFileToGlobalContext = (config: StagingConfig, id: string, fileId: string) => read(config, 'POST', `${sectorPath(id)}/global-context/files`, Block, { fileId })
export const summarizeGlobalContextFile = (config: StagingConfig, id: string, fileId: string) => read(config, 'POST', `${sectorPath(id)}/global-context/files/${encodeURIComponent(fileId)}/summarize`, Block)
export const removeGlobalContextFile = (config: StagingConfig, id: string, fileId: string) => read(config, 'DELETE', `${sectorPath(id)}/global-context/files/${encodeURIComponent(fileId)}`, z.object({ version: z.number(), filename: z.string(), hash: z.string(), state: z.string() }))
export const compactGlobalContext = (config: StagingConfig, id: string) => read(config, 'POST', `${sectorPath(id)}/global-context/compact`, z.object({ started: z.boolean() }))
export const restoreGlobalContext = (config: StagingConfig, id: string, version: number) => read(config, 'POST', `${sectorPath(id)}/global-context/restore`, z.object({ version: z.number(), sections: Sections }), { version })
export const startGlobalContextRewrite = (config: StagingConfig, id: string, instruction: string) => read(config, 'POST', `${sectorPath(id)}/global-context/rewrite`, z.object({ sessionId: z.string() }), { instruction })
export const getLocalContext = (config: StagingConfig, thread: string) => read(config, 'GET', threadPath(thread), Local)
export const saveLocalContext = (config: StagingConfig, thread: string, version: number, notes: string) => read(config, 'PATCH', threadPath(thread), Local, { version, notes })
export const compactLocalContext = (config: StagingConfig, thread: string) => read(config, 'POST', `${threadPath(thread)}/compact`, z.object({ compacted: z.boolean(), reason: z.string().optional(), context: Local }))
export const getResearchProgress = (config: StagingConfig, id: string) => read(config, 'GET', `${sectorPath(id)}/progress`, Progress)
export const ensureResearchSession = (config: StagingConfig, id: string): Promise<Session> => read(config, 'POST', `${sectorPath(id)}/research-session`, z.object({ id: z.string(), title: z.string(), sectorId: z.string(), kind: z.literal('research'), createdAt: z.string(), updatedAt: z.string() }).passthrough())

const OperationReceipt = z.object({ operationId: z.string(), toolName: z.string().optional(), state: z.enum(['confirmed', 'unresolved']), reason: z.string(), recordedAt: z.string().optional() })
export type OperationReceipt = z.infer<typeof OperationReceipt>
export const inspectThreadOperation = (config: StagingConfig, thread: string, operationId: string) => read(config, 'GET', `/v1/threads/${encodeURIComponent(thread)}/operations/${encodeURIComponent(operationId)}`, OperationReceipt)

export const rebuildLocalContext = (config: StagingConfig, thread: string, version: number, summary: string) => read(config, 'POST', `${threadPath(thread)}/rebuild`, Local, { version, summary, independent: true })

const ExecutionRecordMetadata = z.object({ seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), at: z.string().datetime({ offset: true }), runKey: z.string().min(1).max(255), attemptLease: z.string().uuid(), round: z.number().int().nonnegative(), kind: z.enum(['request', 'response', 'tool-result']), workflowId: z.string().min(1).max(255).optional(), executionId: z.string().min(1).max(255).optional(), ownerEpoch: z.string().uuid().optional(), ref: z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive().max(16 * 1024 * 1024) }).strict() }).strict()
const ExecutionRecordPage = z.object({ records: z.array(ExecutionRecordMetadata).max(100), nextAfterSeq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable() }).strict()
const ExecutionRecordBody = z.object({ record: z.record(z.string(), z.unknown()) }).strict()
export type ExecutionRecordMetadata = z.infer<typeof ExecutionRecordMetadata>
export type ExecutionRecordPage = z.infer<typeof ExecutionRecordPage>
export type ExecutionRecordBody = z.infer<typeof ExecutionRecordBody>
export const listExecutionRecords = (config: StagingConfig, thread: string, afterSeq = 0) => read(config, 'GET', `/v1/threads/${encodeURIComponent(thread)}/execution-records?afterSeq=${afterSeq}&limit=20`, ExecutionRecordPage)
export const getExecutionRecord = (config: StagingConfig, thread: string, seq: number) => read(config, 'GET', `/v1/threads/${encodeURIComponent(thread)}/execution-records/${seq}`, ExecutionRecordBody)

export const reviewResearchWork = (config: StagingConfig, sectorId: string, workId: string, planVersion: number, receiptVersion: string, decision: 'retry' | 'exclude', reason: string, idempotencyKey: string = crypto.randomUUID()) => read(config, 'POST', `${sectorPath(sectorId)}/work/${encodeURIComponent(workId)}/review`, WorkItem, { planVersion, receiptVersion, decision, reason }, idempotencyKey)

export const retryFileProcessing = (config: StagingConfig, sectorId: string, fileId: string, jobId: string, revision: number, allowDuplicatePaid: boolean) => read(config, 'POST', `${sectorPath(sectorId)}/files/${encodeURIComponent(fileId)}/retry`, FileProcessingProgress, { jobId, revision, allowDuplicatePaid })

export const FileUnitsPage = z.object({ status: z.string(), units: z.array(z.object({ ord: z.number().int().nonnegative(), kind: z.string(), text: z.string(), uncertain: z.boolean(), page: z.number().int().positive().optional(), imageOrdinal: z.number().int().nonnegative().optional(), imageRole: z.enum(['embedded','page-visual']).optional(), imageId: z.string().optional() })).max(100), nextOrd: z.number().int().nonnegative().nullable(), fullChars: z.number().nonnegative() })
export type FileUnitsPage = z.infer<typeof FileUnitsPage>
export const getFileUnitsPage = (config: StagingConfig, sectorId: string, fileId: string, fromOrd: number) => read(config, 'GET', `${sectorPath(sectorId)}/files/${encodeURIComponent(fileId)}/units?fromOrd=${fromOrd}&limit=20`, FileUnitsPage)
