// Cold-archive targets. B1.4. GCS is the real target on staging and prod;
// the filesystem target exists for unit tests and offline dev only. Both
// speak the same interface so retention and replay never branch on backend.
import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Readable, type Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Storage } from '@google-cloud/storage'
import { createLogger, logOp } from '../observability/logging.js'

function assertArchiveKey(key: string, prefix = false): void {
  if (typeof key !== 'string') throw new TypeError('Archive key must be a string.')
  const parts = key.split('/')
  if (prefix && parts.at(-1) === '') parts.pop()
  if (typeof key !== 'string' || Buffer.byteLength(key) > 1024 || (key.includes('\\') || [...key].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) || key.startsWith('/') || (!prefix && !key) || parts.some((part) => part === '.' || part === '..' || part === '')) throw new TypeError('Archive key must be a relative scoped path without traversal.')
}

export class ResearchSourceError extends Error {
  constructor(readonly code: 'source_integrity' | 'source_scope' | 'source_limit' | 'source_timeout' | 'execution_limit' | 'execution_integrity' | 'execution_scope', message: string) {
    super(message)
    this.name = 'ResearchSourceError'
  }
}

export interface ArchiveTarget {
  write(key: string, body: string, signal?: AbortSignal): Promise<void>
  read(key: string, maxBytes?: number, signal?: AbortSignal): Promise<string | undefined>
  list(prefix: string): Promise<string[]>
}

export class FilesystemTarget implements ArchiveTarget {
  constructor(private readonly dir: string) {}

  private path(key: string, prefix = false): string {
    assertArchiveKey(key, prefix)
    return join(this.dir, key)
  }

  async write(key: string, body: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const path = this.path(key)
    await mkdir(join(path, '..'), { recursive: true })
    const temporary = `${path}.tmp-${randomUUID()}`
    try { await writeFile(temporary, body, { encoding: 'utf8', signal }); signal?.throwIfAborted(); await rename(temporary, path) }
    finally { await unlink(temporary).catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }) }
  }

  async read(key: string, maxBytes?: number, signal?: AbortSignal): Promise<string | undefined> {
    signal?.throwIfAborted()
    if (maxBytes !== undefined) checkReadLimit(maxBytes)
    try {
      if (maxBytes !== undefined) {
        const file = await open(this.path(key), 'r')
        try {
          const buffer = Buffer.alloc(maxBytes + 1)
          let size = 0
          while (size < buffer.length) {
            signal?.throwIfAborted()
            const { bytesRead } = await file.read(buffer, size, buffer.length - size, null)
            signal?.throwIfAborted()
            if (!bytesRead) break
            size += bytesRead
          }
          if (size > maxBytes) throw new ResearchSourceError('source_limit', 'Archive source exceeds its byte limit.')
          return buffer.subarray(0, size).toString('utf8')
        } finally { await file.close() }
      }
      return await readFile(this.path(key), { encoding: 'utf8', signal })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async list(prefix: string): Promise<string[]> {
    assertArchiveKey(prefix, true)
    const out: string[] = []
    const walk = async (relative: string): Promise<void> => {
      const entries = await readdir(this.path(relative, true), { withFileTypes: true }).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      })
      for (const entry of entries) {
        const key = relative === '' ? entry.name : `${relative}/${entry.name}`
        if (entry.isDirectory()) await walk(key)
        else if (key.startsWith(prefix)) out.push(key)
      }
    }
    await walk('')
    return out.sort()
  }
}

// Minimal structural surface of a GCS bucket: the real @google-cloud/storage
// Bucket satisfies this, and tests inject an in-memory fake.
export interface GcsFileHandle {
  save(body: string): Promise<void>
  createReadStream?(options?: { start: number; end: number }): Readable
  createWriteStream?(): Writable
  download(options?: { start: number; end: number }): Promise<[Buffer]>
  exists(): Promise<[boolean]>
}

interface GcsListedFile {
  name: string
}

export interface GcsBucketHandle {
  file(name: string): GcsFileHandle
  // Tuple with rest: the real client returns extra response positions that
  // callers never touch, and fakes return just the file list.
  getFiles(query: { prefix: string }): Promise<[GcsListedFile[], ...unknown[]]>
}

export class GcsTarget implements ArchiveTarget {
  constructor(
    private readonly bucket: GcsBucketHandle,
    private readonly prefix = '',
  ) {}

