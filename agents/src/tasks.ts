// Task lifecycle tools: checkpoint, clarify, blocker, submit, fail. T3.2.
// Records only; the deterministic submit gate chain lands in T6.1, which
// wires into the shouldAccept hook. Loop drivers later map clarify/blocker
// records to waiting states.
import type { ToolRegistration } from './tools.js'

export interface CheckpointRecord {
  note: string
}

export interface ClarificationRecord {
  question: string
}

export interface BlockerRecord {
  reason: string
}

export interface SubmissionRecord {
  summary: string
  detail?: string
}

export interface FailureRecord {
  reason: string
}

export class TaskLedger {
  checkpoints: CheckpointRecord[] = []
  clarifications: ClarificationRecord[] = []
  blockers: BlockerRecord[] = []
  submissions: SubmissionRecord[] = []
  failures: FailureRecord[] = []
}

function text(value: unknown): value is string {
  return typeof value === 'string'
}

function optionalText(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

export function taskTools(
  ledger: TaskLedger,
  hooks: { shouldAccept?: (submission: SubmissionRecord) => string[] } = {},
): ToolRegistration[] {
  return [
    {
      definition: {
        name: 'task.checkpoint',
        description: 'Record a durable checkpoint note.',
        parameters: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
      },
      handler: (args) => {
        if (!text(args['note'])) return Promise.resolve({ content: 'note must be a string', isError: true })
        ledger.checkpoints.push({ note: args['note'] })
        return Promise.resolve({ content: `checkpoint #${ledger.checkpoints.length} recorded` })
      },
    },
    {
      definition: {
        name: 'task.request_clarification',
        description: 'Ask the operator a question; the run waits for an answer.',
        parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
      },
      handler: (args) => {
        if (!text(args['question'])) {
          return Promise.resolve({ content: 'question must be a string', isError: true })
        }
        ledger.clarifications.push({ question: args['question'] })
        return Promise.resolve({ content: 'clarification requested; run waits' })
      },
    },
    {
      definition: {
        name: 'task.report_blocker',
        description: 'Report a blocker without completing.',
        parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
      },
      handler: (args) => {
        if (!text(args['reason'])) {
          return Promise.resolve({ content: 'reason must be a string', isError: true })
        }
        ledger.blockers.push({ reason: args['reason'] })
        return Promise.resolve({ content: 'blocker recorded' })
      },
    },
    {
      definition: {
        name: 'task.submit',
        description: 'Submit the result. Passes only when the acceptance hook is silent.',
        parameters: {
          type: 'object',
          properties: { summary: { type: 'string' }, detail: { type: 'string' } },
          required: ['summary'],
        },
      },
      handler: (args) => {
        if (!text(args['summary']) || !optionalText(args['detail'])) {
          return Promise.resolve({ content: 'summary must be a string', isError: true })
        }
        const submission: SubmissionRecord = { summary: args['summary'] }
        if (typeof args['detail'] === 'string') submission.detail = args['detail']
        const errors = hooks.shouldAccept?.(submission) ?? []
        if (errors.length > 0) {
          return Promise.resolve({ content: `submit rejected: ${errors.join('; ')}`, isError: true })
        }
        ledger.submissions.push(submission)
        return Promise.resolve({ content: 'submitted' })
      },
    },
    {
      definition: {
        name: 'task.fail',
        description: 'Mark the task failed with a reason.',
        parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
      },
      handler: (args) => {
        if (!text(args['reason'])) {
          return Promise.resolve({ content: 'reason must be a string', isError: true })
        }
        ledger.failures.push({ reason: args['reason'] })
        return Promise.resolve({ content: 'failure recorded' })
      },
    },
  ]
}
