// Cold-archive targets. B1.4. GCS is the real target on staging and prod;
// the filesystem target exists for unit tests and offline dev only. Both
// speak the same interface so retention and replay never branch on backend.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Storage } from '@google-cloud/storage'

export interface ArchiveTarget {
  write(key: string, body: string): Promise<void>
  read(key: string): Promise<string | undefined>
  list(prefix: string): Promise<string[]>
}

export class FilesystemTarget implements ArchiveTarget {
  constructor(private readonly dir: string) {}

  private path(key: string): string {
    return join(this.dir, key)
  }

  async write(key: string, body: string): Promise<void> {
    const path = this.path(key)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, body, 'utf8')
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
    const out: string[] = []
    const walk = async (relative: string): Promise<void> => {
      const entries = await readdir(this.path(relative), { withFileTypes: true }).catch(() => [])
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

  private key(name: string): string {
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
    const [files] = await this.bucket.getFiles({ prefix: this.key(prefix) })
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
