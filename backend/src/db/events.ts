// Events repository: the only read/write path to the event log (moved
// from events/append.ts, B7.2 behavior-neutral). Every state-changing or
// notable backend action goes through appendEvent: Zod-validated envelope,
// idempotency key (duplicates replay the first seq, one row), per-partition
// ordering, and a redaction hook that scrubs secrets before they touch disk.
// Misaligned calls throw DbContractError before any SQL runs.
import { randomUUID } from 'node:crypto'
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
import type { Scope } from '../auth/keys.js'
import { scrubSecrets, createLogger, logOp } from '../observability/logging.js'
import { ArtifactImportTimeout, DbContractError } from './errors.js'
import { DURABLE_STREAM_LOCK_SQL } from './checkpoints.js'
import { assertFileVisible, hiddenFileIds, indexSectorArtifact, sessionKind, WorkspaceError } from './workspace.js'

export const EventEnvelope = z.object({
  idempotencyKey: z.string().min(1),
  partition: z.string().min(1),
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  redacted: z.boolean().default(false),
})

export type EventEnvelope = z.infer<typeof EventEnvelope>

export interface AppendedEvent {
  seq: number
  duplicate: boolean
}

// Minimal query surface: pg Pool/Client satisfy it, and tests can fake it
// without importing driver result types.
export interface DbQueryResult<TRow> {
  rowCount: number | null
  rows: TRow[]
}

export interface Db {
  query<TRow>(text: string, params?: unknown[]): Promise<DbQueryResult<TRow>>
}

interface EventRow {
  seq: number
}

const KeySchema = z.string().min(1)
const PartitionSchema = z.string().min(1)
const AfterSeqSchema = z.number().int().min(0)

