// Deep-research pipeline as a durable workflow. B2.5. Ports the proven
// agents/runResearchWorkflow semantics: one stage per question, findings
// indexed as events before the report is presented, zero-evidence runs take
// the refusal branch with a logged reason, and pause/resume preserves the
// stage cursor — resume replays history to the cursor and never re-executes
// a completed activity (Temporal memoizes completed results; the cursor only
// advances after the stage completion is logged).
//
// The workflow never hashes or calls providers: findings (with content
// hashes) arrive opaque from the stage activity, and the report assembler
// below mirrors agents assembleReport over plain string equality. Only
// type-only agents shapes cross the sandbox boundary.
//
// Pause is stage-granular: a pause during a stage lets that stage finish and
// holds the next one. Loop/time budgets are B2.6, not silent behavior here.
import {
  condition,
  defineQuery,
  defineSignal,
  log,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow'
import type { Finding } from '@kardata/agents'
import { activityOptions } from '../timeouts.js'
import type * as researchActivitiesModule from '../activities/research.js'
import type * as turnActivitiesModule from '../activities/turn.js'

const research = proxyActivities<typeof researchActivitiesModule>(activityOptions('research'))
const events = proxyActivities<typeof turnActivitiesModule>(activityOptions('research'))

export interface ResearchRunInput {
  runId: string
  scope: string
  questions: string[]
}

export type ResearchRunStatus = 'running' | 'paused' | 'reported' | 'refused' | 'blocked'

export interface ResearchRunState {
  runId: string
  scope: string
  status: ResearchRunStatus
  /** Next incomplete stage index. Advances only after the stage completion is logged. */
  cursor: number
  stagesTotal: number
  findingsCount: number
}

export const researchPauseSignal = defineSignal('researchPause')
export const researchResumeSignal = defineSignal('researchResume')
export const researchStateQuery = defineQuery<ResearchRunState>('researchState')

// Workflow-side scopes are prefixed `run-`: the stage activity writes its own
// `started:<index>` markers into the same partition, and sharing the bare
// `started` scope once swallowed stage 1's marker via idempotent replay.
function idempotencyKey(partition: string, scope: string, nonce: number): string {
  return `${partition}:${scope}:${nonce}`
}

// Mirror of agents assembleReport: dedupe by content hash, findings then
// sources. Kept out of the agents runtime import because workflow code cannot
// pull the agents runtime into the sandbox; shared with the guarded workflow
// (same bundle) and proven equal to the real assembler by test.
export function assembleFindingsReport(findings: Finding[]): string {
  const seen = new Map<string, Finding>()
  for (const finding of findings) {
    if (!seen.has(finding.contentHash)) seen.set(finding.contentHash, finding)
  }
  const unique = [...seen.values()]
  const lines = ['## Findings']
  for (const finding of unique) lines.push(`- [${finding.claim}](${finding.url})`)
  lines.push('', '## Sources')
  for (const finding of unique) lines.push(`- ${finding.url} (${finding.docId})`)
  return lines.join('\n')
}

export async function researchRun(input: ResearchRunInput): Promise<string> {
  const partition = `research:${input.runId}`
  const box: { status: ResearchRunStatus } = { status: 'running' }
  const currentStatus = (): ResearchRunStatus => box.status
  let nonce = 0
  let cursor = 0
  const findings: Finding[] = []
  const seenHashes = new Set<string>()

  setHandler(researchPauseSignal, () => {
    if (currentStatus() === 'running') box.status = 'paused'
    log.info('signal received', { signal: 'researchPause', status: currentStatus() })
  })
  setHandler(researchResumeSignal, () => {
    if (currentStatus() === 'paused') box.status = 'running'
    log.info('signal received', { signal: 'researchResume', status: currentStatus() })
  })
  setHandler(researchStateQuery, () => ({
    runId: input.runId,
    scope: input.scope,
    status: box.status,
    cursor,
    stagesTotal: input.questions.length,
    findingsCount: findings.length,
  }))

  if (!input.scope.trim()) {
    box.status = 'blocked'
    nonce += 1
    await events.appendEventActivity({
      idempotencyKey: idempotencyKey(partition, 'run-blocked', nonce),
      partition,
      type: 't.research.blocked',
      payload: { runId: input.runId, reasons: ['scope must be non-empty'] },
    })
    return 'blocked'
  }

  nonce += 1
  await events.appendEventActivity({
    idempotencyKey: idempotencyKey(partition, 'run-started', nonce),
    partition,
    type: 't.research.started',
    payload: { runId: input.runId, scope: input.scope, questions: input.questions },
  })

  while (cursor < input.questions.length) {
    if (currentStatus() === 'paused') {
      await condition(() => currentStatus() !== 'paused')
      continue
    }
    const question = input.questions[cursor]
    if (question === undefined) break
    const stageIndex = cursor
    const result = await research.runResearchStageActivity({
      runId: input.runId,
      partition,
      stageIndex,
      question,
    })
    for (const finding of result.findings) {
      if (!seenHashes.has(finding.contentHash)) {
        seenHashes.add(finding.contentHash)
        findings.push(finding)
      }
    }
    // Index before presentation: the stage completion (with its findings)
    // is logged first, and the cursor advances only after the log lands.
    // A resume therefore replays to this cursor with both intact.
    nonce += 1
    await events.appendEventActivity({
      idempotencyKey: idempotencyKey(partition, `run-completed-${stageIndex}`, nonce),
      partition,
      type: 't.research.stage_completed',
      payload: { runId: input.runId, stageIndex, question, findings: result.findings },
    })
    cursor = stageIndex + 1
  }

  if (findings.length === 0) {
    box.status = 'refused'
    nonce += 1
    await events.appendEventActivity({
      idempotencyKey: idempotencyKey(partition, 'run-refused', nonce),
      partition,
      type: 't.research.refused',
      payload: { runId: input.runId, reason: 'zero evidence captured: refusing to report' },
    })
    return 'refused'
  }

  const report = assembleFindingsReport(findings)
  box.status = 'reported'
  nonce += 1
  await events.appendEventActivity({
    idempotencyKey: idempotencyKey(partition, 'run-reported', nonce),
    partition,
    type: 't.research.reported',
    payload: { runId: input.runId, report, findingsCount: findings.length },
  })
  return 'reported'
}
