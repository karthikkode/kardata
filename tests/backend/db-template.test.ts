import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { derivedUrl, ensureTestDb, prepareTestTemplate, templateIdentity, TEST_DATABASE_URL } from './db-helper.js'

async function admin() {
  const url = new URL(TEST_DATABASE_URL!)
  url.pathname = '/postgres'
  const client = new Client({ connectionString: url.toString() })
  await client.connect()
  return client
}

describe('template identity', () => {
  it('rejects unsafe run identifiers and binds migrations deterministically', () => {
    expect(() => templateIdentity('injected"')).toThrow(/identity/)
    const identity = templateIdentity('a'.repeat(32))
    expect(identity).toEqual(templateIdentity('a'.repeat(32)))
    expect(identity.name.length).toBeLessThanOrEqual(63)
    expect(identity.versions).toHaveLength(24)
    expect(identity.marker).toMatch(/^kardata-test-template:v1:a{32}:[a-f0-9]{64}$/)
    expect(templateIdentity('b'.repeat(32)).marker).not.toBe(identity.marker)
  })
})

describe.skipIf(!TEST_DATABASE_URL)('sealed native test templates', () => {
  const concurrentRunId = randomUUID().replaceAll('-', '')
  const contaminationRunId = randomUUID().replaceAll('-', '')
  beforeAll(async () => {
    // Template migration setup belongs outside feature test clocks.
    await Promise.all([prepareTestTemplate(concurrentRunId), prepareTestTemplate(concurrentRunId)])
    await prepareTestTemplate(contaminationRunId)
  })
  it('concurrent bootstrap publishes one empty sealed source; clones retain schema and isolate writes', async () => {
    const runId = concurrentRunId
    const identity = templateIdentity(runId)
    const client = await admin()
    try {
      const { rows } = await client.query('SELECT datallowconn, datistemplate FROM pg_database WHERE datname = $1', [identity.name])
      expect(rows).toEqual([{ datallowconn: false, datistemplate: false }])
      const configuredRun = process.env['KARDATA_TEST_DB_RUN_ID']!
      // Clone the run prepared by global setup; no environment mutation races.
      expect(templateIdentity(configuredRun).name).not.toBe(identity.name)
      const first = await ensureTestDb('kardata_test_clone_isolation')
      const second = await ensureTestDb('kardata_test_clone_isolation')
      expect(new URL(first).pathname).not.toBe(new URL(second).pathname)
      const a = new Client({ connectionString: first })
      const b = new Client({ connectionString: second })
      await a.connect()
      await b.connect()
      try {
        expect((await a.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map((row: {version: string}) => row.version)).toEqual(identity.versions)
        await a.query("INSERT INTO events (idempotency_key, partition, type) VALUES ('template-isolation', 'test', 'test')")
        expect((await b.query('SELECT count(*)::int AS count FROM events')).rows).toEqual([{ count: 0 }])
        expect((await b.query('SELECT count(*)::int AS count FROM file_processing_jobs')).rows).toEqual([{ count: 0 }])
      } finally {
        await Promise.all([a.end(), b.end()])
      }
    } finally {
      await client.end()
    }
  })

  it('rejects a contaminated source even if its old readiness marker is retained', async () => {
    const runId = contaminationRunId
    const identity = templateIdentity(runId)
    const client = await admin()
    try {
      await client.query(`ALTER DATABASE "${identity.name}" ALLOW_CONNECTIONS true`)
      const source = new Client({ connectionString: derivedUrl(identity.name) })
      await source.connect()
      try {
        await source.query("INSERT INTO events (idempotency_key, partition, type) VALUES ('contamination', 'test', 'test')")
      } finally {
        await source.end()
      }
      await client.query(`ALTER DATABASE "${identity.name}" ALLOW_CONNECTIONS false`)
      vi.stubEnv('KARDATA_TEST_DB_RUN_ID', runId)
      try {
        const outcome = await ensureTestDb('kardata_test_contaminated').then(() => 'accepted', (error: unknown) => error instanceof Error ? error.message : 'unknown error')
        expect(outcome).toBe('Test template contains application data')
      } finally {
        vi.unstubAllEnvs()
      }
    } finally {
      await client.end()
    }
  })

  it('rejects partial, unsealed and identity-mismatched sources without adopting them', async () => {
    const runId = randomUUID().replaceAll('-', '')
    const identity = templateIdentity(runId)
    const client = await admin()
    try {
      await client.query(`CREATE DATABASE "${identity.name}" TEMPLATE template0`)
      await expect(prepareTestTemplate(runId)).rejects.toThrow(/unsealed/)
      await client.query(`ALTER DATABASE "${identity.name}" ALLOW_CONNECTIONS false`)
      await client.query(`COMMENT ON DATABASE "${identity.name}" IS 'wrong-identity'`)
      await expect(prepareTestTemplate(runId)).rejects.toThrow(/identity/)
    } finally {
      await client.end()
    }
    // Interrupted sources remain preserved and unconnectable for inspection.
    expect(new URL(derivedUrl(identity.name)).pathname).toBe(`/${identity.name}`)
  })
})
