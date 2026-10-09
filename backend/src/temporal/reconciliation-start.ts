import { Client, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client'
import { createLogger, logOp } from '../observability/logging.js'
import { temporalClientInterceptors, withAmbientTrace } from '../observability/temporal-tracing.js'
import { temporalAddress, temporalNamespace } from './connection.js'
import { laneConfig } from './lanes.js'

const RECONCILIATION_WORKFLOW_ID = 'kardata-execution-reconciliation-v1'

export async function ensureExecutionReconciliation(): Promise<void> {
  await logOp(createLogger({ runId: RECONCILIATION_WORKFLOW_ID }), 'execution.supervisor.start', async () => {
    const connection = await Connection.connect({ address: temporalAddress(),connectTimeout: '5s' })
    try {
      const client = new Client({ connection, namespace: temporalNamespace(), interceptors: { workflow: temporalClientInterceptors() } })
      try { await connection.withDeadline(Date.now() + 5_000,() => withAmbientTrace(() => client.workflow.start('executionReconciliation', { workflowId: RECONCILIATION_WORKFLOW_ID, taskQueue: laneConfig('research').taskQueue, args: [{}] }))) }
      catch (error) { if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error }
    } finally { await connection.close() }
  })
}

const FILE_ADMISSION_WORKFLOW_ID = 'kardata-file-admission-reconciliation-v1'
/** Separate workflow type: existing supervision histories stay replayable. */
export async function ensureFileAdmissionReconciliation(): Promise<void> {
  await logOp(createLogger({runId:FILE_ADMISSION_WORKFLOW_ID}),'file.admission.supervisor.start',async()=>{
    const connection=await Connection.connect({address:temporalAddress(),connectTimeout:'5s'})
    try{
      const client=new Client({connection,namespace:temporalNamespace(),interceptors:{workflow:temporalClientInterceptors()}})
      try{await connection.withDeadline(Date.now()+5000,()=>withAmbientTrace(()=>client.workflow.start('fileAdmissionReconciliation',{workflowId:FILE_ADMISSION_WORKFLOW_ID,taskQueue:laneConfig('research').taskQueue,args:[{}]})))}
      catch(error){if(!(error instanceof WorkflowExecutionAlreadyStartedError))throw error}
    }finally{await connection.close()}
  })
}
