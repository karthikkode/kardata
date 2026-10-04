import { ActivityFailure, ApplicationFailure, patched } from '@temporalio/workflow'

/** Context failures retain the same activity input/operation identity.
 * Existing histories keep their terminal-error contract via patching. */
export async function resumableTurn<T>(execute: () => Promise<T>, park: (reason: string, kind: 'context' | 'operation' | 'pause') => Promise<void>, waitForResume: () => Promise<void>, opts?: { parkPause?: boolean }): Promise<T> {
  for (;;) {
    try { return await execute() } catch (error) {
      const failure = error instanceof ActivityFailure && error.cause instanceof ApplicationFailure ? error.cause : undefined
      const kind = failure?.type === 'ResearchPaused' && opts?.parkPause === true ? 'pause'
        : failure?.type === 'OperationBlocked' && patched('operation-recovery-v1') ? 'operation'
        : failure?.type === 'ContextBlocked' && patched('context-recovery-v1') ? 'context'
        : undefined
      if (!failure || !kind) throw error
      await park(failure.message, kind)
      await waitForResume()
    }
  }
}
