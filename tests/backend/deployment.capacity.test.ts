import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const compose = parse(readFileSync(fileURLToPath(new URL('../../deployment/compose.yaml', import.meta.url)), 'utf8')) as { services: { db: { shm_size?: string; command: string[]; restart?: string }; temporal: { restart?: string } } }
const ci = parse(readFileSync(fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url)), 'utf8')) as { jobs: { verify: { steps: Array<{ run?: string; env?: Record<string, string> }> }; integration: { services: { postgres: { options?: string } }; steps: Array<{ run?: string; env?: Record<string, string> }> } } }
describe('Postgres deployment resource budget', () => {
  it('provides shared memory for parallel query work without increasing connection fan-out', () => {
    expect(compose.services.db.shm_size).toBe('1gb')
    expect(compose.services.db.command).toContain('max_connections=100')
  })
  it('runs the CI Postgres battery with the verified shared-memory budget', () => {
    const options = ci.jobs.integration.services.postgres.options?.split(/\s+/) ?? []
    expect(options).toContain('--shm-size=1g')
    expect(compose.services.db.shm_size).toBe('1gb')
  })
  it('gates durable PDF recovery on the explicitly owned CI Temporal server', () => {
    const step = ci.jobs.integration.steps.find((entry) => entry.run?.includes('workflows.file-processing.test.ts'))
    expect(step).toBeDefined()
    expect(step?.env?.KARDATA_TEMPORAL_TEST).toBe('1')
    expect(step?.env?.KARDATA_FILE_TEMPORAL_ADDRESS).toBe('localhost:7233')
  })
  it('runs the real parser memory scenarios as a separate CI gate', () => {
    const step = ci.jobs.verify.steps.find((entry) => entry.run?.includes('pdf-mixed.test.ts'))
    expect(step?.env?.KARDATA_PDF_MEMORY_TEST).toBe('1')
  })
  it('restarts db and temporal unless stopped, so a daemon restart self-heals the stack', () => {
    expect(compose.services.db.restart).toBe('unless-stopped')
    expect(compose.services.temporal.restart).toBe('unless-stopped')
  })
})
