// Cold-archive targets. B1.4. GCS is the real target on staging and prod;
// the filesystem target exists for unit tests and offline dev only. Both
// speak the same interface so retention and replay never branch on backend.
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Storage } from '@google-cloud/storage'

export function assertArchiveKey(key: string, prefix = false): void {
  if (typeof key !== 'string') throw new TypeError('Archive key must be a string.')
  const parts = key.split('/')
  if (prefix && parts.at(-1) === '') parts.pop()
  if (typeof key !== 'string' || Buffer.byteLength(key) > 1024 || (key.includes('\\') || [...key].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) || key.startsWith('/') || (!prefix && !key) || parts.some((part) => part === '.' || part === '..' || part === '')) throw new TypeError('Archive key must be a relative scoped path without traversal.')
}

export interface ArchiveTarget {
  write(key: string, body: string): Promise<void>
  read(key: string): Promise<string | undefined>
  list(prefix: string): Promise<string[]>
}

export class FilesystemTarget implements ArchiveTarget {
  constructor(private readonly dir: string) {}

  private path(key: string, prefix = false): string {
    assertArchiveKey(key, prefix)
    return join(this.dir, key)
  }

  async write(key: string, body: string): Promise<void> {
    const path = this.path(key)
    await mkdir(join(path, '..'), { recursive: true })
    const temporary = `${path}.tmp-${randomUUID()}`
    try { await writeFile(temporary, body, 'utf8'); await rename(temporary, path) }
    finally { await unlink(temporary).catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }) }
  }

  async read(key: string): Promise<string | undefined> {
    try {
      return await readFile(this.path(key), 'utf8')
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
  download(): Promise<[Buffer]>
  exists(): Promise<[boolean]>
}

export interface GcsListedFile {
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

  async write(key: string, body: string): Promise<void> {
    await this.bucket.file(this.key(key)).save(body)
  }

  async read(key: string): Promise<string | undefined> {
    const file = this.bucket.file(this.key(key))
    const [exists] = await file.exists()
    if (!exists) return undefined
    const [body] = await file.download()
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
