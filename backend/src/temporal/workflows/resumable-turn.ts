import { ActivityFailure, ApplicationFailure, patched } from '@temporalio/workflow'

export type ParkKind = 'context' | 'operation' | 'pause' | 'provider'

/** Failure type to park kind. Patch checks run only for the matching
 * type (short-circuit), so new patch markers land only on the
 * affected path — never on every turn. Pure except the injected
 * patch check, so unit tests pin it without a workflow sandbox. */
export function parkKindFor(failureType: string | null | undefined, opts: { parkPause: boolean; hasPatch: (id: string) => boolean }): ParkKind | undefined {
  if (failureType === 'ResearchPaused' && opts.parkPause) return 'pause'
  if (failureType === 'OperationBlocked' && opts.hasPatch('operation-recovery-v1')) return 'operation'
  if (failureType === 'ContextBlocked' && opts.hasPatch('context-recovery-v1')) return 'context'
  if (failureType === 'ProviderExhausted' && opts.hasPatch('provider-park-v1')) return 'provider'
  return undefined
}

/** Visible tool-message name per park kind. Provider exhaustion gets
 * its own name; every older kind keeps its exact previous label. */
export function parkMessageName(kind: ParkKind): string {
  if (kind === 'operation') return 'operation.recovery'
  if (kind === 'provider') return 'provider.outage'
  return 'context.compaction'
}

/** Context failures retain the same activity input/operation identity.
 * Existing histories keep their terminal-error contract via patching. */
export async function resumableTurn<T>(execute: () => Promise<T>, park: (reason: string, kind: ParkKind) => Promise<void>, waitForResume: () => Promise<void>, opts?: { parkPause?: boolean }): Promise<T> {
  for (;;) {
    try { return await execute() } catch (error) {
      const failure = error instanceof ActivityFailure && error.cause instanceof ApplicationFailure ? error.cause : undefined
      const kind = parkKindFor(failure?.type, { parkPause: opts?.parkPause === true, hasPatch: (id) => patched(id) })
      if (!failure || !kind) throw error
      await park(failure.message, kind)
      await waitForResume()
    }
  }
}
