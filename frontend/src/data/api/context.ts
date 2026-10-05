// Context API: global sector context and per-thread local context.
import { z } from 'zod'
import { requestValidated, sectorPath, type StagingConfig } from './client'

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
export const getContextPreview = (config: StagingConfig, id: string, proposal: string) => requestValidated(config, 'GET', `${sectorPath(id)}/global-context/proposals/${encodeURIComponent(proposal)}`, Preview)

const Local = z.object({ pendingResponse: z.object({ round: z.number() }).optional(), task: z.string().optional(), sourceRefs: z.array(ContextFileRef).optional(), contextBlocked: z.string().optional(), pendingOperations: z.array(z.object({ operationId: z.string(), toolName: z.string(), callId: z.string(), reason: z.string() })).optional(), threadKey: z.string(), notes: z.string(), summary: z.string(), coveredSeq: z.number(), version: z.number(), usage: z.object({ inputTokens: z.number(), budget: z.number(), window: z.number(), method: z.enum(['exact','estimated']) }).optional() })
export type LocalContext = z.infer<typeof Local>

const threadPath = (id: string) => `/v1/threads/${encodeURIComponent(id)}/context`

export const getGlobalContext = (config: StagingConfig, id: string) => requestValidated(config, 'GET', `${sectorPath(id)}/global-context`, Global)
export const saveGlobalContext = (config: StagingConfig, id: string, baseVersion: number, sections: Sections) => requestValidated(config, 'PATCH', `${sectorPath(id)}/global-context`, Change, { baseVersion, sections })
export const decideGlobalContext = (config: StagingConfig, id: string, proposalId: string, approve: boolean) => requestValidated(config, 'POST', `${sectorPath(id)}/global-context/proposals/${encodeURIComponent(proposalId)}/decision`, Change, { approve })

const Block = z.object({ fileId: z.string(), filename: z.string(), state: z.string(), tokens: z.number(), summary: z.string(), error: z.string().nullable() }).passthrough()
export const addFileToGlobalContext = (config: StagingConfig, id: string, fileId: string) => requestValidated(config, 'POST', `${sectorPath(id)}/global-context/files`, Block, { fileId })
export const summarizeGlobalContextFile = (config: StagingConfig, id: string, fileId: string) => requestValidated(config, 'POST', `${sectorPath(id)}/global-context/files/${encodeURIComponent(fileId)}/summarize`, Block)
export const removeGlobalContextFile = (config: StagingConfig, id: string, fileId: string) => requestValidated(config, 'DELETE', `${sectorPath(id)}/global-context/files/${encodeURIComponent(fileId)}`, z.object({ version: z.number(), filename: z.string(), hash: z.string(), state: z.string() }))
export const compactGlobalContext = (config: StagingConfig, id: string) => requestValidated(config, 'POST', `${sectorPath(id)}/global-context/compact`, z.object({ started: z.boolean() }))
export const restoreGlobalContext = (config: StagingConfig, id: string, version: number) => requestValidated(config, 'POST', `${sectorPath(id)}/global-context/restore`, z.object({ version: z.number(), sections: Sections }), { version })
export const startGlobalContextRewrite = (config: StagingConfig, id: string, instruction: string) => requestValidated(config, 'POST', `${sectorPath(id)}/global-context/rewrite`, z.object({ sessionId: z.string() }), { instruction })
export const getLocalContext = (config: StagingConfig, thread: string) => requestValidated(config, 'GET', threadPath(thread), Local)
export const saveLocalContext = (config: StagingConfig, thread: string, version: number, notes: string) => requestValidated(config, 'PATCH', threadPath(thread), Local, { version, notes })
export const compactLocalContext = (config: StagingConfig, thread: string) => requestValidated(config, 'POST', `${threadPath(thread)}/compact`, z.object({ compacted: z.boolean(), reason: z.string().optional(), context: Local }))

export const rebuildLocalContext = (config: StagingConfig, thread: string, version: number, summary: string) => requestValidated(config, 'POST', `${threadPath(thread)}/rebuild`, Local, { version, summary, independent: true })
