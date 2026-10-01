import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const compose = parse(readFileSync(fileURLToPath(new URL('../../deployment/compose.yaml', import.meta.url)), 'utf8')) as { services: { db: { shm_size?: string; command: string[] } } }
describe('Postgres deployment resource budget', () => {
  it('provides shared memory for parallel query work without increasing connection fan-out', () => {
    expect(compose.services.db.shm_size).toBe('1gb')
    expect(compose.services.db.command).toContain('max_connections=100')
  })
})
