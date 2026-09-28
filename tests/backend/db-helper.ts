// Shared live-DB harness for backend suites. Each DB-touching file owns a
// separate database so files stay parallel-safe and order-independent.
// Gated on TEST_DATABASE_URL; callers skip explicitly without it.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { migrate } from '../../backend/src/db/migrate.js'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations')

export const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL']

export function derivedUrl(dbName: string): string {
  const url = new URL(TEST_DATABASE_URL as string)
  url.pathname = `/${dbName}`
  return url.toString()
}

/** Creates the database (tolerating a prior run) and migrates it up. */
export async function ensureTestDb(dbName: string): Promise<string> {
  const url = derivedUrl(dbName)
  const admin = new URL(TEST_DATABASE_URL as string)
  admin.pathname = '/postgres'
  const client = new Client({ connectionString: admin.toString() })
  await client.connect()
  try {
    await client.query(`CREATE DATABASE ${dbName}`)
  } catch (error) {
    if (!/already exists/i.test((error as Error).message)) throw error
  } finally {
    await client.end()
  }
  await migrate(url, DIR, 'up')
  return url
}
