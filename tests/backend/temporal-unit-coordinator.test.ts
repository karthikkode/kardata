// Pure unit tests for sector coordinator activities: executable gating,
// work-item transport budgets, checkpoint dedupe, discovery search/intake,
// acceptance validation, lifecycle guards, and evidence verdicts.
// No database, no Temporal server.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApplicationFailure } from '@temporalio/activity'
import { MockActivityEnvironment } from '@temporalio/testing'
import {
  evidenceVerdict,
  loadCoordinatorActivity,
  researchCheckpointActivity,
  researchDiscoveryAcceptanceActivity,
  researchIntakeActivity,
  researchLifecycleActivity,
  researchSearchActivity,
  researchVerdictActivity,
  researchWorkItemActivity,
} from '../../backend/src/temporal/activities/coordinator.js'

const db = vi.hoisted(() => ({
  pool: {},
  project: vi.fn(),
  reviewSequence: vi.fn(),
  hydrate: vi.fn(),
  persistSource: vi.fn(),
  archive: vi.fn(),
  search: vi.fn(),
  recordCompany: vi.fn(),
  append: vi.fn(),
  closeDiscovery: vi.fn(),
  artifact: vi.fn(),
  ensureSession: vi.fn(),
  sector: vi.fn(),
  session: vi.fn(),
  sessionKind: vi.fn(),
  globalContext: vi.fn(),
  progress: vi.fn(),
  publication: vi.fn(),
  coordinatorProgress: vi.fn(),
  workItem: vi.fn(),
  intakeReceipts: vi.fn(),
  budget: vi.fn(),
  recordBudget: vi.fn(),
  plan: vi.fn(),
  ledgerProblem: vi.fn(),
  registerDiscovery: vi.fn(),
  registerCandidate: vi.fn(),
  executionState: vi.fn(),
  recordWork: vi.fn(),
  companyStage: vi.fn(),
  companyState: vi.fn(),
  sectorState: vi.fn(),
  upsertCompany: vi.fn(),
  transact: vi.fn(),
}))
vi.mock('../../backend/src/projector.js', () => ({ projectNewEvents: db.project }))
vi.mock('../../backend/src/db/work-review.js', () => ({ readResearchWorkReviewSequence: db.reviewSequence }))
vi.mock('../../backend/src/archive/targets.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/archive/targets.js')>()),
  hydrateResearchSources: db.hydrate,
  persistResearchSource: db.persistSource,
  resolveArchiveTarget: db.archive,
}))
vi.mock('../../backend/src/temporal/activities/sweep.js', () => ({ recordSweepCompanyActivity: db.recordCompany, searchWebPageActivity: db.search }))
vi.mock('../../backend/src/db/index.js', async (original) => ({
  ...(await original<typeof import('../../backend/src/db/index.js')>()),
  workerPoolFromEnv: () => db.pool,
  appendEvent: db.append,
  closeDiscovery: db.closeDiscovery,
  createArtifact: db.artifact,
  ensureResearchSession: db.ensureSession,
  getSector: db.sector,
  getSession: db.session,
  sessionKind: db.sessionKind,
  readGlobalContext: db.globalContext,
  readResearchProgress: db.progress,
  readDiscoveryPublicationState: db.publication,
  readResearchCoordinatorProgress: db.coordinatorProgress,
  readResearchWorkItem: db.workItem,
  researchIntakeReceipts: db.intakeReceipts,
  readResearchBudget: db.budget,
  recordResearchBudget: db.recordBudget,
  readSectorPlan: db.plan,
  recordLedgerProblem: db.ledgerProblem,
  registerSectorDiscovery: db.registerDiscovery,
  registerLedgerCandidate: db.registerCandidate,
  readSectorExecutionState: db.executionState,
  recordResearchWork: db.recordWork,
  setCompanyStage: db.companyStage,
  setCompanyState: db.companyState,
  setSectorState: db.sectorState,
  upsertLedgerCompany: db.upsertCompany,
  workspaceTransaction: db.transact,
}))

const TX = {}
beforeEach(() => {
  vi.clearAllMocks()
  db.transact.mockImplementation(async (_db: unknown, _key: string, work: (tx: unknown) => Promise<unknown>) => work(TX))
  db.project.mockResolvedValue({ caughtUp: true })
  db.archive.mockReturnValue({})
  db.hydrate.mockImplementation(async (_archive: unknown, _session: string, outcome: unknown) => outcome)
})

