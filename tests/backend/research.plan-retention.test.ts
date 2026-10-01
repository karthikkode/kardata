// Isolated Postgres, exact executable revisions and real approval transactions.
import { Pool } from 'pg'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { cpus, totalmem } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { approveSectorPlan, createSector, proposeGlobalContext, readGlobalContext, readPartition, readResearchProgress, readSectorPlan, recordPlanVersion, recordResearchWork, setSectorState, updateSectorPlan } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
const scope = { tenantId: 'TEST plan retention', projectId: null }
const executable = { researchDepth: 'discovery' as const, discoveryTarget: 1, discovery: [{ id: 'au', title: 'TEST Australian discovery', queries: ['TEST Australian services'], maxPages: 1 }], companyBrief: 'TEST verify sources', budgets: { maxCompanies: 2, maxWallMinutes: 60, concurrency: 2 as const }, acceptance: ['TEST source-backed Australian companies'] }
const markdown = (plan = executable) => `# TEST plan\n\n\`\`\`research-plan\n${JSON.stringify(plan)}\n\`\`\``

describe.skipIf(!TEST_DATABASE_URL)('approved revision retention', () => {
  let pool: Pool
  beforeAll(async () => { pool = new Pool({ connectionString: await ensureTestDb('kardata_test_plan_retention'), max: 5 }) })
  afterAll(async () => { await pool?.end() })
  async function prepared() {
    const { sectorId } = await createSector(pool, { name: 'TEST Australian services', topic: 'TEST scope', initialState: 'planned', scope })
    await projectNewEvents(pool)
    await recordPlanVersion(pool, sectorId, markdown(), 'TEST first', scope)
    await approveSectorPlan(pool, sectorId, 1, scope)
    await projectNewEvents(pool)
    await setSectorState(pool, sectorId, 'running', { scope }); await projectNewEvents(pool)
    const base = { attempts: 1, childId: null, evidence: ['https://business.example.test/identity', 'https://business.example.test/location', 'https://business.example.test/services'], detail: 'TEST verified source-backed discovery', sourceUrl: 'https://business.example.test/' }
    await recordResearchWork(pool, { sectorId, planVersion: 1, scope, item: { ...base, id: `${sectorId}:v1:company-one`, kind: 'company', title: 'TEST completed company', state: 'complete' } })
    await recordResearchWork(pool, { sectorId, planVersion: 1, scope, item: { ...base, id: `${sectorId}:v1:intake:one`, kind: 'discovery', title: 'TEST completed intake', state: 'complete', childId: 'TEST original child', detail: 'accept: TEST verified identity/fit' } })
    await recordResearchWork(pool, { sectorId, planVersion: 1, scope, item: { ...base, id: `${sectorId}:v1:intake:uncertain`, kind: 'discovery', title: 'TEST uncertain intake', sourceUrl: 'https://uncertain.example.test/', state: 'blocked', detail: 'uncertain: TEST unresolved' } })
    await recordResearchWork(pool, { sectorId, planVersion: 1, scope, item: { ...base, sourceUrl: undefined, evidence: [], id: `${sectorId}:v1:discovery:au`, kind: 'discovery', title: 'TEST completed direction', state: 'complete', cursor: { queryIndex: 1, page: 0, seenDomains: ['business.example.test'] } } })
    await setSectorState(pool, sectorId, 'paused', { scope }) // Deliberate projection lag.
    return sectorId
  }
  it('retains eligible completed work and provenance while unresolved work stays unresolved', async () => {
    const sectorId = await prepared()
    await updateSectorPlan(pool, sectorId, '# TEST clearer formatting', scope, 'TEST compatible revision')
    await approveSectorPlan(pool, sectorId, 2, scope) // No projector between lifecycle mutations.
    await projectNewEvents(pool)
    const progress = await readResearchProgress(pool, sectorId, scope)
    expect(progress.planVersion).toBe(2)
    expect(progress.items.map((item) => item.title).sort()).toEqual(['TEST completed company', 'TEST completed direction', 'TEST completed intake', 'TEST uncertain intake'])
    expect(progress.items.filter((item) => item.state === 'complete')).toHaveLength(3)
    expect(progress.items.find((item) => item.title === 'TEST uncertain intake')).toMatchObject({ state: 'blocked', attempts: 1 })
    expect(progress.unresolved).toBe(1)
    expect(progress.items.find((item) => item.title === 'TEST completed intake')).toMatchObject({ childId: 'TEST original child', evidence: expect.arrayContaining(['https://business.example.test/identity']), detail: expect.stringContaining('Retained from approved plan v1') })
    expect(progress.items.find((item) => item.title === 'TEST completed intake')?.detail.startsWith('accept:')).toBe(true)
    expect((await pool.query('SELECT state FROM research_work WHERE id=$1', [`${sectorId}:v1:intake:uncertain`])).rows[0].state).toBe('blocked')
    expect((await readPartition(pool, `sector:${sectorId}`)).filter((event) => event.type === 'sector.research.work_retained')).toHaveLength(1)
  })
  it('retains companies when capacity expands but reruns capacity-stopped directions', async () => {
    const sectorId = await prepared()
    const expanded = { ...executable, discoveryTarget: 2, budgets: { ...executable.budgets, maxCompanies: 3 } }
    await updateSectorPlan(pool, sectorId, markdown(expanded), scope, 'TEST expanded capacity')
    await approveSectorPlan(pool, sectorId, 2, scope); await projectNewEvents(pool)
    const progress = await readResearchProgress(pool, sectorId, scope)
    expect(progress.items.filter((item) => item.kind === 'company')).toHaveLength(1)
    expect(progress.items.some((item) => item.title === 'TEST completed direction')).toBe(false)
    expect(progress.estimatedPercent).toBeNull()
  })
  it('does not infer eligibility after acceptance criteria change', async () => {
    const sectorId = await prepared()
    await updateSectorPlan(pool, sectorId, markdown({ ...executable, acceptance: ['TEST different owner criteria'] }), scope, 'TEST new acceptance')
    await approveSectorPlan(pool, sectorId, 2, scope); await projectNewEvents(pool)
    expect((await readResearchProgress(pool, sectorId, scope)).items).toEqual([])
    expect((await readGlobalContext(pool, sectorId, scope)).version).toBe(0)
  })
  it('rejects stale approval and concurrent twin approvals without a duplicate pin', async () => {
    const sectorId = await prepared()
    await updateSectorPlan(pool, sectorId, '# TEST v2', scope, 'TEST stale revision')
    await expect(approveSectorPlan(pool, sectorId, 1, scope)).rejects.toMatchObject({ failure: 'conflict' })
    const results = await Promise.allSettled([approveSectorPlan(pool, sectorId, 2, scope), approveSectorPlan(pool, sectorId, 2, scope)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect((await readSectorPlan(pool, sectorId, scope))?.approvals).toEqual([1, 2])
  })
  it('does not silently retain old discoveries across a committed scope change', async () => {
    const sectorId = await prepared()
    const context = await readGlobalContext(pool, sectorId, scope)
    await proposeGlobalContext(pool, { sectorId, baseVersion: context.version, sections: { ...context.sections, scope: 'TEST scope expanded to HVAC' }, sourceThread: 'TEST owner', owner: true, scope })
    await updateSectorPlan(pool, sectorId, markdown(), scope, 'TEST scope revision')
    await approveSectorPlan(pool, sectorId, 2, scope); await projectNewEvents(pool)
    expect((await readResearchProgress(pool, sectorId, scope)).items).toEqual([])
    expect((await readSectorPlan(pool, sectorId, scope))?.approvedContext?.scope).toBe('TEST scope expanded to HVAC')
  })
  it('rolls back approval and retention when the new limit excludes completed discoveries', async () => {
    const sectorId = await prepared()
    await recordResearchWork(pool, { sectorId, planVersion: 1, scope, item: { id: `${sectorId}:v1:company-two`, kind: 'company', title: 'TEST second completed company', state: 'complete', attempts: 1, childId: null, sourceUrl: 'https://second.example.test/', evidence: ['https://second.example.test/a','https://second.example.test/b','https://second.example.test/c'], detail: 'TEST verified source-backed discovery' } })
    await updateSectorPlan(pool, sectorId, markdown({ ...executable, budgets: { ...executable.budgets, maxCompanies: 1 } }), scope, 'TEST reduced limit')
    await expect(approveSectorPlan(pool, sectorId, 2, scope)).rejects.toMatchObject({ code: 'conflict' })
    expect((await readSectorPlan(pool, sectorId, scope))?.approvals).toEqual([1])
    expect((await pool.query('SELECT count(*) AS n FROM research_work WHERE sector_id=$1 AND plan_version=2', [sectorId])).rows[0].n).toBe('0')
  })

  it('keeps protected decision changes out of automatic retention', async () => {
    const sectorId = await prepared()
    const context = await readGlobalContext(pool, sectorId, scope)
    await proposeGlobalContext(pool, { sectorId, baseVersion: context.version, sections: { ...context.sections, decisions: 'TEST exclude franchises from completed eligibility' }, sourceThread: 'TEST owner', owner: true, scope })
    await updateSectorPlan(pool, sectorId, markdown(), scope, 'TEST decision revision')
    await approveSectorPlan(pool, sectorId, 2, scope); await projectNewEvents(pool)
    expect((await readResearchProgress(pool, sectorId, scope)).items).toEqual([])
    expect((await readSectorPlan(pool, sectorId, scope))?.approvedContext?.decisions).toContain('TEST exclude franchises')
  })

  it('rejects a stale displayed context before retaining or approving work', async () => {
    const sectorId = await prepared()
    const context = await readGlobalContext(pool, sectorId, scope)
    await proposeGlobalContext(pool, { sectorId, baseVersion: context.version, sections: { ...context.sections, findings: 'TEST new evidence before approval' }, sourceThread: 'TEST owner', owner: true, scope })
    await updateSectorPlan(pool, sectorId, markdown(), scope, 'TEST stale context revision')
    await expect(approveSectorPlan(pool, sectorId, 2, scope, undefined, context.version)).rejects.toMatchObject({ failure: 'conflict' })
    expect((await readSectorPlan(pool, sectorId, scope))?.approvedVersion).toBe(1)
    await approveSectorPlan(pool, sectorId, 2, scope, undefined, context.version + 1); await projectNewEvents(pool)
    expect((await readResearchProgress(pool, sectorId, scope)).items.filter((item) => item.kind === 'company')).toHaveLength(1)
  })

  it('retains 2000 completed discoveries through one bounded approval bulk write', async () => {
    const { sectorId } = await createSector(pool, { name: 'TEST 2000 retention load', topic: 'TEST scope', initialState: 'planned', scope })
    await projectNewEvents(pool)
    const plan = { ...executable, budgets: { ...executable.budgets, maxCompanies: 2000 } }
    await recordPlanVersion(pool, sectorId, markdown(plan), 'TEST load first', scope)
    await approveSectorPlan(pool, sectorId, 1, scope); await projectNewEvents(pool)
    // Explicit synthetic work fixtures; no companies, sources or evidence are published.
    await pool.query(`INSERT INTO research_work(id,sector_id,plan_version,kind,title,state,attempts,evidence,detail,source_url)
      SELECT $1||':v1:load-'||g,$1,1,'company','TEST fixture '||g,'complete',1,'["https://example.test/a","https://example.test/b","https://example.test/c"]'::jsonb,'TEST synthetic receipt','https://example.test/' FROM generate_series(1,2000) g`, [sectorId])
    await setSectorState(pool, sectorId, 'paused', { scope })
    await updateSectorPlan(pool, sectorId, '# TEST presentation update', scope, 'TEST load revision')
    const started = performance.now()
    await approveSectorPlan(pool, sectorId, 2, scope)
    const latencyMs = performance.now() - started
    expect(latencyMs).toBeLessThan(5000)
    await projectNewEvents(pool)
    const progress = await readResearchProgress(pool, sectorId, scope)
    expect(progress.items).toHaveLength(2000)
    expect(progress.items.every((item) => item.state === 'complete' && item.detail.includes('Retained from approved plan v1'))).toBe(true)
    const receipt = (await readPartition(pool, `sector:${sectorId}`)).find((event) => event.type === 'sector.research.work_retained')
    expect(receipt?.payload).toMatchObject({ count: 2000, sourceVersion: 1, planVersion: 2 })
    const root = join(import.meta.dirname, '..', '..')
    const sources = ['backend/src/db/workspace.ts', 'backend/src/db/sector-plan.ts', 'tests/backend/research.plan-retention.test.ts']
    mkdirSync(join(root, 'backend', 'test-results'), { recursive: true })
    writeFileSync(join(root, 'backend', 'test-results', 'retention.load.json'), JSON.stringify({ kind: 'synthetic isolated Postgres work retention, no companies published', at: new Date().toISOString(), companies: 2000, latencyMs, rssBytesAtEnd: process.memoryUsage().rss, poolWaitersAtEnd: pool.waitingCount, node: process.version, cpuCount: cpus().length, hostMemoryBytes: totalmem(), sourceHashes: Object.fromEntries(sources.map((path) => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')])) }, null, 2) + '\n')
  })

})
