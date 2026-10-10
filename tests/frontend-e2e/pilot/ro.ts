// The one read-only DB helper for pilot specs. Connects as the
// kardata_pilot_ro role (CONNECT + SELECT only, B2) with the password
// from the pilot worktree's agents/.env. Statements must be SELECT:
// anything else is refused before touching the database, so a spec
// can never write no matter what the role allows.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { pilotWorktree } from './state.js'

let pool: Pool | null = null

function roPool(): Pool {
  if (pool) return pool
  const envText = readFileSync(join(pilotWorktree(), 'agents', '.env'), 'utf8')
  const password = envText
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('KARDATA_PILOT_RO_PASSWORD='))
    ?.slice('KARDATA_PILOT_RO_PASSWORD='.length)
    .trim()
  if (!password) throw new Error('pilot worktree agents/.env is missing KARDATA_PILOT_RO_PASSWORD')
  pool = new Pool({
    connectionString: `postgresql://kardata_pilot_ro:${encodeURIComponent(password)}@127.0.0.1:5433/kardata_pilot`,
  })
  return pool
}

export async function pilotRoQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (!/^\s*select\b/i.test(sql)) throw new Error('pilot specs query the DB read-only (SELECT only)')
  const { rows } = await roPool().query(sql, params as unknown[])
  return rows as T[]
}

export async function closePilotRo(): Promise<void> {
  await pool?.end()
  pool = null
}
