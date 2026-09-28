// Artifact pipeline (B4.3). Task/session-scoped artifact operations over
// the archive targets (GCS staging/prod, filesystem tests): store writes
// bytes plus a `t.artifact.stored` event, index records a `t.artifact.indexed`
// event with integrity hashes, and serve refuses anything the index does
// not cover — unindexed bytes are unservable, even when present.
//
// The pipeline has exactly three write-adjacent operations (body write,
// stored event, indexed event), all artifact-scoped. Proposals travel the
// same path as every other kind: there is no apply/mutate operation, so the
// proposal path structurally cannot write company mutations.
import { createHash, randomUUID } from 'node:crypto'
import type { ArchiveTarget } from '../archive/targets.js'
import type { StoredEvent } from '../db/index.js'

export const ARTIFACT_STORED_EVENT = 't.artifact.stored'
export const ARTIFACT_INDEXED_EVENT = 't.artifact.indexed'

/** Bodies over this size are rejected before any write. Staging bound. */
export const ARTIFACT_MAX_BYTES = 8 * 1024 * 1024

export interface ArtifactScope {
  kind: 'session' | 'task'
  id: string
}

export type ArtifactKind = 'file' | 'proposal' | 'report'

/** Why the bytes exist. Required on every store: the DB index answers
 * "why is this file stored" for every file, so nothing lands unexplained. */
export type ArtifactReason = 'subagent_output' | 'user_upload' | 'report' | 'proposal'

const ARTIFACT_REASONS: ReadonlySet<string> = new Set([
  'subagent_output',
  'user_upload',
  'report',
  'proposal',
])

export class ArtifactValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactValidationError'
  }
}

/** Thrown when serve (or index) runs ahead of its prerequisite event.
// The body may exist; without the index row it is still unservable. */
export class UnindexedArtifactError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnindexedArtifactError'
  }
}

/** Thrown when indexed bytes are missing or fail the recorded hash. */
export class CorruptArtifactError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CorruptArtifactError'
  }
}

export interface StoreInput {
  scope: ArtifactScope
  kind?: ArtifactKind
  name: string
  detail?: string
  source?: string
  body: string
  /** Caller key for idempotent re-store; generated when absent. */
  artifactId?: string
  /** Why the bytes exist (recorded in the index). Rejected when absent. */
  reason: ArtifactReason
  /** Run or thread key that produced the bytes (recorded in the index). */
  producedBy: string
}

export interface StoredArtifact {
  artifactId: string
  scope: ArtifactScope
  kind: ArtifactKind
  name: string
  key: string
  bytes: number
}

export interface IndexedArtifact extends StoredArtifact {
  detail?: string
  source?: string
  reason: ArtifactReason
  producedBy: string
  sha256: string
}

export interface ServedArtifact {
  body: string
  meta: IndexedArtifact
}

export interface ArtifactDeps {
  log(fields: {
    op: 'artifact.store' | 'artifact.index' | 'artifact.serve'
    scope: string
    artifactId: string
    ok: boolean
    bytes?: number
  }): void
  findEvent(idempotencyKey: string): Promise<StoredEvent | undefined>
  record(input: {
    idempotencyKey: string
    partition: string
    type: string
    payload: Record<string, unknown>
  }): Promise<void>
}

export function bodyKey(scope: ArtifactScope, artifactId: string): string {
  return `artifacts/${scope.kind}/${scope.id}/${artifactId}`
}

function storedKey(scope: ArtifactScope, artifactId: string): string {
  return `artifact-stored:${scope.kind}:${scope.id}:${artifactId}`
}

function indexKey(scope: ArtifactScope, artifactId: string): string {
  return `artifact-indexed:${scope.kind}:${scope.id}:${artifactId}`
}

/** Shared idempotency-key formats so db repos can locate artifact records
 * without duplicating the format (drift here orphans bytes). */
export function storedEventKey(scope: ArtifactScope, artifactId: string): string {
  return storedKey(scope, artifactId)
}

export function indexedEventKey(scope: ArtifactScope, artifactId: string): string {
  return indexKey(scope, artifactId)
}

export function referencedEventKey(toSessionId: string, artifactId: string): string {
  return `artifact-referenced:session:${toSessionId}:${artifactId}`
}

function partition(scope: ArtifactScope): string {
  return `artifact:${scope.kind}:${scope.id}`
}

function scopeLabel(scope: ArtifactScope): string {
  return `${scope.kind}:${scope.id}`
}

function checkScope(scope: ArtifactScope): void {
  if ((scope.kind !== 'session' && scope.kind !== 'task') || scope.id.trim() === '') {
    throw new ArtifactValidationError('artifact scope needs a session or task kind with a non-empty id')
  }
}

function payloadOf(event: StoredEvent): Record<string, unknown> {
  const payload = event.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new CorruptArtifactError(`artifact event ${event.idempotencyKey} carries no payload`)
  }
  return payload as Record<string, unknown>
}

