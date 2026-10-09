// Artifact pipeline (B4.3). Index gate plus the proposal no-mutation
// proof over a real filesystem target with in-memory event deps: stored
// but unindexed bytes are unservable, tampered bytes fail the recorded
// hash, and the proposal path touches only artifact keys and events.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FilesystemTarget } from '../../backend/src/archive/targets.js'
import {
  ARTIFACT_INDEXED_EVENT,
  ARTIFACT_STORED_EVENT,
  ArtifactValidationError,
  CorruptArtifactError,
  UnindexedArtifactError,
  indexArtifact,
  serveArtifact,
  storeAndIndex,
  storeArtifact,
  type ArtifactDeps,
  type ArtifactScope,
} from '../../backend/src/artifacts/pipeline.js'
import type { StoredEvent } from '../../backend/src/db/index.js'

const SESSION: ArtifactScope = { kind: 'session', id: 's-art' }

function testDeps(): ArtifactDeps & { logs: unknown[]; events: Map<string, StoredEvent>; keys: string[] } {
  const logs: unknown[] = []
  const events = new Map<string, StoredEvent>()
  const keys: string[] = []
  let seq = 0
  return {
    logs,
    events,
    keys,
    log: (fields) => logs.push(fields),
    findEvent: async (idempotencyKey) => events.get(idempotencyKey),
    record: async (event) => {
      // Emulates ON CONFLICT DO NOTHING: first write wins.
      if (events.has(event.idempotencyKey)) return
      seq += 1
      events.set(event.idempotencyKey, {
        seq,
        idempotencyKey: event.idempotencyKey,
        partition: event.partition,
        type: event.type,
        payload: event.payload,
        redacted: false,
        at: new Date().toISOString(),
        traceId: null,
        client: null,
      })
    },
  }
}

function target() {
  return new FilesystemTarget(mkdtempSync(join(tmpdir(), 'kardata-artifacts-')))
}

