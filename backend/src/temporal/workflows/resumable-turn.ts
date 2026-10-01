import { ActivityFailure, ApplicationFailure, patched } from '@temporalio/workflow'

/** Context failures retain the same activity input/operation identity.
 * Existing histories keep their terminal-error contract via patching. */
export async function resumableTurn<T>(execute: () => Promise<T>, park: (reason: string) => Promise<void>, waitForResume: () => Promise<void>): Promise<T> {
  for (;;) {
    try { return await execute() } catch (error) {
      if (!(error instanceof ActivityFailure && error.cause instanceof ApplicationFailure && error.cause.type === 'ContextBlocked' && patched('context-recovery-v1'))) throw error
      await park(error.cause.message)
      await waitForResume()
    }
  }
}
