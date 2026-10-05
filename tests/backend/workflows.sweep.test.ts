// Sector sweep end to end (Phase 6). Gated on KARDATA_TEMPORAL_TEST like
// the other workflow suites: live Temporal + live database. Search answers
// from a local HTTP stub shaped like the Brave endpoint (real HTTP, no
// open internet), so the full path — templates, pagination, domain
// dedupe, ledger + projection writes, terminal transition — is proven.
import { createServer, type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { Client as WorkflowClient } from '@temporalio/client'
import type { NativeConnection, Worker } from '@temporalio/worker'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSector, listSectorCompanies } from '../../backend/src/db/index.js'
import { RetrievalError, type SearchHit } from '../../backend/src/retrieval/web.js'
import { connectClient, connectWorker, temporalNamespace } from '../../backend/src/temporal/connection.js'
import { createLaneWorker } from '../../backend/src/temporal/worker.js'
import {
  loadSweepContextActivity,
  recordSweepCompanyActivity,
  searchWebPageActivity,
  setSweepStateActivity,
} from '../../backend/src/temporal/activities/sweep.js'
import { ensureTestDb } from './db-helper.js'

const ENABLED = process.env['KARDATA_TEMPORAL_TEST'] === '1'
const ADDRESS = process.env['KARDATA_TEMPORAL_ADDRESS'] ?? 'localhost:7233'
const WORKFLOWS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'backend',
  'src',
  'temporal',
  'workflows',
  'sweep.ts',
)

