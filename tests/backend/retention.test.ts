import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { beforeAll, describe, expect, it } from 'vitest'
import { appendEvent, readPartition } from '../../backend/src/db/index.js'
import {
  FilesystemTarget,
  GcsTarget,
  type ArchiveTarget,
  type GcsBucketHandle,
  type GcsFileHandle,
} from '../../backend/src/archive/targets.js'
import { readArchive, runRetention } from '../../backend/src/archive/retention.js'
import { ensureTestDb, TEST_DATABASE_URL } from './db-helper.js'

// In-memory GCS bucket double: exercises GcsTarget write/read/list without
// credentials or network.
class FakeGcsBucket implements GcsBucketHandle {
  private readonly objects = new Map<string, string>()

  file(name: string): GcsFileHandle {
    const objects = this.objects
    return {
      async save(body: string): Promise<void> {
        objects.set(name, body)
      },
      async download(): Promise<[Buffer]> {
        const body = objects.get(name)
        if (body === undefined) throw new Error(`no such object '${name}'`)
        return [Buffer.from(body, 'utf8')]
      },
      async exists(): Promise<[boolean]> {
        return [objects.has(name)]
      },
    }
  }

  async getFiles(query: { prefix: string }): Promise<[{ name: string }[]]> {
    return [[...this.objects.keys()].filter((name) => name.startsWith(query.prefix)).map((name) => ({ name }))]
  }
}

describe('archive targets (B1.4)', () => {
  it('filesystem target round-trips and lists by prefix', async () => {
    const target = new FilesystemTarget(mkdtempSync(join(tmpdir(), 'kardata-arch-')))
    await target.write('events/p1/1.json', '{"seq":1}')
    await target.write('events/p1/2.json', '{"seq":2}')
    await target.write('events/other/1.json', '{"seq":1}')
    expect(await target.read('events/p1/1.json')).toBe('{"seq":1}')
    expect(await target.read('events/missing/9.json')).toBeUndefined()
    expect(await target.list('events/p1/')).toEqual(['events/p1/1.json', 'events/p1/2.json'])
  })

  it('GCS target round-trips write/read/list through a bucket double', async () => {
    const target: ArchiveTarget = new GcsTarget(new FakeGcsBucket())
    await target.write('events/p1/1.json', '{"seq":1}')
    await target.write('events/p1/2.json', '{"seq":2}')
    expect(await target.read('events/p1/1.json')).toBe('{"seq":1}')
    expect(await target.read('events/missing/9.json')).toBeUndefined()
    expect(await target.list('events/p1/')).toEqual(['events/p1/1.json', 'events/p1/2.json'])
  })
})

describe.skipIf(!TEST_DATABASE_URL)('retention job (B1.4)', () => {
  let url = ''

  beforeAll(async () => {
    url = await ensureTestDb('kardata_test_retention')
  }, 30_000)

  function pool(): Pool {
    return new Pool({ connectionString: url })
  }

  it('archives old rows, drops them hot, and replays hot plus archive', async () => {
    const db = pool()
    try {
      await db.query("DELETE FROM events WHERE partition = 'retention:fixture'")
      await appendEvent(db, {
        idempotencyKey: 'ret-old',
        partition: 'retention:fixture',
        type: 't.run.started',
        payload: {},
      })
      await appendEvent(db, {
        idempotencyKey: 'ret-new',
        partition: 'retention:fixture',
        type: 't.run.started',
        payload: {},
      })
      await db.query(
        `UPDATE events SET at = now() - make_interval(days => 60) WHERE idempotency_key = 'ret-old'`,
      )

      const target = new FilesystemTarget(mkdtempSync(join(tmpdir(), 'kardata-ret-')))
      const result = await runRetention(db, target, { olderThanDays: 30 })
      expect(result).toEqual({ archived: 1, deleted: 1 })

      const hot = await readPartition(db, 'retention:fixture')
      expect(hot.map((event) => event.idempotencyKey)).toEqual(['ret-new'])
      const cold = await readArchive(target, 'retention:fixture')
      expect(cold.map((event) => event.idempotencyKey)).toEqual(['ret-old'])

      // Replay across both reproduces the full fixture.
      const replayed = [...cold, ...hot].sort((a, b) => a.seq - b.seq)
      expect(replayed).toHaveLength(2)

      // Second run is a no-op.
      expect(await runRetention(db, target, { olderThanDays: 30 })).toEqual({ archived: 0, deleted: 0 })
    } finally {
      await db.end()
    }
  })

  it('archives artifact index events together and never touches bodies', async () => {
    const db = pool()
    try {
      const partition = 'artifact:session:ret-old'
      await db.query('DELETE FROM events WHERE partition = $1', [partition])
      await appendEvent(db, {
        idempotencyKey: 'artifact-stored:session:ret-old:art-keep',
        partition,
        type: 't.artifact.stored',
        payload: {
          artifactId: 'art-keep',
          name: 'keep.md',
          reason: 'subagent_output',
          producedBy: 'run-ret',
        },
      })
      await appendEvent(db, {
        idempotencyKey: 'artifact-indexed:session:ret-old:art-keep',
        partition,
        type: 't.artifact.indexed',
        payload: { artifactId: 'art-keep', name: 'keep.md', sha256: 'abc' },
      })
      await db.query(`UPDATE events SET at = now() - make_interval(days => 60) WHERE partition = $1`, [
        partition,
      ])

      const target = new FilesystemTarget(mkdtempSync(join(tmpdir(), 'kardata-ret-art-')))
      await target.write('artifacts/session/ret-old/art-keep', 'goldmine bytes')

      const result = await runRetention(db, target, { olderThanDays: 30 })
      expect(result).toEqual({ archived: 2, deleted: 2 })

      // Index rows are cold but replayable together; the bytes never moved.
      const cold = await readArchive(target, partition)
      expect(cold.map((event) => event.type).sort()).toEqual([
        't.artifact.indexed',
        't.artifact.stored',
      ])
      expect(await readPartition(db, partition)).toEqual([])
      expect(await target.read('artifacts/session/ret-old/art-keep')).toBe('goldmine bytes')
    } finally {
      await db.end()
    }
  })
})
