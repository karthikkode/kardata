import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSector, listSectorCompanies, markCompanyFound, readEventsAfter, rebuildFromEvents, registerLedgerCandidate, registerSectorDiscovery, upsertLedgerCompany } from '../../backend/src/db/index.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

describe.skipIf(!TEST_DATABASE_URL)('discovery identity and evidence preservation', () => {
  let pool: Pool
  const scope = { tenantId: 'test-discovery', projectId: null }
  beforeAll(async () => { pool = new Pool({ connectionString: await ensureTestDb('kardata_test_discovery_integrity') }) })
  afterAll(async () => { await pool?.end() })

  it('deduplicates within a sector while allowing the same domain in another sector', async () => {
    const first = await createSector(pool, { name: 'TEST first sector', scope })
    const second = await createSector(pool, { name: 'TEST second sector', scope })
    await projectNewEvents(pool)
    const twins = await Promise.all(Array.from({ length: 20 }, () => registerSectorDiscovery(pool, { sectorId: first.sectorId, domain: 'example.test', name: 'TEST example', scope })))
    const elsewhere = await registerSectorDiscovery(pool, { sectorId: second.sectorId, domain: 'example.test', name: 'TEST example', scope })
    expect(new Set(twins.map((entry) => entry.companyId)).size).toBe(1)
    expect(elsewhere.companyId).not.toBe(twins[0]?.companyId)
    await projectNewEvents(pool)
    expect((await listSectorCompanies(pool, first.sectorId, scope)).total).toBe(1)
    expect((await listSectorCompanies(pool, second.sectorId, scope)).total).toBe(1)
    await rebuildFromEvents(pool, await readEventsAfter(pool, 0, 1000))
    expect((await listSectorCompanies(pool, second.sectorId, scope)).total).toBe(1)
  })

  it('adopts the legacy identity only in its owning sector', async () => {
    const sector = await createSector(pool, { name: 'TEST legacy sector', scope })
    await projectNewEvents(pool)
    await markCompanyFound(pool, { sectorId: sector.sectorId, companyId: 'legacy-company', name: 'TEST legacy company', idempotencyKey: `sweep-found:${sector.sectorId}:legacy.test`, scope })
    await projectNewEvents(pool)
    expect(await registerSectorDiscovery(pool, { sectorId: sector.sectorId, domain: 'legacy.test', name: 'TEST legacy company', scope })).toEqual({ companyId: 'legacy-company' })
  })

  it('does not downgrade a researched ledger company during rediscovery', async () => {
    const existing = await upsertLedgerCompany(pool, { domain: 'researched.test', name: 'TEST researched', qualification: 'qualified', qualificationReason: 'Evidence-backed verdict', scaleSignal: 'Verified scale', contactRef: 'Saved contact' })
    const discovered = await registerLedgerCandidate(pool, { domain: 'researched.test', name: 'Changed discovery label', sector: 'Another sector', qualificationReason: 'Search snippet' })
    expect(discovered).toMatchObject({ id: existing.id, name: 'TEST researched', qualification: 'qualified', qualificationReason: 'Evidence-backed verdict', scaleSignal: 'Verified scale', contactRef: 'Saved contact' })
  })
})
