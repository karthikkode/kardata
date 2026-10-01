// Real Temporal and DB; retrieval/reviewer fixtures fail closed off-network.
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { Client as WorkflowClient } from '@temporalio/client'
import type { NativeConnection, Worker } from '@temporalio/worker'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { approveSectorPlan, createSector, ensureResearchSession, readResearchProgress, recordPlanVersion, setSectorState, updateSectorPlan } from '../../backend/src/db/index.js'
import { ensureApprovedCoordinator } from '../../backend/src/temporal/gateway.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { appendEventActivity } from '../../backend/src/temporal/activities/turn.js'
import * as activities from '../../backend/src/temporal/activities/coordinator.js'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const search = vi.hoisted(() => vi.fn())
vi.mock('../../backend/src/temporal/activities/sweep.js', async (importOriginal) => ({ ...await importOriginal<typeof import('../../backend/src/temporal/activities/sweep.js')>(), searchWebPageActivity: search }))
const ENABLED = process.env['KARDATA_TEMPORAL_TEST'] === '1' && Boolean(TEST_DATABASE_URL)
const scope = { tenantId: 'test-discovery-coordinator', projectId: null }

describe.skipIf(!ENABLED)('sector discovery coordinator acceptance', () => {
  let pool: Pool, connection: NativeConnection, client: WorkflowClient
  let researchWorker: Worker, turnWorker: Worker
  let researchRun: Promise<void>, turnRun: Promise<void>
  const queue = `test-coordinator-${randomUUID()}`
  const pages: number[] = []
  const reviewerOperations: string[] = []
  type Hold = { entered(): void; ready: Promise<void>; completed?(): void; skip?: number }
  let loadHold: Hold | null = null, resumeHold: Hold | null = null
  const handles: Array<ReturnType<WorkflowClient['workflow']['getHandle']>> = []
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
      loadCoordinatorActivity: async (input: activities.CoordinatorInput) => {
        const loaded = await activities.loadCoordinatorActivity(input)
        const hold = loadHold
        if (hold?.skip) hold.skip--
        else if (hold) { loadHold = null; hold.entered(); await hold.ready }
        return loaded
      },
      researchLifecycleActivity: async (input: Parameters<typeof activities.researchLifecycleActivity>[0]) => {
        const hold = input.state === 'running' ? resumeHold : null
        if (hold) { resumeHold = null; hold.entered(); await hold.ready }
        await activities.researchLifecycleActivity(input)
        hold?.completed?.()
      },
    } })
    turnWorker = await createLaneWorker({ lane: 'turn', connection, namespace: temporalNamespace(), workflowsPath: path, taskQueue: `${queue}-turn`, activities: {
      appendEventActivity,
      karbotTurnActivity: async (input: { text: string; runKey: string }) => {
        reviewerOperations.push(input.runKey)
        const sampleLine = input.text.split('\n').find((line) => line.startsWith('Reproducible sample: '))
        if (!sampleLine) throw new Error('Unexpected fixture reviewer assignment')
        const sample = JSON.parse(sampleLine.slice('Reproducible sample: '.length)) as Array<{ id: string; url: string }>
        const entries = sample.map((item) => ({ id: item.id, url: item.url, excerpt: 'TEST Australian manufacturing company', isCompany: true, inGeography: true, inSector: true }))
        return { reply: `TEST evidence review\n\n\`\`\`discovery-result\n${JSON.stringify({ checks: [{ criterion: 'Verified Australian companies', met: true, evidence: sample.map((item) => item.url) }], sample: entries })}\n\`\`\``, toolCalls: [], sources: sample.map((item) => ({ url: item.url, text: 'TEST Australian manufacturing company with source evidence.' })) }
      },
    } })
    researchRun = researchWorker.run(); turnRun = turnWorker.run()
    search.mockImplementation(async ({ query, page }: { query: string; page: number }) => {
      pages.push(page)
      if (query === 'TEST empty') return []
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

  async function start(query: string, target: number) {
    const sector = await createSector(pool, { name: 'TEST Australian widgets', topic: 'Australian manufacturing widgets', initialState: 'draft', scope })
    await projectNewEvents(pool)
    const session = await ensureResearchSession(pool, sector.sectorId, scope)
    await recordPlanVersion(pool, sector.sectorId, `# TEST discovery\n\n\`\`\`research-plan\n${JSON.stringify({ researchDepth: 'discovery', discoveryTarget: target, discovery: [{ id: 'widgets', title: 'TEST widgets', queries: [query], maxPages: 3 }], companyBrief: 'Discovery only', budgets: { maxCompanies: 10, maxWallMinutes: 5, concurrency: 2 }, acceptance: ['Verified Australian companies'] })}\n\`\`\``, 'test-plan', scope)
    await setSectorState(pool, sector.sectorId, 'planned', { scope }); await projectNewEvents(pool)
    await approveSectorPlan(pool, sector.sectorId, 1, scope); await projectNewEvents(pool)
    await setSectorState(pool, sector.sectorId, 'queued', { scope }); await projectNewEvents(pool)
    const handle = await client.workflow.start('sectorCoordinator', { taskQueue: queue, workflowId: `test-discovery-${sector.sectorId}`, args: [{ sectorId: sector.sectorId, scope, turnTaskQueue: `${queue}-turn` }] })
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
})
