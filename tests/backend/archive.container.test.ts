import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const enabled = process.env['KARDATA_ARCHIVE_CONTAINER_TEST'] === '1'
const dist = fileURLToPath(new URL('../../backend/dist', import.meta.url))
describe.skipIf(!enabled)('isolated worker/server archive persistence', () => {
  it('reads exact evidence through replacement containers after its writer is removed', () => {
    expect(existsSync(`${dist}/archive/targets.js`), 'Build the backend first; no stale fallback').toBe(true)
    const volume = `kardata-test-archive-${randomUUID()}`
    const image = process.env['KARDATA_ARCHIVE_TEST_IMAGE'] ?? 'kardata-backend'
    execFileSync('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], { timeout: 15000, stdio: 'pipe' })
    execFileSync('docker', ['volume', 'create', volume], { timeout: 15000, stdio: 'pipe' })
    const run = (role: string, program: string) => {
      const output = execFileSync('docker', ['run', '--rm', '--name', `${volume}-${role}`, '--entrypoint', 'node', '-v', `${volume}:/var/kardata/archive`, '-v', `${dist}:/app/backend/dist:ro`, '-e', 'KARDATA_ARCHIVE_DIR=/var/kardata/archive', image, '--input-type=module', '-e', program], { encoding: 'utf8', timeout: 15000, maxBuffer: 131072 })
      const line = output.split('\n').find((entry) => entry.startsWith('TEST_RECORD:'))
      expect(line, `${role} did not confirm its operation`).toBeDefined()
      return JSON.parse(line!.slice('TEST_RECORD:'.length)) as { record: { hash: string; bytes: number; key: string }; source: { url: string; hash: string; key: string } }
    }
    const reference = run('writer', `import { persistExecutionRecord,persistResearchSource,resolveArchiveTarget } from '/app/backend/dist/archive/targets.js';const archive=resolveArchiveTarget();const record=await persistExecutionRecord(archive,'TEST container session',{text:'TEST '+ 'á'.repeat(1100000)});const source=await persistResearchSource(archive,'TEST container session',{url:'https://test.example.test/source',text:'TEST source '+ 'á'.repeat(1000000)});console.log('TEST_RECORD:'+JSON.stringify({record,source}));`)
    expect(reference.record.bytes).toBeGreaterThan(2000000)
    expect(reference.source.url).toBe('https://test.example.test/source')
    const reader = `import { readExecutionRecord,hydrateResearchSources,resolveArchiveTarget } from '/app/backend/dist/archive/targets.js';const refs=${JSON.stringify(reference)};const archive=resolveArchiveTarget();const body=await readExecutionRecord(archive,'TEST container session',refs.record);if(body.text!=='TEST '+ 'á'.repeat(1100000))throw new Error('TEST exact-byte mismatch');const outcome=await hydrateResearchSources(archive,'TEST container session',{sourceRefs:[refs.source]});if(outcome.sources.length!==1||outcome.sources[0].url!==refs.source.url||outcome.sources[0].text!=='TEST source '+ 'á'.repeat(1000000))throw new Error('TEST exact source mismatch');console.log('TEST_RECORD:'+JSON.stringify(refs));`
    expect(run('server-reader', reader)).toEqual(reference)
    expect(run('replacement-worker-reader', reader)).toEqual(reference)
    // Only owned ephemeral containers are removed. Retain the isolated fixture
    // volume: this test never purges shared archives or other resources.
  }, 60000)
})