describe('artifact pipeline (B4.3)', () => {
  it('stores, indexes, and serves a round trip', async () => {
    const dir = target()
    const d = testDeps()
    const stored = await storeArtifact(
      dir,
      { scope: SESSION, kind: 'file', name: 'notes.md', detail: 'd', source: 't', body: '# hello', reason: 'user_upload', producedBy: 'test' },
      d,
    )
    const indexed = await indexArtifact(dir, SESSION, stored.artifactId, d)
    expect(indexed.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(indexed.bytes).toBe(7)
    const served = await serveArtifact(dir, SESSION, stored.artifactId, d)
    expect(served.body).toBe('# hello')
    expect(served.meta.artifactId).toBe(stored.artifactId)
    expect([...d.events.values()].map((event) => event.type)).toEqual([
      ARTIFACT_STORED_EVENT,
      ARTIFACT_INDEXED_EVENT,
    ])
  })

  it('refuses unindexed bytes even when they exist', async () => {
    const dir = target()
    const d = testDeps()
    const stored = await storeArtifact(dir, { scope: SESSION, name: 'raw.md', body: 'present', reason: 'user_upload', producedBy: 'test' }, d)
    // The bytes are provably there — and still unservable without the index.
    expect(await dir.read(stored.key)).toBe('present')
    await expect(serveArtifact(dir, SESSION, stored.artifactId, d)).rejects.toBeInstanceOf(
      UnindexedArtifactError,
    )
    await expect(indexArtifact(dir, { kind: 'task', id: 't-9' }, 'art-missing', d)).rejects.toBeInstanceOf(
      UnindexedArtifactError,
    )
  })

  it('fails tampered bytes against the recorded hash', async () => {
    const dir = target()
    const d = testDeps()
    const stored = await storeArtifact(dir, { scope: SESSION, name: 'v.md', body: 'original', reason: 'report', producedBy: 'run-1' }, d)
    await indexArtifact(dir, SESSION, stored.artifactId, d)
    await dir.write(stored.key, 'tampered')
    await expect(serveArtifact(dir, SESSION, stored.artifactId, d)).rejects.toBeInstanceOf(
      CorruptArtifactError,
    )
  })

  it('keeps the proposal path to artifact keys and events only', async () => {
    const inner = target()
    const seenKeys: string[] = []
    const recording = {
      async write(key: string, body: string): Promise<void> {
        seenKeys.push(key)
        await inner.write(key, body)
      },
      read: (key: string) => inner.read(key),
      list: (prefix: string) => inner.list(prefix),
    }
    const d = testDeps()
    const stored = await storeArtifact(
      recording,
      { scope: SESSION, kind: 'proposal', name: 'thesis.md', body: 'buy everything', reason: 'proposal', producedBy: 'run-2' },
      d,
    )
    await indexArtifact(recording, SESSION, stored.artifactId, d)
    const served = await serveArtifact(recording, SESSION, stored.artifactId, d)
    expect(served.body).toBe('buy everything')
    // Zero company mutations: every byte lands under artifacts/, every
    // event is an artifact lifecycle event in an artifact partition.
    expect(seenKeys.length).toBeGreaterThan(0)
    for (const key of seenKeys) expect(key.startsWith('artifacts/')).toBe(true)
    const events = [...d.events.values()]
    expect(events.length).toBeGreaterThan(0)
    for (const event of events) {
      expect([ARTIFACT_STORED_EVENT, ARTIFACT_INDEXED_EVENT]).toContain(event.type)
      expect(event.partition.startsWith('artifact:')).toBe(true)
    }
  })

  it('rejects empty names, empty bodies, and oversize bodies before writing', async () => {
    const dir = target()
    const d = testDeps()
    await expect(storeArtifact(dir, { scope: SESSION, name: '  ', body: 'x', reason: 'user_upload', producedBy: 'test' }, d)).rejects.toBeInstanceOf(
      ArtifactValidationError,
    )
    await expect(storeArtifact(dir, { scope: SESSION, name: 'e.md', body: '', reason: 'user_upload', producedBy: 'test' }, d)).rejects.toBeInstanceOf(
      ArtifactValidationError,
    )
    await expect(
      storeArtifact(dir, { scope: SESSION, name: 'big.bin', body: 'x'.repeat(8 * 1024 * 1024 + 1), reason: 'user_upload', producedBy: 'test' }, d),
    ).rejects.toBeInstanceOf(ArtifactValidationError)
    expect(d.events.size).toBe(0)
    expect(await dir.list('artifacts/')).toEqual([])
  })

  it('re-stores idempotently under a caller key', async () => {
    const dir = target()
    const d = testDeps()
    const first = await storeArtifact(
      dir,
      { scope: SESSION, name: 'r.md', body: 'same', artifactId: 'art-fixed', reason: 'subagent_output', producedBy: 'run-3' },
      d,
    )
    const second = await storeArtifact(
      dir,
      { scope: SESSION, name: 'r.md', body: 'same', artifactId: 'art-fixed', reason: 'subagent_output', producedBy: 'run-3' },
      d,
    )
    expect(second.artifactId).toBe(first.artifactId)
    expect(d.events.size).toBe(1)
  })
  it('rejects conflicting content under an indexed id without overwriting its original bytes', async () => {
    const dir = target(), d = testDeps()
    const original = { scope: SESSION, name: 'TEST evidence.txt', body: 'Original evidence', artifactId: 'test-immutable', reason: 'report' as const, producedBy: 'TEST run' }
    await storeAndIndex(dir, original, d)
    await expect(storeAndIndex(dir, { ...original, body: 'Changed evidence' }, d)).rejects.toThrow(/conflict/i)
    expect((await serveArtifact(dir, SESSION, original.artifactId, d)).body).toBe(original.body)
  })
  it('retains the winning content and integrity record under conflicting concurrent stores', async () => {
    const dir = target(), d = testDeps()
    const original = { scope: SESSION, name: 'TEST evidence.txt', artifactId: 'test-concurrent-immutable', reason: 'report' as const, producedBy: 'TEST run' }
    const results = await Promise.allSettled(['First evidence', 'Second evidence'].map((body) => storeAndIndex(dir, { ...original, body }, d)))
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(['First evidence', 'Second evidence']).toContain((await serveArtifact(dir, SESSION, original.artifactId, d)).body)
  })

  it('rejects reason-less and producer-less stores before writing', async () => {
    const dir = target()
    const d = testDeps()
    await expect(
      storeArtifact(
        dir,
        // @ts-expect-error provenance is required, not optional
        { scope: SESSION, name: 'noreason.md', body: 'x' },
        d,
      ),
    ).rejects.toBeInstanceOf(ArtifactValidationError)
    await expect(
      storeArtifact(
        dir,
        { scope: SESSION, name: 'noproducer.md', body: 'x', reason: 'user_upload', producedBy: '  ' },
        d,
      ),
    ).rejects.toBeInstanceOf(ArtifactValidationError)
    await expect(
      storeArtifact(
        dir,
        // @ts-expect-error unknown reasons are rejected
        { scope: SESSION, name: 'badreason.md', body: 'x', reason: 'vibes', producedBy: 'test' },
        d,
      ),
    ).rejects.toBeInstanceOf(ArtifactValidationError)
    expect(d.events.size).toBe(0)
    expect(await dir.list('artifacts/')).toEqual([])
  })

  it('storeAndIndex leaves every file indexed with its provenance', async () => {
    const dir = target()
    const d = testDeps()
    const indexed = await storeAndIndex(
      dir,
      { scope: SESSION, name: 'gold.md', body: 'keep me', reason: 'subagent_output', producedBy: 'run-7' },
      d,
    )
    expect(indexed.reason).toBe('subagent_output')
    expect(indexed.producedBy).toBe('run-7')
    const served = await serveArtifact(dir, SESSION, indexed.artifactId, d)
    expect(served.body).toBe('keep me')
    expect(served.meta.reason).toBe('subagent_output')
    expect([...d.events.values()].map((event) => event.type)).toEqual([
      ARTIFACT_STORED_EVENT,
      ARTIFACT_INDEXED_EVENT,
    ])
  })

  it('refuses to index a stored payload with no provenance', async () => {
    const dir = target()
    const d = testDeps()
    await dir.write('artifacts/session/s-art/art-noprov', 'bytes without a why')
    await d.record({
      idempotencyKey: 'artifact-stored:session:s-art:art-noprov',
      partition: 'artifact:session:s-art',
      type: ARTIFACT_STORED_EVENT,
      payload: { artifactId: 'art-noprov' },
    })
    await expect(indexArtifact(dir, SESSION, 'art-noprov', d)).rejects.toBeInstanceOf(
      CorruptArtifactError,
    )
  })

  it('logs shapes only, never artifact text', async () => {
    const dir = target()
    const d = testDeps()
    const stored = await storeArtifact(
      dir,
      { scope: SESSION, name: 's.md', body: 'SECRET-BODY-QQQ', reason: 'user_upload', producedBy: 'test' },
      d,
    )
    await indexArtifact(dir, SESSION, stored.artifactId, d)
    await serveArtifact(dir, SESSION, stored.artifactId, d)
    const logged = JSON.stringify(d.logs)
    expect(logged).not.toContain('SECRET-BODY-QQQ')
    expect(d.logs).toHaveLength(3)
  })
})