function plan(version = 2, executable: Record<string, unknown> = { researchDepth: 'deep' }) {
  return { versions: [{ version, executable }], approvedVersion: version, latest: { version, executable }, approvedContext: null }
}
function verdictReply() {
  const verdict = {
    qualification: 'qualified',
    reason: 'Acme saves lens makers money.',
    findings: [{ claim: 'Acme cuts grinding cost', url: 'https://acme.test/evidence', excerpt: 'cuts grinding cost by half' }],
    problems: [{ problem: 'slow grinding', mechanism: 'old wheels', costEvidence: 'overtime bills', sourceUrl: 'https://acme.test/evidence', status: 'worthy' }],
    acceptanceMet: true,
  }
  return {
    reply: `Report text.\n\`\`\`research-result\n${JSON.stringify(verdict)}\n\`\`\``,
    sources: [{ url: 'https://acme.test/evidence', text: 'field notes: Acme cuts grinding cost by half every week' }],
    toolCalls: [],
  }
}

describe('loadCoordinatorActivity [F:backend.activity.coordinator.loadCoordinatorActivity] [F:backend.activity.coordinator.researchWorkItemActivity] [F:backend.activity.coordinator.researchCheckpointActivity] [F:backend.activity.coordinator.researchSearchActivity] [F:backend.activity.coordinator.researchIntakeActivity] [F:backend.activity.coordinator.researchDiscoveryAcceptanceActivity] [F:backend.activity.coordinator.researchLifecycleActivity] [F:backend.activity.coordinator.researchVerdictActivity] [F:backend.activity.coordinator.evidenceVerdict]', () => {
  it('requires a sector and an executable approved plan', async () => {
    db.sector.mockResolvedValue(null)
    db.plan.mockResolvedValue(plan())
    await expect(loadCoordinatorActivity({ sectorId: 'sec-1' })).rejects.toThrow('Review an executable research plan before starting.')
    db.sector.mockResolvedValue({ id: 'sec-1', state: 'running' })
    db.plan.mockResolvedValue(null)
    await expect(loadCoordinatorActivity({ sectorId: 'sec-1' })).rejects.toThrow('Review an executable research plan before starting.')
  })
  it('refuses compact state past the safe transport budget', async () => {
    db.sector.mockResolvedValue({ id: 'sec-1', state: 'running' })
    db.plan.mockResolvedValue(plan(2, { researchDepth: 'discovery' }))
    db.ensureSession.mockResolvedValue({ id: 'sess-r' })
    db.executionState.mockResolvedValue('running')
    db.globalContext.mockResolvedValue({ sections: { scope: 's', instructions: '', decisions: '', findings: '', questions: '' }, markdown: '', changes: [] })
    db.coordinatorProgress.mockResolvedValue({ sectorId: 'sec-1', items: Array.from({ length: 2000 }, (_, i) => ({ id: `w-${i}`, detail: 'x'.repeat(1000) })) })
    db.reviewSequence.mockResolvedValue([])
    const error = await loadCoordinatorActivity({ sectorId: 'sec-1', compactState: true }).then(() => null, (e: unknown) => e as InstanceType<typeof ApplicationFailure>)
    expect(error).toBeInstanceOf(ApplicationFailure)
    expect(error?.message).toContain('safe transport budget')
  })
})

describe('researchWorkItemActivity', () => {
  it('returns the item and refuses oversized transport', async () => {
    db.workItem.mockResolvedValue({ id: 'w1', detail: 'small' })
    await expect(researchWorkItemActivity({ sectorId: 'sec-1', version: 2, id: 'w1' })).resolves.toEqual({ id: 'w1', detail: 'small' })
    db.workItem.mockResolvedValue({ id: 'w1', detail: 'x'.repeat(1_600_000) })
    const error = await researchWorkItemActivity({ sectorId: 'sec-1', version: 2, id: 'w1' }).then(() => null, (e: unknown) => e as Error)
    expect(error?.message).toContain('safe transport budget')
  })
})

