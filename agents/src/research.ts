// Staged deep-research workflow with governor, retriever seam, per-claim
// evidence, and zero-evidence refusal. T8.1-T8.2. Runs against stub domain
// tools; the supervisor fans out deterministically over brief questions
// (model-driven decomposition is a later upgrade, not a scope cut: the
// topology, budgets, and evidence rules are what this phase proves).
import { createHash } from 'node:crypto'
import { BudgetTracker, RepetitionTracker, type BudgetLimits } from './budgets.js'
import type { Clock } from './clock.js'
import { DOCUMENT_FIXTURES } from './domain.js'
import { IdempotencyLog } from './epochs.js'
import { createRun, transition } from './loop.js'
import { runPreflight } from './preflight.js'
import type { ProviderAdapter, ChatMessage, ToolResult } from './providers.js'
import { ToolRegistry } from './tools.js'
import { runTurn } from './turn.js'

// Retriever seam: snippet search split from full fetch behind a stable
// schema. Providers plug in here; the workflow never names one.
export interface RetrievedDoc {
  id: string
  url: string
  title: string
  body: string
}

export interface Retriever {
  search(query: string, maxResults: number): Promise<Array<{ id: string; url: string }>>
  fetch(id: string): Promise<RetrievedDoc>
}

export class StubRetriever implements Retriever {
  async search(query: string, maxResults: number): Promise<Array<{ id: string; url: string }>> {
    const needle = query.toLowerCase()
    return DOCUMENT_FIXTURES.filter((doc) =>
      `${doc.title} ${doc.url}`.toLowerCase().includes(needle),
    )
      .slice(0, maxResults)
      .map((doc) => ({ id: doc.id, url: doc.url }))
  }

  async fetch(id: string): Promise<RetrievedDoc> {
    const doc = DOCUMENT_FIXTURES.find((entry) => entry.id === id)
    if (!doc) throw new Error(`unknown document '${id}'`)
    return { ...doc, body: `Canned body of ${doc.title}.` }
  }
}

// Per-claim evidence: every finding carries its document, URL, excerpt, and
// content hash. No donor implements this; it is Karbot-owned.
export interface Finding {
  claim: string
  docId: string
  url: string
  excerpt: string
  contentHash: string
}

export function captureFinding(input: {
  claim: string
  docId: string
  url: string
  excerpt: string
}): Finding {
  const claim = input.claim.trim()
  const docId = input.docId.trim()
  const url = input.url.trim()
  const excerpt = input.excerpt.trim()
  if (!claim || !docId || !url || !excerpt) {
    throw new Error('finding needs claim, docId, url, and excerpt: claims without sources are rejected')
  }
  const contentHash = createHash('sha256').update(`${docId}\n${url}\n${excerpt}`).digest('hex')
  return { claim, docId, url, excerpt, contentHash }
}

