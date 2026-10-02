import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const compose = parse(readFileSync(fileURLToPath(new URL('../../deployment/compose.yaml', import.meta.url)), 'utf8')) as {
  services: Record<string, { environment?: Record<string, string>; volumes?: string[] }>
}
describe('archive visibility across production roles', () => {
  it('keeps evidence written by a worker readable and persistent through the backend archive mount', () => {
    const backend = compose.services['backend']!, worker = compose.services['worker']!
    const directory = backend.environment?.['KARDATA_ARCHIVE_DIR']
    expect(directory).toBe('/var/kardata/archive')
    expect(worker.environment?.['KARDATA_ARCHIVE_DIR']).toBe(directory)
    const mount = backend.volumes?.find((entry) => entry.endsWith(`:${directory}`))
    expect(mount).toBe('archive-data:/var/kardata/archive')
    expect(worker.volumes).toContain(mount)
  })
  it('uses the same archive target selection and read-only GCS credentials in both roles', () => {
    const backend = compose.services['backend']!, worker = compose.services['worker']!
    for (const key of ['KARDATA_GCS_BUCKET','KARDATA_GCS_PREFIX','KARDATA_GCP_PROJECT_ID','GOOGLE_APPLICATION_CREDENTIALS']) {
      expect(backend.environment?.[key], key).toBeDefined()
      expect(worker.environment?.[key], key).toBe(backend.environment?.[key])
    }
    const adc = backend.volumes?.find((entry) => entry.endsWith(':/run/kardata/adc.json:ro'))
    expect(adc).toBeDefined()
    expect(worker.volumes).toContain(adc)
  })
})
