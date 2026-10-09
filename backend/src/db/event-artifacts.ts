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
import { ArtifactImportTimeout, checked, DbContractError, Id } from './errors.js'
import { assertFileVisible, hiddenFileIds, ingestSectorDocument } from './sector-documents.js'
import { requireSector, WorkspaceError } from './workspace.js'

import {
  KeySchema,
  appendEvent,
  findEventByKey,
  readPartition,
  type Db,
} from './events.js'
import { getSession, listSessions } from './sessions.js'

export async function indexSectorArtifact(db: Db, sectorId: string, artifactId: string, name: string, body: string, scope?: Scope, authorThread?: string): Promise<void> {
  checked(Id, sectorId)
  checked(Id, artifactId)
  if (typeof name !== 'string' || !name) throw new DbContractError('name must be a non-empty string')
  if (typeof body !== 'string' || !body) throw new DbContractError('body must be a non-empty string')
  await requireSector(db, sectorId, scope)
  const filename = /\.(md|txt|csv|json)$/i.test(name) ? name : `${name}.txt`
  const doc = await ingestSectorDocument(db, { sectorId, filename, contentBase64: Buffer.from(body).toString('base64'), source: 'artifact', scope, ...(authorThread ? { authorThread } : {}) })
  await db.query('INSERT INTO workspace_files(sector_id,file_id,document_id) VALUES($1,$2,$3) ON CONFLICT(sector_id,file_id) DO UPDATE SET document_id=$3', [sectorId, artifactId, doc.id])
}

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

const ARTIFACT_LIST_TYPES = ['t.artifact.stored', 't.artifact.indexed', ARTIFACT_REFERENCED_EVENT]

const ARTIFACT_PARTITION_PREFIX = 'artifact:session:'

/** Row-validity mirror of ArtifactSummaryPayload: absent (SQL NULL from ->)
 * is allowed for every optional field, explicit JSON null is not, strings
 * keep their length rules, bytes must be a non-negative integer, and
 * fromScope must carry a known kind plus a non-empty id. */
const ARTIFACT_VALID_ROW = `jsonb_typeof(payload) = 'object'
  AND jsonb_typeof(payload->'artifactId') = 'string' AND payload->>'artifactId' <> ''
  AND (payload->'name' IS NULL OR (jsonb_typeof(payload->'name') = 'string' AND payload->>'name' <> ''))
  AND (payload->'kind' IS NULL OR jsonb_typeof(payload->'kind') = 'string')
  AND (payload->'sha256' IS NULL OR jsonb_typeof(payload->'sha256') = 'string')
  AND (payload->'detail' IS NULL OR jsonb_typeof(payload->'detail') = 'string')
  AND (payload->'reason' IS NULL OR jsonb_typeof(payload->'reason') = 'string')
  AND (payload->'producedBy' IS NULL OR jsonb_typeof(payload->'producedBy') = 'string')
  AND (payload->'bytes' IS NULL OR (jsonb_typeof(payload->'bytes') = 'number'
    AND (payload->'bytes')::numeric >= 0 AND (payload->'bytes')::numeric = trunc((payload->'bytes')::numeric)))
  AND (payload->'sourceIndexed' IS NULL OR jsonb_typeof(payload->'sourceIndexed') = 'boolean')
  AND (payload->'fromScope' IS NULL OR (jsonb_typeof(payload->'fromScope') = 'object'
    AND (payload->'fromScope'->>'kind') IN ('session', 'task')
    AND jsonb_typeof(payload->'fromScope'->'id') = 'string' AND (payload->'fromScope'->>'id') <> ''))`

/** The artifact fold in SQL: fetching every artifact event row caps the
 * sector library at ~860 ms at volume (166k rows), so the database folds
 * to one row per (partition, artifact) in a single scan: last-write-wins
 * per field in seq order over valid rows, the indexed flags, the unproven
 * reference scopes, and the arrival time. The payload ? 'artifactId'
 * prefilter matches the partial fold index: keyless rows contribute
 * nothing (invalid for the fold, NULL for the arrival). Summaries come out
 * in first-appearance order. */