export async function appendEvent(db: Db, input: unknown): Promise<AppendedEvent> {
  const parsed = EventEnvelope.safeParse(input)
  if (!parsed.success) {
    throw new DbContractError(`invalid event envelope: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
  }
  const event = parsed.data
  const payload = event.redacted ? scrubSecrets(event.payload) : event.payload
  const inserted = await db.query<EventRow>(
    `WITH durable_order AS MATERIALIZED (${DURABLE_STREAM_LOCK_SQL})
     INSERT INTO events (idempotency_key, partition, type, payload, redacted)
     SELECT $1, $2, $3, $4::jsonb, $5 FROM durable_order
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING seq`,
    [event.idempotencyKey, event.partition, event.type, JSON.stringify(payload), event.redacted],
  )
  if (inserted.rowCount === 1) {
    const row = inserted.rows[0]
    if (!row) throw new Error('appendEvent: missing RETURNING row')
    return { seq: Number(row.seq), duplicate: false }
  }
  const existing = await db.query<EventRow>('SELECT seq FROM events WHERE idempotency_key = $1', [
    event.idempotencyKey,
  ])
  const row = existing.rows[0]
  if (!row) throw new Error('appendEvent: lost idempotency race with no winner')
  return { seq: Number(row.seq), duplicate: true }
}

export interface StoredEvent {
  seq: number
  idempotencyKey: string
  partition: string
  type: string
  payload: unknown
  redacted: boolean
  at: string
}

/** Durable exactly-once lookup: the recorded outcome of a prior call under
 * the same idempotency key, if any. Tool activities replay from this row
 * instead of re-executing. */
export async function findEventByKey(db: Db, idempotencyKey: string): Promise<StoredEvent | undefined> {
  if (!KeySchema.safeParse(idempotencyKey).success) {
    throw new DbContractError('idempotencyKey must be a non-empty string')
  }
  const { rows } = await db.query<{
    seq: number
    idempotency_key: string
    partition: string
    type: string
    payload: unknown
    redacted: boolean
    at: Date
  }>(
    `SELECT seq, idempotency_key, partition, type, payload, redacted, at
     FROM events WHERE idempotency_key = $1`,
    [idempotencyKey],
  )
  const row = rows[0]
  if (!row) return undefined
  return {
    seq: Number(row.seq),
    idempotencyKey: row.idempotency_key,
    partition: row.partition,
    type: row.type,
    payload: row.payload,
    redacted: row.redacted,
    at: row.at.toISOString(),
  }
}

export async function readPartition(db: Db, partition: string, afterSeq = 0, types?: string[]): Promise<StoredEvent[]> {
  if (!PartitionSchema.safeParse(partition).success) {
    throw new DbContractError('partition must be a non-empty string')
  }
  if (!AfterSeqSchema.safeParse(afterSeq).success) {
    throw new DbContractError('afterSeq must be a non-negative integer')
  }
  if (types !== undefined && !z.array(z.string().min(1)).min(1).max(20).safeParse(types).success) throw new DbContractError('Event types must contain1-20 non-empty strings')
  const { rows } = await db.query<{
    seq: number
    idempotency_key: string
    partition: string
    type: string
    payload: unknown
    redacted: boolean
    at: Date
  }>(
    `SELECT seq, idempotency_key, partition, type, payload, redacted, at
     FROM events WHERE partition = $1 AND seq > $2 ${types === undefined ? '' : 'AND type=ANY($3::text[])'} ORDER BY seq ASC`,
    types === undefined ? [partition, afterSeq] : [partition, afterSeq, types],
  )
  return rows.map((row) => ({
    seq: Number(row.seq),
    idempotencyKey: row.idempotency_key,
    partition: row.partition,
    type: row.type,
    payload: row.payload,
    redacted: row.redacted,
    at: row.at.toISOString(),
  }))
}

// Session reads straight from the event log (moved from sessions/query.ts,
// B7.5 behavior-neutral). Sessions have no projection table: identity and
// title come from t.session.created, freshness from the latest event in the
// session partition. Always current, no checkpoint needed.

export interface SessionRecord {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  /** Owning sector for sector chats; absent for general Karbot sessions. */
  sectorId?: string
  /** Per-session provider+model selection; absent until the caller sets one. */
  model?: SessionModelSelection
}

/** Per-session provider+model selection, stored on t.session.model events. */
export const SessionModelSelection = z.object({
  provider: z.literal('meta'),
  model: z.string().min(1),
  reasoning: z.boolean().default(false),
  /** Reasoning depth; only meaningful when the model lists the level. */
  effort: z.string().min(1).optional(),
})

export type SessionModelSelection = z.infer<typeof SessionModelSelection>

export const SESSION_MODEL_EVENT = 't.session.model'

/** Tombstone: deleted sessions stay in the log but vanish from reads. */
export const SESSION_DELETED_EVENT = 't.session.deleted'

interface SessionRow {
  id: string
  title: string
  sector: string | null
  created_at: Date | string
  updated_at: Date | string
}

const SESSIONS_CTE = `WITH created AS (
  SELECT DISTINCT ON (payload->>'sessionId')
    payload->>'sessionId' AS id, payload->>'title' AS title, at AS created_at,
    payload->>'tenantId' AS tenant, payload->>'projectId' AS project,
    payload->>'sectorId' AS sector
  FROM events WHERE type = 't.session.created'
  ORDER BY payload->>'sessionId', at ASC
), renamed AS (
  SELECT DISTINCT ON (payload->>'sessionId')
    payload->>'sessionId' AS id, payload->>'title' AS title
  FROM events WHERE type = 't.session.renamed'
  ORDER BY payload->>'sessionId', at DESC
), deleted AS (
  SELECT DISTINCT payload->>'sessionId' AS id
  FROM events WHERE type = 't.session.deleted'
)`;

// Earliest creation wins when an id was created twice (workflows also append
// t.session.created); updatedAt tracks the freshest event in the partition.
// With a scope, only the caller's tenant (and selected project) is visible;
// sessions created before tenancy carry no tenant and stay hidden.
// sectorId narrows to one sector's chats; without it only general Karbot
// sessions list (sector chats live in their sector pool, never in Karbot).
export async function listSessions(db: Db, scope?: Scope, sectorId?: string): Promise<SessionRecord[]> {
  if (sectorId !== undefined && !z.string().min(1).safeParse(sectorId).success) {
    throw new DbContractError('sectorId must be a non-empty string')
  }
  const conditions: string[] = []
  const params: unknown[] = []
  if (scope) {
    params.push(scope.tenantId, scope.projectId)
    conditions.push(`c.tenant = $${params.length - 1} AND ($${params.length}::text IS NULL OR c.project = $${params.length})`)
  }
  if (sectorId !== undefined) {
    params.push(sectorId)
    conditions.push(`c.sector = $${params.length}`)
  } else {
    conditions.push('c.sector IS NULL')
  }
  const filter = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''
  const { rows } = await db.query<SessionRow>(
    `${SESSIONS_CTE}
     SELECT c.id AS id, COALESCE(r.title, c.title) AS title, c.sector AS sector, c.created_at AS created_at, MAX(e.at) AS updated_at
     FROM created c LEFT JOIN renamed r ON r.id = c.id LEFT JOIN deleted d ON d.id = c.id JOIN events e ON e.partition = 'session:' || c.id
     WHERE d.id IS NULL ${filter}
     GROUP BY c.id, COALESCE(r.title, c.title), c.sector, c.created_at
     ORDER BY MAX(e.at) DESC`,
    params,
  )
  return rows.map(toSessionRecord)
}

interface RawEventRow {
  seq: number | string
  idempotency_key: string
  partition: string
  type: string
  payload: unknown
  redacted: boolean
  at: Date | string
}

function toStoredEvent(row: RawEventRow): StoredEvent {
  return {
    seq: Number(row.seq),
    idempotencyKey: row.idempotency_key,
    partition: row.partition,
    type: row.type,
    payload: row.payload,
    redacted: row.redacted,
    at: new Date(row.at).toISOString(),
  }
}

/** Reads up to limit events past a global seq, in seq order. Powers the
 * request-scoped projector's catch-up batches. */
export async function readEventsAfter(db: Db, fromSeq: number, limit: number): Promise<StoredEvent[]> {
  if (!AfterSeqSchema.safeParse(fromSeq).success) {
    throw new DbContractError('fromSeq must be a non-negative integer')
  }
  if (!z.number().int().positive().safeParse(limit).success) {
    throw new DbContractError('limit must be a positive integer')
  }
  const { rows } = await db.query<RawEventRow>(
    `SELECT seq, idempotency_key, partition, type, payload, redacted, at
     FROM events WHERE seq > $1 ORDER BY seq ASC LIMIT $2`,
    [fromSeq, limit],
  )
  return rows.map(toStoredEvent)
}

/** Launch isolation lookup: the parent workflow id recorded by a
 * subagent launch, for routing finished-child steers to the parent. */
export async function findLaunchParentWorkflowId(
  db: Db,
  childId: string,
): Promise<string | undefined> {
  if (!z.string().min(1).safeParse(childId).success) {
    throw new DbContractError('childId must be a non-empty string')
  }
  const { rows } = await db.query<{ payload: { parentWorkflowId?: string } }>(
    `SELECT payload FROM events WHERE type = 't.subagent.launched' AND payload->>'childId' = $1
     ORDER BY seq ASC LIMIT 1`,
    [childId],
  )
  return rows[0]?.payload.parentWorkflowId
}

/** Retention read: oldest-first batch of events past the age window. */
export async function readEventsOlderThan(
  db: Db,
  olderThanDays: number,
  limit: number,
): Promise<StoredEvent[]> {
  if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
    throw new DbContractError('olderThanDays must be a non-negative number')
  }
  if (!z.number().int().positive().safeParse(limit).success) {
    throw new DbContractError('limit must be a positive integer')
  }
  const { rows } = await db.query<RawEventRow>(
    `SELECT seq, idempotency_key, partition, type, payload, redacted, at FROM events
     WHERE at < now() - make_interval(days => $1)
     ORDER BY seq ASC LIMIT $2`,
    [olderThanDays, limit],
  )
  return rows.map(toStoredEvent)
}

/** Retention delete: drops exactly the archived seqs. */
export async function deleteEventsBySeq(db: Db, seqs: number[]): Promise<void> {
  if (!Array.isArray(seqs) || seqs.some((seq) => !Number.isInteger(seq))) {
    throw new DbContractError('seqs must be an array of integers')
  }
  if (seqs.length === 0) return
  await db.query('DELETE FROM events WHERE seq = ANY($1::bigint[])', [seqs])
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

export const ARTIFACT_REFERENCED_EVENT = 't.artifact.referenced'

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

export async function getSession(
  db: Db,
  sessionId: string,
  scope?: Scope,
): Promise<SessionRecord | undefined> {
  if (!z.string().min(1).safeParse(sessionId).success) {
    throw new DbContractError('sessionId must be a non-empty string')
  }
  const filter = scope
    ? `AND c.tenant = $2 AND ($3::text IS NULL OR c.project = $3)`
    : ''
  const params = scope ? [sessionId, scope.tenantId, scope.projectId] : [sessionId]
  const { rows } = await db.query<SessionRow>(
    `${SESSIONS_CTE}
     SELECT c.id AS id, COALESCE(r.title, c.title) AS title, c.sector AS sector, c.created_at AS created_at, MAX(e.at) AS updated_at
     FROM created c LEFT JOIN renamed r ON r.id = c.id LEFT JOIN deleted d ON d.id = c.id JOIN events e ON e.partition = 'session:' || c.id
     WHERE c.id = $1 AND d.id IS NULL ${filter}
     GROUP BY c.id, COALESCE(r.title, c.title), c.sector, c.created_at`,
    params,
  )
  const row = rows[0]
  if (!row) return undefined
  const record = toSessionRecord(row)
  const model = await getSessionModel(db, sessionId)
  if (model) record.model = model
  return record
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    title: row.title,
    ...(row.sector ? { sectorId: row.sector } : {}),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

/** Creates a session: appends t.session.created, which starts the session
 * thread in projection. The id is server-generated (UUID); callers never
 * supply it, so creates never collide. Under auth the caller's tenant (and
 * project, when selected) binds at creation; open mode binds nothing.
 * sectorId links a sector chat (the route verifies the sector first). */
export async function createSession(
  db: Db,
  title: string,
  scope?: Scope,
  sectorId?: string,
): Promise<SessionRecord> {
  if (!z.string().min(1).safeParse(title).success) {
    throw new DbContractError('title must be a non-empty string')
  }
  if (sectorId !== undefined && !z.string().min(1).safeParse(sectorId).success) {
    throw new DbContractError('sectorId must be a non-empty string')
  }
  const id = randomUUID()
  await appendEvent(db, {
    idempotencyKey: `session:${id}:created`,
    partition: `session:${id}`,
    type: 't.session.created',
    payload: {
      sessionId: id,
      title,
      ...(scope ? { tenantId: scope.tenantId, projectId: scope.projectId } : {}),
      ...(sectorId === undefined ? {} : { sectorId }),
    },
  })
  const record = await getSession(db, id, scope)
  if (!record) throw new Error('createSession: session missing after append')
  return record
}

/** Renames a session: appends t.session.renamed, and reads resolve the
 * latest title, so history is preserved. Returns undefined when the session
 * is missing or outside scope (callers answer 404). */
export async function renameSession(
  db: Db,
  sessionId: string,
  title: string,
  scope?: Scope,
): Promise<SessionRecord | undefined> {
  if (!z.string().min(1).safeParse(sessionId).success) {
    throw new DbContractError('sessionId must be a non-empty string')
  }
  if (!z.string().min(1).safeParse(title).success) {
    throw new DbContractError('title must be a non-empty string')
  }
  const current = await getSession(db, sessionId, scope)
  if (!current) return undefined
  await appendEvent(db, {
    idempotencyKey: `session:${sessionId}:renamed:${randomUUID()}`,
    partition: `session:${sessionId}`,
    type: 't.session.renamed',
    payload: {
      sessionId,
      title,
      ...(scope ? { tenantId: scope.tenantId, projectId: scope.projectId } : {}),
    },
  })
  const record = await getSession(db, sessionId, scope)
  if (!record) throw new Error('renameSession: session missing after append')
  return record
}

/** Deletes a session: appends t.session.deleted, which hides the session
 * from list/get (and its session thread from projection) while the log
 * keeps full history. Returns false when the session is missing, already
 * deleted, or outside scope (callers answer 404). */
export async function deleteSession(
  db: Db,
  sessionId: string,
  scope?: Scope,
): Promise<boolean> {
  if (!z.string().min(1).safeParse(sessionId).success) {
    throw new DbContractError('sessionId must be a non-empty string')
  }
  const current = await getSession(db, sessionId, scope)
  if (!current) return false
  if (await sessionKind(db, sessionId) === 'research') throw new WorkspaceError('conflict', 'The research conversation is retained for this sector. Pause research instead.')
  await appendEvent(db, {
    idempotencyKey: `session:${sessionId}:deleted:${randomUUID()}`,
    partition: `session:${sessionId}`,
    type: SESSION_DELETED_EVENT,
    payload: {
      sessionId,
      ...(scope ? { tenantId: scope.tenantId, projectId: scope.projectId } : {}),
    },
  })
  return true
}

/** Latest per-session provider+model selection: the newest t.session.model
 * event in the session partition wins; sessions without one (or with only
 * unparseable ones) select nothing. History is append-only — setting a
 * model never rewrites an earlier event. */
export async function getSessionModel(
  db: Db,
  sessionId: string,
): Promise<SessionModelSelection | undefined> {
  if (!z.string().min(1).safeParse(sessionId).success) {
    throw new DbContractError('sessionId must be a non-empty string')
  }
  const events = await readPartition(db, `session:${sessionId}`)
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!event || event.type !== SESSION_MODEL_EVENT) continue
    const parsed = SessionModelSelection.safeParse(event.payload)
    if (parsed.success) return parsed.data
  }
  return undefined
}

/** Sets the session model: appends t.session.model and returns the stored
 * selection. Returns undefined when the session is missing or outside
 * scope (callers answer 404). */
export async function setSessionModel(
  db: Db,
  sessionId: string,
  input: unknown,
  scope?: Scope,
): Promise<SessionModelSelection | undefined> {
  if (!z.string().min(1).safeParse(sessionId).success) {
    throw new DbContractError('sessionId must be a non-empty string')
  }
  const parsed = SessionModelSelection.safeParse(input)
  if (!parsed.success) {
    throw new DbContractError(
      `invalid session model: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    )
  }
  const current = await getSession(db, sessionId, scope)
  if (!current) return undefined
  await appendEvent(db, {
    idempotencyKey: `session:${sessionId}:model:${randomUUID()}`,
    partition: `session:${sessionId}`,
    type: SESSION_MODEL_EVENT,
    payload: { sessionId, ...parsed.data },
  })
  const stored = await getSessionModel(db, sessionId)
  if (!stored) throw new Error('setSessionModel: model missing after append')
  return stored
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
