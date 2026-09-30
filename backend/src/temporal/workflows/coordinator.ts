import { ActivityFailure, ApplicationFailure, CancellationScope, condition, defineQuery, defineSignal, log, proxyActivities, setHandler, sleep, startChild, workflowInfo, type ChildWorkflowHandle } from '@temporalio/workflow'
import type { TurnOutcome } from '../activities/turn.js'
import type * as activities from '../activities/coordinator.js'
import type * as turnActivities from '../activities/turn.js'
import type { WorkItem } from '../research-plan.js'
import { laneConfig } from '../lanes.js'
import { activityOptions } from '../timeouts.js'
import { isSweepCancellation } from '../sweep-rules.js'

const research = proxyActivities<typeof activities>(activityOptions('research'))
const turn = proxyActivities<typeof turnActivities>({ ...activityOptions('turn'), taskQueue: laneConfig('turn').taskQueue })
export const coordinatorPause = defineSignal('coordinatorPause')
export const coordinatorResume = defineSignal('coordinatorResume')
export const coordinatorState = defineQuery<{ paused: boolean; active: number }>('coordinatorState')

export async function sectorCoordinator(input: activities.CoordinatorInput): Promise<'complete' | 'failed'> {
  let paused = false, active = 0
  const children = new Map<string, ChildWorkflowHandle<typeof companyResearch>>()
  setHandler(coordinatorPause, () => { paused = true; log.info('signal received', { signal: 'coordinatorPause' }) })
  setHandler(coordinatorResume, async () => {
    await research.researchLifecycleActivity({ ...input, state: 'running' })
    paused = false
    for (const child of children.values()) await child.signal('childResume')
    log.info('signal received', { signal: 'coordinatorResume' })
  })
  setHandler(coordinatorState, () => ({ paused, active }))
  const initial = await research.loadCoordinatorActivity(input)
  const version = initial.plan.version
  const plan = initial.plan.executable
  const approvedScope = initial.context.sections.scope
  let spent = 0
  const check = async () => {
    if (paused) await condition(() => !paused)
    const fresh = await research.loadCoordinatorActivity(input)
    if (fresh.context.sections.scope !== approvedScope || fresh.plan.version !== version) {
      await research.researchLifecycleActivity({ ...input, state: 'paused' })
      throw new Error('Research scope changed. Review and approve a revised plan before restarting.')
    }
    if (spent >= plan.budgets.maxWallMinutes * 60_000) throw new Error('Approved research wall-clock budget exhausted.')
    return fresh
  }
  const bounded = async <T>(work: () => Promise<T>): Promise<T> => CancellationScope.cancellable(async () => {
    const scope = CancellationScope.current()
    let timedOut = false
    const started = Date.now()
    const timerScope = new CancellationScope({ cancellable: true })
    const timer = timerScope.run(async () => { await sleep(Math.max(1, plan.budgets.maxWallMinutes * 60_000 - spent)); timedOut = true; scope.cancel() }).catch((error: unknown) => { if (!isSweepCancellation(error)) throw error })
    try { return await work() } catch (error) { if (timedOut) throw new Error('Approved research budget exhausted. Review and extend the plan.'); throw error } finally { timerScope.cancel(); spent += Date.now() - started; await timer }
  })
  try {
    await research.researchLifecycleActivity({ ...input, state: 'running' })
    let known = initial.progress.items.filter((item) => item.kind === 'company').flatMap((item) => (item.sourceUrl ?? item.evidence[0]) ? [new URL(item.sourceUrl ?? item.evidence[0] ?? '').hostname.replace(/^www\./, '')] : [])
    for (const direction of plan.discovery) {
      const id = `${input.sectorId}:v${version}:discovery:${direction.id}`
      const stored = initial.progress.items.find((item) => item.id === id)
      if (stored?.state === 'complete') continue
      let item: WorkItem = stored ?? { id, kind: 'discovery', title: direction.title, state: 'running', attempts: 1, childId: null, evidence: [], detail: '' }
      const cursor = item.cursor ?? { queryIndex: 0, page: 0, seenDomains: known }
      known = [...new Set([...known, ...cursor.seenDomains])]
      for (let queryIndex = cursor.queryIndex; queryIndex < direction.queries.length; queryIndex++) {
        const query = direction.queries[queryIndex]
        if (!query) continue
        for (let page = queryIndex === cursor.queryIndex ? cursor.page : 0; page < direction.maxPages; page++) {
          await check()
          if (known.length >= plan.budgets.maxCompanies) {
            item = { ...item, state: 'blocked', detail: 'Company limit reached. Review the remaining discovery work.' }
            await research.researchCheckpointActivity({ ...input, version, item })
            throw new Error(item.detail)
          }
          const fresh = await bounded(() => research.researchSearchActivity({ ...input, version, query, page, seen: known, remaining: plan.budgets.maxCompanies - known.length }))
          known = [...new Set([...known, ...fresh])]
          item = { ...item, state: 'running', cursor: { queryIndex, page: page + 1, seenDomains: known } }
          await research.researchCheckpointActivity({ ...input, version, item })
          if (!fresh.length) break
        }
        item = { ...item, cursor: { queryIndex: queryIndex + 1, page: 0, seenDomains: known } }
        await research.researchCheckpointActivity({ ...input, version, item })
      }
      await research.researchCheckpointActivity({ ...input, version, item: { ...item, state: 'complete', detail: 'Approved discovery queries exhausted.' } })
    }
    await research.researchDiscoveryClosedActivity(input)
    const discovered = await check()
    const companies = discovered.progress.items.filter((item) => item.kind === 'company' && item.state !== 'complete')
    let failures = 0
    for (let index = 0; index < companies.length; index += 2) {
      await check()
      const batch = companies.slice(index, index + 2)
      active = batch.length
      const results = await bounded(() => Promise.all(batch.map(async (item) => {
        await research.researchCheckpointActivity({ ...input, version, item: { ...item, state: 'running', attempts: item.attempts + 1 } })
        try {
          const handle = await startChild(companyResearch, { workflowId: item.childId ?? `research-${item.id}`, taskQueue: laneConfig('turn').taskQueue, args: [{ ...input, version, sessionId: initial.sessionId, item, brief: plan.companyBrief, acceptance: plan.acceptance }] })
          children.set(item.id, handle)
          const outcome = await handle.result()
          children.delete(item.id)
          await research.researchVerdictActivity({ ...input, version, sessionId: initial.sessionId, item, outcome })
          return true
        } catch (error) {
          if (isSweepCancellation(error)) throw error
          children.delete(item.id)
          log.error('company research failed', { workId: item.id, code: 'research_failed' })
          await research.researchCheckpointActivity({ ...input, version, item: { ...item, state: 'blocked', attempts: item.attempts + 1, detail: 'Research did not produce a complete evidence-backed verdict. Review this task before retrying.' } })
          return false
        }
      })))
      failures += results.filter((ok) => !ok).length
      active = 0
    }
    await research.researchLifecycleActivity({ ...input, state: failures ? 'failed' : 'complete' })
    return failures ? 'failed' : 'complete'
  } catch (error) {
    if (isSweepCancellation(error)) throw error
    log.error('research coordinator stopped', { sectorId: input.sectorId, code: 'research_blocked' })
    const current = await research.loadCoordinatorActivity(input)
    if (current.sector.state !== 'paused') await research.researchLifecycleActivity({ ...input, state: 'failed' })
    return 'failed'
  }
}

