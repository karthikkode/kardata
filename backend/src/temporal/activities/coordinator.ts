import { createHash } from 'node:crypto'
import { Context } from '@temporalio/activity'
import { z } from 'zod'
import type { Scope } from '../../auth/keys.js'
import { appendEvent, closeDiscovery, createArtifact, ensureResearchSession, getSector, readGlobalContext, readResearchProgress, recordResearchBudget, readSectorPlan, recordLedgerProblem, registerSectorDiscovery, registerLedgerCandidate, readSectorExecutionState, recordResearchWork, setCompanyStage, setCompanyState, setSectorState, upsertLedgerCompany, workerPoolFromEnv, workspaceTransaction, type PlanVersion } from '../../db/index.js'
import { projectNewEvents } from '../../projector.js'
import { createLogger, logOp } from '../../observability/logging.js'
import { extractNewDomains, sectorSignals } from '../sweep-rules.js'
import type { WorkItem } from '../research-plan.js'
import { recordSweepCompanyActivity, searchWebPageActivity } from './sweep.js'
import type { TurnOutcome } from './turn.js'
import { validateDiscoveryIntake } from '../discovery-intake.js'
import type { CandidateCompany } from '../sweep-rules.js'
import { discoverySample, validateDiscoveryAcceptance } from '../discovery-acceptance.js'