describe('researchCheckpointActivity', () => {
  const item = { id: 'sec-1:v2:co-1', kind: 'company', title: 'Acme', state: 'pending', attempts: 0, childId: null, evidence: [], detail: '' }
  it('keeps an excluded or superseded receipt instead of rewriting it', async () => {
    const excluded = { ...item, state: 'excluded' }
    db.workItem.mockResolvedValue(excluded)
    await expect(researchCheckpointActivity({ sectorId: 'sec-1', version: 2, item: item as never })).resolves.toBe(excluded)
    const intake = { ...item, id: 'sec-1:v2:intake:abc', receiptVersion: 2 }
    db.workItem.mockResolvedValue({ ...intake, receiptVersion: 1 })
    await expect(researchCheckpointActivity({ sectorId: 'sec-1', version: 2, item: intake as never })).resolves.toMatchObject({ receiptVersion: 1 })
    expect(db.recordWork).not.toHaveBeenCalled()
  })
  it('records fresh work and rethrows unexpected reads', async () => {
    db.workItem.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'not_found' })).mockResolvedValueOnce({ ...item, state: 'pending' })
    await expect(researchCheckpointActivity({ sectorId: 'sec-1', version: 2, item: item as never })).resolves.toMatchObject({ id: item.id })
    expect(db.recordWork).toHaveBeenCalled()
    db.workItem.mockRejectedValueOnce(new Error('store down'))
    await expect(researchCheckpointActivity({ sectorId: 'sec-1', version: 2, item: item as never })).rejects.toThrow('store down')
  })
})

describe('researchSearchActivity', () => {
  it('requires the sector', async () => {
    db.sector.mockResolvedValue(null)
    await expect(new MockActivityEnvironment().run(researchSearchActivity, { sectorId: 'sec-1', version: 2, query: 'lenses', page: 0, seen: [], remaining: 5 })).rejects.toThrow('Sector unavailable')
  })
  it('records deep-research companies with child turns', async () => {
    db.sector.mockResolvedValue({ id: 'sec-1', name: 'Optics', topic: 'precision lenses' })
    db.plan.mockResolvedValue(plan(2, { researchDepth: 'deep' }))
    db.search.mockResolvedValue([{ title: 'Acme lens works', url: 'https://acme.test/lenses', snippet: 'precision lenses' }])
    db.recordCompany.mockResolvedValue({ companyId: 'co-9' })
    const result = await new MockActivityEnvironment().run(researchSearchActivity, { sectorId: 'sec-1', version: 2, query: 'lenses', page: 0, seen: [], remaining: 5 })
    expect(result).toEqual({ domains: ['acme.test'], exhausted: false })
    expect(db.recordWork).toHaveBeenCalledWith(db.pool, expect.objectContaining({ item: expect.objectContaining({ state: 'pending', childId: 'research-sec-1-v2-co-9' }) }))
  })
  it('completes discovery-depth companies without child turns and reports exhaustion', async () => {
    db.sector.mockResolvedValue({ id: 'sec-1', name: 'Optics', topic: 'precision lenses' })
    db.plan.mockResolvedValue(plan(2, { researchDepth: 'discovery' }))
    db.search.mockResolvedValue([{ title: 'Acme lens works', url: 'https://acme.test/lenses', snippet: 'precision lenses' }])
    db.recordCompany.mockResolvedValue({ companyId: 'co-9' })
    const result = await new MockActivityEnvironment().run(researchSearchActivity, { sectorId: 'sec-1', version: 2, query: 'lenses', page: 0, seen: [], remaining: 5 })
    expect(result).toEqual({ domains: ['acme.test'], exhausted: false })
    expect(db.recordWork).toHaveBeenCalledWith(db.pool, expect.objectContaining({ item: expect.objectContaining({ state: 'complete', childId: null }) }))
    db.search.mockResolvedValue([])
    const empty = await new MockActivityEnvironment().run(researchSearchActivity, { sectorId: 'sec-1', version: 2, query: 'lenses', page: 3, seen: [], remaining: 5 })
    expect(empty).toEqual({ domains: [], exhausted: true })
  })
})

