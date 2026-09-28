// Turn loop run states. T1.1: states plus legal transitions only; budgets,
// epochs, and dispatch arrive in T1.2-T1.3 and later phases.
export const RUN_STATES = [
  'IDLE',
  'RUNNING',
  'PAUSED',
  'CANCELLING',
  'FINISHED',
  'ERROR',
] as const

export type RunState = (typeof RUN_STATES)[number]

const TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  IDLE: ['RUNNING'],
  RUNNING: ['PAUSED', 'CANCELLING', 'FINISHED', 'ERROR'],
  PAUSED: ['RUNNING', 'CANCELLING', 'ERROR'],
  CANCELLING: ['FINISHED', 'ERROR'],
  FINISHED: [],
  ERROR: [],
}

export function isLegalTransition(from: RunState, to: RunState): boolean {
  return TRANSITIONS[from].includes(to)
}

export class IllegalTransitionError extends Error {
  readonly from: RunState
  readonly to: RunState

  constructor(from: RunState, to: RunState) {
    super(`Illegal run transition ${from} -> ${to}`)
    this.name = 'IllegalTransitionError'
    this.from = from
    this.to = to
  }
}

export interface Run {
  readonly id: string
  state: RunState
  /** Execution epoch. Bumps on every resume; outputs from older epochs are stale. */
  epoch: number
}

let nextRunId = 1

export function createRun(): Run {
  const run: Run = { id: `run-${nextRunId++}`, state: 'IDLE', epoch: 0 }
  return run
}

export function transition(run: Run, to: RunState): void {
  if (!isLegalTransition(run.state, to)) {
    throw new IllegalTransitionError(run.state, to)
  }
  run.state = to
}