  /** Real wiring: credentials come from the environment (GOOGLE_APPLICATION_CREDENTIALS). Lazy: no network until use. */
  static fromBucketName(bucketName: string, storage = new Storage(), prefix = ''): GcsTarget {
    return new GcsTarget(storage.bucket(bucketName), prefix)
  }

  private key(name: string, prefix = false): string {
    assertArchiveKey(name, prefix)
    return this.prefix === '' ? name : `${this.prefix}/${name}`
  }

  async write(key: string, body: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const file = this.bucket.file(this.key(key))
    if (signal && file.createWriteStream) await pipeline(Readable.from([body]), file.createWriteStream(), { signal })
    else await file.save(body)
    signal?.throwIfAborted()
  }

  async read(key: string, maxBytes?: number, signal?: AbortSignal): Promise<string | undefined> {
    signal?.throwIfAborted()
    if (maxBytes !== undefined) checkReadLimit(maxBytes)
    const file = this.bucket.file(this.key(key))
    const [exists] = await file.exists()
    if (!exists) return undefined
    signal?.throwIfAborted()
    if (signal && file.createReadStream) {
      const stream = file.createReadStream(maxBytes === undefined ? undefined : { start: 0, end: maxBytes })
      const abort = () => stream.destroy(new Error('Archive read cancelled.'))
      const chunks: Buffer[] = []
      let size = 0
      signal.addEventListener('abort', abort, { once: true })
      try {
        if (signal.aborted) abort()
        for await (const chunk of stream) {
          signal.throwIfAborted()
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
          size += bytes.length
          if (maxBytes !== undefined && size > maxBytes) throw new ResearchSourceError('source_limit', 'Archive source exceeds its byte limit.')
          chunks.push(bytes)
        }
        signal.throwIfAborted()
        return Buffer.concat(chunks).toString('utf8')
      } finally { signal.removeEventListener('abort', abort); stream.destroy() }
    }
    const [body] = await file.download(maxBytes === undefined ? undefined : { start: 0, end: maxBytes })
    signal?.throwIfAborted()
    if (maxBytes !== undefined && body.byteLength > maxBytes) throw new ResearchSourceError('source_limit', 'Archive source exceeds its byte limit.')
    return body.toString('utf8')
  }

  async list(prefix: string): Promise<string[]> {
    const [files] = await this.bucket.getFiles({ prefix: this.key(prefix, true) })
    const base = this.prefix === '' ? '' : `${this.prefix}/`
    return files
      .map((file) => (file.name.startsWith(base) ? file.name.slice(base.length) : file.name))
      .sort()
  }
}

/** Runtime target selection. A configured `KARDATA_GCS_BUCKET` picks the
 * real GCS target (credentials via `GOOGLE_APPLICATION_CREDENTIALS`,
 * mounted read-only in compose); otherwise the filesystem target serves
 * dev and hermetic tests with no credentials at all. */
export function resolveArchiveTarget(env: NodeJS.ProcessEnv = process.env): ArchiveTarget {
  const bucket = env['KARDATA_GCS_BUCKET']?.trim()
  if (bucket) {
    return GcsTarget.fromBucketName(bucket, new Storage(), env['KARDATA_GCS_PREFIX']?.trim() || '')
  }
  return new FilesystemTarget(env['KARDATA_ARCHIVE_DIR']?.trim() || 'var/archive')
}

function checkReadLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024) throw new TypeError('Archive read limit must be 1..16777216 bytes.')
}

export interface ArchivedResearchSource { url: string; key: string; hash: string }
export interface ArchivedExecutionRecord { key: string; hash: string; bytes: number }
const EXECUTION_BYTES = 16 * 1024 * 1024
/** Exact normalized execution content lives in the existing archive, not logs.
 * A verified reference is published only after read-back matches the write. */