describe('researchIntakeActivity', () => {
  const item = { id: 'sec-1:v2:intake:abc', kind: 'company', title: 'Acme', state: 'running', attempts: 0, childId: 'research-1', evidence: [], detail: '' }
  const candidate = { domain: 'acme.test', name: 'Acme', url: 'https://acme.test/' }
  function acceptOutcome() {
    const result = {
      decision: 'accept', name: 'Acme Corp', reason: 'solid source backing',
      identity: { url: 'https://acme.test/about', excerpt: 'Acme Corp is a lens maker' },
      geography: { url: 'https://acme.test/geo', excerpt: 'based in Berlin Germany' },
      sector: { url: 'https://acme.test/sector', excerpt: 'makes precision lenses' },
    }
    return {
      reply: `notes\n\`\`\`intake-result\n${JSON.stringify(result)}\n\`\`\``,
      sources: [
        { url: 'https://acme.test/about', text: 'profile: Acme Corp is a lens maker since 1990' },
        { url: 'https://acme.test/geo', text: 'hq: based in Berlin Germany today' },
        { url: 'https://acme.test/sector', text: 'line: makes precision lenses daily' },
      ],
      toolCalls: [],
    }
  }
  function input(outcome: unknown) {
    return { sectorId: 'sec-1', version: 2, sessionId: 'sess-r', item: item as never, candidate, outcome: outcome as never }
  }
  function sessionOk() {
    db.session.mockResolvedValue({ id: 'sess-r', sectorId: 'sec-1' })
    db.sessionKind.mockResolvedValue('research')
  }
  function txOk() {
    db.workItem.mockResolvedValue({ ...item })
    db.plan.mockResolvedValue({ ...plan(), latest: { version: 2, executable: { budgets: { maxCompanies: 10 } } } })
    db.sector.mockResolvedValue({ id: 'sec-1', name: 'Optics' })
    db.globalContext.mockResolvedValue({ sections: { scope: 's' } })
    db.executionState.mockResolvedValue('running')
    db.publication.mockResolvedValue({ accepted: false, companyCount: 0 })
    db.registerDiscovery.mockResolvedValue({ companyId: 'co-1' })
  }
  it('denies intake from a foreign or non-research session', async () => {
    db.session.mockResolvedValue({ id: 'sess-r', sectorId: 'sec-other' })
    db.sessionKind.mockResolvedValue('research')
    const foreign = await new MockActivityEnvironment().run(researchIntakeActivity, input(acceptOutcome())).then(() => null, (e: unknown) => e as Error)
    expect(foreign?.message).toContain('not this sector research parent')
    db.session.mockResolvedValue({ id: 'sess-r', sectorId: 'sec-1' })
    db.sessionKind.mockResolvedValue('normal')
    const normal = await new MockActivityEnvironment().run(researchIntakeActivity, input(acceptOutcome())).then(() => null, (e: unknown) => e as Error)
    expect(normal?.message).toContain('not this sector research parent')
  })
  it('rejects intake without valid source backing', async () => {
    sessionOk()
    const error = await new MockActivityEnvironment().run(researchIntakeActivity, input({ reply: 'garbage', sources: [], toolCalls: [] })).then(() => null, (e: unknown) => e as Error)
    expect(error?.message).toContain('did not provide valid source-backed intake')
    expect(db.append).not.toHaveBeenCalled()
  })
  it('accepts source-backed intake and publishes the company', async () => {
    sessionOk()
    txOk()
    db.persistSource.mockImplementation(async (_archive: unknown, _session: string, source: unknown) => source)
    const result = await new MockActivityEnvironment().run(researchIntakeActivity, input(acceptOutcome()))
    expect(result).toEqual({ accepted: true, deferred: false, limited: false, decision: 'accept' })
    expect(db.registerDiscovery).toHaveBeenCalled()
    expect(db.recordWork).toHaveBeenCalledWith(TX, expect.objectContaining({ item: expect.objectContaining({ state: 'complete', title: 'Acme Corp' }) }))
    expect(db.artifact).toHaveBeenCalledWith(db.pool, expect.objectContaining({ name: 'acme.test intake.md' }))
  })
  it('keeps excluded and completed receipts untouched', async () => {
    sessionOk()
    txOk()
    db.workItem.mockResolvedValue({ ...item, state: 'excluded' })
    await expect(new MockActivityEnvironment().run(researchIntakeActivity, input(acceptOutcome()))).resolves.toMatchObject({ excluded: true, accepted: false })
    db.workItem.mockResolvedValue({ ...item, state: 'complete', detail: 'accept: done' })
    await expect(new MockActivityEnvironment().run(researchIntakeActivity, input(acceptOutcome()))).resolves.toMatchObject({ accepted: true, decision: 'accept' })
    expect(db.registerDiscovery).not.toHaveBeenCalled()
  })
  it('rejects superseded attempts, moved plans, and moved scope', async () => {
    sessionOk()
    txOk()
    db.workItem.mockResolvedValue({ ...item, attempts: 1 })
    const stale = await new MockActivityEnvironment().run(researchIntakeActivity, input(acceptOutcome())).then(() => null, (e: unknown) => e as Error)
    expect(stale?.message).toContain('superseded')
    db.workItem.mockResolvedValue({ ...item })
    db.plan.mockResolvedValue({ ...plan(), latest: { version: 3, executable: {} }, approvedVersion: 3 })
    await expect(new MockActivityEnvironment().run(researchIntakeActivity, input(acceptOutcome()))).rejects.toThrow('Intake plan changed')
    db.plan.mockResolvedValue({ ...plan(), latest: { version: 2, executable: {} }, approvedContext: { scope: 'moved' } })
    db.globalContext.mockResolvedValue({ sections: { scope: 'original' } })
    await expect(new MockActivityEnvironment().run(researchIntakeActivity, input(acceptOutcome()))).rejects.toThrow('Approved research scope changed.')
  })
  it('defers on owner pause and refuses stopped research', async () => {
    sessionOk()
    txOk()
    db.executionState.mockResolvedValue('paused')
    await expect(new MockActivityEnvironment().run(researchIntakeActivity, input(acceptOutcome()))).resolves.toEqual({ accepted: false, deferred: true, limited: false, decision: 'accept' })
    db.executionState.mockResolvedValue('complete')
    await expect(new MockActivityEnvironment().run(researchIntakeActivity, input(acceptOutcome()))).rejects.toThrow('Research is not running.')
  })
  it('blocks intake at the approved company limit', async () => {
    sessionOk()
    txOk()
    db.publication.mockResolvedValue({ accepted: false, companyCount: 10 })
    const result = await new MockActivityEnvironment().run(researchIntakeActivity, input(acceptOutcome()))
    expect(result).toEqual({ accepted: false, deferred: false, limited: true, decision: 'accept' })
    expect(db.registerDiscovery).not.toHaveBeenCalled()
  })
  it('records uncertain intake as blocked without publishing', async () => {
    sessionOk()
    txOk()
    const uncertain = { decision: 'uncertain', name: 'Acme', reason: 'thin sourcing' }
    const outcome = { reply: `notes\n\`\`\`intake-result\n${JSON.stringify(uncertain)}\n\`\`\``, sources: [], toolCalls: [] }
    const result = await new MockActivityEnvironment().run(researchIntakeActivity, input(outcome))
    expect(result).toEqual({ accepted: false, deferred: false, limited: false, decision: 'uncertain' })
    expect(db.registerDiscovery).not.toHaveBeenCalled()
    expect(db.recordWork).toHaveBeenCalledWith(TX, expect.objectContaining({ item: expect.objectContaining({ state: 'blocked' }) }))
  })
})

