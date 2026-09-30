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

const plan = proxyActivities<typeof planActivitiesModule>(activityOptions('research'))
const sweep = proxyActivities<typeof sweepActivitiesModule>(activityOptions('research'))
// Cross-lane call: the planning turn executes on turn-lane workers (vendor
// pacing + MCP wiring live there), never on the research worker running
// this workflow. Without the explicit queue the task lands on the research
// queue, whose worker has no turn activities (live NotFoundError 2026-09-30).
const turn = proxyActivities<typeof turnActivitiesModule>({
  ...activityOptions('turn'),
  taskQueue: laneConfig('turn').taskQueue,
})

export interface SectorPlanInput {
  sectorId: string
  sessionId: string
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
    'Return a plan with exactly these headings: scope, direction shards, query shapes, budgets, risks, open questions.',
    'Every claim needs evidence or an explicit uncertain mark — never invent.',
    'Write the plan as the reply. If you cannot evidence a section, say so under its heading.',
    'Append a research-plan fenced JSON block with exactly: discovery (array of {id,title,queries:string[],maxPages:1..10}), companyBrief (instructions to investigate all worthy problems and report evidence), budgets ({maxCompanies:1..1000,maxWallMinutes:1..1440,concurrency:2}), acceptance (nonempty string[]). This is the executable specification the owner will approve. Use real sector queries, bounded budgets and evidence-based completion requirements.',
  ].join('\n')
}

export async function sectorPlan(input: SectorPlanInput): Promise<'planned' | 'failed'> {
  const modern = patched('plan-version-run-v2')
  const versionKey = modern ? workflowInfo().runId : input.sectorId
  const progress: PlanProgress = { sectorId: input.sectorId, status: 'planning' }
  setHandler(planProgressQuery, () => ({ ...progress }))
  let context: Awaited<ReturnType<typeof sweep.loadSweepContextActivity>>
  try {
    context = await sweep.loadSweepContextActivity({ sectorId: input.sectorId, scope: input.scope })
  } catch (error) {
    if (isSweepCancellation(error)) throw error
    log.error('plan context failed', { sectorId: input.sectorId, error })
    await plan.setPlanStateActivity({ sectorId: input.sectorId, state: 'failed', scope: input.scope })
    return 'failed'
  }
  let reply: string
  try {
    const outcome = await turn.karbotTurnActivity({
      sessionId: input.sessionId,
      threadKey: input.sessionId,
      runKey: modern ? `plan:${input.sectorId}:${versionKey}` : `plan:${input.sectorId}`,
      text: planningBrief(context.name, context.topic),
      ...(input.fakeSteps === undefined ? {} : { fakeSteps: input.fakeSteps }),
    })
    reply = outcome.reply
  } catch (error) {
    if (isSweepCancellation(error)) throw error
    log.error('plan turn failed', { sectorId: input.sectorId, error })
    await plan.setPlanStateActivity({ sectorId: input.sectorId, state: 'failed', scope: input.scope })
    return 'failed'
  }
  if (!reply.trim()) {
    log.error('plan turn empty', { sectorId: input.sectorId })
    await plan.setPlanStateActivity({ sectorId: input.sectorId, state: 'failed', scope: input.scope })
    return 'failed'
  }
  try {
    await plan.writePlanArtifactActivity({
      sectorId: input.sectorId,
      markdown: reply,
      idempotencyKey: `run:${versionKey}`,
      scope: input.scope,
    })
  } catch (error) {
    if (isSweepCancellation(error)) throw error
    log.error('plan write failed', { sectorId: input.sectorId, error })
    await plan.setPlanStateActivity({ sectorId: input.sectorId, state: 'failed', scope: input.scope })
    return 'failed'
  }
  progress.status = 'planned'
  await plan.setPlanStateActivity({ sectorId: input.sectorId, state: 'planned', scope: input.scope })
  return 'planned'
}