export async function persistExecutionRecord(archive: ArchiveTarget, sessionId: string, record: unknown, signal?: AbortSignal): Promise<ArchivedExecutionRecord> {
  return logOp(sourceLogger, 'archive.execution.write', async () => {
    if (!sessionId || sessionId.length > 255) throw new TypeError('Invalid execution session identity.')
    const body = JSON.stringify(record)
    if (body === undefined) throw new TypeError('Execution record must be JSON.')
    const bytes = Buffer.byteLength(body)
    if (bytes > EXECUTION_BYTES) throw new ResearchSourceError('execution_limit', 'Execution record exceeds its byte limit.')
    const hash = createHash('sha256').update(body).digest('hex')
    const key = `execution-records/${createHash('sha256').update(sessionId).digest('hex')}/${hash}.json`
    let saved = await sourceIO((ioSignal) => archive.read(key, EXECUTION_BYTES, ioSignal), signal)
    if (saved === undefined) {
      await sourceIO((ioSignal) => archive.write(key, body, ioSignal), signal)
      saved = await sourceIO((ioSignal) => archive.read(key, EXECUTION_BYTES, ioSignal), signal)
    }
    if (saved !== body) throw new ResearchSourceError('execution_integrity', 'Execution archive is missing or corrupt.')
    return { key, hash, bytes }
  }, { sessionHash: createHash('sha256').update(sessionId).digest('hex') })
}
export async function readExecutionRecord(archive: ArchiveTarget, sessionId: string, reference: ArchivedExecutionRecord, signal?: AbortSignal): Promise<unknown> {
  return logOp(sourceLogger, 'archive.execution.read', async () => {
    const prefix = `execution-records/${createHash('sha256').update(sessionId).digest('hex')}/`
    if (!/^[a-f0-9]{64}$/.test(reference.hash) || reference.key !== `${prefix}${reference.hash}.json` || !Number.isSafeInteger(reference.bytes) || reference.bytes < 1 || reference.bytes > EXECUTION_BYTES) throw new ResearchSourceError('execution_scope', 'Execution reference is outside its session.')
    const body = await sourceIO((ioSignal) => archive.read(reference.key, EXECUTION_BYTES, ioSignal), signal)
    if (body === undefined || Buffer.byteLength(body) !== reference.bytes || createHash('sha256').update(body).digest('hex') !== reference.hash) throw new ResearchSourceError('execution_integrity', 'Execution archive is missing or corrupt.')
    return JSON.parse(body) as unknown
  }, { sessionHash: createHash('sha256').update(sessionId).digest('hex') })
}
const SOURCE_BYTES = 2 * 1024 * 1024
const sourceLogger = createLogger({ op: 'archive.source' })
/** A reference is returned only after exact archived bytes are verified. Existing
 * content-addressed sources are adopted, never overwritten or silently repaired. */
export async function persistResearchSource(archive: ArchiveTarget, sessionId: string, source: { url: string; text: string }, signal?: AbortSignal): Promise<ArchivedResearchSource> {
  return logOp(sourceLogger, 'archive.source', async () => {
    if (!sessionId || sessionId.length > 255) throw new TypeError('Invalid source session identity.')
    const url = new URL(source.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || source.url.length > 2000) throw new TypeError('Invalid research source URL.')
    if (Buffer.byteLength(source.text) > SOURCE_BYTES) throw new ResearchSourceError('source_limit', 'Research source exceeds its byte limit.')
    const hash = createHash('sha256').update(`${source.url}\n${source.text}`).digest('hex')
    const key = `research-sources/${createHash('sha256').update(sessionId).digest('hex')}/${hash}.txt`
    let body = await sourceIO((ioSignal) => archive.read(key, SOURCE_BYTES, ioSignal), signal)
    if (body === undefined) {
      await sourceIO((ioSignal) => archive.write(key, source.text, ioSignal), signal)
      body = await sourceIO((ioSignal) => archive.read(key, SOURCE_BYTES, ioSignal), signal)
    }
    if (body === undefined || body !== source.text || createHash('sha256').update(`${source.url}\n${body}`).digest('hex') !== hash) throw new ResearchSourceError('source_integrity', 'Research source archive is missing or corrupt.')
    return { url: source.url, key, hash }
  }, { sessionHash: createHash('sha256').update(sessionId).digest('hex') })
}

