// Pause, resume, cancel with execution epochs, plus idempotency for safe
// resume. T1.3. An epoch change means anything recorded but not yet consumed
// under the old epoch is stale and must not be applied.
import { IllegalTransitionError, transition, type Run } from './loop.js'

export function pauseRun(run: Run): void {
  transition(run, 'PAUSED')
}

export function resumeRun(run: Run): void {
  // Resume is only meaningful from PAUSED: starting a fresh run is startRun's
  // job, not resume's, so IDLE -> RUNNING through here is rejected.
  if (run.state !== 'PAUSED') {
    throw new IllegalTransitionError(run.state, 'RUNNING')
  }
  transition(run, 'RUNNING')
  run.epoch += 1
}

export function cancelRun(run: Run): void {
  transition(run, 'CANCELLING')
}

// Exactly-once record of completed actions, scoped by execution epoch.
// Within one epoch the repetition tracker governs repeats (warn, replan,
// block). Across epochs (resume after pause or kill), a key recorded under an
// older epoch is served from cache instead of re-executing. Keys are
// caller-chosen (tool plus canonical args plus scope).
export class IdempotencyLog {
  private readonly epochs = new Map<string, number>()

  has(key: string): boolean {
    return this.epochs.has(key)
  }

  // Returns true when newly recorded, false when already present (skip it).
  record(key: string, epoch = 0): boolean {
    if (this.epochs.has(key)) return false
    this.epochs.set(key, epoch)
    return true
  }

  recordedBefore(key: string, epoch: number): boolean {
    const at = this.epochs.get(key)
    return at !== undefined && at < epoch
  }

  pending<T>(actions: Array<{ key: string; value: T }>): T[] {
    return actions.filter((action) => !this.epochs.has(action.key)).map((action) => action.value)
  }
}
