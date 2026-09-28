// Fleet seed: deterministic TEST data for 1000-company scale runs (Phase 1).
// Hermetic part always runs (determinism, labels, counts, stages).
// Live part seeds a real database and proves ingest at volume; it skips
// without TEST_DATABASE_URL like every other live suite.
import { describe, expect, it } from 'vitest'
import { generateFleet } from './fleet-seed.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'
import { createDbPool } from '../../backend/src/db/pool.js'
import { projectNewEvents } from '../../backend/src/projector.js'
import {
  createSector,
  getSector,
  listSectorCompanies,
  markCompanyFound,
} from '../../backend/src/db/sectors.js'
import { ingestSectorDocument, listSectorDocuments } from '../../backend/src/db/sector-documents.js'

const LIVE = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== ''

describe('generateFleet (hermetic)', () => {
  it('is deterministic: same seed gives byte-identical output', () => {
    expect(generateFleet(7, 1000, 12)).toEqual(generateFleet(7, 1000, 12))
  })

  it('differs across seeds', () => {
    expect(generateFleet(7, 100, 4)).not.toEqual(generateFleet(8, 100, 4))
  })

  it('labels every row TEST with unique company names and valid stages', () => {
    const fleet = generateFleet(7, 1000, 12)
    expect(fleet.companies).toHaveLength(1000)
    const names = fleet.companies.map((company) => company.name)
    expect(new Set(names).size).toBe(1000)
    for (const name of names) expect(name.startsWith('TEST ')).toBe(true)
    const stages = new Set(fleet.companies.map((company) => company.stage))
    expect([...stages].sort()).toEqual(['Deep research', 'Filter', 'Final validation', 'Problem found'])
    for (const doc of fleet.docs) {
      expect(doc.filename.startsWith('test-fleet-')).toBe(true)
      expect(doc.text).toContain('TEST DATA')
    }
  })

  it('sizes docs across the chunker cap: small singles plus multi-unit files', () => {
    const fleet = generateFleet(7, 100, 12)
    const big = fleet.docs.filter((doc) => doc.text.length > 2000)
    const small = fleet.docs.filter((doc) => doc.text.length <= 2000)
    expect(big.length).toBeGreaterThan(0)
    expect(small.length).toBeGreaterThan(0)
  })
})

describe.skipIf(!LIVE)('fleet seed at volume (live)', () => {
  it(
    'seeds 1000 companies plus 12 documents into an isolated TEST scope',
    async () => {
      const url = await ensureTestDb('kardata_test_fleet_seed')
      const pool = createDbPool(url, { max: 5, statementTimeoutMs: 60_000 }, 'fleet-seed')
      try {
        const scope = { tenantId: 'test-fleet', projectId: null }
        const sectorId = 'sec-test-fleet-1000'
        await createSector(pool, { name: 'TEST Fleet Sector', topic: 'TEST DATA: thousand-company scale run', scope, sectorId })
        await projectNewEvents(pool)
        const fleet = generateFleet(7, 1000, 12)
        const appendStart = Date.now()
        for (const company of fleet.companies) {
          await markCompanyFound(pool, { sectorId, name: company.name, stage: company.stage, scope })
        }
        const appendMs = Date.now() - appendStart
        const projectStart = Date.now()
        await projectNewEvents(pool)
        const projectMs = Date.now() - projectStart
        console.log(`[fleet-seed] append1000Ms=${appendMs} projectMs=${projectMs}`)

        const sector = await getSector(pool, sectorId, scope)
        expect(sector?.companiesFound).toBe(1000)
        const companies = await listSectorCompanies(pool, sectorId, scope)
        expect(companies).toHaveLength(1000)

        const ingested = []
        for (const doc of fleet.docs) {
          ingested.push(
            await ingestSectorDocument(pool, {
              sectorId,
              filename: doc.filename,
              contentBase64: Buffer.from(doc.text, 'utf8').toString('base64'),
              scope,
            }),
          )
        }
        expect(ingested.every((doc) => doc.status === 'indexed')).toBe(true)
        const listed = await listSectorDocuments(pool, sectorId, scope)
        expect(listed).toHaveLength(12)
        const multi = ingested.filter((doc) => doc.unitCount > 1)
        expect(multi.length).toBeGreaterThan(0)
        console.log(`[fleet-seed] docs=12 multiUnit=${multi.length}`)
      } finally {
        await pool.end()
      }
    },
    600_000,
  )
})
