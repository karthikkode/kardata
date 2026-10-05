// Real isolated Postgres: operation identity cannot cross sector/plan boundaries.
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSector, recordResearchWork } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('research work identity authority [F:db.index.createSector] [F:db.sectors.createSector] [F:db.workspace_research.recordResearchWork] [F:db.workspace.WorkspaceError] [F:db.workspace_global_context.notifyWorkspace] [F:db.workspace.requireSector] [F:db.errors.Id]', () => {
  let pool: Pool
  const scope = { tenantId: 'TEST work authority', projectId: null }
  beforeAll(async () => { pool = new Pool({ connectionString: await ensureTestDb('kardata_test_work_authority'), max: 4 }) })
  afterAll(async () => { await pool?.end() })
  async function sectors() {
    const a = await createSector(pool, { name: 'TEST first', topic: 'TEST', scope })
    const b = await createSector(pool, { name: 'TEST second', topic: 'TEST', scope })
    await projectNewEvents(pool)
    return [a.sectorId, b.sectorId] as const
  }
  const item = { id: 'TEST owned work', kind: 'discovery' as const, title: 'TEST owned', state: 'running' as const, attempts: 1, childId: null, evidence: [], detail: 'TEST original' }
  it('denies a foreign-sector identity and a different plan version without altering the receipt', async () => {
    const [a, b] = await sectors()
    await recordResearchWork(pool, { sectorId: a, planVersion: 1, item, scope })
    await expect(recordResearchWork(pool, { sectorId: b, planVersion: 1, item: { ...item, state: 'failed' }, scope })).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(recordResearchWork(pool, { sectorId: a, planVersion: 2, item: { ...item, state: 'failed' }, scope })).rejects.toMatchObject({ code: 'conflict' })
    const { rows } = await pool.query('SELECT sector_id,plan_version,state,detail FROM research_work WHERE id=$1', [item.id])
    expect(rows).toEqual([{ sector_id: a, plan_version: 1, state: 'running', detail: item.detail }])
  })
  it('keeps completion immutable and emits no false replay notification', async () => {
    const [a] = await sectors()
    const completed = { ...item, id: 'TEST completed work', state: 'complete' as const }
    await recordResearchWork(pool, { sectorId: a, planVersion: 1, item: completed, scope })
    const before = await pool.query('SELECT count(*) AS n FROM outbox')
    await recordResearchWork(pool, { sectorId: a, planVersion: 1, item: { ...completed, state: 'failed' }, scope })
    expect((await pool.query('SELECT state FROM research_work WHERE id=$1', [completed.id])).rows[0].state).toBe('complete')
    expect((await pool.query('SELECT count(*) AS n FROM outbox')).rows).toEqual(before.rows)
  })
  it('lets exactly one sector win a concurrent identity claim', async () => {
    const [a, b] = await sectors()
    const twin = { ...item, id: 'TEST competing work' }
    const results = await Promise.allSettled([a, b].map((sectorId) => recordResearchWork(pool, { sectorId, planVersion: 1, item: twin, scope })))
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect((await pool.query('SELECT count(*) AS n FROM research_work WHERE id=$1', [twin.id])).rows[0].n).toBe('1')
  })
})
