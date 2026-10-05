import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSector, readResearchBudget, recordResearchBudget } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('durable cumulative research budget [F:db.index.createSector] [F:db.workspace_research.readResearchBudget] [F:db.workspace_research.recordResearchBudget] [F:db.sectors.createSector] [F:db.events.DURABLE_STREAM_LOCK_SQL] [F:db.errors.WorkspaceError] [F:db.index.Db] [F:db.index.TransactableDb] [F:db.workspace.WorkspaceError] [F:db.workspace.requireSector] [F:db.workspace.workspaceTransaction] [F:db.errors.Id] [F:db.errors.checked]', () => {
  let pool: Pool, sectorId: string
  const scope = { tenantId: 'test-budget', projectId: null }
  beforeAll(async () => {
    pool = new Pool({ connectionString: await ensureTestDb('kardata_test_research_budget') })
    sectorId = (await createSector(pool, { name: 'TEST budget sector', scope })).sectorId
    await projectNewEvents(pool)
  })
  afterAll(async () => { await pool?.end() })
  it('preserves cumulative usage across runs and deduplicates retried checkpoints', async () => {
    const first = { sectorId, scope, runId: 'run-one', spentMs: 1000, checkpoint: 1 }
    await Promise.all(Array.from({ length: 20 }, () => recordResearchBudget(pool, first)))
    await recordResearchBudget(pool, { ...first, spentMs: 2500, checkpoint: 2 })
    await recordResearchBudget(pool, first)
    await recordResearchBudget(pool, { ...first, runId: 'run-two', spentMs: 4000 })
    expect(await readResearchBudget(pool, sectorId, scope)).toBe(6500)
    await expect(recordResearchBudget(pool, { ...first, spentMs: 9999 })).rejects.toThrow(/changed on replay/)
    expect(await readResearchBudget(pool, sectorId, scope)).toBe(6500)
  })
  it('denies cross-tenant access and invalid measurements', async () => {
    await expect(readResearchBudget(pool, sectorId, { tenantId: 'foreign', projectId: null })).rejects.toThrow()
    await expect(recordResearchBudget(pool, { sectorId, scope, runId: 'bad', checkpoint: 1, spentMs: -1 })).rejects.toThrow()
  })
})
