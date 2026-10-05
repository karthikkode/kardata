// Event-sourced artifacts: listing, referencing, scope resolution,
// tenant listing, and creation.
import { z } from 'zod'
import {
  ARTIFACT_MAX_BYTES,
  indexedEventKey,
  referencedEventKey,
  serveArtifact,
  storeAndIndex,
  storedEventKey,
  type ArtifactKind,
  type ArtifactReason,
  type ArtifactScope,
} from '../artifacts/pipeline.js'
import { resolveArchiveTarget, type ArchiveTarget } from '../archive/targets.js'
import type { Scope } from '../auth/types.js'
import { createLogger, logOp } from '../observability/logging.js'
import { ArtifactImportTimeout, DbContractError } from './errors.js'
import { indexSectorArtifact } from './workspace-library.js'
import { assertFileVisible, hiddenFileIds } from './sector-documents.js'
import { WorkspaceError } from './workspace.js'

import {
  KeySchema,
  appendEvent,
  findEventByKey,
  readPartition,
  type Db,
} from './events.js'
import { getSession, listSessions } from './sessions.js'

export interface ArtifactSummary {
  artifactId: string
  name?: string
  kind?: string
  bytes?: number
  sha256?: string
  detail?: string
  reason?: string
  producedBy?: string
  /** Owning scope when this session holds the file by reference, not origin. */
  referencedFrom?: ArtifactScope
  /** Populated by the tenant listing only. */
  sessionId?: string
  indexed: boolean
}

const ARTIFACT_REFERENCED_EVENT = 't.artifact.referenced'

const ArtifactScopePayload = z.object({
  kind: z.enum(['session', 'task']),
  id: z.string().min(1),
})

const ArtifactSummaryPayload = z
  .object({
    artifactId: z.string().min(1),
    name: z.string().min(1).optional(),
    kind: z.string().optional(),
    bytes: z.number().int().nonnegative().optional(),
    sha256: z.string().optional(),
    detail: z.string().optional(),
    reason: z.string().optional(),
    producedBy: z.string().optional(),
    fromScope: ArtifactScopePayload.optional(),
    sourceIndexed: z.boolean().optional(),
  })
  .passthrough()

/** Artifact listing for a session scope: joins stored + indexed event
 * records from the artifact partition. Files-menu reads; body serving
 * stays in the pipeline (needs the archive target). */
export async function listArtifacts(db: Db, sessionId: string, includeHidden = false): Promise<ArtifactSummary[]> {
  if (!z.string().min(1).safeParse(sessionId).success) {
    throw new DbContractError('sessionId must be a non-empty string')
  }
  const events = await readPartition(db, `artifact:session:${sessionId}`)
  const byId = new Map<string, ArtifactSummary>()
  for (const event of events) {
    if (
      event.type !== 't.artifact.stored' &&
      event.type !== 't.artifact.indexed' &&
      event.type !== ARTIFACT_REFERENCED_EVENT
    ) {
      continue
    }
    const parsed = ArtifactSummaryPayload.safeParse(event.payload)
    if (!parsed.success) continue
    let entry = byId.get(parsed.data.artifactId)
    if (!entry) {
      entry = { artifactId: parsed.data.artifactId, indexed: false }
      byId.set(parsed.data.artifactId, entry)
    }
    if (parsed.data.name !== undefined) entry.name = parsed.data.name
    if (parsed.data.kind !== undefined) entry.kind = parsed.data.kind
    if (parsed.data.bytes !== undefined) entry.bytes = parsed.data.bytes
    if (parsed.data.sha256 !== undefined) entry.sha256 = parsed.data.sha256
    if (parsed.data.detail !== undefined) entry.detail = parsed.data.detail
    if (parsed.data.reason !== undefined) entry.reason = parsed.data.reason
    if (parsed.data.producedBy !== undefined) entry.producedBy = parsed.data.producedBy
    if (event.type === 't.artifact.indexed') entry.indexed = true
    if (event.type === ARTIFACT_REFERENCED_EVENT && parsed.data.fromScope !== undefined) {
      entry.referencedFrom = parsed.data.fromScope
      const proof = parsed.data.sourceIndexed === true ? undefined : await findEventByKey(db, indexedEventKey(parsed.data.fromScope, parsed.data.artifactId))
      if (parsed.data.sourceIndexed === true || proof?.type === 't.artifact.indexed') entry.indexed = true
    }
  }
  const session = await getSession(db, sessionId)
  const hidden = !includeHidden && session?.sectorId ? await hiddenFileIds(db, session.sectorId) : new Set<string>()
  return [...byId.values()].filter((file) => !hidden.has(file.artifactId))
}

/** Attach an existing file to another session without copying bytes. The
 * referenced event snapshots display fields and the owning scope; serve
 * still resolves bytes through the owner's index gate. */
