// Pre-flight checks before long operations. T6.2. A frozen brief plus a
// check receipt is required to start; any failing check blocks with reasons.
import { createHash } from 'node:crypto'
import type { Clock } from './clock.js'

export interface PreflightInput {
  scope: string
  estimatedTokens: number
  tokenBudget: number
  tokenUsed: number
  requiredTools: string[]
  reachableTools: string[]
  duplicateRunning: boolean
  expectedPolicyVersion: string
  actualPolicyVersion: string
}

export interface PreflightReceipt {
  scope: string
  briefHash: string
  checkedAt: number
}

export function freezeBrief(scope: string): { scope: string; briefHash: string } {
  const briefHash = createHash('sha256').update(scope).digest('hex')
  return { scope, briefHash }
}

export type PreflightResult =
  | { ok: true; receipt: PreflightReceipt }
  | { ok: false; reasons: string[] }

export function runPreflight(input: PreflightInput, clock: Clock): PreflightResult {
  const reasons: string[] = []
  if (!input.scope.trim()) reasons.push('scope must be non-empty')
  if (input.tokenUsed + input.estimatedTokens > input.tokenBudget) {
    reasons.push(
      `insufficient token budget: need ${input.estimatedTokens}, have ${input.tokenBudget - input.tokenUsed}`,
    )
  }
  const reachable = new Set(input.reachableTools)
  for (const tool of input.requiredTools) {
    if (!reachable.has(tool)) reasons.push(`required tool unreachable: ${tool}`)
  }
  if (input.duplicateRunning) reasons.push('a run already covers this scope')
  if (input.actualPolicyVersion !== input.expectedPolicyVersion) {
    reasons.push(
      `policy version mismatch: expected ${input.expectedPolicyVersion}, found ${input.actualPolicyVersion}`,
    )
  }
  if (reasons.length > 0) return { ok: false, reasons }
  const { briefHash } = freezeBrief(input.scope)
  return { ok: true, receipt: { scope: input.scope, briefHash, checkedAt: clock.now() } }
}
