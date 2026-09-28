// Guarded research runs: loop + time guards as durable service. B2.6. Ports
// the agents A11.3/A11.4 semantics onto the B2.5 pipeline: every visit runs
// as a guarded stage activity (execution recorded with its attempt number),
// the shared pure decideLoop rule judges the visit history after each stage,
// and unit/run wall-clock budgets race each active span as durable timers.
//
// Suspend parks everything: no span timer or scope is pending while
// suspended, so resume-after-suspend needs an explicit approved operator
// signal — or the suspend wait expires after suspendTimeoutMs and the run
// closes through the terminal tail instead of wedging open.
// Unauthorized resumes are denied and logged, never applied. An approved
// resume re-arms the active span with the (optionally extended) budgets and,
// after a loop suspend, restarts the detector window as an operator override.
//
// No wall clock exists in workflow code: budgets are sleep timers, and each
// resumed span receives the approved budget window (documented below).
// Cursor/visit/findings updates follow the B2.5 rule — log first, advance
// after — so a timeout that steals the tail of a visit retries that visit
// without duplicating logged rows (idempotency keys) or findings (hashes).
import {
  CancellationScope,
  condition,
  defineQuery,
  defineSignal,
  log,
  proxyActivities,
  setHandler,
  sleep,
} from '@temporalio/workflow'
import type { Finding } from '@kardata/agents'
import { activityOptions } from '../timeouts.js'
import type { GuardVisit } from '../guards.js'
import type * as guardActivitiesModule from '../activities/loopguards.js'
import type * as turnActivitiesModule from '../activities/turn.js'
import type { GuardedStageResult } from '../activities/loopguards.js'
import { assembleFindingsReport } from './research.js'

const guards = proxyActivities<typeof guardActivitiesModule>(activityOptions('research'))
const events = proxyActivities<typeof turnActivitiesModule>(activityOptions('research'))

export interface GuardedRunInput {
  runId: string
  scope: string
  /** Visit order; repeats revisit a stage (loop fixture: ['A', 'B', 'A']). */
  route: string[]
  unitBudgetMs: number
  runBudgetMs: number
  maxFruitlessRevisits: number
  /** Suspend close: a suspended run with no approved resume for this long
   * expires to the terminal tail (partial report, or refused when there is
   * no evidence) instead of wedging open. Defaults to 1 h. */
  suspendTimeoutMs?: number
}

/** Default suspend close for guarded runs. */
export const DEFAULT_SUSPEND_TIMEOUT_MS = 3_600_000

export type GuardedRunStatus = 'running' | 'suspended' | 'reported' | 'refused' | 'blocked'
export type SuspendKind = 'loop' | 'unit-budget' | 'run-budget'

export interface GuardResume {
  approved: boolean
  extendUnitMs?: number
  extendRunMs?: number
}

export interface GuardedRunState {
  runId: string
  status: GuardedRunStatus
  cursor: number
  visitsTotal: number
  suspendKind?: SuspendKind
  suspendReason?: string
}

export const guardResumeSignal = defineSignal<[GuardResume]>('guardResume')
export const guardStateQuery = defineQuery<GuardedRunState>('guardState')

function idempotencyKey(partition: string, scope: string, nonce: number): string {
  return `${partition}:${scope}:${nonce}`
}