describe('researchDiscoveryAcceptanceActivity', () => {
  const item = { id: 'sec-1:v2:accept', kind: 'acceptance', title: 'accept', state: 'running', attempts: 0, childId: null, evidence: [], detail: '' }
  const company = { kind: 'company', id: 'sec-1:v2:co-1', title: 'Acme', sourceUrl: 'https://acme.test/' }
  function outcome() {
    const result = {
      checks: [{ criterion: 'criterion-a', met: true, evidence: ['https://acme.test/'] }],
      sample: [{ id: 'sec-1:v2:co-1', url: 'https://acme.test/', excerpt: 'Acme Corp makes lenses', isCompany: true, inGeography: true, inSector: true }],
    }
    return {
      reply: `review\n\`\`\`discovery-result\n${JSON.stringify(result)}\n\`\`\``,
      sources: [{ url: 'https://acme.test/', text: 'site: Acme Corp makes lenses here' }],
      toolCalls: [],
    }
  }
  function input() {
    return { sectorId: 'sec-1', version: 2, sessionId: 'sess-r', item: item as never, outcomes: [outcome()] as never }
  }
  it('requires the approved plan and its discovery target', async () => {
    db.progress.mockResolvedValue({ plan: null, items: [] })
    await expect(new MockActivityEnvironment().run(researchDiscoveryAcceptanceActivity, input())).rejects.toThrow('Approved plan is unavailable for validation.')
    db.progress.mockResolvedValue({ plan: { versions: [{ version: 2, executable: { discoveryTarget: 5, acceptance: ['criterion-a'] } }] }, items: [company] })
    await expect(new MockActivityEnvironment().run(researchDiscoveryAcceptanceActivity, input())).rejects.toThrow('discovery target has not been reached')
  })
  it('verifies the sample and records acceptance', async () => {
    db.progress.mockResolvedValue({ plan: { versions: [{ version: 2, executable: { discoveryTarget: 1, acceptance: ['criterion-a'] } }] }, items: [company] })
    db.plan.mockResolvedValue({ ...plan(), latest: { version: 2, executable: {} } })
    db.globalContext.mockResolvedValue({ sections: { scope: 's' } })
    db.executionState.mockResolvedValue('running')
    const result: Awaited<ReturnType<typeof researchDiscoveryAcceptanceActivity>> =
      await new MockActivityEnvironment().run(researchDiscoveryAcceptanceActivity, input())
    expect(result.deferred).toBe(false)
    expect(result.verified?.sample).toHaveLength(1)
    expect(db.artifact).toHaveBeenCalledWith(db.pool, expect.objectContaining({ name: 'Discovery acceptance report.md' }))
    expect(db.recordWork).toHaveBeenCalledWith(TX, expect.objectContaining({ item: expect.objectContaining({ state: 'complete' }) }))
  })
  it('denies superseded acceptance and defers on owner pause', async () => {
    db.progress.mockResolvedValue({ plan: { versions: [{ version: 2, executable: { discoveryTarget: 1, acceptance: ['criterion-a'] } }] }, items: [company] })
    db.plan.mockResolvedValue({ ...plan(), latest: { version: 3, executable: {} }, approvedVersion: 3 })
    db.globalContext.mockResolvedValue({ sections: { scope: 's' } })
    const moved = await new MockActivityEnvironment().run(researchDiscoveryAcceptanceActivity, input()).then(() => null, (e: unknown) => e as Error)
    expect(moved?.message).toContain('Acceptance plan or scope changed')
    db.plan.mockResolvedValue({ ...plan(), latest: { version: 2, executable: {} } })
    db.executionState.mockResolvedValue('paused')
    await expect(new MockActivityEnvironment().run(researchDiscoveryAcceptanceActivity, input())).resolves.toEqual({ deferred: true, verified: null })
    db.executionState.mockResolvedValue('complete')
    const stopped = await new MockActivityEnvironment().run(researchDiscoveryAcceptanceActivity, input()).then(() => null, (e: unknown) => e as Error)
    expect(stopped?.message).toContain('Research is not running.')
  })
})

