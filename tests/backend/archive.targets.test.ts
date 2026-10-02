// Archive target selection + GCS conformance (B-F2). The resolver picks
// GCS iff KARDATA_GCS_BUCKET is set, else the filesystem target with no
// credentials; the GCS target round-trips over an in-memory fake bucket
// (the pattern targets.ts documents), honoring the key prefix.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  archiveResearchOutcome, hydrateResearchSources, persistResearchSource, persistExecutionRecord, readExecutionRecord,
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
  it.each(['../escape', '/absolute', 'folder/../escape', 'folder\\escape', 'folder//escape', 'folder/./escape'])('rejects unsafe archive key %s before calling storage', async (key) => {
    const bucket = new FakeBucket(), target = new GcsTarget(bucket, 'staging')
    await expect(target.write(key, 'TEST data')).rejects.toThrow(/archive key/i)
    await expect(target.read(key)).rejects.toThrow(/archive key/i)
    await expect(target.list(key)).rejects.toThrow(/archive key/i)
    expect(bucket.bodies.size).toBe(0)
  })
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

describe('filesystem archive failures', () => {
  it('does not turn a misconfigured archive path into a successful empty listing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kardata-archive-fault-'))
    const path = join(root, 'file-not-directory')
    writeFileSync(path, 'TEST archive misconfiguration')
    await expect(new FilesystemTarget(path).list('')).rejects.toThrow()
  })
})

