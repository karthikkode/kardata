// Real Temporal and DB; retrieval/reviewer fixtures fail closed off-network.
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { ApplicationFailure } from '@temporalio/common'
import { Context } from '@temporalio/activity'
import { MockActivityEnvironment } from '@temporalio/testing'
import { Client as WorkflowClient } from '@temporalio/client'
import type { NativeConnection, Worker } from '@temporalio/worker'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { approveSectorPlan, beginThreadTurn, finishSteering, createSector, ensureResearchSession, listArtifacts, listSectorCompanies, readPartition, readResearchProgress, recordPlanVersion, setSectorState, updateSectorPlan } from '../../backend/src/db/index.js'
import { reviewResearchWork } from '../../backend/src/db/work-review.js'
import { ensureApprovedCoordinator } from '../../backend/src/temporal/runs-helpers.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { archiveResearchOutcome, hydrateResearchSources, resolveArchiveTarget } from '../../backend/src/archive/targets.js'
import { appendEventActivity, type TurnOutcome } from '../../backend/src/temporal/activities/turn.js'
import { type KarbotTurnInput } from '../../backend/src/temporal/activities/karbot-turn-input.js'
import * as activities from '../../backend/src/temporal/activities/coordinator.js'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const search = vi.hoisted(() => vi.fn())
vi.mock('../../backend/src/temporal/activities/sweep.js', async (importOriginal) => ({ ...await importOriginal<typeof import('../../backend/src/temporal/activities/sweep.js')>(), searchWebPageActivity: search }))
const receiptFault = vi.hoisted(() => ({ fail: false, revision: 1, pause: false, acceptancePause: false, lookupIds: [] as string[], holdAcceptance: null as null | { entered(): void; ready: Promise<void> } }))
vi.mock('../../backend/src/db/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../backend/src/db/index.js')>()
  return { ...original, researchIntakeReceipts: async (...args: Parameters<typeof original.researchIntakeReceipts>) => { receiptFault.lookupIds.push(...args[3]); return original.researchIntakeReceipts(...args) }, createArtifact: async (...args: Parameters<typeof original.createArtifact>) => {
    const result = await original.createArtifact(...args)
    if (receiptFault.fail && args[1].name.endsWith(' intake.md')) {
      receiptFault.fail = false
      throw ApplicationFailure.nonRetryable('TEST interrupted after durable receipt', 'TestReceiptInterrupted')
    }
    if (args[1].name === 'Discovery acceptance report.md' && receiptFault.holdAcceptance) {
      const hold = receiptFault.holdAcceptance; receiptFault.holdAcceptance = null; hold.entered(); await hold.ready
    }
    if (receiptFault.acceptancePause && args[1].name === 'Discovery acceptance report.md') {
      receiptFault.acceptancePause = false
      const session = await original.getSession(args[0], args[1].sessionId)
      await original.setSectorState(args[0], session!.sectorId!, 'paused')
    }
    if (receiptFault.pause && args[1].name.endsWith(' intake.md')) {
      receiptFault.pause = false
      const session = await original.getSession(args[0], args[1].sessionId)
      if (!session?.sectorId) throw new Error('TEST receipt session missing sector')
      await original.setSectorState(args[0], session.sectorId, 'paused')
      // Intentionally no projector catch-up: this is the publication race.
    }
    return result
  } }
})
const ENABLED = process.env['KARDATA_TEMPORAL_TEST'] === '1' && Boolean(TEST_DATABASE_URL)
const scope = { tenantId: 'test-discovery-coordinator', projectId: null }

