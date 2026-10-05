import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { beforeAll, describe, expect, it } from 'vitest'
import { appendEvent, listColdPointers, readPartition } from '../../backend/src/db/index.js'
import {
  FilesystemTarget,
  GcsTarget,
  type ArchiveTarget,
  type GcsBucketHandle,
  type GcsFileHandle,
} from '../../backend/src/archive/targets.js'
import { KNOWLEDGE_EVENT_TYPES, readArchive, runRetention } from '../../backend/src/archive/retention.js'
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

      // The moved event keeps a DB pointer to its archive bytes.
      const pointers = await listColdPointers(db, 'retention:fixture')
      expect(pointers).toHaveLength(1)
      expect(pointers[0]).toMatchObject({ type: 't.run.started' })
      expect(await target.read(pointers[0]!.archiveKey)).toContain('ret-old')

      // Second run is a no-op.
      expect(await runRetention(db, target, { olderThanDays: 30 })).toEqual({ archived: 0, deleted: 0 })
    } finally {
      await db.end()
    }
  })

  it('keeps knowledge events hot while operational events move with pointers', async () => {
    const db = pool()
    try {
      const knowledge = 'artifact:session:ret-keep'
      const operational = 'retention:ops-fixture'
      await db.query('DELETE FROM events WHERE partition = ANY($1)', [[knowledge, operational]])
      await appendEvent(db, {
        idempotencyKey: 'artifact-stored:session:ret-keep:art-keep',
        partition: knowledge,
        type: 't.artifact.stored',
        payload: { artifactId: 'art-keep', name: 'keep.md', reason: 'subagent_output', producedBy: 'run-ret' },
      })
      await appendEvent(db, {
        idempotencyKey: 'artifact-indexed:session:ret-keep:art-keep',
        partition: knowledge,
        type: 't.artifact.indexed',
        payload: { artifactId: 'art-keep', name: 'keep.md', sha256: 'abc' },
      })
      await appendEvent(db, {
        idempotencyKey: 'exec-record-keep',
        partition: knowledge,
        type: 't.execution.recorded',
        payload: { threadKey: 'ret-keep', runKey: 'run-1', kind: 'request', round: 1 },
      })
      await appendEvent(db, {
        idempotencyKey: 'company-found-keep',
        partition: knowledge,
        type: 'company.found',
        payload: { companyId: 'com-keep', sectorId: 'sec-keep', name: 'Keep Co' },
      })
      await appendEvent(db, {
        idempotencyKey: 'artifact-referenced-keep',
        partition: knowledge,
        type: 't.artifact.referenced',
        payload: { artifactId: 'art-keep', fromScope: { kind: 'session', id: 'ret-keep' } },
      })
      await appendEvent(db, {
        idempotencyKey: 'company-stage-keep',
        partition: knowledge,
        type: 'company.stage_changed',
        payload: { companyId: 'com-keep', stage: 'Filter' },
      })
      await appendEvent(db, {
        idempotencyKey: 'company-state-keep',
        partition: knowledge,
        type: 'company.state_changed',
        payload: { companyId: 'com-keep', state: 'running' },
      })
      await appendEvent(db, {
        idempotencyKey: 'ret-ops-old',
        partition: operational,
        type: 't.run.started',
        payload: {},
      })
      await db.query(`UPDATE events SET at = now() - make_interval(days => 60) WHERE partition = ANY($1)`, [
        [knowledge, operational],
      ])

      const target = new FilesystemTarget(mkdtempSync(join(tmpdir(), 'kardata-ret-keep-')))
      const result = await runRetention(db, target, { olderThanDays: 30 })
      expect(result).toEqual({ archived: 1, deleted: 1 })

      // Knowledge survives hot and readable; only the operational event moved.
      const survivors = await readPartition(db, knowledge)
      expect(survivors.map((event) => event.idempotencyKey).sort()).toEqual([
        'artifact-indexed:session:ret-keep:art-keep',
        'artifact-referenced-keep',
        'artifact-stored:session:ret-keep:art-keep',
        'company-found-keep',
        'company-stage-keep',
        'company-state-keep',
        'exec-record-keep',
      ])
      expect(new Set(survivors.map((event) => event.type))).toEqual(new Set(KNOWLEDGE_EVENT_TYPES))
      expect(await readPartition(db, operational)).toEqual([])
      expect(await listColdPointers(db, knowledge)).toEqual([])
      expect(await listColdPointers(db, operational)).toHaveLength(1)
      expect((await readArchive(target, operational)).map((event) => event.idempotencyKey)).toEqual(['ret-ops-old'])
    } finally {
      await db.end()
    }
  })
})