export async function guardedResearchRun(input: GuardedRunInput): Promise<string> {
  const partition = `research:${input.runId}`
  const box: { status: GuardedRunStatus } = { status: 'running' }
  const resumeQueue: GuardResume[] = []
  let nonce = 0
  let cursor = 0
  let unitBudget = input.unitBudgetMs
  let runBudget = input.runBudgetMs
  let suspended: { kind: SuspendKind; reason: string } | undefined
  const visits: GuardVisit[] = []
  const findings: Finding[] = []
  const seenHashes = new Set<string>()

  setHandler(guardResumeSignal, (request: GuardResume) => {
    resumeQueue.push(request)
    log.info('signal received', { signal: 'guardResume', pending: resumeQueue.length })
  })
  setHandler(guardStateQuery, () => ({
    runId: input.runId,
    status: box.status,
    cursor,
    visitsTotal: input.route.length,
    suspendKind: suspended?.kind,
    suspendReason: suspended?.reason,
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
    payload: { runId: input.runId, scope: input.scope, route: input.route },
  })

  // One visit inside its unit budget. The timer cancels the scope on fire;
  // success cancels the scope to disarm the timer (the completed activity is
  // unaffected; the timer's own cancellation is swallowed below).
  async function runVisit(visitIndex: number, stage: string): Promise<GuardedStageResult | 'unit-timeout'> {
    return CancellationScope.cancellable(async () => {
      const scope = CancellationScope.current()
      let timedOut = false
      const timer = sleep(unitBudget).then(
        () => {
          timedOut = true
          scope.cancel()
        },
        () => undefined,
      )
      void timer
      try {
        const result = await guards.runGuardedStageActivity({
          runId: input.runId,
          partition,
          visitIndex,
          stage,
          question: stage,
        })
        scope.cancel()
        return result
      } catch (error) {
        if (timedOut) return 'unit-timeout'
        throw error
      }
    })
  }

  for (;;) {
    if (cursor >= input.route.length) break
    if (suspended) {
      const request = resumeQueue.shift()
      if (request === undefined) {
        const suspendTimeoutMs = input.suspendTimeoutMs ?? DEFAULT_SUSPEND_TIMEOUT_MS
        const resumed = await condition(() => resumeQueue.length > 0, suspendTimeoutMs)
        if (!resumed) {
          // Suspend close: no operator verdict arrived. The run expires to
          // the terminal tail below — partial findings still report, an
          // evidence-free run refuses — instead of waiting forever.
          nonce += 1
          await events.appendEventActivity({
            idempotencyKey: idempotencyKey(partition, 'run-suspend-expired', nonce),
            partition,
            type: 't.research.suspend_expired',
            payload: { runId: input.runId, kind: suspended.kind, reason: suspended.reason },
          })
          break
        }
        continue
      }
      if (!request.approved) {
        nonce += 1
        await events.appendEventActivity({
          idempotencyKey: idempotencyKey(partition, 'run-resume-denied', nonce),
          partition,
          type: 't.research.resume_denied',
          payload: { runId: input.runId, reason: 'resume requires operator approval' },
        })
        continue
      }
      if (request.extendUnitMs !== undefined) unitBudget = request.extendUnitMs
      if (request.extendRunMs !== undefined) runBudget = request.extendRunMs
      // Operator override after a loop suspend: the detector restarts with a
      // fresh window instead of instantly re-tripping on old revisits.
      if (suspended.kind === 'loop') visits.length = 0
      suspended = undefined
      box.status = 'running'
      nonce += 1
      await events.appendEventActivity({
        idempotencyKey: idempotencyKey(partition, 'run-resumed', nonce),
        partition,
        type: 't.research.resumed',
        payload: { runId: input.runId, extendedUnitMs: request.extendUnitMs, extendedRunMs: request.extendRunMs },
      })
      continue
    }

    // Active span: the run timer bounds this unattended stretch. Suspend
    // handling (appends, resume waits) happens outside scopes at loop level.
    // NOTE: cursor/visits/findings are mutated inside scopes and read at loop
    // level — correct at runtime (closures), opaque to TS flow analysis, so
    // the span RETURNS its suspend verdict instead of setting an outer let.
    const spanOutcome: { suspend?: { kind: SuspendKind; reason: string } } =
      await CancellationScope.cancellable(async () => {
        const span = CancellationScope.current()
        let spanTimeout = false
        const runTimer = sleep(runBudget).then(
          () => {
            spanTimeout = true
            span.cancel()
          },
          () => undefined,
        )
        void runTimer
        try {
          for (;;) {
            const stage = input.route[cursor]
            if (stage === undefined) break
            const visitIndex = cursor
            const outcome = await runVisit(visitIndex, stage)
            if (outcome === 'unit-timeout') {
              return {
                suspend: {
                  kind: 'unit-budget' as SuspendKind,
                  reason: `unit wall-clock budget exceeded on stage '${stage}'`,
                },
              }
            }
            const fresh = outcome.findings.filter((finding) => !seenHashes.has(finding.contentHash))
            for (const finding of fresh) {
              seenHashes.add(finding.contentHash)
              findings.push(finding)
            }
            nonce += 1
            await events.appendEventActivity({
              idempotencyKey: idempotencyKey(partition, `run-completed-${visitIndex}`, nonce),
              partition,
              type: 't.research.stage_completed',
              payload: { runId: input.runId, visitIndex, stage, question: stage, findings: outcome.findings },
            })
            // A timeout that steals the tail (after the log, before the
            // cursor) must not double-record the visit on resume.
            if (visits.length === visitIndex) {
              visits.push({ stage, acted: true, newEvidence: fresh.length })
            }
            const verdict = await guards.detectLoopActivity({
              runId: input.runId,
              partition,
              visits: [...visits],
              maxFruitlessRevisits: input.maxFruitlessRevisits,
            })
            if (verdict.verdict === 'loop') {
              return { suspend: { kind: 'loop' as SuspendKind, reason: verdict.reason } }
            }
            cursor = visitIndex + 1
          }
          span.cancel()
          return {}
        } catch (error) {
          if (!spanTimeout) throw error
          return {
            suspend: {
              kind: 'run-budget' as SuspendKind,
              reason: `run wall-clock budget exceeded at visit ${cursor} of ${input.route.length}`,
            },
          }
        }
      })

    if (spanOutcome.suspend && !suspended) {
      suspended = spanOutcome.suspend
      box.status = 'suspended'
      nonce += 1
      await events.appendEventActivity({
        idempotencyKey: idempotencyKey(partition, 'run-suspended', nonce),
        partition,
        type: 't.research.suspended',
        payload: { runId: input.runId, kind: suspended.kind, reason: suspended.reason, cursor },
      })
    }
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