interface CompanyInput extends activities.CoordinatorInput { version: number; sessionId: string; item: WorkItem; brief: string; acceptance: string[] }
export async function companyResearch(input: CompanyInput): Promise<TurnOutcome> {
  const childId = workflowInfo().workflowId, threadKey = `agent:${childId}`, partition = `child:${childId}`
  const parent = `session:${input.sessionId}`
  let cancelled = false
  let parked = false
  const inbox: string[] = []
  setHandler(defineQuery('childState'), () => ({ id: childId, status: cancelled ? 'cancelled' : 'running', acceptingSteer: !cancelled && !parked, queueDepth: inbox.length }))
  setHandler(defineSignal('childResume'), () => { parked = false; log.info('signal received', { signal: 'childResume' }) })
  setHandler(defineSignal<[string]>('childMessage'), (text) => { inbox.push(text); log.info('signal received', { signal: 'childMessage', pending: inbox.length }) })
  const append = (key: string, type: string, payload: Record<string, unknown>, target = partition) => turn.appendEventActivity({ idempotencyKey: `${childId}:${key}`, partition: target, type, payload })
  await append('launch', 't.subagent.launched', { sessionId: input.sessionId, parentSessionId: input.sessionId, childId, name: input.item.title, parentWorkflowId: workflowInfo().parent?.workflowId, depth: 0, mode: 'empty', goal: input.brief, queueCapacity: 10, canDelegate: false }, parent)
  const text = [`Research ${input.item.title}: ${input.item.sourceUrl ?? input.item.evidence[0]}.`, input.brief,
    'Investigate all worthy problems broadly. A $3k–6k/month capacity signal is an internal targeting filter, never a quoted price. Do not stop at one symptom.',
    `Approved acceptance criteria: ${input.acceptance.join('; ')}`,
    'Fetch your sources through web_fetch and quote exact excerpts. No fetched evidence means blocked, never a guessed verdict.',
    'Return a concise readable report followed by a research-result fenced JSON block: {qualification:"qualified"|"disqualified",reason:string,findings:[{claim,url,excerpt}],problems:[{problem,mechanism,costEvidence,sourceUrl,status:"candidate"|"worthy"|"rejected"}],acceptanceMet:boolean}.',
  ].join('\n')
  await append('assignment', 't.message.appended', { threadKey, kind: 'text', message: { role: 'user', text: `Research ${input.item.title} against the approved plan.` } })
  let parkCount = 0
  const runTurn = async (text: string, runKey: string): Promise<TurnOutcome> => {
    for (;;) {
      try { return await turn.karbotTurnActivity({ sessionId: input.sessionId, threadKey, runKey, text }) } catch (error) {
        if (!(error instanceof ActivityFailure && error.cause instanceof ApplicationFailure && ['ResearchPaused','ContextBlocked'].includes(error.cause.type ?? ''))) throw error
        parked = true
        parkCount++
        await append(`park:${parkCount}`, 't.thread.state', { threadKey, status: 'PAUSED', acceptingSteer: false })
        if (error.cause.type === 'ContextBlocked') await append(`context-blocked:${parkCount}`, 't.message.appended', { threadKey, kind: 'text', message: { role: 'agent', text: `Context paused: ${error.cause.message}` } })
        await condition(() => !parked)
        await append(`resume:${parkCount}`, 't.thread.state', { threadKey, status: 'RUNNING', acceptingSteer: true })
      }
    }
  }
  try {
    const outcome = await runTurn(text, `${childId}:research`)
    await append('reply', 't.message.appended', { threadKey, kind: 'text', message: { role: 'agent', text: outcome.reply.replace(/```research-result[\s\S]*?```/g, '').trim() || 'Research finished. The evidence verdict is being validated.', reasoning: outcome.reasoning } })
    let followup = 0
    while (inbox.length) {
      const next = inbox.shift()
      if (!next) continue
      followup++
      await append(`followup-user:${followup}`, 't.message.appended', { threadKey, kind: 'text', message: { role: 'user', text: next } })
      const reply = await runTurn(next, `${childId}:followup:${followup}`)
      await append(`followup-reply:${followup}`, 't.message.appended', { threadKey, kind: 'text', message: { role: 'agent', text: reply.reply, reasoning: reply.reasoning } })
    }
    return outcome
  } catch (error) { cancelled = isSweepCancellation(error); throw error } finally {
    await CancellationScope.nonCancellable(() => append('completion', 't.subagent.completed', { summary: { id: childId, goal: input.brief, status: cancelled ? 'cancelled' : 'finished', depth: 0, mode: 'empty', threadLength: 2, missedSteer: [...inbox] } }, parent))
  }
}
