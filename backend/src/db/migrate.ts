// Minimal SQL migrator. B0.3. Migration files live in db/migrations and
// carry `-- migrate:up` / `-- migrate:down` sections; up runs in one
// transaction and records the version, down reverses it. No ORM, no magic.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'

export type Direction = 'up' | 'down'

function splitSections(text: string): { up: string; down: string } {
  const marker = (name: string): number => {
    const index = text.split('\n').findIndex((line) => line.trim() === `-- migrate:${name}`)
    if (index === -1) throw new Error(`migration missing -- migrate:${name} marker`)
    return index
  }
  const lines = text.split('\n')
  const up = lines.slice(marker('up') + 1, marker('down')).join('\n')
  const down = lines.slice(marker('down') + 1).join('\n')
  return { up, down }
}

export function migrationFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
}

export async function migrate(connectionString: string, dir: string, direction: Direction): Promise<string[]> {
  const applied: string[] = []
  const client = new Client({ connectionString })
  await client.connect()
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    )
    const { rows } = await client.query<{ version: string }>('SELECT version FROM schema_migrations')
    const recorded = new Set(rows.map((row) => row.version))
    const files = direction === 'up' ? migrationFiles(dir) : migrationFiles(dir).reverse()
    for (const file of files) {
      const version = file.replace(/\.sql$/, '')
      if (direction === 'up' && recorded.has(version)) continue
      if (direction === 'down' && !recorded.has(version)) continue
      const { up, down } = splitSections(readFileSync(join(dir, file), 'utf8'))
      await client.query('BEGIN')
      try {
        // Down runs destructive SQL that may drop schema_migrations itself,
        // so the bookkeeping row goes first; up records after its SQL lands.
        if (direction === 'down') {
          await client.query('DELETE FROM schema_migrations WHERE version = $1', [version])
        }
        await client.query(direction === 'up' ? up : down)
        if (direction === 'up') {
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version])
        }
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
      applied.push(`${direction}:${version}`)
    }
  } finally {
    await client.end()
  }
  return applied
}
