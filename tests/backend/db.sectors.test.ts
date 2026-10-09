// Sector research repo contract (B-S2/B-S3). Hermetic validation proofs
// need no database; the lifecycle suite runs against the live database and
// skips explicitly without TEST_DATABASE_URL.
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assertSectorTransition,
  createSector,
  createSession,
  DbContractError,
  getSector,
  readSectorExecutionState,
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
    await expect(listCompanies(db, undefined, {}, { limit: 0 })).rejects.toBeInstanceOf(DbContractError)
    await expect(listCompanies(db, undefined, {}, { limit: 501 })).rejects.toBeInstanceOf(DbContractError)
    await expect(listCompanies(db, undefined, {}, { offset: -1 })).rejects.toBeInstanceOf(DbContractError)
    await expect(listSectorCompanies(db, 's', undefined, {}, { limit: 0 })).rejects.toBeInstanceOf(
      DbContractError,
    )
    await expect(sectorActivity(db, 's', undefined, { limit: 501 })).rejects.toBeInstanceOf(
      DbContractError,
    )
    expect(wasQueried()).toBe(false)
  })

  describe.skipIf(!ENABLED)('lifecycle against Postgres [F:db.index.createSector] [F:db.index.createSession] [F:db.index.markCompanyFound] [F:db.index.setSectorState] [F:db.index.DbContractError] [F:db.index.projectBatch] [F:db.index.readEventsAfter] [F:db.index.listSectorCompanies] [F:db.index.rebuildFromEvents] [F:db.index.assertSectorTransition] [F:db.index.getSector] [F:db.index.readSectorExecutionState] [F:db.index.listCompanies] [F:db.index.listSectors] [F:db.index.recordResearchSession] [F:db.index.sectorActivity] [F:db.index.setCompanyStage] [F:db.index.setCompanyState] [F:db.sectors.createSector] [F:db.sectors.getSector] [F:db.sectors.listSectorCompanies] [F:db.sectors.markCompanyFound] [F:db.sectors.assertSectorTransition] [F:db.sessions.createSession] [F:db.sectors.setSectorState] [F:db.errors.DbContractError] [F:db.threads.projectBatch] [F:db.events.readEventsAfter] [F:db.threads.rebuildFromEvents] [F:db.sectors.readSectorExecutionState] [F:db.sectors.listCompanies] [F:db.sectors.listSectors] [F:db.sectors.recordResearchSession] [F:db.sectors.sectorActivity] [F:db.sectors.setCompanyStage] [F:db.sectors.setCompanyState] [F:db.index.StoredEvent] [F:db.workspace.WorkspaceError] [F:db.workspace.requireSector]', () => {
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
      expect(companies.total).toBe(2)
      expect(companies.companies.map((entry) => entry.name).sort()).toEqual(['Acme Audio', 'West Paw'])
      const west = companies.companies.find((entry) => entry.id === companyId)
      expect(west).toMatchObject({ stage: 'Final validation', state: 'running', sectorName: 'Pet care' })
      // Fresh discovery defaults: Filter stage, running state.
      expect(companies.companies.find((entry) => entry.id === `t-acme-${STAMP}`)).toMatchObject({
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
      expect(paused.companies.map((entry) => entry.id)).toContain(`t-acme-${STAMP}`)
      const deep = await listSectorCompanies(pool, `t-pet-care-${STAMP}`, SCOPE, { query: 'acme' })
      expect(deep.companies).toHaveLength(1)
      expect(deep.total).toBe(1)
      expect(deep.companies[0]).toMatchObject({ stage: 'Deep research', state: 'paused' })
      // Other tenants see nothing.
      expect(await listSectors(pool, OTHER)).toEqual([])
      expect(await listCompanies(pool, OTHER)).toEqual({ companies: [], total: 0 })
      expect(await getSector(pool, `t-pet-care-${STAMP}`, OTHER)).toBeUndefined()
    })

    it('walks the plan-mandatory states and filters them', async () => {
      const { sectorId } = await createSector(pool, {
        name: 'Planned sector',
        topic: 'Planned topic',
        scope: SCOPE,
        sectorId: `t-planned-${STAMP}`,
        idempotencyKey: `t:sector:planned-${STAMP}`,
        initialState: 'draft',
      })
      await catchUp()
      for (const state of ['planning', 'planned', 'approved'] as const) {
        const current = (await getSector(pool, sectorId, SCOPE))?.state
        assertSectorTransition(current ?? 'draft', state)
        await setSectorState(pool, sectorId, state, { scope: SCOPE })
        await catchUp()
        expect((await getSector(pool, sectorId, SCOPE))?.state).toBe(state)
      }
      expect((await listSectors(pool, SCOPE, { state: 'approved' })).map((entry) => entry.id)).toContain(sectorId)
      assertSectorTransition('approved', 'queued')
      await setSectorState(pool, sectorId, 'queued', { scope: SCOPE })
      await catchUp()
      expect((await listSectors(pool, SCOPE, { state: 'approved' })).map((entry) => entry.id)).not.toContain(
        sectorId,
      )
    })

    it('pages company and activity reads with truthful totals', async () => {
      const { sectorId } = await createSector(pool, {
        name: 'Paging',
        topic: 'Page windows',
        scope: SCOPE,
        sectorId: `t-paging-${STAMP}`,
        idempotencyKey: `t:sector:paging-${STAMP}`,
      })
      await catchUp()
      for (let i = 0; i < 5; i++) {
        await markCompanyFound(pool, {
          sectorId,
          name: `Page Co ${i}`,
          scope: SCOPE,
          companyId: `t-page-${i}-${STAMP}`,
          idempotencyKey: `t:company:page-${i}-${STAMP}`,
        })
      }
      await catchUp()

      const first = await listSectorCompanies(pool, sectorId, SCOPE, {}, { limit: 2, offset: 0 })
      expect(first.companies).toHaveLength(2)
      expect(first.total).toBe(5)
      const last = await listSectorCompanies(pool, sectorId, SCOPE, {}, { limit: 2, offset: 4 })
      expect(last.companies).toHaveLength(1)
      expect(last.total).toBe(5)
      const past = await listSectorCompanies(pool, sectorId, SCOPE, {}, { limit: 2, offset: 5 })
      expect(past.companies).toEqual([])
      expect(past.total).toBe(5)
      const wide = await listCompanies(pool, SCOPE, { query: 'Page Co' })
      expect(wide.total).toBeGreaterThanOrEqual(5)
      expect(wide.companies.length).toBeLessThanOrEqual(100)

      const head = await sectorActivity(pool, sectorId, SCOPE, { limit: 2, offset: 0 })
      expect(head.entries).toHaveLength(2)
      expect(head.total).toBeGreaterThanOrEqual(6)
      const tail = await sectorActivity(pool, sectorId, SCOPE, { limit: 2, offset: head.total })
      expect(tail.entries).toEqual([])
      expect(tail.total).toBe(head.total)
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
      const texts = activity.entries.map((entry) => entry.text)
      expect(texts[0]).toBe('Research started for D2C pet brands.')
      expect(texts).toContain('West Paw found.')
      expect(texts).toContain('Acme Audio moved to Deep research.')
      expect(texts).toContain('Research running.')
      const seqs = activity.entries.map((entry) => entry.seq)
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)
      await expect(sectorActivity(pool, `t-missing-${STAMP}`, SCOPE)).rejects.toBeInstanceOf(DbContractError)
    })

    it('reads committed lifecycle independently of projector lag and enforces owner scope', async () => {
      const created = await createSector(pool, { name: 'TEST lifecycle lag', initialState: 'draft', scope: SCOPE })
      await catchUp()
      await setSectorState(pool, created.sectorId, 'paused', { scope: SCOPE })
      expect((await getSector(pool, created.sectorId, SCOPE))?.state).toBe('draft')
      expect(await readSectorExecutionState(pool, created.sectorId, SCOPE)).toBe('paused')
      await expect(readSectorExecutionState(pool, created.sectorId, OTHER)).rejects.toBeInstanceOf(DbContractError)
      await catchUp()
      expect((await getSector(pool, created.sectorId, SCOPE))?.state).toBe('paused')
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
