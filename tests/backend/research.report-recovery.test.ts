import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { MockActivityEnvironment } from '@temporalio/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FilesystemTarget } from '../../backend/src/archive/targets.js'
import { approveSectorPlan, createSector, ensureResearchSession, listArtifacts, readResearchProgress, readSectorLibraryFile, recordPlanVersion, recordResearchWork, setSectorState } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { researchDiscoveryAcceptanceActivity } from '../../backend/src/temporal/activities/coordinator.js'
import type { WorkItem } from '../../backend/src/temporal/research-plan.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const faults = vi.hoisted(() => ({ checkpoint: false }))
vi.mock('../../backend/src/db/index.js', async (original) => {
  const actual = await original<typeof import('../../backend/src/db/index.js')>()
  return { ...actual, recordResearchWork: async (...args: Parameters<typeof actual.recordResearchWork>) => {
    if (faults.checkpoint && args[1].item.kind === 'discovery' && args[1].item.state === 'complete') { faults.checkpoint = false; throw new Error('TEST checkpoint failed after report write') }
    return actual.recordResearchWork(...args)
  } }
})
describe.skipIf(!TEST_DATABASE_URL)('research report attempt recovery', () => {
  let pool: Pool, archive: FilesystemTarget, sectorId: string, sessionId: string
  const scope = { tenantId: 'test-report-recovery', projectId: null }
  beforeAll(async () => {
    const url = await ensureTestDb('kardata_test_report_recovery')
    vi.stubEnv('DATABASE_URL', url)
    const path = mkdtempSync(join(tmpdir(), 'kardata-report-recovery-'))
    vi.stubEnv('KARDATA_ARCHIVE_DIR', path); vi.stubEnv('KARDATA_GCS_BUCKET', '')
    archive = new FilesystemTarget(path)
    pool = new Pool({ connectionString: url })
    sectorId = (await createSector(pool, { name: 'TEST report recovery', scope })).sectorId
    await projectNewEvents(pool)
    sessionId = (await ensureResearchSession(pool, sectorId, scope)).id
    const plan = { researchDepth: 'discovery', discoveryTarget: 1, discovery: [{ id: 'test', title: 'TEST discovery', queries: ['TEST company'], maxPages: 1 }], companyBrief: 'Discovery only', budgets: { maxCompanies: 10, maxWallMinutes: 5, concurrency: 2 }, acceptance: ['TEST criterion'] }
    await recordPlanVersion(pool, sectorId, `# TEST plan\n\n\`\`\`research-plan\n${JSON.stringify(plan)}\n\`\`\``, 'test-plan', scope)
    await setSectorState(pool, sectorId, 'planned', { scope }); await projectNewEvents(pool)
    await approveSectorPlan(pool, sectorId, 1, scope); await projectNewEvents(pool)
    await recordResearchWork(pool, { sectorId, scope, planVersion: 1, item: { id: 'TEST company', kind: 'company', title: 'TEST company', sourceUrl: 'https://test.example.test/', state: 'complete', attempts: 1, childId: null, evidence: [], detail: 'TEST discovery' } })
  })
  afterAll(async () => { await pool?.end(); vi.unstubAllEnvs() })
  it('preserves the first report and completes a new attempt with changed evidence', async () => {
    const item: WorkItem = { id: 'TEST acceptance', kind: 'discovery', title: 'TEST acceptance', state: 'running', attempts: 1, childId: null, evidence: [], detail: '' }
    const input = (excerpt: string) => ({ sectorId, scope, sessionId, version: 1, item, outcomes: [{ toolCalls: [], reply: JSON.stringify({ checks: [{ criterion: 'TEST criterion', met: true, evidence: ['https://test.example.test/'] }], sample: [{ id: 'TEST company', url: 'https://test.example.test/', excerpt, isCompany: true, inGeography: true, inSector: true }] }), sources: [{ url: 'https://test.example.test/', text: excerpt }] }] })
    faults.checkpoint = true
    const first = new MockActivityEnvironment({ workflowExecution: { workflowId: 'TEST coordinator', runId: 'TEST-attempt-one' } })
    await expect(first.run(researchDiscoveryAcceptanceActivity, input('TEST original source evidence'))).rejects.toThrow('TEST checkpoint failed after report write')
    const second = new MockActivityEnvironment({ workflowExecution: { workflowId: 'TEST coordinator', runId: 'TEST-attempt-two' } })
    await second.run(researchDiscoveryAcceptanceActivity, input('TEST changed source evidence'))
    const reports = (await listArtifacts(pool, sessionId)).filter((file) => file.name === 'Discovery acceptance report.md')
    expect(reports).toHaveLength(2)
    const bodies = await Promise.all(reports.map((file) => readSectorLibraryFile(pool, sectorId, file.artifactId, archive, scope)))
    expect(bodies.some((body) => body.text.includes('TEST original source evidence'))).toBe(true)
    expect(bodies.some((body) => body.text.includes('TEST changed source evidence'))).toBe(true)
    expect((await readResearchProgress(pool, sectorId, scope)).items.find((work) => work.id === item.id)?.state).toBe('complete')
  })
})
