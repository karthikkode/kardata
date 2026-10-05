// Events repository: the only read/write path to the event log (moved
// from events/append.ts, B7.2 behavior-neutral). Every state-changing or
// notable backend action goes through appendEvent: Zod-validated envelope,
// idempotency key (duplicates replay the first seq, one row), per-partition
// ordering, and a redaction hook that scrubs secrets before they touch disk.
// Misaligned calls throw DbContractError before any SQL runs.
import { context, trace } from '@opentelemetry/api'
import { z } from 'zod'
import { scrubSecrets } from '../observability/logging.js'
import { currentEventClient, currentTraceId, type EventClient } from '../observability/ambient.js'
import { DbContractError } from './errors.js'

/** Both durable streams share one lock: transactions cannot invert event
 * and outbox lock order, and cursors cannot overtake uncommitted seqs. */
export const DURABLE_STREAM_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('kardata:durable-stream'))"

export const EventEnvelope = z.object({
  idempotencyKey: z.string().min(1),
  partition: z.string().min(1),
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  redacted: z.boolean().default(false),
  /** Explicit trace (P3.2.6); absent means the ambient one. */
  traceId: z.string().regex(/^[0-9a-f]{32}$/).optional(),
  /** Explicit caller (P3.2.6); absent means the ambient route client,
   * else system for background writes. */
  client: z.enum(['ui', 'agent-mcp', 'system', 'other']).optional(),
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

/** Shared key schema for the event slices. */
export const KeySchema = z.string().min(1)
const PartitionSchema = z.string().min(1)
const AfterSeqSchema = z.number().int().min(0)

/** Ambient trace for the event (P3.2.6): the OTel span the activity
 * interceptor installed, else the route ALS the Fastify hook entered.
 * Read with @opentelemetry/api only, so the db layer stays free of
 * temporal imports. */
function ambientTraceId(): string | undefined {
  const otel = trace.getSpanContext(context.active())?.traceId
  if (otel !== undefined && otel !== '0'.repeat(32)) return otel
  return currentTraceId()
}

export async function appendEvent(db: Db, input: unknown): Promise<AppendedEvent> {
  const parsed = EventEnvelope.safeParse(input)
  if (!parsed.success) {
    throw new DbContractError(`invalid event envelope: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
  }
  const event = parsed.data
  const payload = event.redacted ? scrubSecrets(event.payload) : event.payload
  const traceId = event.traceId ?? ambientTraceId() ?? null
  const client = event.client ?? currentEventClient() ?? 'system'
  const inserted = await db.query<EventRow>(
    `WITH durable_order AS MATERIALIZED (${DURABLE_STREAM_LOCK_SQL})
     INSERT INTO events (idempotency_key, partition, type, payload, redacted, trace_id, client)
     SELECT $1, $2, $3, $4::jsonb, $5, $6, $7 FROM durable_order
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING seq`,
    [event.idempotencyKey, event.partition, event.type, JSON.stringify(payload), event.redacted, traceId, client],
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
  /** Null for rows written before migration 0025. */
  traceId: string | null
  client: EventClient | null
}

/** Projection input: trace/client ride DB reads but never affect the
 * projected views, so MCP callers may replay historical events without
 * them. */
export type ProjectableEvent = Omit<StoredEvent, 'traceId' | 'client'> &
  Partial<Pick<StoredEvent, 'traceId' | 'client'>>;

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
    trace_id: string | null
    client: EventClient | null
  }>(
    `SELECT seq, idempotency_key, partition, type, payload, redacted, at, trace_id, client
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
    traceId: row.trace_id,
    client: row.client,
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
    trace_id: string | null
    client: EventClient | null
  }>(
    `SELECT seq, idempotency_key, partition, type, payload, redacted, at, trace_id, client
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
    traceId: row.trace_id,
    client: row.client,
  }))
}

interface RawEventRow {
  seq: number | string
  idempotency_key: string
  partition: string
  type: string
  payload: unknown
  redacted: boolean
  at: Date | string
  trace_id: string | null
  client: EventClient | null
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
    traceId: row.trace_id,
    client: row.client,
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
    `SELECT seq, idempotency_key, partition, type, payload, redacted, at, trace_id, client
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

/** Retention read: oldest-first batch of events past the age window.
 * Knowledge event types (documents aside, which never enter the log) stay
 * hot: artifacts, execution records and company facts are read live from
 * the log, so retention excludes them when told to. */
export async function readEventsOlderThan(
  db: Db,
  olderThanDays: number,
  limit: number,
  excludeTypes: string[] = [],
): Promise<StoredEvent[]> {
  if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
    throw new DbContractError('olderThanDays must be a non-negative number')
  }
  if (!z.number().int().positive().safeParse(limit).success) {
    throw new DbContractError('limit must be a positive integer')
  }
  const { rows } = await db.query<RawEventRow>(
    `SELECT seq, idempotency_key, partition, type, payload, redacted, at, trace_id, client FROM events
     WHERE at < now() - make_interval(days => $1)
       AND ($3::text[] IS NULL OR type <> ALL($3::text[]))
     ORDER BY seq ASC LIMIT $2`,
    [olderThanDays, limit, excludeTypes.length > 0 ? excludeTypes : null],
  )
  return rows.map(toStoredEvent)
}

export interface ColdEventPointer {
  partition: string
  seq: number
  archiveKey: string
  type: string
  at: string
}

/** Records one cold-storage pointer per moved event: the hot log keeps a
 * durable reference to where the bytes went. Idempotent per run. */
export async function recordColdPointers(db: Db, pointers: ColdEventPointer[]): Promise<void> {
  if (pointers.length === 0) return
  const values: unknown[] = []
  const tuples = pointers.map((pointer, index) => {
    const base = index * 5
    values.push(pointer.partition, pointer.seq, pointer.archiveKey, pointer.type, pointer.at)
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5}::timestamptz)`
  })
  await db.query(
    `INSERT INTO cold_event_pointers(partition, seq, archive_key, type, at) VALUES ${tuples.join(',')} ON CONFLICT(partition, seq) DO NOTHING`,
    values,
  )
}

/** Lists cold-storage pointers for a partition (or the whole log), so replay
 * and audit can find moved bytes without scanning the archive. */
export async function listColdPointers(db: Db, partition?: string): Promise<ColdEventPointer[]> {
  const { rows } = partition
    ? await db.query<{ partition: string; seq: string; archive_key: string; type: string; at: Date | string }>(
        'SELECT partition, seq, archive_key, type, at FROM cold_event_pointers WHERE partition = $1 ORDER BY seq ASC',
        [partition],
      )
    : await db.query<{ partition: string; seq: string; archive_key: string; type: string; at: Date | string }>(
        'SELECT partition, seq, archive_key, type, at FROM cold_event_pointers ORDER BY partition ASC, seq ASC',
      )
  return rows.map((row) => ({
    partition: row.partition,
    seq: Number(row.seq),
    archiveKey: row.archive_key,
    type: row.type,
    at: row.at instanceof Date ? row.at.toISOString() : String(row.at),
  }))
}

/** Retention delete: drops exactly the archived seqs. */
export async function deleteEventsBySeq(db: Db, seqs: number[]): Promise<void> {
  if (!Array.isArray(seqs) || seqs.some((seq) => !Number.isInteger(seq))) {
    throw new DbContractError('seqs must be an array of integers')
  }
  if (seqs.length === 0) return
  await db.query('DELETE FROM events WHERE seq = ANY($1::bigint[])', [seqs])
}