export interface SourceOutcome { sources?: Array<{ url: string; text: string }>; sourceRefs?: ArchivedResearchSource[] }
export async function hydrateResearchSources<T extends SourceOutcome>(archive: ArchiveTarget, sessionId: string, outcome: T, signal?: AbortSignal): Promise<T & { sources: Array<{ url: string; text: string }> }> {
  return logOp(sourceLogger, 'archive.source.read', async () => {
    if (!outcome.sourceRefs) return { ...outcome, sources: outcome.sources ?? [] }
    if (outcome.sourceRefs.length > 256) throw new ResearchSourceError('source_limit', 'Research source reference limit exceeded.')
    const sources = []
    const prefix = `research-sources/${createHash('sha256').update(sessionId).digest('hex')}/`
    for (const reference of outcome.sourceRefs) {
      if (!/^[a-f0-9]{64}$/.test(reference.hash) || reference.key !== `${prefix}${reference.hash}.txt`) throw new ResearchSourceError('source_scope', 'Research source reference is outside its session.')
      const text = await sourceIO((ioSignal) => archive.read(reference.key, SOURCE_BYTES, ioSignal), signal)
      if (text === undefined || createHash('sha256').update(`${reference.url}\n${text}`).digest('hex') !== reference.hash) throw new ResearchSourceError('source_integrity', 'Saved source evidence is missing or corrupt.')
      sources.push({ url: reference.url, text })
    }
    return { ...outcome, sources }
  }, { sessionHash: createHash('sha256').update(sessionId).digest('hex'), sourceCount: outcome.sourceRefs?.length ?? outcome.sources?.length ?? 0 })
}
export async function archiveResearchOutcome<T extends SourceOutcome>(archive: ArchiveTarget, sessionId: string, outcome: T, signal?: AbortSignal): Promise<Omit<T, 'sources'> & { sourceRefs: ArchivedResearchSource[] }> {
  const hydrated = await hydrateResearchSources(archive, sessionId, outcome, signal)
  if (hydrated.sources.length > 256) throw new ResearchSourceError('source_limit', 'Research source reference limit exceeded.')
  const sourceRefs = []
  for (const source of hydrated.sources) sourceRefs.push(await persistResearchSource(archive, sessionId, source, signal))
  const { sources: _sources, ...rest } = outcome
  return { ...rest, sourceRefs }
}

/** One storage exchange is bounded even for a legacy injected target that does
 * not honor abort. Production FS/GCS paths receive and honor this signal. */
async function sourceIO<T>(work: (signal: AbortSignal) => Promise<T>, outer?: AbortSignal): Promise<T> {
  const deadline = new AbortController()
  const signal = outer ? AbortSignal.any([outer, deadline.signal]) : deadline.signal
  const timer = setTimeout(() => deadline.abort(new ResearchSourceError('source_timeout', 'Source archive request deadline exceeded.')), 60000)
  let rejectAbort: (() => void) | undefined
  try {
    signal.throwIfAborted()
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(signal.reason)
      signal.addEventListener('abort', rejectAbort, { once: true })
    })
    return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return work(signal) }), aborted])
  } finally {
    clearTimeout(timer)
    if (rejectAbort) signal.removeEventListener('abort', rejectAbort)
    deadline.abort()
  }
}

/** Bound file-storage operations even when a target ignores cancellation.
 * Writes use deterministic immutable receipt keys; an expired acknowledgement
 * never proves that the write did not happen. Callers verify before replay. */
const archiveDeadlineLimits = new WeakMap<ArchiveTarget, number>()
export function withArchiveDeadline(target: ArchiveTarget, timeoutMs = 30_000): ArchiveTarget {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new TypeError('Invalid archive operation deadline.')
  if ((archiveDeadlineLimits.get(target) ?? Infinity) <= timeoutMs) return target
  const logger = createLogger({ op: 'file.archive' })
  const keyHash = (key: string) => createHash('sha256').update(key).digest('hex')
  async function run<T>(work: (signal: AbortSignal) => Promise<T>, external?: AbortSignal): Promise<T> {
    const controller = new AbortController()
    const signal = external ? AbortSignal.any([controller.signal, external]) : controller.signal
    let timer: ReturnType<typeof setTimeout> | undefined
    let rejectAbort: () => void = () => undefined
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(new ResearchSourceError('source_timeout', 'File storage operation did not settle before its deadline.'))
      signal.addEventListener('abort', rejectAbort, { once: true })
    })
    try {
      signal.throwIfAborted()
      timer = setTimeout(() => controller.abort(), timeoutMs)
      return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return work(signal) }), aborted])
    } finally {
      if (timer) clearTimeout(timer)
      signal.removeEventListener('abort', rejectAbort)
    }
  }
  const bounded: ArchiveTarget = {
    write: (key, body, signal) => logOp(logger, 'file.archive.write', () => run((boundedSignal) => target.write(key, body, boundedSignal), signal), { keyHash: keyHash(key), bytes: Buffer.byteLength(body) }),
    read: (key, maxBytes, signal) => logOp(logger, 'file.archive.read', () => run((boundedSignal) => target.read(key, maxBytes, boundedSignal), signal), { keyHash: keyHash(key), maxBytes }),
    list: (prefix) => logOp(logger, 'file.archive.list', () => run(() => target.list(prefix)), { keyHash: keyHash(prefix) }),
  }
  archiveDeadlineLimits.set(bounded, timeoutMs)
  return bounded
}
