// Sector research repo contract (B-S2/B-S3). Hermetic validation proofs
// need no database; the lifecycle suite runs against the live database and
// skips explicitly without TEST_DATABASE_URL.
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createSector,
  createSession,
  DbContractError,
  getSector,
  listCompanies,
  listSectors,
  listSectorCompanies,
  markCompanyFound,
  projectBatch,
  readEventsAfter,
  rebuildFromEvents,
  recordResearchSession,
  sectorActivity,
  setCompanyStage,
  setCompanyState,
  setSectorState,
} from '../../backend/src/db/index.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

const ENABLED = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''
const SCOPE = { tenantId: 'tenant-sector', projectId: null }
const STAMP = randomUUID()
const OTHER = { tenantId: 'tenant-other', projectId: null }

function untouchedDb(): { db: { query: () => Promise<never> }; wasQueried: () => boolean } {
  let queried = false
  return {
    db: {
      query: async (): Promise<never> => {
        queried = true
        throw new Error('must not touch the database')
      },
    },
    wasQueried: () => queried,
  }
}

describe('sector repos (B-S2)', () => {
  it('rejects misaligned calls before any SQL', async () => {
    const { db, wasQueried } = untouchedDb()
    await expect(createSector(db, { name: '' })).rejects.toBeInstanceOf(DbContractError)
    await expect(setSectorState(db, 's', 'bogus' as never)).rejects.toBeInstanceOf(DbContractError)
    await expect(
      markCompanyFound(db, { sectorId: 's', name: 'n', stage: 'bogus' as never }),
    ).rejects.toBeInstanceOf(DbContractError)
    await expect(setCompanyStage(db, 'c', 'bogus' as never)).rejects.toBeInstanceOf(DbContractError)
    await expect(listSectors(db, undefined, { state: 'bogus' as never })).rejects.toBeInstanceOf(
      DbContractError,
    )
    await expect(listCompanies(db, undefined, { query: 'x'.repeat(201) })).rejects.toBeInstanceOf(
      DbContractError,
    )
    await expect(sectorActivity(db, '', undefined)).rejects.toBeInstanceOf(DbContractError)
    expect(wasQueried()).toBe(false)
  })

  describe.skipIf(!ENABLED)('lifecycle against Postgres', () => {
    let pool: Pool

    async function catchUp(): Promise<void> {
      let from = 0
      for (;;) {
        const batch = await readEventsAfter(pool, from, 500)
        if (batch.length === 0) break
        await projectBatch(pool, batch)
        const last = batch[batch.length - 1]
        if (!last) break
        from = Number(last.seq)
      }
    }

    beforeAll(async () => {
      const url = await ensureTestDb('kardata_test_sectors')
      pool = new Pool({ connectionString: url })
    }, 120_000)

    afterAll(async () => {
      await pool?.end()
    })

    it('creates, lists, and counts companies per sector', async () => {
      const { sectorId } = await createSector(pool, {
        name: 'Pet care',
        topic: 'D2C pet brands',
        scope: SCOPE,
        sectorId: `t-pet-care-${STAMP}`,
        idempotencyKey: `t:sector:pet-care-${STAMP}`,
      })
      await catchUp()
      // Writers read the projection: unknown sectors fail before appending.
      await expect(setSectorState(pool, `t-missing-${STAMP}`, 'running', { scope: SCOPE })).rejects.toBeInstanceOf(
        DbContractError,
      )
      const { companyId } = await markCompanyFound(pool, {
        sectorId,
        name: 'West Paw',
        stage: 'Final validation',
        state: 'running',
        scope: SCOPE,
        companyId: `t-west-paw-${STAMP}`,
        idempotencyKey: `t:company:west-paw-${STAMP}`,
      })
      await markCompanyFound(pool, {
        sectorId,
        name: 'Acme Audio',
        scope: SCOPE,
        companyId: `t-acme-${STAMP}`,
        idempotencyKey: `t:company:acme-${STAMP}`,
      })
      await catchUp()

      const sector = await getSector(pool, sectorId, SCOPE)
      expect(sector).toMatchObject({
        name: 'Pet care',
        topic: 'D2C pet brands',
        state: 'queued',
        companiesFound: 2,
        researchSessionId: null,
      })
      const companies = await listSectorCompanies(pool, sectorId, SCOPE)
      expect(companies.map((entry) => entry.name).sort()).toEqual(['Acme Audio', 'West Paw'])
      const west = companies.find((entry) => entry.id === companyId)
      expect(west).toMatchObject({ stage: 'Final validation', state: 'running', sectorName: 'Pet care' })
      // Fresh discovery defaults: Filter stage, running state.
      expect(companies.find((entry) => entry.id === `t-acme-${STAMP}`)).toMatchObject({
        stage: 'Filter',
        state: 'running',
      })
    })

    it('filters by state and text across scopes', async () => {
      await setSectorState(pool, `t-pet-care-${STAMP}`, 'running', { scope: SCOPE })
      await setCompanyState(pool, `t-acme-${STAMP}`, 'paused', { scope: SCOPE })
      await setCompanyStage(pool, `t-acme-${STAMP}`, 'Deep research', { scope: SCOPE })
      await catchUp()

      expect((await listSectors(pool, SCOPE, { state: 'running' })).map((entry) => entry.id)).toContain(
        `t-pet-care-${STAMP}`,
      )
      expect(await listSectors(pool, SCOPE, { state: 'failed' })).toEqual([])
      expect((await listSectors(pool, SCOPE, { query: 'pet' })).map((entry) => entry.id)).toContain(
        `t-pet-care-${STAMP}`,
      )
      const paused = await listCompanies(pool, SCOPE, { state: 'paused' })
      expect(paused.map((entry) => entry.id)).toContain(`t-acme-${STAMP}`)
      const deep = await listSectorCompanies(pool, `t-pet-care-${STAMP}`, SCOPE, { query: 'acme' })
      expect(deep).toHaveLength(1)
      expect(deep[0]).toMatchObject({ stage: 'Deep research', state: 'paused' })
      // Other tenants see nothing.
      expect(await listSectors(pool, OTHER)).toEqual([])
      expect(await listCompanies(pool, OTHER)).toEqual([])
      expect(await getSector(pool, `t-pet-care-${STAMP}`, OTHER)).toBeUndefined()
    })

    it('projects the research session pin from the start event', async () => {
      const chat = await createSession(pool, 'Pet care chat', SCOPE, `t-pet-care-${STAMP}`)
      await recordResearchSession(pool, `t-pet-care-${STAMP}`, chat.id, { scope: SCOPE })
      await catchUp()
      const sector = await getSector(pool, `t-pet-care-${STAMP}`, SCOPE)
      expect(sector).toMatchObject({ researchSessionId: chat.id })
      // Replay-safe: a second projection keeps the same pin.
      await catchUp()
      expect(await getSector(pool, `t-pet-care-${STAMP}`, SCOPE)).toMatchObject({ researchSessionId: chat.id })
      await expect(recordResearchSession(pool, `t-missing-${STAMP}`, chat.id, { scope: SCOPE })).rejects.toBeInstanceOf(
        DbContractError,
      )
    })

    it('derives the activity timeline from the sector partition', async () => {
      const activity = await sectorActivity(pool, `t-pet-care-${STAMP}`, SCOPE)
      const texts = activity.map((entry) => entry.text)
      expect(texts[0]).toBe('Research started for D2C pet brands.')
      expect(texts).toContain('West Paw found.')
      expect(texts).toContain('Acme Audio moved to Deep research.')
      expect(texts).toContain('Research running.')
      const seqs = activity.map((entry) => entry.seq)
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)
      await expect(sectorActivity(pool, `t-missing-${STAMP}`, SCOPE)).rejects.toBeInstanceOf(DbContractError)
    })

    it('replays idempotently and rebuilds from events', async () => {
      const before = await listSectors(pool, SCOPE)
      await catchUp()
      expect(await listSectors(pool, SCOPE)).toEqual(before)
      const events = await readEventsAfter(pool, 0, 10_000)
      const partition = events.filter(
        (event) => event.partition === `sector:t-pet-care-${STAMP}`,
      )
      await rebuildFromEvents(pool, partition)
      const sector = await getSector(pool, `t-pet-care-${STAMP}`, SCOPE)
      expect(sector).toMatchObject({ state: 'running', companiesFound: 2 })
    })
  })
})
