// Archive target selection + GCS conformance (B-F2). The resolver picks
// GCS iff KARDATA_GCS_BUCKET is set, else the filesystem target with no
// credentials; the GCS target round-trips over an in-memory fake bucket
// (the pattern targets.ts documents), honoring the key prefix.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FilesystemTarget,
  GcsTarget,
  resolveArchiveTarget,
  type GcsBucketHandle,
} from '../../backend/src/archive/targets.js'

class FakeBucket implements GcsBucketHandle {
  readonly bodies = new Map<string, string>()

  file(name: string) {
    const bodies = this.bodies
    return {
      async save(body: string): Promise<void> {
        bodies.set(name, body)
      },
      async download(): Promise<[Buffer]> {
        const body = bodies.get(name)
        if (body === undefined) throw new Error(`no such file ${name}`)
        return [Buffer.from(body, 'utf8')]
      },
      async exists(): Promise<[boolean]> {
        return [bodies.has(name)]
      },
    }
  }

  async getFiles(query: { prefix: string }): Promise<[{ name: string }[], ...unknown[]]> {
    const names = [...bodiesNames(this.bodies)]
      .filter((name) => name.startsWith(query.prefix))
      .map((name) => ({ name }))
    return [names]
  }
}

function bodiesNames(bodies: Map<string, string>): string[] {
  return [...bodies.keys()]
}

describe('resolveArchiveTarget', () => {
  it('picks the filesystem target without a bucket and no credentials', () => {
    const target = resolveArchiveTarget({ KARDATA_ARCHIVE_DIR: join(tmpdir(), 'no-bucket') })
    expect(target).toBeInstanceOf(FilesystemTarget)
  })

  it('honors a custom archive dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'archive-'))
    const target = resolveArchiveTarget({ KARDATA_ARCHIVE_DIR: dir })
    await target.write('a.txt', 'bytes')
    expect(await target.read('a.txt')).toBe('bytes')
  })

  it('picks GCS when a bucket is configured', () => {
    const target = resolveArchiveTarget({ KARDATA_GCS_BUCKET: 'kardata-arch' })
    expect(target).toBeInstanceOf(GcsTarget)
  })
})

describe('GcsTarget over a fake bucket', () => {
  it('round-trips write/read/list with a prefix', async () => {
    const bucket = new FakeBucket()
    const target = new GcsTarget(bucket, 'staging')
    await target.write('events/p/1.json', '{"seq":1}')
    expect(await target.read('events/p/1.json')).toBe('{"seq":1}')
    expect(await target.read('missing.json')).toBeUndefined()
    expect(await target.list('events/')).toEqual(['events/p/1.json'])
    // Prefix stays on the wire, off the logical keys.
    expect([...bucket.bodies.keys()]).toEqual(['staging/events/p/1.json'])
  })

  it('builds from a bucket name with a prefix', () => {
    const bucket = new FakeBucket()
    const target = GcsTarget.fromBucketName(
      'kardata-arch',
      { bucket: () => bucket } as unknown as Parameters<typeof GcsTarget.fromBucketName>[1],
      'staging',
    )
    expect(target).toBeInstanceOf(GcsTarget)
  })
})
