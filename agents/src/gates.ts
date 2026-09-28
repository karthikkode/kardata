// Deterministic submit gate chain, tripwire, advisory rubric. T6.1.
// task.submit passes only through runGateChain; policy violations halt with
// TripwireError instead of retrying. The model-graded rubric is advisory:
// the deterministic gate still decides.
import type { TrippedBudget } from './budgets.js'
import type { Todo } from './planning.js'
import type { SubmissionRecord } from './tasks.js'

export type SubmitterScope = 'parent' | 'child'

export interface GateInput {
  todos: Todo[]
  submission: SubmissionRecord
  trippedBudgets: TrippedBudget[]
  submitter: SubmitterScope
}

export function checkTodosComplete(todos: Todo[]): string[] {
  const open = todos.filter((todo) => todo.status !== 'completed')
  if (open.length === 0) return []
  return [`${open.length} plan item(s) not completed: ${open.map((todo) => todo.id).join(', ')}`]
}

export function checkSubmissionShape(submission: SubmissionRecord): string[] {
  if (!submission.summary.trim()) return ['submit needs a non-empty summary']
  return []
}

export function checkBudgetsClear(tripped: TrippedBudget[]): string[] {
  if (tripped.length === 0) return []
  return [`budgets tripped: ${tripped.join(', ')}`]
}

export function checkSubmitterScope(submitter: SubmitterScope): string[] {
  // Children report through collect_result, never task.submit: a child
  // submitting the parent task is a delegation escape.
  if (submitter === 'child') return ['child runs cannot submit parent tasks; use collect_result']
  return []
}

export function runGateChain(input: GateInput): string[] {
  return [
    ...checkTodosComplete(input.todos),
    ...checkSubmissionShape(input.submission),
    ...checkBudgetsClear(input.trippedBudgets),
    ...checkSubmitterScope(input.submitter),
  ]
}

export class TripwireError extends Error {
  constructor(
    message: string,
    readonly violation: 'empty-result' | 'submit-while-blocked',
  ) {
    super(message)
    this.name = 'TripwireError'
  }
}

// Policy violations halt with a typed exception, not a retryable error:
// submitting nothing, or submitting while a blocker is open.
export function assertNoTripwire(
  submission: SubmissionRecord,
  openBlockers: number,
): void {
  if (!submission.summary.trim() && !submission.detail?.trim()) {
    throw new TripwireError('submit with empty result', 'empty-result')
  }
  if (openBlockers > 0) {
    throw new TripwireError(`submit with ${openBlockers} open blocker(s)`, 'submit-while-blocked')
  }
}

export type RubricVerdict = 'satisfied' | 'needs_revision' | 'failed'

export interface RubricResult {
  verdict: Exclude<RubricVerdict, 'needs_revision'>
  iterations: number
}

// Advisory model-graded loop with a hard iteration cap. Returns the last
// verdict on exhaustion; callers keep the last response intact.
export async function runRubric(
  grade: () => Promise<RubricVerdict>,
  maxIterations: number,
): Promise<RubricResult> {
  let iterations = 0
  for (;;) {
    iterations += 1
    const verdict = await grade()
    if (verdict === 'satisfied') return { verdict, iterations }
    if (verdict === 'failed') return { verdict, iterations }
    if (iterations >= maxIterations) return { verdict: 'failed', iterations }
  }
}