export function assembleReport(findings: Finding[]): string {
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

export interface ResearchGovernor {
  maxUnits: number
  maxReactTurns: number
  maxResultsPerQuery: number
  /** Per-question-unit wall-clock budget. Breach suspends the run (A11.4). */
  maxUnitWallMs: number
  /** Whole-run wall-clock budget. Breach suspends the run (A11.4). */
  maxRunWallMs: number
  /** Consecutive acting-but-fruitless units before the run blocks (A11.3). */
  maxFruitlessUnits: number
}

// A11.1. A stage is one briefed question-unit through its bounded react loop
// to captured findings. A completed stage is settled: resume skips it and the
// checkpoint carries its findings forward byte-identical.
export interface ResearchStageCheckpoint {
  question: string
  findings: Finding[]
}

export interface ResearchCheckpoint {
  version: 1
  scope: string
  completed: ResearchStageCheckpoint[]
  /** Wall-clock spent by the run chain so far: budgets accumulate across resume. */
  elapsedMs: number
}

export type ResearchOutcome =
  | { outcome: 'reported'; report: string; findings: Finding[]; unitsRun: number; checkpoint: ResearchCheckpoint }
  | { outcome: 'refused'; reason: string }
  | { outcome: 'blocked'; reasons: string[] }
  | { outcome: 'suspended'; reason: string; findings: Finding[]; checkpoint: ResearchCheckpoint }

export interface ResearchInput {
  scope: string
  questions: string[]
  provider: ProviderAdapter
  buildRegistry: () => ToolRegistry
  limits: BudgetLimits
  governor: ResearchGovernor
  clock: Clock
  policyVersion: string
  /** Resume cursor: settled stages are skipped, never re-run (A11.1/A11.2). */
  resumeFrom?: ResearchCheckpoint
  /** Researcher system prompt override. Defaults to the evidence-capture
   * posture below; retrieval phases pass a KB-aware prompt here. */
  systemPrompt?: string
}

// A11.3. Loop detection at unit granularity. A unit that acts (issues tool
// calls) but adds zero new evidence is fruitless: the model is revisiting
// covered ground. maxFruitlessUnits consecutive fruitless units block the run
// with a reason. Genuinely new evidence resets the counter, so productive
// revision never trips it. Units that never act do not count either way, so
// zero-evidence refusal still reports as refused, not blocked.
export class StageMonitor {
  private fruitlessUnits = 0

  constructor(private readonly maxFruitlessUnits: number) {}

  noteUnit(toolCallsMade: number, newFindings: number): 'ok' | 'blocked' {
    if (toolCallsMade > 0 && newFindings === 0) {
      this.fruitlessUnits += 1
    } else {
      this.fruitlessUnits = 0
    }
    return this.fruitlessUnits >= this.maxFruitlessUnits ? 'blocked' : 'ok'
  }
}

function findingFromToolResult(result: ToolResult): Finding | undefined {
  if (result.isError || result.toolName !== 'evidence.capture') return undefined
  try {
    const parsed: unknown = JSON.parse(result.content)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const record = parsed as Record<string, unknown>
    const excerpt = record['excerpt']
    const docId = record['docId']
    const url = record['url']
    if (typeof excerpt !== 'string' || typeof docId !== 'string' || typeof url !== 'string') {
      return undefined
    }
    return captureFinding({ claim: excerpt, docId, url, excerpt })
  } catch {
    return undefined
  }
}

export async function runResearchWorkflow(input: ResearchInput): Promise<ResearchOutcome> {
  if (!input.scope.trim()) return { outcome: 'blocked', reasons: ['scope must be non-empty'] }
  const preflight = runPreflight(
    {
      scope: input.scope,
      estimatedTokens: input.questions.length * 2_000,
      tokenBudget: input.limits.maxTokens,
      tokenUsed: 0,
      requiredTools: ['hound.search', 'documents.get', 'evidence.capture'],
      reachableTools: input.buildRegistry().listDefinitions().map((tool) => tool.name),
      duplicateRunning: false,
      expectedPolicyVersion: input.policyVersion,
      actualPolicyVersion: input.policyVersion,
    },
    input.clock,
  )
  if (!preflight.ok) return { outcome: 'blocked', reasons: preflight.reasons }

  if (input.resumeFrom && input.resumeFrom.scope !== input.scope) {
    return { outcome: 'blocked', reasons: ['checkpoint scope mismatch: resume scope must equal run scope'] }
  }
  // A11.1/A11.2. Settled stages come forward as facts: their findings seed
  // the report and their questions are never sent to the provider again.
  const settled = new Map((input.resumeFrom?.completed ?? []).map((stage) => [stage.question, stage]))
  const seenHashes = new Set<string>()
  const findings: Finding[] = []
  const completed: ResearchStageCheckpoint[] = []
  for (const stage of input.resumeFrom?.completed ?? []) {
    for (const finding of stage.findings) {
      if (!seenHashes.has(finding.contentHash)) {
        seenHashes.add(finding.contentHash)
        findings.push(finding)
      }
    }
    completed.push(stage)
  }
  // Budgets accumulate across the resume chain: a resumed run inherits the
  // elapsed time of the checkpoint, so the same numeric budget trips again
  // unless the operator approves an extension.
  const runStart = input.clock.now() - (input.resumeFrom?.elapsedMs ?? 0)
  const checkpoint = (): ResearchCheckpoint => ({
    version: 1,
    scope: input.scope,
    completed: [...completed],
    elapsedMs: input.clock.now() - runStart,
  })
  const suspended = (reason: string): ResearchOutcome => ({ outcome: 'suspended', reason, findings: [...findings], checkpoint: checkpoint() })
  const monitor = new StageMonitor(input.governor.maxFruitlessUnits)
  const units = input.questions.slice(0, input.governor.maxUnits)
  let unitsRun = 0
  for (const question of units) {
    if (settled.has(question)) continue
    // A11.4. Run budget is checked before each unit: breach suspends with
    // the cursor, never silently and never by running on indefinitely.
    if (input.clock.now() - runStart >= input.governor.maxRunWallMs) {
      return suspended(`run wall-clock budget exceeded after ${completed.length} of ${units.length} stages`)
    }
    const unit = await runResearchUnit(input, question)
    if (unit.suspended) return suspended(unit.suspended)
    const fresh = unit.findings.filter((finding) => !seenHashes.has(finding.contentHash))
    for (const finding of fresh) {
      seenHashes.add(finding.contentHash)
      findings.push(finding)
    }
    completed.push({ question, findings: unit.findings })
    unitsRun += 1
    if (monitor.noteUnit(unit.toolCallsMade, fresh.length) === 'blocked') {
      return {
        outcome: 'blocked',
        reasons: [
          `research loop: ${input.governor.maxFruitlessUnits} consecutive units acted without new evidence (last: '${question}')`,
        ],
      }
    }
  }
  if (findings.length === 0) {
    return { outcome: 'refused', reason: 'zero evidence captured: refusing to report' }
  }
  return { outcome: 'reported', report: assembleReport(findings), findings, unitsRun, checkpoint: checkpoint() }
}

interface ResearchUnitResult {
  findings: Finding[]
  toolCallsMade: number
  /** Set when the unit wall-clock budget trips mid-unit (A11.4). */
  suspended?: string
}

async function runResearchUnit(input: ResearchInput, question: string): Promise<ResearchUnitResult> {
  const run = createRun()
  transition(run, 'RUNNING')
  const history: ChatMessage[] = [
    { role: 'user', text: `Research brief [${input.scope}]: ${question}` },
  ]
  const turnCtx = {
    run,
    provider: input.provider,
    registry: input.buildRegistry(),
    history,
    systemPrompt: input.systemPrompt ?? 'You are a researcher. Capture evidence for every claim.',
    budgets: new BudgetTracker(input.limits, input.clock),
    repetition: new RepetitionTracker(),
    executions: new IdempotencyLog(),
    results: new Map<string, ToolResult>(),
    clock: input.clock,
  }
  const unitStart = input.clock.now()
  const findings: Finding[] = []
  let toolCallsMade = 0
  for (let turn = 0; turn < input.governor.maxReactTurns; turn++) {
    // A11.4. Unit budget is checked before each turn: the run suspends at
    // the cursor instead of letting one stage burn unbounded time.
    if (input.clock.now() - unitStart >= input.governor.maxUnitWallMs) {
      return { findings, toolCallsMade, suspended: `unit wall-clock budget exceeded on '${question}'` }
    }
    let outcome: Awaited<ReturnType<typeof runTurn>>
    try {
      outcome = await runTurn(turnCtx)
    } catch {
      break
    }
    toolCallsMade += outcome.response.toolCalls.length
    if (outcome.turn.outcome === 'acted') {
      for (const result of outcome.turn.results) {
        const finding = findingFromToolResult(result)
        if (finding) findings.push(finding)
      }
      continue
    }
    break
  }
  return { findings, toolCallsMade }
}
