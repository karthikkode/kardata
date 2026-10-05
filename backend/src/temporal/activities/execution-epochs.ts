import { Context } from '@temporalio/activity'
import { reserveExecutionIntent,markExecutionIntent,readTurnContinuation,requireThread,getThreadHeader,getSession,readResearchWorkItem,readSectorPlan,recoveryCheckpointHash,WorkspaceError, type ExecutionIntentInput, workerPoolFromEnv } from '../../db/index.js'
import { Client } from '@temporalio/client'
import { connectClient } from '../connection.js'
import { loadOriginalTurnRecovery,type OriginalTurnRecovery } from '../turn-recovery.js'
import { projectNewEvents } from '../../projector.js'
import { createLogger, logOp } from '../../observability/logging.js'
import { temporalClientInterceptors } from '../../observability/temporal-tracing.js'

export async function prepareExecutionIntentActivity(input: ExecutionIntentInput): Promise<string> {
  const context = Context.current()
  const owner = context.info.workflowExecution
  if (!owner) throw new Error('Execution preparation requires an owning workflow')
  return logOp(createLogger({ runId: owner.workflowId,attempt: context.info.attempt }),'execution.intent.prepare',() => reserveExecutionIntent(workerPoolFromEnv(),{
    ...input,requestKey: `${owner.runId}:${input.requestKey}`,
  }),{ childWorkflowId: input.workflowId,threadKey: input.threadKey })
}

export async function settlePreparedExecutionIntentActivity(input: { epoch: string; beforeDispatch: boolean }): Promise<void> {
  const context=Context.current(); const owner=context.info.workflowExecution
  if (!owner) throw new Error('Execution settlement requires an owning workflow')
  return logOp(createLogger({ runId: owner.workflowId,attempt: context.info.attempt }),'execution.intent.settle',() => markExecutionIntent(workerPoolFromEnv(),input.epoch,input.beforeDispatch,owner.runId),{ epoch: input.epoch,beforeDispatch: input.beforeDispatch })
}

export async function originalRecoveryReadyActivity(input: { threadKey: string; sessionId: string; checkpointHash: string }): Promise<boolean> {
  const context=Context.current()
  return logOp(createLogger({ runId: context.info.workflowExecution?.workflowId,attempt: context.info.attempt }),'execution.original.ready',async () => {
    const pool=workerPoolFromEnv(); const actor=await requireThread(pool,input.threadKey)
    if (actor.session.id!==input.sessionId) throw new WorkspaceError('permission_denied','The original task belongs to another session.')
    const connection=await connectClient()
    try {
      const client=new Client({ connection,namespace: context.info.namespace,interceptors: { workflow: temporalClientInterceptors() } })
      const description=await connection.withDeadline(Date.now()+2_000,() => client.workflow.getHandle(input.threadKey.slice(6)).describe())
      if (description.status.name==='RUNNING') return false
      const saved=await readTurnContinuation(pool,input.threadKey)
      if (!saved || recoveryCheckpointHash(saved)!==input.checkpointHash) throw new WorkspaceError('conflict','The saved original task changed. Review the current task and retry Resume.')
      return true
    } finally { await connection.close() }
  },{ threadKey: input.threadKey })
}

/** Research parent retries only its scoped, still-approved work contract. */
export async function prepareResearchTurnRecoveryActivity(input: { sectorId: string; version: number; workId: string; childId: string; sessionId: string }): Promise<OriginalTurnRecovery | undefined> {
  const context=Context.current()
  return logOp(createLogger({ runId: context.info.workflowExecution?.workflowId,attempt: context.info.attempt }),'execution.research.restore',async () => {
    const pool=workerPoolFromEnv(); await projectNewEvents(pool)
    const work=await readResearchWorkItem(pool,input.sectorId,input.version,input.workId)
    const session=await getSession(pool,input.sessionId)
    const plan=await readSectorPlan(pool,input.sectorId)
    if (work.childId!==input.childId || session?.sectorId!==input.sectorId || plan?.approvedVersion!==input.version) throw new WorkspaceError('conflict','The original work no longer matches the approved research contract. Review the plan before retrying.')
    const threadKey=`agent:${input.childId}`
    if (!(await getThreadHeader(pool,threadKey)) || !(await readTurnContinuation(pool,threadKey))) return undefined
    const connection=await connectClient()
    try { return await loadOriginalTurnRecovery(pool,new Client({ connection,namespace: context.info.namespace,interceptors: { workflow: temporalClientInterceptors() } }),threadKey) }
    finally { await connection.close() }
  },{ childId: input.childId,workId: input.workId })
}