const ARTIFACT_FOLD_SQL = `SELECT partition AS partition, payload->>'artifactId' AS artifact_id,
   (array_agg(payload->>'name' ORDER BY seq DESC) FILTER (WHERE ${ARTIFACT_VALID_ROW} AND payload ? 'name'))[1] AS name,
   (array_agg(payload->>'kind' ORDER BY seq DESC) FILTER (WHERE ${ARTIFACT_VALID_ROW} AND payload ? 'kind'))[1] AS kind,
   (array_agg(payload->'bytes' ORDER BY seq DESC) FILTER (WHERE ${ARTIFACT_VALID_ROW} AND payload ? 'bytes'))[1] AS bytes,
   (array_agg(payload->>'sha256' ORDER BY seq DESC) FILTER (WHERE ${ARTIFACT_VALID_ROW} AND payload ? 'sha256'))[1] AS sha256,
   (array_agg(payload->>'detail' ORDER BY seq DESC) FILTER (WHERE ${ARTIFACT_VALID_ROW} AND payload ? 'detail'))[1] AS detail,
   (array_agg(payload->>'reason' ORDER BY seq DESC) FILTER (WHERE ${ARTIFACT_VALID_ROW} AND payload ? 'reason'))[1] AS reason,
   (array_agg(payload->>'producedBy' ORDER BY seq DESC) FILTER (WHERE ${ARTIFACT_VALID_ROW} AND payload ? 'producedBy'))[1] AS produced_by,
   (array_agg(jsonb_build_object('kind', payload->'fromScope'->>'kind', 'id', payload->'fromScope'->>'id')
     ORDER BY seq DESC) FILTER (WHERE ${ARTIFACT_VALID_ROW} AND type = 't.artifact.referenced' AND payload ? 'fromScope'))[1] AS referenced_from,
   bool_or(type = 't.artifact.indexed') FILTER (WHERE ${ARTIFACT_VALID_ROW}) AS direct_indexed,
   bool_or((payload->'sourceIndexed')::boolean IS TRUE)
     FILTER (WHERE ${ARTIFACT_VALID_ROW} AND type = 't.artifact.referenced' AND payload ? 'fromScope') AS ref_indexed,
   array_agg(DISTINCT payload->'fromScope') FILTER (WHERE ${ARTIFACT_VALID_ROW} AND type = 't.artifact.referenced'
     AND payload ? 'fromScope' AND NOT ((payload->'sourceIndexed')::boolean IS TRUE)) AS unproven_refs,
   min(seq) FILTER (WHERE ${ARTIFACT_VALID_ROW}) AS first_seq,
   min(at) FILTER (WHERE payload->>'artifactId' IS NOT NULL) AS arrived
 FROM events
 WHERE partition = ANY($1::text[]) AND type = ANY($2::text[]) AND payload ? 'artifactId'
 GROUP BY partition, payload->>'artifactId'
 ORDER BY partition ASC, first_seq ASC`

interface ArtifactFoldRow {
  partition: string
  artifact_id: string | null
  name: string | null
  kind: string | null
  bytes: number | null
  sha256: string | null
  detail: string | null
  reason: string | null
  produced_by: string | null
  referenced_from: ArtifactScope | null
  direct_indexed: boolean | null
  ref_indexed: boolean | null
  unproven_refs: ArtifactScope[] | null
  first_seq: string | null
  arrived: Date | null
}

interface FoldedPartitions {
  summaries: Map<string, ArtifactSummary[]>
  arrivedAt: Map<string, number>
}

function toArtifactSummary(row: ArtifactFoldRow, proven: Set<string>): ArtifactSummary | undefined {
  if (row.artifact_id === null || row.first_seq === null) return undefined
  const artifactId = row.artifact_id
  const entry: ArtifactSummary = { artifactId, indexed: false }
  if (row.name !== null) entry.name = row.name
  if (row.kind !== null) entry.kind = row.kind
  if (row.bytes !== null) entry.bytes = row.bytes
  if (row.sha256 !== null) entry.sha256 = row.sha256
  if (row.detail !== null) entry.detail = row.detail
  if (row.reason !== null) entry.reason = row.reason
  if (row.produced_by !== null) entry.producedBy = row.produced_by
  if (row.referenced_from !== null) entry.referencedFrom = row.referenced_from
  entry.indexed = row.direct_indexed === true || row.ref_indexed === true ||
    (row.unproven_refs ?? []).some((scope) => proven.has(indexedEventKey(scope, artifactId)))
  return entry
}

