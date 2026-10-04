// Every invocation owns a fresh DB. Vitest may clone a sealed schema-only source.
import { dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { migrate, migrationFiles } from '../../backend/src/db/migrate.js'
import { createLogger, logOp } from '../../backend/src/observability/logging.js'

const logger = createLogger({ op: 'db.test-isolation' })
const CLIENT_BOUNDS = { connectionTimeoutMillis: 10000, statement_timeout: 300000 }
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations')
export const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL']
export const TEMPLATE_RUN_ENV = 'KARDATA_TEST_DB_RUN_ID'

export function derivedUrl(dbName: string): string {
  // kardata_live_<suite> is the live-Meta suite prefix (tests/backend/live):
  // same isolation guarantees as kardata_test_, never a real database name.
  if (!/^kardata_(test|live)_[a-z0-9_]+$/.test(dbName) || dbName.length > 63) {
    throw new Error('Expected an isolated test database name (kardata_test_<suite> or kardata_live_<suite>, at most 63 characters)')
  }
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required for live database tests')
  const url = new URL(TEST_DATABASE_URL)
  url.pathname = `/${dbName}`
  return url.toString()
}

export function templateIdentity(runId: string): { name: string; marker: string; versions: string[] } {
  if (!/^[a-f0-9]{32}$/.test(runId)) throw new Error('Invalid test template run identity')
  const files = migrationFiles(DIR)
  const hash = createHash('sha256')
  for (const file of files) hash.update(file).update('\0').update(readFileSync(join(DIR, file))).update('\0')
  const digest = hash.digest('hex')
  return {
    name: `kardata_test_template_${runId}`,
    marker: `kardata-test-template:v1:${runId}:${digest}`,
    versions: files.map((file) => file.slice(0, -4)),
  }
}

function adminClient(): Client {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required for live database tests')
  const url = new URL(TEST_DATABASE_URL)
  url.pathname = '/postgres'
  return new Client({ connectionString: url.toString(), ...CLIENT_BOUNDS })
}

async function templateRow(client: Client, name: string) {
  const result = await client.query<{ owned: boolean; datallowconn: boolean; datistemplate: boolean; marker: string | null }>(
    `SELECT datdba = (SELECT oid FROM pg_roles WHERE rolname = current_user) AS owned,
      datallowconn, datistemplate, shobj_description(oid, 'pg_database') AS marker
     FROM pg_database WHERE datname = $1`, [name],
  )
  return result.rows[0]
}

async function validateSealed(client: Client, identity: ReturnType<typeof templateIdentity>): Promise<void> {
  const row = await templateRow(client, identity.name)
  if (!row?.owned || row.datallowconn || row.datistemplate || row.marker !== identity.marker) {
    throw new Error('Test template is missing, unsealed, unowned or has a different migration identity')
  }
}

async function validateEmptySchema(source: Client, identity: ReturnType<typeof templateIdentity>): Promise<void> {
  const applied = await source.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version')
  if (JSON.stringify(applied.rows.map((row) => row.version)) !== JSON.stringify(identity.versions)) {
    throw new Error('Test template migration set is incomplete')
  }
  const tables = await source.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'")
  for (const { tablename } of tables.rows) {
    const quoted = tablename.replaceAll('"', '""')
    const count = await source.query<{ populated: boolean }>(`SELECT EXISTS (SELECT 1 FROM "${quoted}") AS populated`)
    if (count.rows[0]?.populated) throw new Error('Test template contains application data')
  }
}

/** Bootstrap occurs outside feature test clocks. Never adopt a partial source. */
export async function prepareTestTemplate(runId: string): Promise<void> {
  const identity = templateIdentity(runId)
  return logOp(logger, 'db.test-template.prepare', () => executeTemplatePreparation(identity), { runId, migrationCount: identity.versions.length })
}

async function executeTemplatePreparation(identity: ReturnType<typeof templateIdentity>): Promise<void> {
  const runId = identity.name.slice('kardata_test_template_'.length)
  derivedUrl(identity.name)
  const admin = adminClient()
  await admin.connect()
  try {
    await admin.query("SET lock_timeout = '30s'")
    await admin.query('SELECT pg_advisory_lock(hashtext($1))', [`kardata:test-template:${runId}`])
    const existing = await templateRow(admin, identity.name)
    if (existing) {
      await validateSealed(admin, identity)
      return
    }
    await admin.query(`CREATE DATABASE "${identity.name}" TEMPLATE template0`)
    const sourceUrl = derivedUrl(identity.name)
    await migrate(sourceUrl, DIR, 'up')
    const source = new Client({ connectionString: sourceUrl, ...CLIENT_BOUNDS })
    await source.connect()
    try {
      await validateEmptySchema(source, identity)
    } finally {
      await source.end()
    }
    // Sealing is the readiness barrier. No marker is published on a failed build.
    await admin.query(`ALTER DATABASE "${identity.name}" ALLOW_CONNECTIONS false`)
    const connections = await admin.query<{ present: boolean }>('SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = $1) AS present', [identity.name])
    if (connections.rows[0]?.present) throw new Error('Test template still has active connections')
    // Marker contains only validated UUID/hash bytes, never connection material.
    await admin.query(`COMMENT ON DATABASE "${identity.name}" IS '${identity.marker}'`)
    await validateSealed(admin, identity)
  } finally {
    // Closing also releases the session advisory lock, including failure paths.
    await admin.end()
  }
}

/** Every invocation owns a fresh UUID DB; the configured base is never mutated.
 * Outside configured Vitest runs, retain the original fresh-migration path. */
export async function ensureTestDb(dbName: string): Promise<string> {
  derivedUrl(dbName)
  return logOp(logger, 'db.test-database.create', () => executeTestDb(dbName))
}

async function executeTestDb(dbName: string): Promise<string> {
  const isolatedName = `${dbName.slice(0, 46)}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
  const url = derivedUrl(isolatedName)
  const runId = process.env[TEMPLATE_RUN_ENV]
  const identity = runId ? templateIdentity(runId) : undefined
  const client = adminClient()
  await client.connect()
  try {
    await client.query("SET lock_timeout = '30s'")
    if (identity) await validateSealed(client, identity)
    await client.query(`CREATE DATABASE "${isolatedName}"${identity ? ` TEMPLATE "${identity.name}" STRATEGY WAL_LOG` : ''}`)
  } finally {
    await client.end()
  }
  if (!identity) await migrate(url, DIR, 'up')
  else {
    const clone = new Client({ connectionString: url, ...CLIENT_BOUNDS })
    await clone.connect()
    try {
      await validateEmptySchema(clone, identity)
    } finally {
      await clone.end()
    }
  }
  return url
}