export async function referenceArtifact(db: Db, input: { artifactId: string; fromScope: ArtifactScope; toSessionId: string; scope?: Scope }, archive?: ArchiveTarget, timeoutMs = 60_000): Promise<ArtifactSummary> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new DbContractError('Import timeout must be between 1 and 60000 milliseconds')
  return logOp(artifactLogger, 'artifact.import', async () => {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(new ArtifactImportTimeout()), timeoutMs)
    let rejectAbort: () => void = () => undefined
    const cancelled = new Promise<never>((_resolve, reject) => { rejectAbort = () => reject(abort.signal.reason); abort.signal.addEventListener('abort', rejectAbort, { once: true }) })
    try { return await Promise.race([referenceArtifactImpl(db, input, archive, abort.signal), cancelled]) }
    finally { clearTimeout(timer); abort.signal.removeEventListener('abort', rejectAbort) }
  }, { artifactId: input.artifactId, destinationSession: input.toSessionId })
}

async function referenceArtifactImpl(
  db: Db,
  input: {
    artifactId: string
    fromScope: ArtifactScope
    toSessionId: string
    scope?: Scope
  },
  archive?: ArchiveTarget,
  signal?: AbortSignal,
): Promise<ArtifactSummary> {
  if (!KeySchema.safeParse(input.artifactId).success) {
    throw new DbContractError('artifactId must be a non-empty string')
  }
  const scopeParsed = ArtifactScopePayload.safeParse(input.fromScope)
  if (!scopeParsed.success) throw new DbContractError('fromScope must be a session or task scope')
  const toSession = await getSession(db, input.toSessionId, input.scope)
  if (!toSession) throw new DbContractError(`unknown session ${input.toSessionId}`)
  if (input.scope) {
    if (scopeParsed.data.kind !== 'session') throw new WorkspaceError('permission_denied', 'Source task ownership is not established for this import.')
    const source = await getSession(db, scopeParsed.data.id, input.scope)
    if (!source) throw new WorkspaceError('permission_denied', 'Source file is outside the authorized scope.')
    if (source.sectorId) await assertFileVisible(db, source.sectorId, input.artifactId)
  }
  const stored = await findEventByKey(db, storedEventKey(scopeParsed.data, input.artifactId))
  if (!stored || stored.type !== 't.artifact.stored') {
    throw new DbContractError(`artifact ${input.artifactId} was never stored`)
  }
  const indexed = await findEventByKey(db, indexedEventKey(scopeParsed.data, input.artifactId))
  if (!indexed || indexed.type !== 't.artifact.indexed') {
    throw new DbContractError(`artifact ${input.artifactId} is not indexed`)
  }
  const meta = ArtifactSummaryPayload.safeParse(stored.payload)
  const payload: Record<string, unknown> = {
    artifactId: input.artifactId,
    fromScope: scopeParsed.data,
    sourceIndexed: true,
    ...(meta.success && typeof meta.data.name === 'string' ? { name: meta.data.name } : {}),
    ...(meta.success && typeof meta.data.kind === 'string' ? { kind: meta.data.kind } : {}),
    ...(meta.success && typeof meta.data.detail === 'string' ? { detail: meta.data.detail } : {}),
    ...(meta.success && typeof meta.data.reason === 'string' ? { reason: meta.data.reason } : {}),
    ...(meta.success && typeof meta.data.producedBy === 'string'
      ? { producedBy: meta.data.producedBy }
      : {}),
  }
  const original = archive ?? resolveArchiveTarget()
  const target: ArchiveTarget = { list: (prefix) => original.list(prefix), read: (key) => { signal?.throwIfAborted(); return original.read(key, ARTIFACT_MAX_BYTES, signal) }, write: (key, body) => { signal?.throwIfAborted(); return original.write(key, body, signal) } }
  const artifactDeps = { log: (fields: unknown) => artifactLogger.info(fields), findEvent: (key: string) => findEventByKey(db, key), record: async (event: unknown) => { signal?.throwIfAborted(); await appendEvent(db, event); signal?.throwIfAborted() } }
  const served = await serveArtifact(target, scopeParsed.data, input.artifactId, artifactDeps)
  if (toSession.sectorId) {
    const copied = await storeAndIndex(target, { scope: { kind: 'session', id: input.toSessionId }, artifactId: input.artifactId, name: served.meta.name, body: served.body, reason: served.meta.reason, producedBy: served.meta.producedBy, kind: served.meta.kind, detail: served.meta.detail }, artifactDeps)
    await indexSectorArtifact(db, toSession.sectorId, copied.artifactId, copied.name, served.body, input.scope)
    payload['bytes'] = copied.bytes; payload['sha256'] = copied.sha256
  }
  signal?.throwIfAborted()
  await appendEvent(db, {
    idempotencyKey: referencedEventKey(input.toSessionId, input.artifactId),
    partition: `artifact:session:${input.toSessionId}`,
    type: ARTIFACT_REFERENCED_EVENT,
    payload,
  })
  const summary: ArtifactSummary = { artifactId: input.artifactId, indexed: true }
  if (typeof payload['name'] === 'string') summary.name = payload['name']
  if (typeof payload['kind'] === 'string') summary.kind = payload['kind']
  if (typeof payload['detail'] === 'string') summary.detail = payload['detail']
  if (typeof payload['reason'] === 'string') summary.reason = payload['reason']
  if (typeof payload['producedBy'] === 'string') summary.producedBy = payload['producedBy']
  summary.referencedFrom = scopeParsed.data
  return summary
}

