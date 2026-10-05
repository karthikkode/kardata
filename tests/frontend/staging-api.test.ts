// Staging API client proof (B6.1 entry): talks to a live backend.
// Gate: KARDATA_STAGING_URL + KARDATA_STAGING_KEY (operator key).
// Provision once, then persist in the dev volume:
//   docker compose -f deployment/compose.yaml exec -T db psql -U kardata -d kardata \
//     -c "INSERT INTO api_keys (key_id, key_hash, tenant_id, roles) VALUES
//     ('staging-client', encode(sha256('STAGING-KEY-DEV'), 'hex'), 'tenant-a', 'operator')
//     ON CONFLICT (key_id) DO NOTHING;"
// Note: api_keys stores sha256 hex of the presented key;
// replace the key value and keep it out of the repo.
import { beforeAll, describe, expect, it } from 'vitest'
import { attachSectorDocument, listSectorDocuments } from '../../frontend/src/data/api/files.js'
import { createSector, getSectorDetail, listSectors, startSector } from '../../frontend/src/data/api/sectors.js'
import { createSession, getSession, listSessions } from '../../frontend/src/data/api/sessions.js'
import { listCompanies } from '../../frontend/src/data/api/companies.js'
import { listSessionArtifacts, listTenantArtifacts, referenceArtifact } from '../../frontend/src/data/api/artifacts.js'
import { listThreads } from '../../frontend/src/data/api/threads.js'
import { stagingEnabled, StagingApiError, type StagingConfig } from '../../frontend/src/data/api/client.js'

const URL = process.env['KARDATA_STAGING_URL']
const KEY = process.env['KARDATA_STAGING_KEY']
const ENABLED = URL !== undefined && URL !== '' && KEY !== undefined && KEY !== ''

describe.skipIf(!ENABLED)('staging api client', () => {
  let config: StagingConfig

  beforeAll(() => {
    config = { baseUrl: URL ?? '', apiKey: KEY ?? '' }
    expect(stagingEnabled()).toBe(true)
  })

  it('lists and creates sessions', async () => {
    const before = await listSessions(config)
    expect(Array.isArray(before)).toBe(true)
    const created = await createSession(config, `staging-probe-${Date.now()}`)
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
    const fetched = await getSession(config, created.id)
    expect(fetched.title).toBe(created.title)
    const threads = await listThreads(config, created.id)
    expect(threads.length).toBeGreaterThanOrEqual(1)
  })

  it('lists artifacts (empty for a fresh session)', async () => {
    const created = await createSession(config, `staging-artifacts-${Date.now()}`)
    await expect(listSessionArtifacts(config, created.id)).resolves.toEqual([])
  })

  it('denies bad keys with the permission envelope', async () => {
    const bad: StagingConfig = { baseUrl: config.baseUrl, apiKey: 'wrong' }
    const error = await listSessions(bad).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StagingApiError)
    expect((error as StagingApiError).status).toBe(403)
  })

  it('lists sectors and companies without fixtures', async () => {
    expect(Array.isArray(await listSectors(config))).toBe(true)
    expect(Array.isArray(await listSectors(config, { state: 'running', query: 'pet' }))).toBe(true)
    const page = await listCompanies(config)
    expect(Array.isArray(page.companies)).toBe(true)
    expect(page.total).toBeGreaterThanOrEqual(page.companies.length)
    expect(Array.isArray(await listTenantArtifacts(config))).toBe(true)
  })

  it('creates a draft, attaches context, and starts it', async () => {
    const draft = await createSector(config, { name: `staging-draft-${Date.now()}`, topic: 'live probe' })
    expect(draft.state).toBe('draft')
    const attached = await attachSectorDocument(config, draft.id, {
      filename: 'probe.md',
      contentBase64: Buffer.from('# probe\nlive context').toString('base64'),
    })
    expect(attached.filename).toBe('probe.md')
    const docs = await listSectorDocuments(config, draft.id)
    expect(docs.map((doc) => doc.filename)).toContain('probe.md')
    const started = await startSector(config, draft.id)
    expect(started.state).toBe('queued')
  })

  it('answers unknown sector and reference ids with 404', async () => {
    const missing = await getSectorDetail(config, 'sec-missing-live').catch((e: unknown) => e)
    expect(missing).toBeInstanceOf(StagingApiError)
    expect((missing as StagingApiError).status).toBe(404)
    const created = await createSession(config, `staging-ref-${Date.now()}`)
    const ref = await referenceArtifact(config, created.id, 'art-missing-live', {
      kind: 'session',
      id: created.id,
    }).catch((e: unknown) => e)
    expect(ref).toBeInstanceOf(StagingApiError)
    expect((ref as StagingApiError).status).toBe(404)
  })
})