async function foldArtifactPartitions(db: Db, partitions: string[]): Promise<FoldedPartitions> {
  const summaries = new Map<string, ArtifactSummary[]>()
  const arrivedAt = new Map<string, number>()
  const { rows } = await db.query<ArtifactFoldRow>(ARTIFACT_FOLD_SQL, [partitions, ARTIFACT_LIST_TYPES])
  const proofKeys = new Set<string>()
  for (const row of rows) {
    if (row.artifact_id === null) continue
    for (const scope of row.unproven_refs ?? []) proofKeys.add(indexedEventKey(scope, row.artifact_id))
  }
  const proven = new Set<string>()
  if (proofKeys.size > 0) {
    const { rows: proofRows } = await db.query<{ idempotency_key: string; type: string }>(
      'SELECT idempotency_key, type FROM events WHERE idempotency_key = ANY($1::text[])',
      [[...proofKeys]],
    )
    for (const proof of proofRows) {
      if (proof.type === 't.artifact.indexed') proven.add(proof.idempotency_key)
    }
  }
  for (const row of rows) {
    const entry = toArtifactSummary(row, proven)
    if (!entry || row.arrived === null) continue
    const sessionId = row.partition.slice(ARTIFACT_PARTITION_PREFIX.length)
    const list = summaries.get(sessionId) ?? []
    list.push(entry)
    summaries.set(sessionId, list)
    const at = new Date(row.arrived).getTime()
    if (!arrivedAt.has(entry.artifactId) || at < (arrivedAt.get(entry.artifactId) as number)) arrivedAt.set(entry.artifactId, at)
  }
  return { summaries, arrivedAt }
}

/** Artifact listing for a session scope: joins stored + indexed event
 * records from the artifact partition. Files-menu reads; body serving
 * stays in the pipeline (needs the archive target). */
export async function listArtifacts(db: Db, sessionId: string, includeHidden = false): Promise<ArtifactSummary[]> {
  if (!z.string().min(1).safeParse(sessionId).success) {
    throw new DbContractError('sessionId must be a non-empty string')
  }
  const folded = await foldArtifactPartitions(db, [`${ARTIFACT_PARTITION_PREFIX}${sessionId}`])
  const session = await getSession(db, sessionId)
  const hidden = !includeHidden && session?.sectorId ? await hiddenFileIds(db, session.sectorId) : new Set<string>()
  return (folded.summaries.get(sessionId) ?? []).filter((file) => !hidden.has(file.artifactId))
}

export interface BatchedArtifacts {
  summaries: Map<string, ArtifactSummary[]>
  /** Global earliest event time per artifactId (arrival order). */
  arrivedAt: Map<string, number>
}

/** Batched listing for many sessions: one folding query over all artifact
 * partitions instead of one readPartition per session. Entries equal
 * per-session listArtifacts with includeHidden; arrivedAt equals the
 * library's old min(at) arrivals query. */
export async function listArtifactsForSessions(db: Db, sessionIds: string[]): Promise<BatchedArtifacts> {
  if (sessionIds.length === 0) return { summaries: new Map(), arrivedAt: new Map() }
  for (const sessionId of sessionIds) {
    if (!z.string().min(1).safeParse(sessionId).success) throw new DbContractError('sessionId must be a non-empty string')
  }
  return foldArtifactPartitions(db, sessionIds.map((sessionId) => `${ARTIFACT_PARTITION_PREFIX}${sessionId}`))
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
    await indexSectorArtifact(db, toSession.sectorId, copied.artifactId, copied.name, served.body, input.scope, served.meta.producedBy)
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
  /** Authoring thread; defaults to producedBy (thread key in turn paths). */
  authorThread?: string
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
    if (session.sectorId) await indexSectorArtifact(db, session.sectorId, indexed.artifactId, indexed.name, input.content, input.scope, input.authorThread ?? indexed.producedBy)
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