/** Resolve the owning scope for a session-visible artifact: its own stored
 * record first, else the scope a referenced event points at. */
export async function resolveArtifactScope(
  db: Db,
  sessionId: string,
  artifactId: string,
): Promise<{ scope: ArtifactScope; referenced: boolean } | undefined> {
  if (!KeySchema.safeParse(sessionId).success || !KeySchema.safeParse(artifactId).success) {
    throw new DbContractError('sessionId and artifactId must be non-empty strings')
  }
  const own: ArtifactScope = { kind: 'session', id: sessionId }
  const session = await getSession(db, sessionId)
  if (session?.sectorId) await assertFileVisible(db, session.sectorId, artifactId)
  const stored = await findEventByKey(db, storedEventKey(own, artifactId))
  if (stored && stored.type === 't.artifact.stored') return { scope: own, referenced: false }
  const events = await readPartition(db, `artifact:session:${sessionId}`)
  for (const event of events) {
    if (event.type !== ARTIFACT_REFERENCED_EVENT) continue
    const parsed = ArtifactSummaryPayload.safeParse(event.payload)
    if (!parsed.success || parsed.data.artifactId !== artifactId) continue
    if (!parsed.data.fromScope) continue
    if (parsed.data.fromScope.kind === 'session') {
      const owner = await getSession(db, parsed.data.fromScope.id)
      if (owner?.sectorId) await assertFileVisible(db, owner.sectorId, artifactId)
    }
    return { scope: parsed.data.fromScope, referenced: true }
  }
  return undefined
}

/** Tenant-wide file discovery for cross-session attach: every session in
 * scope with its files-menu listing. Task-owned files are referenceable by
 * id (agents carry it) but not enumerated here — tasks have no
 * tenant mapping in phase 1. */
export async function listTenantArtifacts(db: Db, scope: Scope): Promise<ArtifactSummary[]> {
  const sessions = await listSessions(db, scope)
  const out: ArtifactSummary[] = []
  for (const session of sessions) {
    const entries = await listArtifacts(db, session.id)
    for (const entry of entries) out.push({ ...entry, sessionId: session.id })
  }
  return out
}

export interface CreateArtifactInput {
  artifactId?: string
  sessionId: string
  name: string
  content: string
  kind?: ArtifactKind
  detail?: string
  reason?: ArtifactReason
  producedBy?: string
  scope?: Scope
}

/** Creates, writes, and indexes a file or report artifact for a session.
 * Bytes land in the archive target; stored and indexed events append to
 * the session partition so the file is immediately discoverable and
 * servable. Unknown sessions fail before any byte is written. */
const artifactLogger = createLogger({ op: 'artifact.create' })

export async function createArtifact(
  db: Db,
  input: CreateArtifactInput,
  archive?: ArchiveTarget,
): Promise<ArtifactSummary> {
  return logOp(artifactLogger, 'artifact.create', async () => {
    if (!KeySchema.safeParse(input.sessionId).success) {
      throw new DbContractError('sessionId must be a non-empty string')
    }
    if (!KeySchema.safeParse(input.name).success) {
      throw new DbContractError('name must be a non-empty string')
    }
    if (typeof input.content !== 'string' || input.content.length === 0) {
      throw new DbContractError('content must be a non-empty string')
    }
    const session = await getSession(db, input.sessionId, input.scope)
    if (!session) throw new DbContractError(`unknown session ${input.sessionId}`)
    const target = archive ?? resolveArchiveTarget()
    const indexed = await storeAndIndex(
      target,
      {
        scope: { kind: 'session', id: input.sessionId },
        kind: input.kind ?? 'file',
        name: input.name,
        detail: input.detail,
        body: input.content,
        reason: input.reason ?? 'report',
        producedBy: input.producedBy ?? input.sessionId,
        artifactId: input.artifactId,
      },
      {
        log: (fields) => artifactLogger.info(fields),
        findEvent: (key) => findEventByKey(db, key),
        record: (event) => appendEvent(db, event).then(() => undefined),
      },
    )
    if (session.sectorId) await indexSectorArtifact(db, session.sectorId, indexed.artifactId, indexed.name, input.content, input.scope)
    return {
      artifactId: indexed.artifactId,
      name: indexed.name,
      kind: indexed.kind,
      bytes: indexed.bytes,
      sha256: indexed.sha256,
      detail: indexed.detail,
      reason: indexed.reason,
      producedBy: indexed.producedBy,
      indexed: true,
    }
  }, { sessionId: input.sessionId, artifactId: input.artifactId })
}
