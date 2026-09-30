import { Context } from '@temporalio/activity'
import { z } from 'zod'
import type { Scope } from '../../auth/keys.js'
import { closeDiscovery, createArtifact, ensureResearchSession, getSector, readGlobalContext, readResearchProgress, readSectorPlan, recordLedgerProblem, recordResearchWork, setCompanyStage, setCompanyState, setSectorState, upsertLedgerCompany, workerPoolFromEnv, workspaceTransaction, type PlanVersion } from '../../db/index.js'
import { projectNewEvents } from '../../projector.js'
import { createLogger, logOp } from '../../observability/logging.js'
import { extractNewDomains, sectorSignals } from '../sweep-rules.js'
import type { WorkItem } from '../research-plan.js'
import { recordSweepCompanyActivity, searchWebPageActivity } from './sweep.js'
import type { TurnOutcome } from './turn.js'

export interface CoordinatorInput { sectorId: string; scope?: Scope }
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
    return { sector, plan: approved as PlanVersion & { executable: NonNullable<PlanVersion['executable']> }, sessionId: session.id, context, progress: await readResearchProgress(db, input.sectorId, input.scope) }
  })
}
export async function researchCheckpointActivity(input: CoordinatorInput & { version: number; item: WorkItem }) {
  return logOp(logger, 'research.checkpoint', () => recordResearchWork(workerPoolFromEnv(), { ...input, planVersion: input.version }))
}
export async function researchSearchActivity(input: CoordinatorInput & { version: number; query: string; page: number; seen: string[]; remaining: number }) {
  return logOp(logger, 'research.discovery', async () => {
    const db = workerPoolFromEnv()
    await projectNewEvents(db)
    const sector = await getSector(db, input.sectorId, input.scope)
    if (!sector) throw new Error('Sector unavailable')
    const hits = await searchWebPageActivity({ query: input.query, page: input.page })
    const candidates = extractNewDomains(hits, input.seen, sectorSignals(sector.name, sector.topic)).slice(0, input.remaining)
    for (const company of candidates) {
      Context.current().heartbeat({ op: 'research.discovery', sectorId: input.sectorId })
      const { companyId } = await recordSweepCompanyActivity({ sectorId: input.sectorId, scope: input.scope, company: { ...company, sectorName: sector.name } })
      await recordResearchWork(db, { sectorId: input.sectorId, planVersion: input.version, scope: input.scope, item: { id: `${input.sectorId}:v${input.version}:${companyId}`, kind: 'company', title: company.name, state: 'pending', attempts: 0, childId: `research-${input.sectorId}-v${input.version}-${companyId}`, sourceUrl: company.url, evidence: [], detail: '' } })
    }
    return candidates.map((company) => company.domain)
  })
}
export async function researchDiscoveryClosedActivity(input: CoordinatorInput) {
  return logOp(logger, 'research.discovery.closed', () => closeDiscovery(workerPoolFromEnv(), input.sectorId))
}
export async function researchLifecycleActivity(input: CoordinatorInput & { state: 'running' | 'complete' | 'failed' | 'paused' }) {
  return logOp(logger, 'research.lifecycle', async () => {
    const db = workerPoolFromEnv()
    await projectNewEvents(db)
    const sector = await getSector(db, input.sectorId, input.scope)
    if (sector?.state !== input.state) await setSectorState(db, input.sectorId, input.state, { scope: input.scope })
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
    await createArtifact(db, { sessionId: input.sessionId, name: `${input.item.title} research.md`, content: input.outcome.reply.replace(/```research-result[\s\S]*?```/g, '').trim() || verdict.reason, producedBy: `agent:${input.item.childId}`, reason: 'subagent_output', artifactId: `report-${input.item.childId}`, scope: input.scope })
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