export interface CoordinatorInput { sectorId: string; scope?: Scope; /** Isolated harness queue override; never accepted by product APIs. */ turnTaskQueue?: string }
const logger = createLogger({ op: 'research.coordinator' })
export async function loadCoordinatorActivity(input: CoordinatorInput) {
  return logOp(logger, 'research.load', async () => {
    const db = workerPoolFromEnv()
    await projectNewEvents(db)
    const sector = await getSector(db, input.sectorId, input.scope)
    const plan = await readSectorPlan(db, input.sectorId, input.scope)
    const approved = plan?.versions.find((version) => version.version === plan.approvedVersion)
    if (!sector || !approved?.executable) throw new Error('Review an executable research plan before starting.')
    const session = await ensureResearchSession(db, input.sectorId, input.scope)
    const context = await readGlobalContext(db, input.sectorId, input.scope)
    return { sector, plan: approved as PlanVersion & { executable: NonNullable<PlanVersion['executable']> }, sessionId: session.id, approvedScope: plan?.approvedContext?.scope, context, progress: await readResearchProgress(db, input.sectorId, input.scope) }
  })
}
export async function researchCheckpointActivity(input: CoordinatorInput & { version: number; item: WorkItem }) {
  return logOp(logger, 'research.checkpoint', () => recordResearchWork(workerPoolFromEnv(), { ...input, planVersion: input.version }))
}
export async function researchBudgetActivity(input: CoordinatorInput & { runId: string; spentMs: number; checkpoint: number }) {
  return logOp(logger, 'research.budget.checkpoint', () => recordResearchBudget(workerPoolFromEnv(), input))
}
export async function researchSearchActivity(input: CoordinatorInput & { version: number; query: string; page: number; seen: string[]; remaining: number; basicFiltering?: boolean; sourceIntake?: boolean }) {
  return logOp(logger, 'research.discovery', async () => {
    const db = workerPoolFromEnv()
    await projectNewEvents(db)
    const sector = await getSector(db, input.sectorId, input.scope)
    if (!sector) throw new Error('Sector unavailable')
    const plan = await readSectorPlan(db, input.sectorId, input.scope)
    const depth = plan?.versions.find((version) => version.version === input.version)?.executable?.researchDepth
    const hits = await searchWebPageActivity({ query: input.query, page: input.page })
    const screened = extractNewDomains(hits, input.seen, sectorSignals(sector.name, sector.topic), input.basicFiltering)
    const candidates = input.sourceIntake ? screened : screened.slice(0, input.remaining)
    if (input.sourceIntake) return { domains: [], candidates: candidates.map((candidate) => ({ ...candidate, intakeKey: createHash('sha256').update(candidate.domain).digest('hex') })), exhausted: hits.length === 0 }
    for (const company of candidates) {
      Context.current().heartbeat({ op: 'research.discovery', sectorId: input.sectorId })
      const { companyId } = await recordSweepCompanyActivity({ sectorId: input.sectorId, scope: input.scope, company: { ...company, sectorName: sector.name } })
      await recordResearchWork(db, { sectorId: input.sectorId, planVersion: input.version, scope: input.scope, item: { id: `${input.sectorId}:v${input.version}:${companyId}`, kind: 'company', title: company.name, state: depth === 'discovery' ? 'complete' : 'pending', attempts: 0, childId: depth === 'discovery' ? null : `research-${input.sectorId}-v${input.version}-${companyId}`, sourceUrl: company.url, evidence: [], detail: depth === 'discovery' ? 'Discovered from search results. Company deep research has not run.' : '' } })
    }
    return { domains: candidates.map((company) => company.domain), exhausted: hits.length === 0 }
  })
}
export async function researchIntakeActivity(input: CoordinatorInput & { version: number; sessionId: string; item: WorkItem; candidate: CandidateCompany; outcome: TurnOutcome }) {
  return logOp(logger, 'research.discovery.intake', async () => {
    const result = validateDiscoveryIntake(input.outcome, input.candidate)
    const db = workerPoolFromEnv()
    await projectNewEvents(db)
    // The exact validated receipt is inspectable in the existing sector library.
    await createArtifact(db, { sessionId: input.sessionId, name: `${input.candidate.domain} intake.md`, content: ['# Basic company intake', `Company: ${result.name}`, `Decision: ${result.decision}`, `Plan version: ${input.version}`, result.reason, ...(['identity', 'geography', 'sector'] as const).flatMap((field) => { const evidence = result[field]; return evidence ? [`## ${field[0]!.toUpperCase()}${field.slice(1)}`, `[Source](${evidence.url})`, `> ${evidence.excerpt.replace(/\n/g, '\n> ')}`] : [] }), 'Company size: unknown unless separately evidenced. No company deep research was performed.'].join('\n\n'), producedBy: `agent:${input.item.childId}`, reason: 'subagent_output', artifactId: `intake-${input.item.childId}-${Context.current().info.workflowExecution?.runId ?? Context.current().info.activityId}`, scope: input.scope })
    return workspaceTransaction(db, input.sectorId, async (tx) => {
      const plan = await readSectorPlan(tx, input.sectorId, input.scope)
      if (plan?.latest?.version !== input.version || plan.approvedVersion !== input.version) throw new Error('Intake plan changed; publication requires renewed review.')
      const sector = await getSector(tx, input.sectorId, input.scope)
      const context = await readGlobalContext(tx, input.sectorId, input.scope)
      if (!sector || (plan.approvedContext && plan.approvedContext.scope !== context.sections.scope)) throw new Error('Approved research scope changed.')
      const executionState = await readSectorExecutionState(tx, input.sectorId, input.scope)
      if (executionState === 'paused') return { accepted: false, deferred: true, limited: false }
      if (executionState !== 'running') throw new Error('Research is not running.')
      if (result.decision === 'accept') {
        const progress = await readResearchProgress(tx, input.sectorId, input.scope)
        const companies = progress.items.filter((entry) => entry.kind === 'company')
        const existing = companies.some((entry) => entry.sourceUrl && new URL(entry.sourceUrl).hostname.replace(/^www\./, '') === input.candidate.domain)
        const limit = plan.latest.executable?.budgets.maxCompanies
        if (!limit || (!existing && companies.length >= limit)) {
          await recordResearchWork(tx, { sectorId: input.sectorId, planVersion: input.version, scope: input.scope, item: { ...input.item, state: 'blocked', detail: 'Approved company limit reached. Owner review and a revised limit are required.' } })
          return { accepted: false, deferred: false, limited: true }
        }
        await registerLedgerCandidate(tx, { domain: input.candidate.domain, name: result.name, sector: sector.name })
        const { companyId } = await registerSectorDiscovery(tx, { sectorId: input.sectorId, name: result.name, domain: input.candidate.domain, scope: input.scope })
        await recordResearchWork(tx, { sectorId: input.sectorId, planVersion: input.version, scope: input.scope, item: { id: `${input.sectorId}:v${input.version}:${companyId}`, kind: 'company', title: result.name, state: 'complete', attempts: 0, childId: null, sourceUrl: input.candidate.url, evidence: [result.identity!.url, result.geography!.url, result.sector!.url], detail: 'Source-backed basic intake passed. Company deep research has not run.' } })
      }
      await recordResearchWork(tx, { sectorId: input.sectorId, planVersion: input.version, scope: input.scope, item: { ...input.item, state: result.decision === 'uncertain' ? 'blocked' : 'complete', evidence: [result.identity, result.geography, result.sector].flatMap((entry) => entry ? [entry.url] : []), detail: `${result.decision}: ${result.reason}` } })
      return { accepted: result.decision === 'accept', deferred: false, limited: false }
    })
  })
}
export async function researchDiscoveryAcceptanceActivity(input: CoordinatorInput & { version: number; sessionId: string; item: WorkItem; outcomes: TurnOutcome[] }) {
  return logOp(logger, 'research.discovery.acceptance', async () => {
    const db = workerPoolFromEnv()
    const progress = await readResearchProgress(db, input.sectorId, input.scope)
    const plan = progress.plan?.versions.find((version) => version.version === input.version)?.executable
    if (!plan) throw new Error('Approved plan is unavailable for validation.')
    const companies = progress.items.filter((item) => item.kind === 'company')
    if (companies.length < (plan.discoveryTarget ?? 1)) throw new Error('The approved discovery target has not been reached.')
    const sample = discoverySample(companies)
    const verifiedParts = input.outcomes.map((outcome, index) => validateDiscoveryAcceptance(outcome, sample.slice(index * 10, (index + 1) * 10), plan.acceptance))
    const combined = { checks: plan.acceptance.map((criterion) => ({ criterion, met: verifiedParts.every((part) => part.checks.some((check) => check.criterion === criterion && check.met)), evidence: verifiedParts.flatMap((part) => part.checks.find((check) => check.criterion === criterion)?.evidence ?? []) })), sample: verifiedParts.flatMap((part) => part.sample) }
    const verified = validateDiscoveryAcceptance({ reply: JSON.stringify(combined), sources: input.outcomes.flatMap((outcome) => outcome.sources ?? []), toolCalls: [] }, sample, plan.acceptance)
    const report = ['# Discovery acceptance', `Population count: ${companies.length} discovered companies. Approved target: ${plan.discoveryTarget ?? 1}.`, `Evidence review covers a reproducibly selected sample of ${verified.sample.length} companies. Identity, geography and sector checks have not been established individually for the remainder of the population.`, '## Approved criteria: sampled evidence review', ...verified.checks.map((check) => `- ${check.criterion}: passed for the reviewed sample`), '## Source-backed sample', ...verified.sample.map((entry) => `### ${companies.find((item) => item.id === entry.id)?.title ?? entry.id}\n\n[Company source](${entry.url})\n\n> ${entry.excerpt}`)].join('\n\n')
    await createArtifact(db, { sessionId: input.sessionId, name: 'Discovery acceptance report.md', content: report, producedBy: input.sessionId, reason: 'report', artifactId: `discovery-acceptance-${input.sectorId}-v${input.version}-${Context.current().info.workflowExecution?.runId ?? Context.current().info.activityId}`, scope: input.scope })
    await appendEvent(db, { idempotencyKey: `discovery-accepted:${input.sectorId}:v${input.version}:${Context.current().info.workflowExecution?.runId ?? Context.current().info.activityId}`, partition: `sector:${input.sectorId}`, type: 'sector.discovery.validated', payload: { planVersion: input.version, total: companies.length, checks: verified.checks, sample: verified.sample } })
    await recordResearchWork(db, { sectorId: input.sectorId, planVersion: input.version, scope: input.scope, item: { ...input.item, state: 'complete', evidence: verified.sample.map((entry) => entry.url), detail: `${companies.length} companies discovered; ${verified.sample.length} source-backed sample entries passed approved acceptance.` } })
    return verified
  })
}
export async function researchDiscoveryClosedActivity(input: CoordinatorInput) {
  return logOp(logger, 'research.discovery.closed', () => closeDiscovery(workerPoolFromEnv(), input.sectorId))
}
export async function researchLifecycleActivity(input: CoordinatorInput & { state: 'running' | 'complete' | 'failed' | 'paused'; planVersion?: number }) {
  return logOp(logger, 'research.lifecycle', async () => {
    const db = workerPoolFromEnv()
    await projectNewEvents(db)
    await workspaceTransaction(db, input.sectorId, async (tx) => {
      const sector = await getSector(tx, input.sectorId, input.scope)
      if (input.planVersion !== undefined && (await readSectorPlan(tx, input.sectorId, input.scope))?.latest?.version !== input.planVersion) {
        logger.info({ event: 'research.lifecycle.superseded', sectorId: input.sectorId, planVersion: input.planVersion })
        return
      }
      if (sector?.state !== input.state) await setSectorState(tx, input.sectorId, input.state, { scope: input.scope })
    })
    await projectNewEvents(db)
  })
}
const Verdict = z.object({
  qualification: z.enum(['qualified','disqualified']), reason: z.string().min(1).max(2000),
  findings: z.array(z.object({ claim: z.string().min(1), url: z.string().url(), excerpt: z.string().min(1) }).strict()).min(1),
  problems: z.array(z.object({ problem: z.string().min(1).max(2000), mechanism: z.string().max(2000), costEvidence: z.string().max(2000), sourceUrl: z.string().url(), status: z.enum(['candidate','worthy','rejected']) }).strict()),
  acceptanceMet: z.boolean(),
}).strict()
export function evidenceVerdict(outcome: TurnOutcome) {
  if (outcome.haltNotice) throw new Error(outcome.haltNotice)
  const fenced = outcome.reply.match(/```research-result\s*\n([\s\S]*?)```/)
  const verdict = Verdict.parse(JSON.parse(fenced?.[1] ?? outcome.reply))
  if (!verdict.acceptanceMet) throw new Error('The researcher has not met the approved acceptance criteria.')
  for (const finding of verdict.findings) {
    const source = outcome.sources?.find((entry) => entry.url === finding.url)
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
    if (!source || !normalize(source.text).includes(normalize(finding.excerpt))) throw new Error('A finding was not supported by a fetched source excerpt.')
  }
  for (const problem of verdict.problems) if (!verdict.findings.some((finding) => finding.url === problem.sourceUrl)) throw new Error('A problem is missing fetched evidence.')
  return verdict
}
export async function researchVerdictActivity(input: CoordinatorInput & { version: number; sessionId: string; item: WorkItem; outcome: TurnOutcome }) {
  return logOp(logger, 'research.verdict', async () => {
    const db = workerPoolFromEnv()
    const verdict = evidenceVerdict(input.outcome)
    const url = new URL(input.item.sourceUrl ?? input.item.evidence[0] ?? '')
    const domain = url.hostname.replace(/^www\./, '')
    await createArtifact(db, { sessionId: input.sessionId, name: `${input.item.title} research.md`, content: input.outcome.reply.replace(/```research-result[\s\S]*?```/g, '').trim() || verdict.reason, producedBy: `agent:${input.item.childId}`, reason: 'subagent_output', artifactId: `report-${input.item.childId}-${Context.current().info.workflowExecution?.runId ?? Context.current().info.activityId}`, scope: input.scope })
    await workspaceTransaction(db, input.item.id, async (tx) => {
      const progress = await readResearchProgress(tx, input.sectorId, input.scope)
      if (progress.items.find((item) => item.id === input.item.id)?.state === 'complete') return
      const sector = await getSector(tx, input.sectorId, input.scope)
      const company = await upsertLedgerCompany(tx, { domain, name: input.item.title, sector: sector?.name ?? '', qualification: verdict.qualification, qualificationReason: verdict.reason })
      for (const problem of verdict.problems) await recordLedgerProblem(tx, { companyId: company.id, ...problem })
      await recordResearchWork(tx, { sectorId: input.sectorId, planVersion: input.version, scope: input.scope, item: { ...input.item, state: 'complete', evidence: verdict.findings.map((finding) => finding.url), detail: verdict.reason } })
      const companyId = input.item.id.split(':').at(-1) ?? ''
      await setCompanyStage(tx, companyId, verdict.problems.some((problem) => problem.status === 'worthy') ? 'Problem found' : 'Final validation', { scope: input.scope, idempotencyKey: `research-stage:${input.item.id}` })
      await setCompanyState(tx, companyId, 'complete', { scope: input.scope, idempotencyKey: `research-complete:${input.item.id}` })
    })
    await projectNewEvents(db)
    return { detail: verdict.reason, evidence: verdict.findings.map((finding) => finding.url) }
  })
}