describe('verified source archive references', () => {
  it('keeps multi-megabyte source bodies out of transported outcomes and hydrates exact evidence', async () => {
    const target = new FilesystemTarget(mkdtempSync(join(tmpdir(), 'source-refs-')))
    const text = 'TEST source evidence '.repeat(75000)
    const outcome = { reply: 'TEST reviewed', toolCalls: [], sources: [{ url: 'https://company.example.test/', text }, { url: 'https://company.example.test/about', text }] }
    const archived = await archiveResearchOutcome(target, 'TEST session', outcome)
    expect(JSON.stringify(archived).length).toBeLessThan(2000)
    expect(archived).not.toHaveProperty('sources')
    expect((await hydrateResearchSources(target, 'TEST session', archived)).sources).toEqual(outcome.sources)
    await expect(hydrateResearchSources(target, 'OTHER session', archived)).rejects.toThrow('outside')
  })
  it('adopts identical bytes and keeps URL/session/version identities separate', async () => {
    const bucket = new FakeBucket(), target = new GcsTarget(bucket)
    const source = { url: 'https://company.example.test/', text: 'TEST exact evidence' }
    const first = await persistResearchSource(target, 'TEST session', source)
    expect(await persistResearchSource(target, 'TEST session', source)).toEqual(first)
    expect((await persistResearchSource(target, 'OTHER session', source)).key).not.toBe(first.key)
    expect((await persistResearchSource(target, 'TEST session', { ...source, url: `${source.url}about` })).hash).not.toBe(first.hash)
    expect((await persistResearchSource(target, 'TEST session', { ...source, text: 'TEST revised evidence' })).hash).not.toBe(first.hash)
    expect(first.key).not.toContain('TEST session')
  })
  it('never creates a successful reference to missing or corrupt storage', async () => {
    const target = { write: vi.fn(async () => undefined), read: vi.fn(async (): Promise<string | undefined> => undefined), list: async () => [] }
    await expect(persistResearchSource(target, 'TEST session', { url: 'https://company.example.test/', text: 'TEST evidence' })).rejects.toThrow('missing or corrupt')
    target.read.mockResolvedValue('TEST corrupted')
    target.write.mockClear()
    await expect(persistResearchSource(target, 'TEST session', { url: 'https://company.example.test/', text: 'TEST evidence' })).rejects.toThrow('missing or corrupt')
    expect(target.write).not.toHaveBeenCalled()
  })
  it('recovers an uncertain write by verifying retained bytes instead of repeating it', async () => {
    let body: string | undefined
    const target = { write: vi.fn(async (_key: string, text: string) => { body = text; throw new Error('TEST lost storage acknowledgement') }), read: async () => body, list: async () => [] }
    const source = { url: 'https://company.example.test/', text: 'TEST evidence' }
    await expect(persistResearchSource(target, 'TEST session', source)).rejects.toThrow('lost storage')
    expect(await persistResearchSource(target, 'TEST session', source)).toHaveProperty('hash')
    expect(target.write).toHaveBeenCalledTimes(1)
  })
  it('denies altered, missing and cross-session references', async () => {
    const bucket = new FakeBucket(), target = new GcsTarget(bucket)
    const source = { url: 'https://company.example.test/', text: 'TEST evidence' }
    const reference = await persistResearchSource(target, 'TEST session', source)
    await expect(hydrateResearchSources(target, 'TEST session', { sourceRefs: [{ ...reference, url: 'https://other.example.test/' }] })).rejects.toThrow('missing or corrupt')
    bucket.bodies.set(reference.key, 'TEST corrupt replacement')
    await expect(hydrateResearchSources(target, 'TEST session', { sourceRefs: [reference] })).rejects.toThrow('missing or corrupt')
    bucket.bodies.delete(reference.key)
    await expect(hydrateResearchSources(target, 'TEST session', { sourceRefs: [reference] })).rejects.toThrow('missing or corrupt')
  })
  it('enforces byte caps and invalid source authority before storage writes', async () => {
    const bucket = new FakeBucket(), target = new GcsTarget(bucket)
    await expect(persistResearchSource(target, 'TEST session', { url: 'https://company.example.test/', text: 'x'.repeat(2 * 1024 * 1024 + 1) })).rejects.toThrow('byte limit')
    for (const url of ['ftp://company.example.test/', 'https://password@company.example.test/']) await expect(persistResearchSource(target, 'TEST session', { url, text: 'TEST' })).rejects.toThrow('URL')
    expect(bucket.bodies.size).toBe(0)
  })
  it('bounds filesystem reads before full buffering and rejects invalid limits', async () => {
    const target = new FilesystemTarget(mkdtempSync(join(tmpdir(), 'source-read-limit-')))
    await target.write('source.txt', 'TEST bytes')
    expect(await target.read('source.txt', 10)).toBe('TEST bytes')
    await expect(target.read('source.txt', 9)).rejects.toThrow('byte limit')
    for (const limit of [0, -1, 1.5, Infinity, 16777217]) await expect(target.read('source.txt', limit)).rejects.toThrow('read limit')
  })
  it('requests bounded GCS byte ranges and checks returned length', async () => {
    const download = vi.fn(async () => [Buffer.from('TEST bytes')] as [Buffer])
    const target = new GcsTarget({ file: () => ({ save: async () => undefined, download, exists: async () => [true] as [boolean] }), getFiles: async () => [[]] })
    expect(await target.read('source.txt', 10)).toBe('TEST bytes')
    expect(download).toHaveBeenCalledWith({ start: 0, end: 10 })
    await expect(target.read('source.txt', 9)).rejects.toThrow('byte limit')
  })
})