describe('researchLifecycleActivity', () => {
  it('ignores terminal transitions for superseded plans', async () => {
    db.sector.mockResolvedValue({ id: 'sec-1', state: 'running' })
    db.plan.mockResolvedValue({ ...plan(), latest: { version: 3, executable: {} } })
    await expect(researchLifecycleActivity({ sectorId: 'sec-1', state: 'complete', planVersion: 2 })).resolves.toBe(false)
    expect(db.sectorState).not.toHaveBeenCalled()
  })
  it('preserves an owner pause across terminal reports', async () => {
    db.sector.mockResolvedValue({ id: 'sec-1', state: 'paused' })
    db.plan.mockResolvedValue(plan())
    db.executionState.mockResolvedValue('paused')
    await expect(researchLifecycleActivity({ sectorId: 'sec-1', state: 'failed' })).resolves.toBe(false)
  })
  it('applies state changes and projects around them', async () => {
    db.sector.mockResolvedValue({ id: 'sec-1', state: 'paused' })
    db.plan.mockResolvedValue(plan())
    db.executionState.mockResolvedValue('running')
    await expect(researchLifecycleActivity({ sectorId: 'sec-1', state: 'running' })).resolves.toBe(true)
    expect(db.sectorState).toHaveBeenCalledWith(TX, 'sec-1', 'running', { scope: undefined })
    expect(db.project).toHaveBeenCalledTimes(2)
  })
})