describe.skipIf(!ENABLED)('sector sweep workflow (Phase 6) [F:backend.activity.sweep.searchWebPageActivity] [F:backend.activity.sweep.loadSweepContextActivity] [F:backend.activity.sweep.recordSweepCompanyActivity] [F:backend.activity.sweep.setSweepStateActivity] [F:backend.workflow.sweep.sectorSweep] [F:backend.workflow.sweep.DEFAULT_MAX_PAGES_PER_TEMPLATE] [F:backend.workflow.sweep.sweepProgressQuery]', () => {
  let connection: NativeConnection
  let client: WorkflowClient
  let url = ''
  let worker: Worker
  let run: Promise<void>
  let searchServer: Server
  let searchUrl = ''

  beforeAll(async () => {
    process.env['TEMPORAL_ADDRESS'] = ADDRESS
    url = await ensureTestDb('kardata_test_sweep')
    process.env['DATABASE_URL'] = url
    // Local Brave-shaped search stub: every page returns the same two
    // companies plus a social profile (dropped), so per-page dedupe
    // terminates each template and the run lands exactly two. The stub
    // deliberately ignores the offset: an empty keyed page would fall
    // through to the live keyless/browser legs (sweep fallback chain),
    // making this suite depend on the open internet. Empty-page
    // exhaustion is pinned separately in sweep.search.test.ts with
    // fixture doubles. Domains carry a per-run suffix: company ids
    // derive from the domain hash, so static domains would collide with
    // prior runs in the reused database and the projection's
    // ON CONFLICT DO NOTHING would hide this run's companies.
    const runTag = Date.now().toString(36)
    searchServer = createServer((_request, response) => {
      // Same results on every page: page 1+ yields zero new domains, so
      // the workflow breaks per template on dedupe. Titles and snippets
      // carry sector signals (the relevance gate keeps them); the social
      // profile drops on hosts.
      const results = [
        { title: 'Acme Foods', url: `https://www.acmefoods-${runTag}.example/shop`, description: 'artisanal' },
        { title: 'Beta Pantry', url: `https://betapantry-${runTag}.example`, description: 'artisanal pantry staples' },
        { title: 'Acme social', url: 'https://linkedin.com/company/acmefoods', description: 'social' },
      ]
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ web: { results } }))
    })
    await new Promise<void>((resolve) => {
      searchServer.listen(0, '127.0.0.1', () => resolve())
    })
    searchUrl = `http://127.0.0.1:${(searchServer.address() as AddressInfo).port}/search`
    process.env['KARDATA_WEB_SEARCH_URL'] = searchUrl
    process.env['KARDATA_WEB_SEARCH_KEY'] = 'test-key'
    connection = await connectWorker()
    client = new WorkflowClient({ connection: await connectClient() })
    // Injectable-leg contract: the keyed leg does REAL HTTP against the
    // local stub. It cannot go through webSearch: the public-URL guard
    // admits no loopback destination, so the un-injected path fails the
    // keyed leg and silently falls through to the LIVE keyless leg (open
    // internet, nondeterministic counts). Keyless returns nothing and the
    // browser leg throws, so any stub outage fails loudly, never live.
    const keyedStub = async (query: string, page: number): Promise<SearchHit[]> => {
      const response = await fetch(`${searchUrl}?q=${encodeURIComponent(query)}&count=10&offset=${page}`)
      const body = (await response.json()) as {
        web?: { results?: Array<{ title: string; url: string; description?: string }> }
      }
      return (body.web?.results ?? []).map((result) => ({
        title: result.title,
        url: result.url,
        snippet: result.description ?? '',
      }))
    }
    worker = await createLaneWorker({
      lane: 'research',
      connection,
      namespace: temporalNamespace(),
      workflowsPath: WORKFLOWS_PATH,
      activities: {
        loadSweepContextActivity,
        searchWebPageActivity: (input: { query: string; page: number }) =>
          searchWebPageActivity(input, {
            keyed: keyedStub,
            keyless: async () => [],
            browser: async () => {
              throw new RetrievalError('blocked', 'test: browser leg disabled; the keyed stub must serve every page')
            },
          }),
        recordSweepCompanyActivity,
        setSweepStateActivity,
      },
      taskQueue: `kardata-test-sweep-${Date.now()}`,
    })
    run = worker.run()
    run.catch(() => undefined)
  }, 120_000)

  afterAll(async () => {
    worker.shutdown()
    await run
    await connection.close()
    searchServer.close()
    delete process.env['DATABASE_URL']
    delete process.env['KARDATA_WEB_SEARCH_URL']
    delete process.env['KARDATA_WEB_SEARCH_KEY']
  }, 60_000)

  it('sweeps a sector exhaustively into the ledger and completes', async () => {
    const pool = new Pool({ connectionString: url })
    const sectorId = `sec-sweep-${Date.now()}`
    try {
      await createSector(pool, {
        name: 'Speciality foods sweep',
        topic: 'Artisanal packaged foods',
        scope: { tenantId: 'tenant-sweep', projectId: null },
        sectorId,
        initialState: 'queued',
      })
      const handle = await client.workflow.start('sectorSweep', {
        taskQueue: (worker.options as { taskQueue: string }).taskQueue,
        workflowId: `sector-sweep-${sectorId}`,
        args: [{ sectorId, maxPagesPerTemplate: 3, scope: { tenantId: 'tenant-sweep', projectId: null } }],
      })
      expect(await handle.result()).toBe('complete')
      const companies = await listSectorCompanies(pool, sectorId, { tenantId: 'tenant-sweep', projectId: null })
      // Exhaustion, not the cap: the stub repeats the same two companies
      // on every template, so dedupe lands exactly two.
      expect(companies.total).toBe(2)
      expect(companies.companies.map((company) => company.name).sort()).toEqual(['Acme Foods', 'Beta Pantry'])
      const progress = (await handle.query('sweepProgress')) as { status: string; companiesFound: number }
      expect(progress.status).toBe('complete')
      expect(progress.companiesFound).toBe(2)
    } finally {
      await pool.end()
    }
  }, 180_000)

  it('leaves sector state alone when the run is cancelled mid-flight', async () => {
    const pool = new Pool({ connectionString: url })
    const sectorId = `sec-cancel-${Date.now()}`
    try {
      await createSector(pool, {
        name: 'Cancelled sweep',
        topic: 'Interruption proof',
        scope: { tenantId: 'tenant-sweep', projectId: null },
        sectorId,
        initialState: 'queued',
      })
      const handle = await client.workflow.start('sectorSweep', {
        taskQueue: (worker.options as { taskQueue: string }).taskQueue,
        workflowId: `sector-sweep-${sectorId}`,
        args: [{ sectorId, maxPagesPerTemplate: 3, scope: { tenantId: 'tenant-sweep', projectId: null } }],
      })
      // Cancel immediately: wherever it lands (context load, start
      // transition, or the template loop), the guards must propagate the
      // cancellation instead of writing a failed state over the pause.
      await handle.cancel()
      await expect(handle.result()).rejects.toThrow(/cancel/i)
      const { getSector } = await import('../../backend/src/db/index.js')
      const sector = await getSector(pool, sectorId, { tenantId: 'tenant-sweep', projectId: null })
      expect(sector?.state).not.toBe('failed')
    } finally {
      await pool.end()
    }
  }, 180_000)

  it('records nothing the sector vocabulary cannot evidence, and completes', async () => {
    const pool = new Pool({ connectionString: url })
    const sectorId = `sec-offtopic-${Date.now()}`
    try {
      // The shared stub answers pantry queries: a cryptography sector
      // shares no vocabulary with any stub hit, so the relevance gate
      // drops every candidate and the run still completes honestly.
      await createSector(pool, {
        name: 'Quantum hardware',
        topic: 'Quantum cryptography hardware',
        scope: { tenantId: 'tenant-sweep', projectId: null },
        sectorId,
        initialState: 'queued',
      })
      const handle = await client.workflow.start('sectorSweep', {
        taskQueue: (worker.options as { taskQueue: string }).taskQueue,
        workflowId: `sector-sweep-${sectorId}`,
        args: [{ sectorId, maxPagesPerTemplate: 1, scope: { tenantId: 'tenant-sweep', projectId: null } }],
      })
      expect(await handle.result()).toBe('complete')
      const companies = await listSectorCompanies(pool, sectorId, { tenantId: 'tenant-sweep', projectId: null })
      expect(companies.total).toBe(0)
    } finally {
      await pool.end()
    }
  }, 180_000)
})