describe('source archive cancellation and deadlines', () => {
  it('bounds hung storage and aborts its signal without returning a reference', async () => {
    vi.useFakeTimers()
    try {
      let signal: AbortSignal | undefined
      const target = { write: async () => undefined, read: async (_key: string, _cap?: number, supplied?: AbortSignal): Promise<string | undefined> => { signal = supplied; return new Promise(() => undefined) }, list: async () => [] }
      const pending = persistResearchSource(target, 'TEST session', { url: 'https://company.example.test/', text: 'TEST evidence' })
      const rejected = expect(pending).rejects.toMatchObject({ code: 'source_timeout' })
      await vi.advanceTimersByTimeAsync(60001)
      await rejected
      expect(signal?.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
  it('ignores a late storage completion after caller cancellation', async () => {
    let resolveRead: (body: string | undefined) => void = () => undefined
    const target = { write: vi.fn(async () => undefined), read: async (): Promise<string | undefined> => new Promise((resolve) => { resolveRead = resolve }), list: async () => [] }
    const controller = new AbortController()
    const pending = persistResearchSource(target, 'TEST session', { url: 'https://company.example.test/', text: 'TEST evidence' }, controller.signal)
    controller.abort(new Error('TEST cancelled operation'))
    await expect(pending).rejects.toThrow('cancelled operation')
    resolveRead(undefined)
    await Promise.resolve()
    expect(target.write).not.toHaveBeenCalled()
  })
  it('destroys an owned GCS source stream on cancellation', async () => {
    let source: Readable | undefined
    const download = vi.fn(async () => [Buffer.from('TEST')] as [Buffer])
    const target = new GcsTarget({ file: () => ({ save: async () => undefined, download, exists: async () => [true] as [boolean], createReadStream: () => { source = new Readable({ read() { /* deliberately stalled owned fixture */ } }); return source } }), getFiles: async () => [[]] })
    const controller = new AbortController()
    const pending = persistResearchSource(target, 'TEST session', { url: 'https://company.example.test/', text: 'TEST evidence' }, controller.signal)
    await vi.waitFor(() => expect(source).toBeDefined())
    controller.abort(new Error('TEST cancelled source read'))
    await expect(pending).rejects.toThrow('cancelled source read')
    expect(source?.destroyed).toBe(true)
    expect(download).not.toHaveBeenCalled()
  })
})


describe('exact normalized execution archives', () => {
  it('round trips large exact payloads and deduplicates only identical bytes', async () => {
    const bucket = new FakeBucket(), target = new GcsTarget(bucket)
    const record = { systemPrompt: 'TEST instructions', messages: [{ text: 'TEST '+ 'ü'.repeat(1_100_000) }], tools: [{ name: 'TEST tool' }], usage: { cacheReadTokens: 42 } }
    const ref = await persistExecutionRecord(target, 'TEST session', record)
    expect(ref.bytes).toBeGreaterThan(2_000_000)
    expect(await readExecutionRecord(target, 'TEST session', ref)).toEqual(record)
    expect(await persistExecutionRecord(target, 'TEST session', record)).toEqual(ref)
    expect(bucket.bodies.size).toBe(1)
    const changed = await persistExecutionRecord(target, 'TEST session', { ...record, systemPrompt: 'TEST new version' })
    expect(changed.hash).not.toBe(ref.hash)
  })
  it('denies foreign, missing, corrupt and false-size references', async () => {
    const bucket = new FakeBucket(), target = new GcsTarget(bucket)
    const ref = await persistExecutionRecord(target, 'TEST session', { text: 'TEST exact' })
    await expect(readExecutionRecord(target, 'TEST other session', ref)).rejects.toMatchObject({ code: 'execution_scope' })
    await expect(readExecutionRecord(target, 'TEST session', { ...ref, bytes: ref.bytes+1 })).rejects.toMatchObject({ code: 'execution_integrity' })
    bucket.bodies.set(ref.key, 'TEST corrupt')
    await expect(readExecutionRecord(target, 'TEST session', ref)).rejects.toMatchObject({ code: 'execution_integrity' })
    await expect(persistExecutionRecord(target, 'TEST session', { text: 'TEST exact' })).rejects.toMatchObject({ code: 'execution_integrity' })
    bucket.bodies.delete(ref.key)
    await expect(readExecutionRecord(target, 'TEST session', ref)).rejects.toMatchObject({ code: 'execution_integrity' })
  })
  it('never certifies an unconfirmed archive write', async () => {
    const target = { read: async () => undefined, write: async () => undefined, list: async () => [] }
    await expect(persistExecutionRecord(target, 'TEST session', { text: 'TEST' })).rejects.toMatchObject({ code: 'execution_integrity' })
    await expect(persistExecutionRecord(target, 'TEST session', { text: 'x'.repeat(16*1024*1024) })).rejects.toMatchObject({ code: 'execution_limit' })
  })
})