describe('evidenceVerdict', () => {
  it('accepts a fenced verdict with supported findings and linked problems', () => {
    const verdict = evidenceVerdict(verdictReply() as never)
    expect(verdict).toMatchObject({ qualification: 'qualified', acceptanceMet: true })
    expect(verdict.problems).toHaveLength(1)
  })
  it('parses an unfenced verdict reply', () => {
    const inner = {
      qualification: 'disqualified', reason: 'no fit', acceptanceMet: true,
      findings: [{ claim: 'c', url: 'https://acme.test/e', excerpt: 'exact words here' }],
      problems: [],
    }
    const verdict = evidenceVerdict({ reply: JSON.stringify(inner), sources: [{ url: 'https://acme.test/e', text: 'report: exact words here ok' }], toolCalls: [] } as never)
    expect(verdict.qualification).toBe('disqualified')
  })
  it('rejects halted, unmet, unsupported, and unlinked verdicts', () => {
    expect(() => evidenceVerdict({ haltNotice: 'budget tripped', reply: '', toolCalls: [] } as never)).toThrow('budget tripped')
    const base = verdictReply()
    const unmet = JSON.parse(base.reply.match(/```research-result\s*\n([\s\S]*?)```/)?.[1] ?? '{}')
    expect(() => evidenceVerdict({ ...base, reply: base.reply.replace('"acceptanceMet":true', '"acceptanceMet":false') } as never)).toThrow('has not met the approved acceptance criteria')
    expect(() => evidenceVerdict({ ...base, sources: [] } as never)).toThrow('not supported by a fetched source excerpt')
    const unlinked = { ...unmet, problems: [{ problem: 'p', mechanism: '', costEvidence: '', sourceUrl: 'https://other.test/x', status: 'candidate' }] }
    expect(() => evidenceVerdict({ ...base, reply: `\`\`\`research-result\n${JSON.stringify(unlinked)}\n\`\`\`` } as never)).toThrow('missing fetched evidence')
  })
})

describe('researchVerdictActivity', () => {
  const item = { id: 'sec-1:v2:co-1', kind: 'company', title: 'Acme', state: 'running', attempts: 0, childId: 'child-1', sourceUrl: 'https://acme.test/about', evidence: [], detail: '' }
  function input(outcome: unknown) {
    return { sectorId: 'sec-1', version: 2, sessionId: 'sess-r', item: item as never, outcome: outcome as never }
  }
  it('publishes a worthy verdict to the ledger and advances the company', async () => {
    db.progress.mockResolvedValue({ items: [{ id: 'sec-1:v2:co-1', state: 'pending' }] })
    db.sector.mockResolvedValue({ id: 'sec-1', name: 'Optics' })
    db.upsertCompany.mockResolvedValue({ id: 'co-1' })
    const result = await new MockActivityEnvironment().run(researchVerdictActivity, input(verdictReply()))
    expect(result).toEqual({ detail: 'Acme saves lens makers money.', evidence: ['https://acme.test/evidence'] })
    expect(db.upsertCompany).toHaveBeenCalledWith(TX, expect.objectContaining({ domain: 'acme.test', qualification: 'qualified' }))
    expect(db.ledgerProblem).toHaveBeenCalledWith(TX, expect.objectContaining({ companyId: 'co-1', status: 'worthy' }))
    expect(db.companyStage).toHaveBeenCalledWith(TX, 'co-1', 'Problem found', expect.anything())
    expect(db.companyState).toHaveBeenCalledWith(TX, 'co-1', 'complete', expect.anything())
    expect(db.artifact).toHaveBeenCalledWith(db.pool, expect.objectContaining({ name: 'Acme research.md' }))
  })
  it('skips ledger writes for an already completed item', async () => {
    db.progress.mockResolvedValue({ items: [{ id: 'sec-1:v2:co-1', state: 'complete' }] })
    await new MockActivityEnvironment().run(researchVerdictActivity, input(verdictReply()))
    expect(db.upsertCompany).not.toHaveBeenCalled()
    expect(db.recordWork).not.toHaveBeenCalled()
  })
  it('parks non-worthy verdicts at final validation', async () => {
    db.progress.mockResolvedValue({ items: [{ id: 'sec-1:v2:co-1', state: 'pending' }] })
    db.sector.mockResolvedValue({ id: 'sec-1', name: 'Optics' })
    db.upsertCompany.mockResolvedValue({ id: 'co-1' })
    const base = verdictReply()
    const inner = JSON.parse(base.reply.match(/```research-result\s*\n([\s\S]*?)```/)?.[1] ?? '{}')
    inner.problems[0].status = 'rejected'
    await new MockActivityEnvironment().run(researchVerdictActivity, input({ ...base, reply: `text\n\`\`\`research-result\n${JSON.stringify(inner)}\n\`\`\`` }))
    expect(db.companyStage).toHaveBeenCalledWith(TX, 'co-1', 'Final validation', expect.anything())
  })
})
