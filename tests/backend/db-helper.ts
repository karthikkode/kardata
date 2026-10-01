// Shared live-DB harness for backend suites. Each DB-touching file owns a
// separate database so files stay parallel-safe and order-independent.
// Gated on TEST_DATABASE_URL; callers skip explicitly without it.
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { migrate } from '../../backend/src/db/migrate.js'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations')

export const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL']

export function derivedUrl(dbName: string): string {
  if (!/^kardata_test_[a-z0-9_]+$/.test(dbName) || dbName.length > 63) {
    throw new Error('Expected an isolated test database name (kardata_test_<suite>, at most 63 characters)')
  }
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required for live database tests')
  const url = new URL(TEST_DATABASE_URL as string)
  url.pathname = `/${dbName}`
  return url.toString()
}

/** Each invocation owns a fresh database. Never reuse a half-migrated
 * database from an interrupted run, and never mutate the configured base. */
export async function ensureTestDb(dbName: string): Promise<string> {
  derivedUrl(dbName)
  const isolatedName = `${dbName.slice(0, 46)}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
  const url = derivedUrl(isolatedName)
  const admin = new URL(TEST_DATABASE_URL as string)
  admin.pathname = '/postgres'
  const client = new Client({ connectionString: admin.toString() })
  await client.connect()
  try {
    await client.query(`CREATE DATABASE "${isolatedName}"`)
  } finally {
    await client.end()
  }
  await migrate(url, DIR, 'up')
  return url
}
