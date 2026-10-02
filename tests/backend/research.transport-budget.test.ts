// Synthetic isolated PG receipts: model-scale transport, no company publication.
import { Pool } from 'pg'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { MockActivityEnvironment } from '@temporalio/testing'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { approveSectorPlan, createSector, proposeGlobalContext, readGlobalContext, recordPlanVersion } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { loadCoordinatorActivity, type CoordinatorInput } from '../../backend/src/temporal/activities/coordinator.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('research coordinator transport budget', () => {
  let pool: Pool
  beforeAll(async () => { const url = await ensureTestDb('kardata_test_research_transport'); pool = new Pool({ connectionString: url, max: 5 }); vi.stubEnv('DATABASE_URL', url) })
  afterAll(async () => { await pool?.end(); vi.unstubAllEnvs() })
  it('keeps 2000-company-sized state with intake receipts below the Temporal blob budget', async () => {
    const scope = { tenantId: 'TEST transport', projectId: null }
    const { sectorId } = await createSector(pool, { name: 'TEST transport sector', topic: 'TEST Australian services', initialState: 'planned', scope })
    await projectNewEvents(pool)
    const executable = { researchDepth: 'discovery', discoveryTarget: 2000, discovery: [{ id: 'au', title: 'TEST discovery', queries: ['TEST Australian services'], maxPages: 10 }], companyBrief: 'TEST basic source checks', budgets: { maxCompanies: 2000, maxWallMinutes: 1440, concurrency: 2 }, acceptance: ['TEST real distinct companies'] }
    await recordPlanVersion(pool, sectorId, `# TEST plan\n\n\`\`\`research-plan\n${JSON.stringify(executable)}\n\`\`\``, 'TEST transport plan', scope)
    await approveSectorPlan(pool, sectorId, 1, scope); await projectNewEvents(pool)
    // Legal-sized synthetic intake reasons; exact DB receipts must survive projection.
    await pool.query(`INSERT INTO research_work(id,sector_id,plan_version,kind,title,state,attempts,evidence,detail,source_url)
      SELECT $1||':v1:'||(CASE WHEN g<=2000 THEN 'company-' ELSE 'intake:' END)||g,$1,1,CASE WHEN g<=2000 THEN 'company' ELSE 'discovery' END,'TEST company '||g,'complete',1,
      '["https://source.example.test/identity","https://source.example.test/geography","https://source.example.test/services"]'::jsonb,
      CASE WHEN g<=2000 THEN 'Source-backed basic intake passed. Company deep research has not run.' ELSE (CASE WHEN g<=4000 THEN 'accept: ' ELSE 'reject: ' END)||repeat('TEST reason ',150) END,
      'https://company-'||g||'.example.test/' FROM generate_series(1,6000) g`, [sectorId])
    for (let revision = 0; revision < 20; revision++) {
      const context = await readGlobalContext(pool, sectorId, scope)
      await proposeGlobalContext(pool, { sectorId, baseVersion: context.version, sections: { ...context.sections, findings: `TEST findings ${revision} ${'source note '.repeat(200)}` }, sourceThread: 'TEST owner', owner: true, scope })
    }
    const environment = new MockActivityEnvironment()
    const input = { sectorId, scope, compactState: true }
    const loaded = await environment.run<[CoordinatorInput], Awaited<ReturnType<typeof loadCoordinatorActivity>>, typeof loadCoordinatorActivity>(loadCoordinatorActivity, input)
    const bytes = Buffer.byteLength(JSON.stringify(loaded))
    expect(bytes).toBeLessThan(1_500_000)
    expect(loaded.progress.companyCount).toBe(2000)
    expect(loaded.progress.knownDomains).toHaveLength(2000)
    expect(loaded.progress.items.filter((item) => item.kind === 'company')).toHaveLength(50)
    const control = await environment.run<[CoordinatorInput], Awaited<ReturnType<typeof loadCoordinatorActivity>>, typeof loadCoordinatorActivity>(loadCoordinatorActivity, { ...input, statusOnly: true })
    expect(control.progress.items).toEqual([])
    expect(Buffer.byteLength(JSON.stringify(control))).toBeLessThan(20_000)
    const root = join(import.meta.dirname, '..', '..'), sources = ['backend/src/db/workspace.ts','backend/src/db/events.ts','backend/src/temporal/activities/coordinator.ts','backend/src/temporal/workflows/coordinator.ts','tests/backend/research.transport-budget.test.ts']
    mkdirSync(join(root, 'backend', 'test-results'), { recursive: true })
    writeFileSync(join(root, 'backend', 'test-results', 'coordinator.transport.json'), JSON.stringify({ kind: 'synthetic isolated PG/production activity, no companies published', at: new Date().toISOString(), companies: 2000, receipts: 6000, snapshotBytes: bytes, statusBytes: Buffer.byteLength(JSON.stringify(control)), sourceHashes: Object.fromEntries(sources.map((path) => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')])) }, null, 2) + '\n')
    expect((await pool.query('SELECT count(*) AS n FROM research_work WHERE sector_id=$1', [sectorId])).rows[0].n).toBe('6000')
    expect((await pool.query('SELECT length(detail) AS n FROM research_work WHERE sector_id=$1 AND id LIKE $2 LIMIT 1', [sectorId, '%:intake:%'])).rows[0].n).toBeGreaterThan(1500)
  })
})