export async function storeArtifact(
  target: ArchiveTarget,
  input: StoreInput,
  deps: ArtifactDeps,
): Promise<StoredArtifact> {
  checkScope(input.scope)
  if (input.name.trim() === '') throw new ArtifactValidationError('artifact needs a non-empty name')
  if (!ARTIFACT_REASONS.has(input.reason)) {
    throw new ArtifactValidationError(`artifact needs a known reason, got '${input.reason}'`)
  }
  if (input.producedBy.trim() === '') {
    throw new ArtifactValidationError('artifact needs a non-empty producedBy run or thread key')
  }
  const bytes = Buffer.byteLength(input.body, 'utf8')
  if (bytes === 0) throw new ArtifactValidationError('artifact body must not be empty')
  if (bytes > ARTIFACT_MAX_BYTES) {
    throw new ArtifactValidationError(`artifact body exceeds ${ARTIFACT_MAX_BYTES} bytes`)
  }
  const artifactId = input.artifactId ?? `art-${randomUUID()}`
  const kind = input.kind ?? 'file'
  const key = bodyKey(input.scope, artifactId)
  await target.write(key, input.body)
  await deps.record({
    idempotencyKey: storedKey(input.scope, artifactId),
    partition: partition(input.scope),
    type: ARTIFACT_STORED_EVENT,
    payload: {
      artifactId,
      scope: input.scope,
      kind,
      name: input.name,
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      reason: input.reason,
      producedBy: input.producedBy,
      key,
      bytes,
    },
  })
  deps.log({ op: 'artifact.store', scope: scopeLabel(input.scope), artifactId, ok: true, bytes })
  return { artifactId, scope: input.scope, kind, name: input.name, key, bytes }
}

export async function indexArtifact(
  target: ArchiveTarget,
  scope: ArtifactScope,
  artifactId: string,
  deps: ArtifactDeps,
): Promise<IndexedArtifact> {
  checkScope(scope)
  const stored = await deps.findEvent(storedKey(scope, artifactId))
  if (!stored || stored.type !== ARTIFACT_STORED_EVENT) {
    throw new UnindexedArtifactError(`artifact ${artifactId} was never stored`)
  }
  const meta = payloadOf(stored)
  const key = bodyKey(scope, artifactId)
  const body = await target.read(key)
  if (body === undefined) {
    throw new CorruptArtifactError(`stored artifact ${artifactId} has no bytes at ${key}`)
  }
  const sha256 = createHash('sha256').update(body, 'utf8').digest('hex')
  const reason = meta['reason']
  if (typeof reason !== 'string' || !ARTIFACT_REASONS.has(reason)) {
    throw new CorruptArtifactError(`stored artifact ${artifactId} carries no known reason`)
  }
  const producedBy = meta['producedBy']
  if (typeof producedBy !== 'string' || producedBy.trim() === '') {
    throw new CorruptArtifactError(`stored artifact ${artifactId} carries no producer`)
  }
  const indexed: IndexedArtifact = {
    artifactId,
    scope,
    kind: meta['kind'] === 'proposal' || meta['kind'] === 'report' ? meta['kind'] : 'file',
    name: typeof meta['name'] === 'string' ? meta['name'] : artifactId,
    key,
    bytes: Buffer.byteLength(body, 'utf8'),
    reason: reason as ArtifactReason,
    producedBy,
    sha256,
    ...(typeof meta['detail'] === 'string' ? { detail: meta['detail'] } : {}),
    ...(typeof meta['source'] === 'string' ? { source: meta['source'] } : {}),
  }
  await deps.record({
    idempotencyKey: indexKey(scope, artifactId),
    partition: partition(scope),
    type: ARTIFACT_INDEXED_EVENT,
    payload: { ...indexed },
  })
  deps.log({ op: 'artifact.index', scope: scopeLabel(scope), artifactId, ok: true, bytes: indexed.bytes })
  return indexed
}

/** One call, one indexed file: store then index. Production paths use
 * this instead of bare storeArtifact so "every file is indexed" holds
 * structurally instead of by caller discipline. */
export async function storeAndIndex(
  target: ArchiveTarget,
  input: StoreInput,
  deps: ArtifactDeps,
): Promise<IndexedArtifact> {
  const stored = await storeArtifact(target, input, deps)
  return indexArtifact(target, stored.scope, stored.artifactId, deps)
}

export async function serveArtifact(
  target: ArchiveTarget,
  scope: ArtifactScope,
  artifactId: string,
  deps: ArtifactDeps,
): Promise<ServedArtifact> {
  checkScope(scope)
  // The gate: only the index row makes an artifact servable. Stored-only
  // bytes (or no bytes at all) are refused here, not streamed.
  const indexed = await deps.findEvent(indexKey(scope, artifactId))
  if (!indexed || indexed.type !== ARTIFACT_INDEXED_EVENT) {
    throw new UnindexedArtifactError(`artifact ${artifactId} is not indexed`)
  }
  const meta = payloadOf(indexed) as unknown as IndexedArtifact
  const body = await target.read(bodyKey(scope, artifactId))
  if (body === undefined) {
    throw new CorruptArtifactError(`indexed artifact ${artifactId} has no bytes`)
  }
  const sha256 = createHash('sha256').update(body, 'utf8').digest('hex')
  if (sha256 !== meta.sha256) {
    throw new CorruptArtifactError(`indexed artifact ${artifactId} fails its recorded hash`)
  }
  deps.log({ op: 'artifact.serve', scope: scopeLabel(scope), artifactId, ok: true, bytes: meta.bytes })
  return { body, meta }
}
