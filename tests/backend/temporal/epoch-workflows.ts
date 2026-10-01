import { ApplicationFailure,condition,continueAsNew,proxyActivities,startChild,workflowInfo } from '@temporalio/workflow'
import { withPreparedExecution } from '../../../backend/src/temporal/workflows/epoch-start.js'
import type * as preparation from '../../../backend/src/temporal/activities/execution-epochs.js'

const activity = proxyActivities<{ epochLease(input: { sessionId: string; epoch: string; firstExecutionId: string; continuedFromExecutionId?: string; stage: number }): Promise<void> }>({ startToCloseTimeout: '1m' })
export async function epochContinuation(input: { sessionId: string; epoch: string; stage?: number }): Promise<void> {
  const stage = input.stage ?? 0
  await activity.epochLease({ ...input,stage,firstExecutionId: workflowInfo().firstExecutionRunId,continuedFromExecutionId: workflowInfo().continuedFromExecutionRunId })
  if (stage === 0) await continueAsNew<typeof epochContinuation>({ ...input,stage: 1 })
}

const prepare=proxyActivities<typeof preparation>({ startToCloseTimeout: '10s',retry: { maximumAttempts: 1 } })
export async function epochHeldChild(): Promise<void> { await condition(() => false) }
/** Intentionally fails workflow tasks. The logging test observes the native
 * diagnostic then terminates only this owned fixture, never waits for result. */
export async function nativePrivateFailure(): Promise<void> { throw new Error('TEST_PRIVATE_NATIVE_EXECUTION_BODY') }
export async function epochRejectedChild(input: { sessionId: string; childId: string; unknown?: boolean }): Promise<void> {
  const epoch=await prepare.prepareExecutionIntentActivity({ sessionId: input.sessionId,threadKey: `agent:${input.childId}`,workflowId: input.childId,requestKey: 'TEST rejected child' })
  await withPreparedExecution(epoch,async () => {
    if (input.unknown) throw ApplicationFailure.nonRetryable('TEST unknown launch outcome after invocation','StartOutcomeUnknown')
    return startChild(epochHeldChild,{ workflowId: input.childId })
  })
}