describe.skipIf(!ENABLED)('sector discovery coordinator acceptance [F:backend.activity.turn.appendEventActivity] [F:backend.workflow.coordinator.sectorCoordinator] [F:backend.workflow.coordinator.companyResearch] [F:backend.activity.coordinator.evidenceVerdict] [F:backend.activity.coordinator.prepareExecutionIntentActivity] [F:backend.activity.coordinator.prepareResearchTurnRecoveryActivity] [F:backend.activity.coordinator.researchBudgetActivity] [F:backend.activity.coordinator.researchCheckpointActivity] [F:backend.activity.coordinator.researchDiscoveryClosedActivity] [F:backend.activity.coordinator.researchIntakeActivity] [F:backend.activity.coordinator.researchLifecycleActivity] [F:backend.activity.coordinator.researchSearchActivity] [F:backend.activity.coordinator.researchVerdictActivity] [F:backend.activity.coordinator.researchWorkItemActivity] [F:backend.activity.coordinator.settlePreparedExecutionIntentActivity] [F:backend.activity.execution_epochs.prepareResearchTurnRecoveryActivity] [F:backend.activity.execution_epochs.settlePreparedExecutionIntentActivity] [F:backend.workflow.coordinator.coordinatorPause] [F:backend.workflow.coordinator.coordinatorResume] [F:backend.workflow.coordinator.coordinatorState] [F:backend.workflow.epoch_start.withPreparedExecution] [F:backend.workflow.turn_bundle.companyResearch] [F:backend.activity.turn.sleep]', () => {
  let pool: Pool, connection: NativeConnection, client: WorkflowClient
  let researchWorker: Worker, turnWorker: Worker
  let researchRun: Promise<void>, turnRun: Promise<void>
  const queue = `test-coordinator-${randomUUID()}`
  const pages: number[] = []
  const reviewerOperations: string[] = []
  let intakeHold: Hold | null = null
  let intakeBarrier: { target: number; entered: number; maxSeen: number; ready: Promise<void>; release: () => void } | null = null
  let intakeTransient = false
  const transientDomains = new Set<string>()
  const correctedDomains = new Set<string>()
  let reviewHold: Hold | null = null
  let failPageCheckpoint = false
  let failSecondDirection = false
  const searchSeen: string[][] = []
  let intakeDeferred = 0
  let acceptanceDeferred = 0
  let acceptanceRejected = 0
  let racePublication = false
  type Hold = { entered(): void; ready: Promise<void>; completed?(): void; skip?: number }
  let loadHold: Hold | null = null, resumeHold: Hold | null = null, rotationPause: Hold | null = null
  const handles: Array<ReturnType<WorkflowClient['workflow']['getHandle']>> = []
  let lastIntake: Parameters<typeof activities.researchIntakeActivity>[0] | undefined
  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_coordinator')
    vi.stubEnv('DATABASE_URL', url)
    vi.stubEnv('KARDATA_ARCHIVE_DIR', mkdtempSync(join(tmpdir(), 'kardata-coordinator-')))
    vi.stubEnv('KARDATA_GCS_BUCKET', '')
    pool = new Pool({ connectionString: url, max: 5 })
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
    const path = join(import.meta.dirname, '..', '..', 'backend', 'src', 'temporal', 'workflows', 'coordinator.ts')
    researchWorker = await createLaneWorker({ lane: 'research', connection, namespace: temporalNamespace(), workflowsPath: path, taskQueue: queue, activities: { ...activities,
      researchDiscoveryAcceptanceActivity: async (input: Parameters<typeof activities.researchDiscoveryAcceptanceActivity>[0]) => {
        try {
          const result = await activities.researchDiscoveryAcceptanceActivity(input)
          if (result.deferred) acceptanceDeferred++
          return result
        } catch (error) { acceptanceRejected++; throw error }
      },
      researchIntakeActivity: async (input: Parameters<typeof activities.researchIntakeActivity>[0]) => {
        lastIntake = input
        if (racePublication) {
          racePublication = false
          const url = 'https://racing-company.example.test/'
          const hydrated = await hydrateResearchSources(resolveArchiveTarget(), input.sessionId, input.outcome)
          const racerOutcome = await archiveResearchOutcome(resolveArchiveTarget(), input.sessionId, { ...input.outcome, sourceRefs: undefined, reply: input.outcome.reply.replaceAll(input.candidate.url, url), sources: hydrated.sources.map((source) => ({ ...source, url })) })
          const racer = { ...input, item: { ...input.item, id: `${input.item.id}:racer`, childId: `${input.item.childId}:racer`, sourceUrl: url }, candidate: { ...input.candidate, domain: 'racing-company.example.test', url }, outcome: racerOutcome }
          // A legitimate concurrent publisher owns a separately checkpointed
          // intake; borrowing the first candidate's receipt is not authority.
          racer.item.receiptVersion = undefined
          const preparedRacer = { ...racer, item: await activities.researchCheckpointActivity(racer) }
          const [result] = await Promise.all([activities.researchIntakeActivity(input), activities.researchIntakeActivity(preparedRacer)])
          return result
        }
        const result = await activities.researchIntakeActivity(input)
        if (result.deferred) intakeDeferred++
        return result
      },
      researchSearchActivity: async (input: Parameters<typeof activities.researchSearchActivity>[0]) => {
        if (reviewHold && input.query === 'TEST owner-review-hold') { const hold = reviewHold; reviewHold = null; hold.entered(); await hold.ready }
        searchSeen.push(input.seen)
        if (failSecondDirection && input.query === 'TEST intake-cap') { failSecondDirection = false; throw ApplicationFailure.nonRetryable('TEST stopped before next direction', 'TestDirectionInterrupted') }
        return activities.researchSearchActivity(input)
      },
      researchCheckpointActivity: async (input: Parameters<typeof activities.researchCheckpointActivity>[0]) => {
        if (failPageCheckpoint && input.item.cursor?.page === 1 && !input.item.id.includes(':intake:')) {
          failPageCheckpoint = false
          throw ApplicationFailure.nonRetryable('TEST failed before page cursor commit', 'TestPageInterrupted')
        }
        return activities.researchCheckpointActivity(input)
      },
      loadCoordinatorActivity: async (input: activities.CoordinatorInput) => {
        if (rotationPause && input.pinnedVersion !== undefined && !input.statusOnly) { const hold = rotationPause; rotationPause = null; await setSectorState(pool, input.sectorId, 'paused', { scope }); hold.entered(); await hold.ready }
        const loaded = await activities.loadCoordinatorActivity(input)
        const hold = loadHold
        if (hold?.skip) hold.skip--
        else if (hold) { loadHold = null; hold.entered(); await hold.ready }
        return loaded
      },
      researchLifecycleActivity: async (input: Parameters<typeof activities.researchLifecycleActivity>[0]) => {
        const hold = input.state === 'running' ? resumeHold : null
        if (hold) { resumeHold = null; hold.entered(); await hold.ready }
        const applied = await activities.researchLifecycleActivity(input)
        hold?.completed?.()
        return applied
      },
    } })
    turnWorker = await createLaneWorker({ lane: 'turn', connection, namespace: temporalNamespace(), workflowsPath: path, taskQueue: `${queue}-turn`, activities: {
      appendEventActivity,
      karbotTurnActivity: async (input: KarbotTurnInput) => {
        const actual = Context.current().info.workflowExecution!
        const lease = await beginThreadTurn(pool, input.threadKey, input.runKey, input.ownerEpoch ? { epoch: input.ownerEpoch, workflowId: actual.workflowId, executionId: actual.runId, firstExecutionId: input.ownerFirstExecutionId!, threadKey: input.threadKey, sessionId: input.sessionId } : undefined)
        const evaluate = async (): Promise<TurnOutcome> => {
        reviewerOperations.push(input.runKey)
        const candidateLine = input.text.split('\n').find((line) => line.startsWith('Candidate: '))
        if (candidateLine) {
          const candidate = JSON.parse(candidateLine.slice('Candidate: '.length)) as { name: string; url: string }
          expect(input.toolAllow).toEqual(['web_fetch'])
          if (input.text.includes('TEST owner corrected fit')) return { reply: JSON.stringify({ decision: 'reject', name: 'TEST Australian Widgets company', reason: 'TEST owner correction applied' }), toolCalls: [], sources: [] }
          if (transientDomains.delete(new URL(candidate.url).hostname)) return { reply: '', toolCalls: [], haltNotice: 'TEST temporary source failure' }
          if (intakeTransient) { intakeTransient = false; return { reply: '', toolCalls: [], haltNotice: 'TEST transient provider interruption' } }
          if (intakeHold) { const hold = intakeHold; intakeHold = null; hold.entered(); await hold.ready }
          if (intakeBarrier) { const barrier = intakeBarrier; barrier.entered += 1; barrier.maxSeen = Math.max(barrier.maxSeen, barrier.entered); if (barrier.entered >= barrier.target) barrier.release(); await Promise.race([barrier.ready, new Promise((_, reject) => setTimeout(() => reject(new Error(`TEST intake barrier stuck at ${barrier.entered}/${barrier.target}`)), 25000))]); barrier.entered -= 1 }
          if (/rejected|uncertain/.test(candidate.url) && !correctedDomains.has(new URL(candidate.url).hostname)) return { reply: JSON.stringify({ decision: candidate.url.includes('rejected') ? 'reject' : 'uncertain', name: 'Unknown', reason: 'TEST basic intake did not establish fit' }), toolCalls: [], sources: [] }
          const name = 'TEST Australian Widgets company'
          const excerpt = `${name} is an Australian manufacturing widgets supplier. Evidence revision ${receiptFault.revision}.`
          const evidence = { url: candidate.url, excerpt }
          return { reply: JSON.stringify({ decision: 'accept', name, reason: 'TEST source-backed intake', identity: evidence, geography: evidence, sector: evidence }), toolCalls: [], sources: [{ url: candidate.url, text: `${excerpt}\nTEST additional source detail outside the intake excerpt.` }] }
        }
        const sampleLine = input.text.split('\n').find((line) => line.startsWith('Reproducible sample: '))
        if (!sampleLine) throw new Error('Unexpected fixture reviewer assignment')
        const sample = JSON.parse(sampleLine.slice('Reproducible sample: '.length)) as Array<{ id: string; url: string }>
        const entries = sample.map((item) => ({ id: item.id, url: item.url, excerpt: 'TEST Australian manufacturing company', isCompany: true, inGeography: true, inSector: true }))
        return { reply: `TEST evidence review\n\n\`\`\`discovery-result\n${JSON.stringify({ checks: [{ criterion: 'Verified Australian companies', met: true, evidence: sample.map((item) => item.url) }], sample: entries })}\n\`\`\``, toolCalls: [], sources: sample.map((item) => ({ url: item.url, text: 'TEST Australian manufacturing company with source evidence.' })) }
        }
        try { return await archiveResearchOutcome(resolveArchiveTarget(), input.sessionId, await evaluate()) } finally { await finishSteering(pool, input.threadKey, input.runKey, lease) }
      },
    } })
    researchRun = researchWorker.run(); turnRun = turnWorker.run()
    search.mockImplementation(async ({ query, page }: { query: string; page: number }) => {
      pages.push(page)
      if (query === 'TEST empty' || (['TEST source-rejected', 'TEST source-uncertain'].includes(query) && page > 0)) return []
      if (query === 'TEST owner-review-hold') return []
      if (query === 'TEST review-mixed') return page === 0 ? ['uncertain','widgets'].map((domain) => ({ title: 'TEST Australian widgets company', snippet: 'Australian manufacturing widgets', url: `https://${domain}.example.test/` })) : []
      if (['TEST source-rejected', 'TEST source-uncertain'].includes(query) && page === 0) return [{ title: 'TEST Australian widgets business', snippet: 'Australian manufacturing widgets', url: `https://${query.includes('rejected') ? 'rejected' : 'uncertain'}.example.test/` }]
      if (query === 'TEST cap-recovery') return page === 0 ? ['failed-a', 'failed-b', 'widgets'].map((domain) => ({ title: 'TEST Australian widgets company', snippet: 'Australian manufacturing widgets', url: `https://${domain}.example.test/` })) : []
      if (query === 'TEST empty-first-query') return page === 0 ? [] : [{ title: 'TEST forbidden next page', snippet: 'Australian manufacturing widgets', url: 'https://must-not-dispatch.example.test/' }]
      if (query === 'TEST rotation') return page < 3 ? [{ title: 'TEST Australian widgets company', snippet: 'Australian manufacturing widgets', url: `https://rotation-${page}.example.test/` }] : []
      if (query === 'TEST mixed-retention') return page === 0 ? [{ title: 'TEST Australian widgets business', snippet: 'Australian manufacturing widgets', url: 'https://widgets.example.test/' }, { title: 'TEST uncertain Australian business', snippet: 'Australian manufacturing widgets', url: 'https://uncertain.example.test/' }] : []
      if (query === 'TEST intake-cap') return page === 0 ? [
        { title: 'TEST Australian widgets business', snippet: 'Australian manufacturing widgets', url: 'https://rejected.example.test/' },
        { title: 'TEST Australian Widgets company', snippet: 'Australian manufacturing widgets', url: 'https://widgets.example.test/' },
      ] : []
      if (query === 'TEST concurrency-four') return page === 0 ? ['c1', 'c2', 'c3', 'c4'].map((domain) => ({ title: 'TEST Australian widgets company', snippet: 'Australian manufacturing widgets', url: `https://${domain}.example.test/` })) : []
      if (query === 'TEST metadata-junk' && page === 0) return [
        { title: 'Top 20 Australian widgets companies', snippet: 'Australian manufacturing widgets directory', url: 'https://widget-directory.example.test/' },
        { title: 'Australian widgets manufacturing jobs', snippet: 'Manufacturing widgets', url: 'https://widget-jobs.example.test/jobs/australia' },
      ]
      if (query === 'TEST duplicate-page' && page === 0) return [{ title: 'TEST rejected directory', snippet: 'unrelated directory', url: 'https://unrelated.example.test/' }]
      if (page === 1 || (query === 'TEST partial' && page === 0)) return [{ title: 'TEST Australian Widgets company', snippet: 'Australian manufacturing widgets supplier', url: 'https://widgets.example.test/' }]
      return []
    })
  }, 120000)
  afterAll(async () => {
    for (const handle of handles) {
      const state = await handle.describe()
      if (state.status.name === 'RUNNING') { await handle.cancel(); await handle.result().catch(() => undefined) }
    }
    researchWorker?.shutdown(); turnWorker?.shutdown(); await Promise.all([researchRun, turnRun]); await connection?.close(); await pool?.end(); vi.unstubAllEnvs()
  }, 60000)

  async function start(query: string, target: number, maxCompanies = 10, secondQuery?: string, historyEventLimit?: number, prepare?: (sectorId: string) => Promise<void>, concurrency = 2) {
    const sector = await createSector(pool, { name: 'TEST Australian widgets', topic: 'Australian manufacturing widgets', initialState: 'draft', scope })
    await projectNewEvents(pool)
    const session = await ensureResearchSession(pool, sector.sectorId, scope)
    await recordPlanVersion(pool, sector.sectorId, `# TEST discovery\n\n\`\`\`research-plan\n${JSON.stringify({ researchDepth: 'discovery', discoveryTarget: target, discovery: [{ id: 'widgets', title: 'TEST widgets', queries: [query], maxPages: 3 }, ...(secondQuery ? [{ id: 'second', title: 'TEST second direction', queries: [secondQuery], maxPages: 3 }] : [])], companyBrief: 'Discovery only', budgets: { maxCompanies, maxWallMinutes: 5, concurrency }, acceptance: ['Verified Australian companies'] })}\n\`\`\``, 'test-plan', scope)
    await setSectorState(pool, sector.sectorId, 'planned', { scope }); await projectNewEvents(pool)
    await approveSectorPlan(pool, sector.sectorId, 1, scope); await projectNewEvents(pool)
    await setSectorState(pool, sector.sectorId, 'queued', { scope }); await projectNewEvents(pool)
    await prepare?.(sector.sectorId)
    const handle = await client.workflow.start('sectorCoordinator', { taskQueue: queue, workflowId: `test-discovery-${sector.sectorId}`, args: [{ sectorId: sector.sectorId, scope, turnTaskQueue: `${queue}-turn`, ...(historyEventLimit === undefined ? {} : { historyEventLimit }) }] })
    handles.push(handle)
    return { handle, sectorId: sector.sectorId, sessionId: session.id }
  }

  it.each(['TEST empty', 'TEST partial'])('keeps %s discovery incomplete when the approved target is unmet', async (query) => {
    const run = await start(query, 2)
    expect(await run.handle.result()).toBe('failed')
    const progress = await readResearchProgress(pool, run.sectorId, scope)
    expect(progress.state).toBe('failed')
    expect(progress.estimatedPercent).not.toBe(100)
    expect(progress.items.some((item) => item.state === 'blocked')).toBe(true)
  }, 60000)

  it('continues past a rejected page and completes only after source-backed acceptance', async () => {
    pages.length = 0
    const run = await start('TEST duplicate-page', 1)
    expect(await run.handle.result()).toBe('complete')
    expect(pages).toContain(1)
    const progress = await readResearchProgress(pool, run.sectorId, scope)
    expect(progress.state).toBe('complete')
    expect(progress.estimatedPercent).toBe(100)
    expect(progress.items.find((item) => item.title === 'Validate discovery acceptance')?.evidence).toEqual(['https://widgets.example.test/'])
  }, 60000)

  it('filters keyword-matching junk before persistence and continues to a company page', async () => {
    pages.length = 0
    const run = await start('TEST metadata-junk', 1)
    expect(await run.handle.result()).toBe('complete')
    expect(pages).toContain(1)
    const progress = await readResearchProgress(pool, run.sectorId, scope)
    const companies = progress.items.filter((item) => item.kind === 'company')
    expect(companies).toHaveLength(1)
    expect(companies[0]?.sourceUrl).toBe('https://widgets.example.test/')
    expect(companies[0]?.title).not.toMatch(/directory|jobs/i)
  }, 60000)

  it.each(['TEST source-rejected', 'TEST source-uncertain'])('never publishes %s candidates', async (query) => {
    const run = await start(query, 1)
    expect(await run.handle.result()).toBe('failed')
    const progress = await readResearchProgress(pool, run.sectorId, scope)
    expect(progress.items.filter((item) => item.kind === 'company')).toHaveLength(0)
    expect(progress.items.find((item) => item.title.startsWith('Screen '))?.detail).toMatch(/reject:|uncertain:/)
    expect(progress.estimatedPercent).not.toBe(100)
  }, 60000)

  it('retries interrupted intake on an explicit same-plan restart without duplicating companies', async () => {
    intakeTransient = true
    const run = await start('TEST partial', 1)
    expect(await run.handle.result()).toBe('failed')
    const before = await readResearchProgress(pool, run.sectorId, scope)
    expect(before.items.filter((item) => item.kind === 'company')).toHaveLength(0)
    expect(before.items.find((item) => item.title.startsWith('Screen '))?.state).toBe('blocked')
    const restarted = await client.workflow.start('sectorCoordinator', { taskQueue: queue, workflowId: run.handle.workflowId, args: [{ sectorId: run.sectorId, scope, turnTaskQueue: `${queue}-turn` }] })
    handles.push(restarted)
    expect(await restarted.result()).toBe('complete')
    const after = await readResearchProgress(pool, run.sectorId, scope)
    expect(after.items.filter((item) => item.kind === 'company')).toHaveLength(1)
    expect(after.items.find((item) => item.title.startsWith('Screen '))?.attempts).toBe(2)
    expect(after.budgetUsedMs).toBeGreaterThanOrEqual(before.budgetUsedMs)
  }, 60000)

  it('screens the rest of a page after rejecting a candidate without exceeding the company cap', async () => {
    const run = await start('TEST intake-cap', 1, 1)
    expect(await run.handle.result()).toBe('complete')
    const progress = await readResearchProgress(pool, run.sectorId, scope)
    expect(progress.items.filter((item) => item.kind === 'company')).toHaveLength(1)
    expect(progress.items.filter((item) => item.title.startsWith('Screen '))).toHaveLength(2)
  }, 60000)

  it('fans intake screening out to the plan concurrency budget', async () => {
    let release!: () => void
    const ready = new Promise<void>((resolve) => { release = resolve })
    intakeBarrier = { target: 4, entered: 0, maxSeen: 0, ready, release }
    try {
      const run = await start('TEST concurrency-four', 4, 10, undefined, undefined, undefined, 4)
      expect(await run.handle.result()).toBe('complete')
      expect(intakeBarrier.maxSeen).toBe(4)
      const progress = await readResearchProgress(pool, run.sectorId, scope)
      expect(progress.items.filter((item) => item.kind === 'company')).toHaveLength(4)
    } finally { intakeBarrier = null }
  }, 90000)

  it('enforces the publication ceiling under concurrent intake transactions', async () => {
    racePublication = true
    const run = await start('TEST partial', 1, 1)
    expect(await run.handle.result()).toBe('failed')
    await projectNewEvents(pool)
    const progress = await readResearchProgress(pool, run.sectorId, scope)
    expect(progress.items.filter((item) => item.kind === 'company')).toHaveLength(1)
    expect(progress.items.filter((item) => item.id.includes(':intake:') && item.detail.includes('Approved company limit reached'))).toHaveLength(1)
    expect((await listSectorCompanies(pool, run.sectorId, scope)).companies).toHaveLength(1)
  }, 60000)

  it('retains interrupted work for review instead of exceeding the accepted-company cap on restart', async () => {
    transientDomains.add('failed-a.example.test'); transientDomains.add('failed-b.example.test')
    const run = await start('TEST cap-recovery', 1, 1)
    expect(await run.handle.result()).toBe('failed')
    expect((await readResearchProgress(pool, run.sectorId, scope)).items.filter((item) => item.kind === 'company')).toHaveLength(1)
    const basis = reviewerOperations.length
    const restarted = await client.workflow.start('sectorCoordinator', { taskQueue: queue, workflowId: run.handle.workflowId, args: [{ sectorId: run.sectorId, scope, turnTaskQueue: `${queue}-turn` }] })
    handles.push(restarted)
    expect(await restarted.result()).toBe('failed')
    expect(reviewerOperations).toHaveLength(basis)
    const progress = await readResearchProgress(pool, run.sectorId, scope)
    expect(progress.items.filter((item) => item.kind === 'company')).toHaveLength(1)
    expect(progress.items.filter((item) => item.id.includes(':intake:') && item.detail.includes('Approved company limit reached'))).toHaveLength(2)
    expect(progress.estimatedPercent).not.toBe(100)
  }, 60000)

  it('carries rejected screening domains across completed directions on restart', async () => {
    failSecondDirection = true
    const run = await start('TEST source-rejected', 1, 1, 'TEST intake-cap')
    expect(await run.handle.result()).toBe('failed')
    searchSeen.length = 0
    const restarted = await client.workflow.start('sectorCoordinator', { taskQueue: queue, workflowId: run.handle.workflowId, args: [{ sectorId: run.sectorId, scope, turnTaskQueue: `${queue}-turn` }] })
    handles.push(restarted)
    expect(await restarted.result()).toBe('complete')
    expect(searchSeen[0]).toEqual([])
    expect(receiptFault.lookupIds).toContain(`${run.sectorId}:v1:intake:${createHash('sha256').update('rejected.example.test').digest('hex')}`)
    expect((await readResearchProgress(pool, run.sectorId, scope)).items.filter((item) => item.kind === 'company')).toHaveLength(1)
  }, 60000)

  it('does not review recovered candidates again when replaying an uncheckpointed search page', async () => {
    intakeTransient = true
    failPageCheckpoint = true
    const run = await start('TEST partial', 1)
    expect(await run.handle.result()).toBe('failed')
    const operations = reviewerOperations.filter((key) => key.startsWith(`intake-${run.sectorId}`)).length
    searchSeen.length = 0
    const restarted = await client.workflow.start('sectorCoordinator', { taskQueue: queue, workflowId: run.handle.workflowId, args: [{ sectorId: run.sectorId, scope, turnTaskQueue: `${queue}-turn` }] })
    handles.push(restarted)
    expect(await restarted.result()).toBe('complete')
    expect(reviewerOperations.filter((key) => key.startsWith(`intake-${run.sectorId}`))).toHaveLength(operations + 1)
    expect(searchSeen[0]).toEqual([])
    expect(receiptFault.lookupIds).toContain(`${run.sectorId}:v1:intake:${createHash('sha256').update('widgets.example.test').digest('hex')}`)
    expect((await readResearchProgress(pool, run.sectorId, scope)).items.filter((item) => item.kind === 'company')).toHaveLength(1)
  }, 60000)

  it('preserves an earlier archived receipt when a restarted review produces changed evidence', async () => {
    receiptFault.fail = true
    const run = await start('TEST partial', 1)
    expect(await run.handle.result()).toBe('failed')
    expect((await readResearchProgress(pool, run.sectorId, scope)).items.filter((item) => item.kind === 'company')).toHaveLength(0)
    const first = (await listArtifacts(pool, run.sessionId)).filter((entry) => entry.name?.endsWith(' intake.md'))
    expect(first).toHaveLength(1)
    receiptFault.revision++
    const restarted = await client.workflow.start('sectorCoordinator', { taskQueue: queue, workflowId: run.handle.workflowId, args: [{ sectorId: run.sectorId, scope, turnTaskQueue: `${queue}-turn` }] })
    handles.push(restarted)
    expect(await restarted.result()).toBe('complete')
    const reports = (await listArtifacts(pool, run.sessionId)).filter((entry) => entry.name?.endsWith(' intake.md'))
    expect(reports).toHaveLength(2)
    expect(new Set(reports.map((entry) => entry.sha256)).size).toBe(2)
    expect(reports.find((entry) => entry.artifactId === first[0]?.artifactId)?.sha256).toBe(first[0]?.sha256)
  }, 60000)

  it('honors a committed pause even before its projection catches up', async () => {
    receiptFault.pause = true
    const basis = intakeDeferred
    const run = await start('TEST partial', 1)
    await vi.waitFor(() => { expect(intakeDeferred).toBeGreaterThan(basis) }, { timeout: 10000 })
    await run.handle.signal('coordinatorPause')
    const paused = await readResearchProgress(pool, run.sectorId, scope)
    expect(paused.items.filter((item) => item.kind === 'company')).toHaveLength(0)
    await run.handle.signal('coordinatorResume')
    expect(await run.handle.result()).toBe('complete')
    expect((await readResearchProgress(pool, run.sectorId, scope)).items.filter((item) => item.kind === 'company')).toHaveLength(1)
  }, 60000)

  it('resumes after a reviewer finishes while the parent is paused without relaunching the child', async () => {
    let entered: () => void = () => undefined, release: () => void = () => undefined
    const called = new Promise<void>((resolve) => { entered = resolve })
    intakeHold = { entered, ready: new Promise<void>((resolve) => { release = resolve }) }
    const run = await start('TEST partial', 1)
    try {
      await called
      const basis = reviewerOperations.filter((key) => key.startsWith(`intake-${run.sectorId}`)).length
      await run.handle.signal('coordinatorPause')
      release()
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect((await readResearchProgress(pool, run.sectorId, scope)).items.filter((item) => item.kind === 'company')).toHaveLength(0)
      await run.handle.signal('coordinatorResume')
      expect(await run.handle.result()).toBe('complete')
      expect(reviewerOperations.filter((key) => key.startsWith(`intake-${run.sectorId}`))).toHaveLength(basis)
    } finally { release(); intakeHold = null }
  }, 60000)

  it('validates the last steered reviewer outcome rather than publishing its superseded initial answer', async () => {
    let entered: () => void = () => undefined, release: () => void = () => undefined
    const called = new Promise<void>((resolve) => { entered = resolve })
    intakeHold = { entered, ready: new Promise<void>((resolve) => { release = resolve }) }
    const run = await start('TEST partial', 1)
    try {
      await called
      const progress = await readResearchProgress(pool, run.sectorId, scope)
      const childId = progress.items.find((item) => item.title.startsWith('Screen '))!.childId!
      await client.workflow.getHandle(childId).signal('childMessage', 'TEST owner corrected fit')
      release()
      expect(await run.handle.result()).toBe('failed')
      const finished = await readResearchProgress(pool, run.sectorId, scope)
      expect(finished.items.filter((item) => item.kind === 'company')).toHaveLength(0)
      expect(finished.items.find((item) => item.title.startsWith('Screen '))?.detail).toContain('TEST owner correction applied')
    } finally { release(); intakeHold = null }
  }, 60000)

  it('keeps company publication behind the source-review boundary', async () => {
    let entered: () => void = () => undefined, release: () => void = () => undefined
    const called = new Promise<void>((resolve) => { entered = resolve })
    intakeHold = { entered, ready: new Promise<void>((resolve) => { release = resolve }) }
    const run = await start('TEST partial', 1)
    try {
      await called
      expect((await readResearchProgress(pool, run.sectorId, scope)).items.filter((item) => item.kind === 'company')).toHaveLength(0)
      release()
      expect(await run.handle.result()).toBe('complete')
      expect((await readResearchProgress(pool, run.sectorId, scope)).items.filter((item) => item.kind === 'company')).toHaveLength(1)
    } finally { release(); intakeHold = null }
  }, 60000)

  it('defers acceptance under a committed pause and resumes without repeating reviewers', async () => {
    receiptFault.acceptancePause = true
    const basis = acceptanceDeferred
    const run = await start('TEST partial', 1)
    await vi.waitFor(() => { expect(acceptanceDeferred).toBeGreaterThan(basis) }, { timeout: 10000 })
    await run.handle.signal('coordinatorPause')
    const reviewed = reviewerOperations.filter((key) => key.includes(run.sectorId)).length
    await vi.waitFor(async () => { expect((await readResearchProgress(pool, run.sectorId, scope)).state).toBe('paused') }, { timeout: 5000 })
    const paused = await readResearchProgress(pool, run.sectorId, scope)
    expect(paused.state).toBe('paused')
    expect(paused.estimatedPercent).not.toBe(100)
    await run.handle.signal('coordinatorResume')
    expect(await run.handle.result()).toBe('complete')
    expect(reviewerOperations.filter((key) => key.includes(run.sectorId))).toHaveLength(reviewed)
  }, 60000)

  it('does not publish a late acceptance after cancellation while archive work is held', async () => {
    let entered: () => void = () => undefined, release: () => void = () => undefined
    const called = new Promise<void>((resolve) => { entered = resolve })
    receiptFault.holdAcceptance = { entered, ready: new Promise<void>((resolve) => { release = resolve }) }
    const basis = acceptanceRejected
    const run = await start('TEST partial', 1)
    try {
      await called
      await run.handle.cancel()
      await expect(run.handle.result()).rejects.toThrow()
      await vi.waitFor(() => { expect(acceptanceRejected).toBeGreaterThan(basis) }, { timeout: 35000 })
      release()
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect((await readPartition(pool, `sector:${run.sectorId}`)).some((event) => event.type === 'sector.discovery.validated')).toBe(false)
      expect((await readResearchProgress(pool, run.sectorId, scope)).items.find((item) => item.title === 'Validate discovery acceptance')?.state).not.toBe('complete')
    } finally { release(); receiptFault.holdAcceptance = null }
  }, 60000)

  it('retains verified source receipts in Postgres independently of working turn state', async () => {
    const run = await start('TEST partial', 1)
    expect(await run.handle.result()).toBe('complete')
    const reviews = (await readPartition(pool, `sector:${run.sectorId}`)).filter((event) => event.type === 'sector.discovery.intake_reviewed')
    expect(reviews).toHaveLength(1)
    const receipt = reviews[0]!.payload as { sessionId: string; planVersion: number; result: { decision: string }; sources: NonNullable<TurnOutcome['sourceRefs']> }
    expect(receipt.sessionId).toBe(run.sessionId)
    expect(receipt.planVersion).toBe(1)
    expect(receipt.result.decision).toBe('accept')
    const hydrated = await hydrateResearchSources(resolveArchiveTarget(), run.sessionId, { sourceRefs: receipt.sources })
    expect(hydrated.sources[0]?.text).toContain('TEST Australian Widgets company')
    expect(JSON.stringify(receipt)).not.toContain(hydrated.sources[0]!.text)
  }, 60000)

  it('uses fresh reviewer operation identities when a child workflow id is reused', async () => {
    const run = await start('TEST duplicate-page', 1)
    await run.handle.result()
    const progress = await readResearchProgress(pool, run.sectorId, scope)
    const item = progress.items.find((entry) => entry.kind === 'company')!
    const workflowId = `test-reused-reviewer-${randomUUID()}`
    const assignment = `Reproducible sample: ${JSON.stringify([{ id: item.id, url: item.sourceUrl }])}`
    reviewerOperations.length = 0
    for (let attempt = 0; attempt < 2; attempt++) {
      const handle = await client.workflow.start('companyResearch', { taskQueue: `${queue}-turn`, workflowId, args: [{ sectorId: run.sectorId, scope, version: 1, sessionId: run.sessionId, item, brief: 'TEST discovery review', acceptance: ['Verified Australian companies'], assignment, turnTaskQueue: `${queue}-turn` }] })
      handles.push(handle)
      await handle.result()
    }
    expect(reviewerOperations).toHaveLength(2)
    expect(new Set(reviewerOperations).size).toBe(2)
    expect(reviewerOperations.every((key) => key.startsWith(`${workflowId}:`) && key.endsWith(':research'))).toBe(true)
  }, 60000)

  it('excludes owner pause time from the durable allowance and stops new dispatch', async () => {
    let entered: () => void = () => undefined, release: () => void = () => undefined
    const called = new Promise<void>((resolve) => { entered = resolve })
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const callBasis = search.mock.calls.length
    search.mockImplementationOnce(async () => { entered(); await blocked; return [] })
    const started = Date.now()
    const run = await start('TEST pause', 1)
    try {
      await called
      await run.handle.signal('coordinatorPause')
      expect(await run.handle.query('coordinatorState')).toMatchObject({ paused: true })
      await new Promise((resolve) => setTimeout(resolve, 1000))
      release()
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(search.mock.calls.length - callBasis).toBe(1)
      await run.handle.signal('coordinatorResume')
      expect(await run.handle.result()).toBe('failed')
      const progress = await readResearchProgress(pool, run.sectorId, scope)
      expect(progress.budgetUsedMs).toBeGreaterThanOrEqual(0)
      expect(Date.now() - started - progress.budgetUsedMs).toBeGreaterThanOrEqual(750)
    } finally { release() }
  }, 60000)

  it('does not dispatch when pause arrives during a coordinator load', async () => {
    let entered: () => void = () => undefined, release: () => void = () => undefined
    const called = new Promise<void>((resolve) => { entered = resolve })
    loadHold = { entered, skip: 1, ready: new Promise<void>((resolve) => { release = resolve }) }
    const basis = search.mock.calls.length
    const run = await start('TEST empty', 1)
    try {
      await called
      await run.handle.signal('coordinatorPause')
      expect(await run.handle.query('coordinatorState')).toMatchObject({ paused: true })
      release()
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(search.mock.calls).toHaveLength(basis)
      await run.handle.signal('coordinatorResume')
      expect(await run.handle.result()).toBe('failed')
    } finally { release(); loadHold = null }
  }, 60000)

  it('keeps a newer pause when an older resume lifecycle update settles', async () => {
    let entered: () => void = () => undefined, release: () => void = () => undefined
    let enteredLoad: () => void = () => undefined, releaseLoad: () => void = () => undefined, saved: () => void = () => undefined
    const loadCalled = new Promise<void>((resolve) => { enteredLoad = resolve })
    const runningSaved = new Promise<void>((resolve) => { saved = resolve })
    loadHold = { entered: enteredLoad, ready: new Promise<void>((resolve) => { releaseLoad = resolve }) }
    const called = new Promise<void>((resolve) => { entered = resolve })
    const run = await start('TEST empty', 1)
    try {
      await loadCalled
      await run.handle.signal('coordinatorPause')
      resumeHold = { entered, completed: saved, ready: new Promise<void>((resolve) => { release = resolve }) }
      await run.handle.signal('coordinatorResume')
      await called
      await run.handle.signal('coordinatorPause')
      release()
      await runningSaved
      releaseLoad()
      await vi.waitFor(async () => { expect((await readResearchProgress(pool, run.sectorId, scope)).state).toBe('paused') }, { timeout: 5000 })
      expect(await run.handle.query('coordinatorState')).toMatchObject({ paused: true })
      await run.handle.signal('coordinatorResume')
      expect(await run.handle.result()).toBe('failed')
    } finally { release(); releaseLoad(); resumeHold = null; loadHold = null }
  }, 60000)

  it('replaces a confirmed paused execution only after approving its revised plan', async () => {
    let entered: () => void = () => undefined, release: () => void = () => undefined
    const called = new Promise<void>((resolve) => { entered = resolve })
    const blocked = new Promise<void>((resolve) => { release = resolve })
    search.mockImplementationOnce(async () => { entered(); await blocked; return [] })
    const run = await start('TEST empty', 1)
    try {
      await called
      await run.handle.signal('coordinatorPause')
      release()
      await vi.waitFor(async () => { expect((await readResearchProgress(pool, run.sectorId, scope)).state).toBe('paused') }, { timeout: 5000 })
      const before = await readResearchProgress(pool, run.sectorId, scope)
      const revised = { ...before.plan!.latest!.executable!, discovery: [{ id: 'widgets', title: 'TEST revised widgets', queries: ['TEST duplicate-page'], maxPages: 3 }] }
      await updateSectorPlan(pool, run.sectorId, `# TEST revised discovery\n\n\`\`\`research-plan\n${JSON.stringify(revised)}\n\`\`\``, scope, 'test-revised-plan')
      await projectNewEvents(pool)
      await approveSectorPlan(pool, run.sectorId, 2, scope); await projectNewEvents(pool)
      await setSectorState(pool, run.sectorId, 'queued', { scope }); await projectNewEvents(pool)
      let replacement: ReturnType<WorkflowClient['workflow']['getHandle']> | undefined
      await ensureApprovedCoordinator(run.handle, 2, async () => {
        replacement = await client.workflow.start('sectorCoordinator', { taskQueue: queue, workflowId: run.handle.workflowId, args: [{ sectorId: run.sectorId, scope, turnTaskQueue: `${queue}-turn` }] })
        handles.push(replacement)
      })
      expect(await replacement!.result()).toBe('complete')
      const after = await readResearchProgress(pool, run.sectorId, scope)
      expect(after.planVersion).toBe(2)
      expect(after.budgetUsedMs).toBeGreaterThanOrEqual(before.budgetUsedMs)
      expect(after.estimatedPercent).toBe(100)
    } finally { release() }
  }, 60000)
  it('keeps unresolved intake blocking acceptance after a compatible plan revision', async () => {
    const run = await start('TEST mixed-retention', 1, 3)
    expect(await run.handle.result()).toBe('failed')
    const before = await readResearchProgress(pool, run.sectorId, scope)
    expect(before.items.filter((item) => item.kind === 'company')).toHaveLength(1)
    expect(before.items.some((item) => item.state === 'blocked' && item.detail.startsWith('uncertain:'))).toBe(true)
    expect(before.items.find((item) => item.id.includes(':discovery:'))?.state).toBe('complete')
    await setSectorState(pool, run.sectorId, 'paused', { scope })
    await updateSectorPlan(pool, run.sectorId, '# TEST clearer presentation', scope, 'TEST compatible blocked revision')
    await approveSectorPlan(pool, run.sectorId, 2, scope); await projectNewEvents(pool)
    const restarted = await client.workflow.start('sectorCoordinator', { taskQueue: queue, workflowId: run.handle.workflowId, args: [{ sectorId: run.sectorId, scope, turnTaskQueue: `${queue}-turn` }] })
    handles.push(restarted)
    expect(await restarted.result()).toBe('failed')
    const after = await readResearchProgress(pool, run.sectorId, scope)
    expect(after.planVersion).toBe(2)
    expect(after.items.filter((item) => item.kind === 'company')).toHaveLength(1)
    expect(after.items.some((item) => item.state === 'blocked' && item.detail.startsWith('uncertain:'))).toBe(true)
    expect(after.estimatedPercent).not.toBe(100)
    expect(after.budgetUsedMs).toBeGreaterThanOrEqual(before.budgetUsedMs)
  }, 60000)

  it('rotates history after checkpoints without repeating completed discovery or resetting budget', async () => {
    const run = await start('TEST rotation', 3, 3, undefined, 1)
    expect(await run.handle.result()).toBe('complete')
    const progress = await readResearchProgress(pool, run.sectorId, scope)
    expect(progress.items.filter((item) => item.kind === 'company')).toHaveLength(3)
    expect(progress.items.filter((item) => item.id.includes(':intake:'))).toHaveLength(3)
    expect(progress.estimatedPercent).toBe(100)
    const budgetEvents = (await readPartition(pool, `sector:${run.sectorId}`)).filter((event) => event.type === 'sector.research.budget_recorded')
    expect(new Set(budgetEvents.map((event) => (event.payload as { runId: string }).runId)).size).toBeGreaterThan(1)
    expect(progress.budgetUsedMs).toBeGreaterThan(0)
    const turns = reviewerOperations.filter((key) => key.startsWith(`intake-${run.sectorId}`))
    expect(turns).toHaveLength(3)
    expect(new Set(turns).size).toBe(3)
  }, 60000)

  it('restores a committed pause in the continued run until explicit resume', async () => {
    let entered: () => void = () => undefined, release: () => void = () => undefined
    const called = new Promise<void>((resolve) => { entered = resolve })
    rotationPause = { entered, ready: new Promise<void>((resolve) => { release = resolve }) }
    const run = await start('TEST rotation', 3, 3, undefined, 1)
    try {
      await called
      const queriesBefore = pages.length
      release()
      await vi.waitFor(async () => { expect(await run.handle.query('coordinatorState')).toMatchObject({ paused: true }) }, { timeout: 5000 })
      const budgetBefore = (await readResearchProgress(pool, run.sectorId, scope)).budgetUsedMs
      await new Promise((resolve) => setTimeout(resolve, 600))
      expect(pages).toHaveLength(queriesBefore)
      expect((await readResearchProgress(pool, run.sectorId, scope)).budgetUsedMs).toBe(budgetBefore)
      await run.handle.signal('coordinatorResume')
      expect(await run.handle.result()).toBe('complete')
    } finally { release(); rotationPause = null }
  }, 60000)
  it('preserves exhaustion across rotation instead of requesting the next raw page', async () => {
    pages.length = 0
    const run = await start('TEST empty-first-query', 1, 1, 'TEST partial', 1)
    expect(await run.handle.result()).toBe('complete')
    expect(pages.every((page) => page === 0)).toBe(true)
    const progress = await readResearchProgress(pool, run.sectorId, scope)
    expect(progress.items.filter((item) => item.kind === 'company')).toHaveLength(1)
    expect(progress.items.find((item) => item.kind === 'company')?.sourceUrl).toBe('https://widgets.example.test/')
  }, 60000)
  it('increments attempts and preserves source identity past the first retry page', async () => {
    const run = await start('TEST empty', 1, 2000, undefined, undefined, async (sectorId) => {
      await pool.query(`INSERT INTO research_work(id,sector_id,plan_version,kind,title,state,attempts,evidence,detail,source_url)
        SELECT $1||':v1:intake:'||md5(g::text),$1,1,'discovery','Screen TEST Australian widgets company','blocked',5,'[]'::jsonb,'TEST interrupted source check','https://recovery-'||g||'.example.test/' FROM generate_series(1,101) g`, [sectorId])
    })
    expect(await run.handle.result()).toBe('complete')
    const progress = await readResearchProgress(pool, run.sectorId, scope)
    const intakes = progress.items.filter((item) => item.id.includes(':intake:'))
    expect(intakes).toHaveLength(101)
    expect(intakes.every((item) => item.attempts === 6 && item.state === 'complete' && item.sourceUrl?.startsWith('https://recovery-'))).toBe(true)
    expect(progress.items.filter((item) => item.kind === 'company')).toHaveLength(101)
  }, 120000)

  it('retries an owner-reviewed uncertain candidate without dropping its original reason or attempts', async () => {
    const run = await start('TEST source-uncertain', 1)
    expect(await run.handle.result()).toBe('failed')
    const item = (await readResearchProgress(pool, run.sectorId, scope)).items.find((entry) => entry.id.includes(':intake:'))!
    expect(item.detail).toMatch(/^uncertain:/)
    await reviewResearchWork(pool, { sectorId: run.sectorId, workId: item.id, planVersion: 1, receiptVersion: item.receiptVersion!, decision: 'retry', reason: 'TEST source is now verifiable', author: 'TEST approver', scope })
    correctedDomains.add('uncertain.example.test')
    try {
      const restarted = await client.workflow.start('sectorCoordinator', { taskQueue: queue, workflowId: run.handle.workflowId, args: [{ sectorId: run.sectorId, scope, turnTaskQueue: `${queue}-turn` }] })
      handles.push(restarted)
      expect(await restarted.result()).toBe('complete')
      const current = (await readResearchProgress(pool, run.sectorId, scope)).items.find((entry) => entry.id === item.id)!
      expect(current.attempts).toBe(item.attempts + 1)
      expect(current.state).toBe('complete')
      expect((await readPartition(pool, `sector:${run.sectorId}`)).find((entry) => entry.type === 'sector.research.work_reviewed')?.payload).toMatchObject({ before: { detail: item.detail, attempts: item.attempts } })
    } finally { correctedDomains.delete('uncertain.example.test') }
  }, 60000)

  it('keeps owner exclusions out of company publication and resolves only their candidate blocker', async () => {
    const run = await start('TEST review-mixed', 1, 1)
    expect(await run.handle.result()).toBe('failed')
    const item = (await readResearchProgress(pool, run.sectorId, scope)).items.find((entry) => entry.detail.startsWith('uncertain:'))!
    await reviewResearchWork(pool, { sectorId: run.sectorId, workId: item.id, planVersion: 1, receiptVersion: item.receiptVersion!, decision: 'exclude', reason: 'TEST identity not established; never publish it', author: 'TEST approver', scope })
    const before = reviewerOperations.filter((key) => key.startsWith(`intake-${run.sectorId}`)).length
    const restarted = await client.workflow.start('sectorCoordinator', { taskQueue: queue, workflowId: run.handle.workflowId, args: [{ sectorId: run.sectorId, scope, turnTaskQueue: `${queue}-turn` }] })
    handles.push(restarted)
    expect(await restarted.result()).toBe('complete')
    expect(reviewerOperations.filter((key) => key.startsWith(`intake-${run.sectorId}`))).toHaveLength(before)
    const progress = await readResearchProgress(pool, run.sectorId, scope)
    expect(progress.items.find((entry) => entry.id === item.id)?.state).toBe('excluded')
    expect(progress.completed).toBe(progress.total)
    expect(progress.estimatedPercent).toBe(100)
    expect((await listSectorCompanies(pool, run.sectorId, scope)).companies).toHaveLength(1)
  }, 60000)

  it('reloads a paused owner retry at a safe boundary instead of leaving it pending', async () => {
    let entered!: () => void, release!: () => void
    const ready = new Promise<void>((resolve) => { release = resolve })
    const observed = new Promise<void>((resolve) => { entered = resolve })
    reviewHold = { entered, ready }
    const run = await start('TEST source-uncertain', 1, 1, 'TEST owner-review-hold')
    try {
      await observed
      await run.handle.signal('coordinatorPause')
      await vi.waitFor(async () => { await projectNewEvents(pool); expect((await readResearchProgress(pool, run.sectorId, scope)).state).toBe('paused') }, { timeout: 5000 })
      const item = (await readResearchProgress(pool, run.sectorId, scope)).items.find((entry) => entry.detail.startsWith('uncertain:'))!
      await reviewResearchWork(pool, { sectorId: run.sectorId, workId: item.id, planVersion: 1, receiptVersion: item.receiptVersion!, decision: 'retry', reason: 'TEST explicit retry during pause', author: 'TEST approver', scope })
      correctedDomains.add('uncertain.example.test')
      release()
      await run.handle.signal('coordinatorResume')
      expect(await run.handle.result()).toBe('complete')
      const settled = (await readResearchProgress(pool, run.sectorId, scope)).items.find((entry) => entry.id === item.id)!
      expect(settled.state).toBe('complete'); expect(settled.attempts).toBe(item.attempts + 1)
    } finally { release(); correctedDomains.delete('uncertain.example.test'); reviewHold = null }
  }, 60000)

  it('refuses a late accepted outcome after an owner excluded the candidate', async () => {
    const run = await start('TEST source-uncertain', 1)
    expect(await run.handle.result()).toBe('failed')
    const original = lastIntake!
    const item = (await readResearchProgress(pool, run.sectorId, scope)).items.find((entry) => entry.id === original.item.id)!
    await reviewResearchWork(pool, { sectorId: run.sectorId, workId: item.id, planVersion: 1, receiptVersion: item.receiptVersion!, decision: 'exclude', reason: 'TEST definitive owner exclusion', author: 'TEST approver', scope })
    await setSectorState(pool, run.sectorId, 'running', { scope }); await projectNewEvents(pool)
    const name = 'TEST Australian Widgets company', excerpt = `${name} is an Australian manufacturing widgets supplier.`
    const evidence = { url: original.candidate.url, excerpt }
    const outcome: TurnOutcome = { reply: JSON.stringify({ decision: 'accept', name, reason: 'TEST late prior assessment', identity: evidence, geography: evidence, sector: evidence }), toolCalls: [], sources: [{ url: evidence.url, text: excerpt }] }
    const environment = new MockActivityEnvironment()
    const result = await environment.run(activities.researchIntakeActivity, { ...original, outcome })
    expect(result).toMatchObject({ accepted: false, excluded: true })
    expect((await listSectorCompanies(pool, run.sectorId, scope)).companies).toHaveLength(0)
    expect((await readResearchProgress(pool, run.sectorId, scope)).items.find((entry) => entry.id === item.id)?.state).toBe('excluded')
  }, 60000)

})
