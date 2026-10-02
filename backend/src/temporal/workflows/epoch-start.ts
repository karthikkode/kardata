import { CancellationScope,proxyActivities } from '@temporalio/workflow'
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/common'
import type * as activities from '../activities/execution-epochs.js'
import { activityOptions } from '../timeouts.js'

const execution=proxyActivities<typeof activities>(activityOptions('turn'))
/** A server-proven duplicate or a local stop before invoking start cannot
 * create a child. All other launch failures retain uncertain ownership. */
export async function withPreparedExecution<T>(epoch: string | undefined,start: () => Promise<T>,beforeStart?: () => Promise<unknown>): Promise<T> {
  if (!epoch) return start()
  let dispatched=false
  try {
    await beforeStart?.()
    dispatched=true
    return await start()
  } catch (error) {
    await CancellationScope.nonCancellable(() => execution.settlePreparedExecutionIntentActivity({ epoch,beforeDispatch: !dispatched || error instanceof WorkflowExecutionAlreadyStartedError }))
    throw error
  }
}
