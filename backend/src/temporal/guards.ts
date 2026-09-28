// Pure loop-guard rules. B2.6. No SDK imports: shared by the guarded
// workflow, the detector activity, and fast unit tests. Mirrors the agents
// StageMonitor at stage-transition granularity: a revisit (a stage seen
// before) that adds zero new evidence is fruitless; genuine new evidence
// resets the streak so productive revision never trips it.
export interface GuardVisit {
  stage: string
  acted: boolean
  newEvidence: number
}

export type LoopVerdict =
  | { verdict: 'ok' }
  | { verdict: 'loop'; kind: 'repeated-calls' | 'no-progress'; reason: string }

export function decideLoop(visits: GuardVisit[], maxFruitlessRevisits: number): LoopVerdict {
  const seen = new Set<string>()
  let streak = 0
  let last: GuardVisit | undefined
  for (const visit of visits) {
    const revisit = seen.has(visit.stage)
    seen.add(visit.stage)
    if (revisit && visit.newEvidence === 0) {
      streak += 1
    } else {
      streak = 0
    }
    last = visit
  }
  if (streak >= maxFruitlessRevisits && last) {
    const kind = last.acted ? 'repeated-calls' : 'no-progress'
    return {
      verdict: 'loop',
      kind,
      reason: `research loop: ${streak} consecutive revisits without new evidence (last: '${last.stage}', ${kind})`,
    }
  }
  return { verdict: 'ok' }
}
