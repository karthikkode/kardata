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
  /** Research field this claim covers (outline field name). Absent means
   * uncovered: coverage validation counts only tagged findings. */
  field?: string
  /** Aspects of this claim that stay unverified. Uncertain claims report
   * under their own section, never silently beside certain ones. */
  uncertain?: string[]
}

export function captureFinding(input: {
  claim: string
  docId: string
  url: string
  excerpt: string
  field?: string
  uncertain?: string[]
}): Finding {
  const claim = input.claim.trim()
  const docId = input.docId.trim()
  const url = input.url.trim()
  const excerpt = input.excerpt.trim()
  if (!claim || !docId || !url || !excerpt) {
    throw new Error('finding needs claim, docId, url, and excerpt: claims without sources are rejected')
  }
  const field = input.field?.trim() || undefined
  const uncertain = (input.uncertain ?? []).map((entry) => entry.trim()).filter((entry) => entry.length > 0)
  const contentHash = createHash('sha256').update(`${docId}\n${url}\n${excerpt}`).digest('hex')
  return {
    claim,
    docId,
    url,
    excerpt,
    contentHash,
    ...(field === undefined ? {} : { field }),
    ...(uncertain.length === 0 ? {} : { uncertain }),
  }
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
  const uncertain = unique.filter((finding) => (finding.uncertain ?? []).length > 0)
  if (uncertain.length > 0) {
    lines.push('', '## Uncertain')
    for (const finding of uncertain) {
      lines.push(`- [${finding.claim}](${finding.url}) (${(finding.uncertain ?? []).join(', ')})`)
    }
  }
  return lines.join('\n')
}

// Research outline (two-phase adoption): the confirmed plan behind a run.
// Items name what gets researched, fields name what gets collected per
// item, batch bounds the fan-out. Built before any provider call; the
// human confirms it before deep research starts.
export type ResearchDetailLevel = 'brief' | 'moderate' | 'detailed'

export interface ResearchFieldDef {
  name: string
  description: string
  detailLevel: ResearchDetailLevel
  /** Opt-in marker: when ANY field carries it, only marked fields are
   * required. Without markers every field is required, so coverage can
   * never pass vacuously. */
  required?: boolean
}

export interface ResearchOutlineItem {
  name: string
  description?: string
}

export interface ResearchOutline {
  version: 1
  topic: string
  items: ResearchOutlineItem[]
  fields: ResearchFieldDef[]
  batch: { batchSize: number; itemsPerAgent: number }
}

const DETAIL_LEVELS: ResearchDetailLevel[] = ['brief', 'moderate', 'detailed']

export function buildOutline(input: {
  topic: string
  items: ResearchOutlineItem[]
  fields: ResearchFieldDef[]
  batch: { batchSize: number; itemsPerAgent: number }
}): ResearchOutline {
  const topic = input.topic.trim()
  if (!topic) throw new Error('outline needs a non-empty topic')
  if (input.items.length === 0) throw new Error('outline needs at least one item')
  const items = input.items.map((item) => {
    const name = item.name.trim()
    if (!name) throw new Error('outline items need non-empty names')
    const description = item.description?.trim() || undefined
    return description === undefined ? { name } : { name, description }
  })
  if (input.fields.length === 0) throw new Error('outline needs at least one field')
  const fields = input.fields.map((field) => {
    const name = field.name.trim()
    const description = field.description.trim()
    if (!name || !description) throw new Error('outline fields need non-empty names and descriptions')
    if (!DETAIL_LEVELS.includes(field.detailLevel)) throw new Error(`unknown detail level '${field.detailLevel}'`)
    return { name, description, detailLevel: field.detailLevel, ...(field.required === undefined ? {} : { required: field.required }) }
  })
  const { batchSize, itemsPerAgent } = input.batch
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer')
  if (!Number.isInteger(itemsPerAgent) || itemsPerAgent < 1) throw new Error('itemsPerAgent must be a positive integer')
  return { version: 1, topic, items, fields, batch: { batchSize, itemsPerAgent } }
}

/** Coverage gate: every required field needs at least one tagged finding.
 * Uncertain-tagged findings still count as coverage (their doubt is
 * flagged, not hidden); untagged findings cover nothing. Empty input or
 * an uncovered field throws naming the field. */
export function validateFindingsCoverage(findings: Finding[], fields: ResearchFieldDef[]): void {
  const required = fields.some((field) => field.required !== undefined)
    ? fields.filter((field) => field.required === true).map((field) => field.name)
    : fields.map((field) => field.name)
  const covered = new Set(findings.map((finding) => finding.field).filter((field) => field !== undefined))
  const missing = required.filter((name) => !covered.has(name))
  if (missing.length > 0) {
    throw new Error(`findings miss required fields: ${missing.join(', ')}`)
  }
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
