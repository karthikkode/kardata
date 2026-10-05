// Sector planning as a durable workflow: one bounded research turn in
// the sector's planning chat, shaped into a versioned plan artifact,
// then a terminal transition (planned with evidence, failed without).
// Cancellation propagates without state writes (owner intent owns state,
// never a dying run).
//
// Only type-only shapes cross the sandbox: the workflow never fetches,
// parses markdown, or touches the DB (pure helpers below are unit-tested
// directly). Turn work runs on the turn lane; plan writes run on the
// research lane beside the sweep activities.
import { defineQuery, log, patched, proxyActivities, setHandler, workflowInfo } from '@temporalio/workflow'
import { laneConfig } from '../lanes.js'
import { isSweepCancellation } from '../sweep-rules.js'
import { activityOptions } from '../timeouts.js'
import type * as planActivitiesModule from '../activities/plan.js'
import type * as sweepActivitiesModule from '../activities/sweep.js'
import type * as turnActivitiesModule from '../activities/turn.js'
import { visiblePlan } from '../../research-plan.js'

const plan = proxyActivities<typeof planActivitiesModule>(activityOptions('research'))
const sweep = proxyActivities<typeof sweepActivitiesModule>(activityOptions('research'))
// Cross-lane call: the planning turn executes on turn-lane workers (vendor
// pacing + MCP wiring live there), never on the research worker running
// this workflow. Without the explicit queue the task lands on the research
// queue, whose worker has no turn activities (live NotFoundError 2026-09-30).

export interface SectorPlanInput {
  sectorId: string
  sessionId: string
  ownerEpoch?: string
  /** Isolated harness override; product routes never accept this field. */
  turnTaskQueue?: string
  /** Tenant binding: the artifact and transitions carry this scope. */
  scope?: { tenantId: string; projectId: string | null }
  /** Test-only scripted fake steps for the planning turn. Never set in
   * production. */
  fakeSteps?: Array<{ text: string }>
}

export interface PlanProgress {
  sectorId: string
  status: 'planning' | 'planned' | 'failed'
}

export const planProgressQuery = defineQuery<PlanProgress>('planProgress')

/** Planning brief: the turn must return a plan with these headings or
 * say what it could not evidence. Pure: pinned by unit tests. */
export function planningBrief(name: string, topic: string): string {
  return [
    `Plan the research for sector "${name}" (topic: ${topic.trim() || name}).`,
    'Deep-research first: use the knowledge base and the live web to scope what exists.',
    'Write the plan in Markdown with these sections, in order: `## Goal` (2-3 sentences on what this research will find and why), `## Search directions` (one `###` subsection per direction: what it targets and why it should surface real companies), `## Steps` (a numbered list of 4-8 concrete steps the research will take, each one sentence starting with a verb), `## Budget and limits`, `## Risks`, `## Open questions`. Never answer a section with a single word: write at least one full sentence, or say what is not known yet and why.',
    'Every claim needs evidence or an explicit uncertain mark — never invent.',
    'Write the plan as the reply. If you cannot evidence a section, say so under its heading.',
    'Append the executable specification as one fenced block with the exact fence ```research-plan (never ```json or any other fence), containing JSON with exactly: researchDepth ("discovery" for sector discovery; company deep research requires a separately approved phase), discoveryTarget (minimum distinct-company count requested by the owner, 1..2000; do not set it above maxCompanies), discovery (array of {id,title,queries:string[],maxPages:1..10}), companyBrief (instructions to investigate all worthy problems and report evidence), budgets ({maxCompanies:1..2000,maxWallMinutes:1..1440,concurrency:1..64}), acceptance (nonempty string[]). This is the executable specification the owner will approve. Use real sector queries, bounded budgets and evidence-based completion requirements.',
  ].join('\n')
}

export async function sectorPlan(input: SectorPlanInput): Promise<'planned' | 'failed'> {
  const turn = proxyActivities<typeof turnActivitiesModule>({ ...activityOptions('turn'), taskQueue: input.turnTaskQueue ?? laneConfig('turn').taskQueue })
  const modern = patched('plan-version-run-v2')
  const transcript = patched('plan-transcript-v1')
  const versionKey = modern ? workflowInfo().runId : input.sectorId
  const progress: PlanProgress = { sectorId: input.sectorId, status: 'planning' }
  const append = (key: string, message: Record<string, unknown>, kind: 'text' | 'tool' = 'text') => turn.appendEventActivity({ idempotencyKey: `plan-transcript:${versionKey}:${key}`, partition: `session:${input.sessionId}`, type: 't.message.appended', payload: { threadKey: input.sessionId, kind, message } })
  const failed = async () => {
    await plan.setPlanStateActivity({ sectorId: input.sectorId, state: 'failed', scope: input.scope })
    if (transcript) await append('failure', { role: 'agent', text: 'The research plan could not be completed. Review the error and retry planning.', failed: true })
  }
  setHandler(planProgressQuery, () => ({ ...progress }))
  let context: Awaited<ReturnType<typeof sweep.loadSweepContextActivity>>
  try {
    context = await sweep.loadSweepContextActivity({ sectorId: input.sectorId, scope: input.scope })
  } catch (error) {
    if (isSweepCancellation(error)) throw error
    log.error('plan context failed', { sectorId: input.sectorId, error })
    await failed()
    return 'failed'
  }
  let reply: string
  let reasoning: string | undefined
  try {
    if (transcript) await append('request', { role: 'user', text: `Prepare the research plan for ${context.name}.` })
    const outcome = await turn.karbotTurnActivity({
      sessionId: input.sessionId,
      threadKey: input.sessionId,
      runKey: modern ? `plan:${input.sectorId}:${versionKey}` : `plan:${input.sectorId}`,
      ...(input.ownerEpoch ? { ownerEpoch: input.ownerEpoch,ownerFirstExecutionId: workflowInfo().firstExecutionRunId,ownerContinuedFromExecutionId: workflowInfo().continuedFromExecutionRunId } : {}),
      text: planningBrief(context.name, context.topic),
      ...(input.fakeSteps === undefined ? {} : { fakeSteps: input.fakeSteps }),
    })
    reply = outcome.reply
    reasoning = outcome.reasoning
    if (transcript) for (const [index, tool] of outcome.toolCalls.entries()) await append(`tool:${index}`, tool, 'tool')
  } catch (error) {
    if (isSweepCancellation(error)) throw error
    log.error('plan turn failed', { sectorId: input.sectorId, error })
    await failed()
    return 'failed'
  }
  if (!reply.trim()) {
    log.error('plan turn empty', { sectorId: input.sectorId })
    await failed()
    return 'failed'
  }
  try {
    await plan.writePlanArtifactActivity({
      sectorId: input.sectorId,
      markdown: reply,
      idempotencyKey: `run:${versionKey}`,
      scope: input.scope,
      ...(transcript ? { requireExecutable: true } : {}),
    })
  } catch (error) {
    if (isSweepCancellation(error)) throw error
    log.error('plan write failed', { sectorId: input.sectorId, error })
    await failed()
    return 'failed'
  }
  progress.status = 'planned'
  if (transcript) await append('reply', { role: 'agent', text: visiblePlan(reply), ...(reasoning ? { reasoning } : {}) })
  await plan.setPlanStateActivity({ sectorId: input.sectorId, state: 'planned', scope: input.scope })
  return 'planned'
}
