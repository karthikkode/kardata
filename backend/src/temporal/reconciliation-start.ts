import { Client, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client'
import { createLogger, logOp } from '../observability/logging.js'
import { temporalAddress, temporalNamespace } from './connection.js'
import { laneConfig } from './lanes.js'

export const RECONCILIATION_WORKFLOW_ID = 'kardata-execution-reconciliation-v1'

export async function ensureExecutionReconciliation(): Promise<void> {
  await logOp(createLogger({ runId: RECONCILIATION_WORKFLOW_ID }), 'execution.supervisor.start', async () => {
    const connection = await Connection.connect({ address: temporalAddress(),connectTimeout: '5s' })
    try {
      const client = new Client({ connection, namespace: temporalNamespace() })
      try { await connection.withDeadline(Date.now() + 5_000,() => client.workflow.start('executionReconciliation', { workflowId: RECONCILIATION_WORKFLOW_ID, taskQueue: laneConfig('research').taskQueue, args: [{}] })) }
      catch (error) { if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error }
    } finally { await connection.close() }
  })
}
