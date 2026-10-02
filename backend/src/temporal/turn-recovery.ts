import { z } from 'zod'
import { defaultPayloadConverter } from '@temporalio/common'
import type { Client } from '@temporalio/client'
import { readRecoveryRequestReference,readTurnContinuation,requireThread,readSectorPlan,verifyOriginalExecutionEpoch,recoveryCheckpointHash,WorkspaceError,type Db } from '../db/index.js'
import { readExecutionRecord,resolveArchiveTarget,type ArchiveTarget } from '../archive/targets.js'

export interface OriginalTurnRecovery {
  runKey: string; text: string; checkpointHash: string; allowedTools: string[]
  originalInput: { toolAllow?: string[]; systemPrepend?: string[]; preloadChunks?: string[]; mode?: 'brainstorm' | 'plan'; fakeSteps?: unknown[] }
  selection: { provider: 'meta' | 'fake'; model: string | null; reasoningEffort?: string }
}
const RequestRecord=z.object({ provider: z.enum(['meta','fake']),model: z.string().nullable(),boundary: z.object({ planVersion: z.number().int().nullable().optional() }).passthrough(),data: z.object({ tools: z.array(z.object({ name: z.string().min(1).max(80) }).passthrough()).max(128),reasoningEffort: z.string().optional() }).passthrough() }).passthrough()
const OriginalInput=z.object({ toolAllow: z.array(z.string()).optional(),systemPrepend: z.array(z.string()).optional(),preloadChunks: z.array(z.string()).optional(),mode: z.enum(['brainstorm','plan']).optional(),fakeSteps: z.array(z.unknown()).optional() }).strip()
const ScheduledInput=z.object({ sessionId: z.string(),threadKey: z.string(),runKey: z.string(),text: z.string(),ownerEpoch: z.uuid(),ownerFirstExecutionId: z.string(),...OriginalInput.shape,recovery: z.object({ originalInput: OriginalInput }).passthrough().optional() }).strip()

/** Owner-only adapter path. No body/argument grants its own authority: scope,
 * immutable request, SDK event and DB ownership proof must all agree. */
export async function loadOriginalTurnRecovery(db: Db,client: Client,threadKey: string,archive: ArchiveTarget=resolveArchiveTarget()): Promise<OriginalTurnRecovery> {
  const actor=await requireThread(db,threadKey)
  const saved=await readTurnContinuation(db,threadKey)
  if (!saved) throw new WorkspaceError('conflict','No saved original turn is available. Review this stopped task and start a new approved turn.')
  const reference=await readRecoveryRequestReference(db,threadKey,saved.runKey)
  if (!reference?.metadata.workflowId || !reference.metadata.executionId || !reference.metadata.ownerEpoch) throw new WorkspaceError('conflict','The original turn lacks protected execution proof. Review its retained evidence and start a new approved task.')
  const recorded=RequestRecord.safeParse(await readExecutionRecord(archive,actor.session.id,reference.ref))
  if (!recorded.success) throw new WorkspaceError('conflict','The original request contract is unavailable. Review its evidence before restarting.')
  if (actor.session.sectorId && recorded.data.boundary.planVersion!==undefined) {
    const plan=await readSectorPlan(db,actor.session.sectorId)
    if ((plan?.approvedVersion ?? null)!==recorded.data.boundary.planVersion) throw new WorkspaceError('conflict','The approved plan changed. Review the original work against the current plan before resuming it.')
  }
  let token: Uint8Array | undefined
  let bytes=0
  const deadline=Date.now()+5_000
  for (let page=0;page<10;page++) {
    const result=await client.connection.withDeadline(deadline,() => client.connection.workflowService.getWorkflowExecutionHistoryReverse({ namespace: client.options.namespace,execution: { workflowId: reference.metadata.workflowId!,runId: reference.metadata.executionId! },maximumPageSize: 20,nextPageToken: token }))
    bytes+=Buffer.byteLength(JSON.stringify(result.history))
    if (bytes>8*1024*1024) throw new WorkspaceError('conflict','The original execution history exceeds the recovery limit. Review its retained evidence before restarting.')
    for (const event of result.history?.events ?? []) {
      const activity=event.activityTaskScheduledEventAttributes
      if (activity?.activityType?.name!=='karbotTurnActivity' || !activity.input?.payloads?.[0]) continue
      let decoded: unknown
      try { decoded=defaultPayloadConverter.fromPayload(activity.input.payloads[0]) } catch { continue }
      const input=ScheduledInput.safeParse(decoded)
      if (!input.success || input.data.runKey!==saved.runKey || input.data.threadKey!==threadKey || input.data.sessionId!==actor.session.id) continue
      await verifyOriginalExecutionEpoch(db,{ epoch: input.data.ownerEpoch,workflowId: reference.metadata.workflowId,firstExecutionId: input.data.ownerFirstExecutionId,threadKey,sessionId: actor.session.id })
      if (input.data.text!==saved.user) throw new WorkspaceError('conflict','The stored original request and checkpoint disagree. Review the task before resuming.')
      const { toolAllow,systemPrepend,preloadChunks,mode,fakeSteps }=input.data.recovery?.originalInput ?? input.data
      if (recorded.data.provider==='meta' && !recorded.data.model) throw new WorkspaceError('conflict','The original model is not recorded. Review the original task before restarting.')
      return { runKey: saved.runKey,text: saved.user,checkpointHash: recoveryCheckpointHash(saved),allowedTools: recorded.data.data.tools.map((tool) => tool.name),originalInput: { ...(toolAllow ? { toolAllow } : {}),...(systemPrepend ? { systemPrepend } : {}),...(preloadChunks ? { preloadChunks } : {}),...(mode ? { mode } : {}),...(fakeSteps ? { fakeSteps } : {}) },selection: { provider: recorded.data.provider,model: recorded.data.model,...(recorded.data.data.reasoningEffort ? { reasoningEffort: recorded.data.data.reasoningEffort } : {}) } }
    }
    token=result.nextPageToken ?? undefined
    if (!token?.byteLength) break
  }
  throw new WorkspaceError('conflict','The exact original execution contract could not be verified within the recovery limit. Review the retained task before restarting.')
}
