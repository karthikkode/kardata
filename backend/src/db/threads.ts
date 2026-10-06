// Threads repository: threads + thread_messages tables (moved from
// threads/project.ts, B7.5 behavior-neutral). Pure pieces (event payload
// schemas, ThreadView/ChildRef shapes, routeSend) stay in
// threads/project.ts; every SQL statement lives here. Outbox publishes go
// through the outbox repo so one table never spans two repos.
import { z } from 'zod'
import { toApiThread } from '../threads/views.js'
import {
  type ChildRef,
  MessageAppended,
  QueueEnqueued,
  QueueReleased,
  routeSend,
  SendReceived,
  SessionCreated,
  SessionDeleted,
  SubagentCompleted,
  SubagentLaunched,
  SubagentLaunchedV2,
  SubagentMissedSteer,
  ThreadFinished,
  ThreadState,
  type ThreadView,
} from '../threads/project.js'
import { DbContractError } from './errors.js'
import type { Db, ProjectableEvent, StoredEvent } from './events.js'
import { projectProviderRound, projectToolCall } from './execution-rounds.js'
import { publishOutboxFrame } from './outbox.js'
import { projectSectorEvent } from './sectors.js'

interface ThreadRow {
  key: string
  session_id: string
  kind: 'session' | 'subagent'
  status: string
  state_reason: string | null
  accepting_steer: boolean
  queue_depth: number
  updated_at: Date
}

interface MessageRow {
  seq: number
  kind: string
  payload: unknown
  at: Date
}

const ThreadKeySchema = z.string().min(1)
const SessionIdSchema = z.string().min(1)

async function nextMessageSeq(db: Db, threadKey: string): Promise<number> {
  const { rows } = await db.query<{ max: number | null }>(
    'SELECT MAX(seq) AS max FROM thread_messages WHERE thread_key = $1',
    [threadKey],
  )
  return Number(rows[0]?.max ?? 0) + 1
}

async function appendMessage(
  db: Db,
  threadKey: string,
  kind: string,
  payload: Record<string, unknown>,
  at: string,
): Promise<number> {
  const seq = await nextMessageSeq(db, threadKey)
  await db.query(
    'INSERT INTO thread_messages (thread_key, seq, kind, payload, at) VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)',
    [threadKey, seq, kind, JSON.stringify(payload), at],
  )
  await db.query('UPDATE threads SET updated_at = $2::timestamptz WHERE key = $1', [threadKey, at])
  return seq
}

async function threadStatus(db: Db, threadKey: string): Promise<string | undefined> {
  const { rows } = await db.query<{ status: string }>('SELECT status FROM threads WHERE key = $1', [threadKey])
  return rows[0]?.status
}

async function childRefs(db: Db, sessionId: string): Promise<ChildRef[]> {
  const { rows } = await db.query<{ key: string }>(
    "SELECT key FROM threads WHERE session_id = $1 AND kind = 'subagent' ORDER BY key",
    [sessionId],
  )
  const refs: ChildRef[] = []
  for (const row of rows) {
    const { rows: nameRows } = await db.query<{ name: string }>(
      `SELECT payload->>'name' AS name FROM thread_messages
       WHERE thread_key = $1 AND payload->>'launched' = 'true' ORDER BY seq ASC LIMIT 1`,
      [row.key],
    )
    refs.push({ name: nameRows[0]?.name ?? row.key, threadKey: row.key })
  }
  return refs
}

// Every write carries the event's own timestamp: the projection is a pure
// function of the event log, so rebuild reproduces incremental views
// byte-exactly (same rows, same stamps).
//
// Outbox rule (B3.2): every thread-affecting event publishes exactly one
// frame — message events publish message frames (with the thread seq),
// lifecycle events publish state frames (full thread snapshot). Launch
// notices are routing metadata and publish nothing.
async function publishState(db: Db, threadKey: string): Promise<void> {
  const view = await getThread(db, threadKey)
  if (view) await publishOutboxFrame(db, threadKey, 'state', toApiThread(view))
}

/** True when the session carries a delete tombstone. Late events for a
 * deleted session (in-flight turn results landing after the tombstone)
 * must be consumed, never projected: projecting them would reinsert
 * message rows for a projected-away thread and wedge the checkpoint. */
async function isSessionDeleted(db: Db, sessionId: string): Promise<boolean> {
  const { rows } = await db.query<{ one: number }>(
    `SELECT 1 AS one FROM events WHERE type = 't.session.deleted' AND partition = $1 LIMIT 1`,
    [`session:${sessionId}`],
  )
  return rows.length > 0
}

/** Session scope of a thread-mutating event: its session partition, or a
 * bare session-thread target. Null for child/research threads, which
 * outlive any single session tombstone. */
function sessionScopeOf(event: ProjectableEvent, threadKey?: string): string | null {
  const scoped = /^session:(.+)$/.exec(event.partition)
  if (scoped?.[1]) return scoped[1]
  if (threadKey && !threadKey.includes(':')) return threadKey
  return null
}

async function applyEvent(db: Db, event: ProjectableEvent): Promise<boolean> {
  const at = event.at
  switch (event.type) {
    case 't.session.created': {
      const payload = SessionCreated.parse(event.payload)
      await db.query(
        `INSERT INTO threads (key, session_id, kind, status, updated_at)
         VALUES ($1, $1, 'session', 'IDLE', $2::timestamptz)
         ON CONFLICT (key) DO NOTHING`,
        [payload.sessionId, at],
      )
      await publishState(db, payload.sessionId)
      return true
    }
    case 't.session.deleted': {
      // Tombstone projects the session thread away: sends, steers, and
      // thread reads 404 from here on, while the event log keeps history.
      // Local memory and steering rows follow the thread (no hard FK: they
      // must survive rebuildFromEvents, which truncates threads).
      // The context row stays while a lease is active: the orphan detector
      // finds (lease set, thread gone) and cancels the workflow, then clears.
      const payload = SessionDeleted.parse(event.payload)
      await db.query(`DELETE FROM threads WHERE key = $1`, [payload.sessionId])
      await db.query(`DELETE FROM thread_context WHERE thread_key = $1 AND active_lease IS NULL`, [payload.sessionId])
      await db.query(`DELETE FROM thread_instructions WHERE thread_key = $1`, [payload.sessionId])
      return true
    }
    case 't.subagent.launched': {
      const first = SubagentLaunched.safeParse(event.payload)
      const parsed = first.success ? first.data : SubagentLaunchedV2.parse(event.payload)
      const sessionId = 'sessionId' in parsed ? parsed.sessionId : parsed.parentSessionId
      const childId = parsed.childId
      const name = parsed.name ?? null
      const threadKey = `agent:${childId}`
      await db.query(
        `INSERT INTO threads (key, session_id, kind, status, updated_at)
         VALUES ($1, $2, 'subagent', 'RUNNING', $3::timestamptz)
         ON CONFLICT (key) DO UPDATE SET status='RUNNING', accepting_steer=true, updated_at=EXCLUDED.updated_at
         WHERE threads.session_id=EXCLUDED.session_id`,
        [threadKey, sessionId, at],
      )
      // Launch notice doubles as the name record for @mention routing.
      await db.query(
        `INSERT INTO thread_messages (thread_key, seq, kind, payload, at)
         SELECT $1, COALESCE(MAX(seq), 0) + 1, 'text', $2::jsonb, $3::timestamptz
         FROM thread_messages WHERE thread_key = $1
         ON CONFLICT DO NOTHING`,
        [threadKey, JSON.stringify({ launched: 'true', name }), at],
      )
      await publishState(db, threadKey)
      return true
    }
    case 't.subagent.completed': {
      // A closed child (finished or cancelled) stops accepting steer. Both
      // map to FINISHED: the run is over, only the completion entry remains.
      const payload = SubagentCompleted.parse(event.payload)
      const completedKey = `agent:${payload.summary.id}`
      await db.query(
        "UPDATE threads SET status = 'FINISHED', accepting_steer = FALSE, state_reason = NULL, updated_at = $2::timestamptz WHERE key = $1",
        [completedKey, at],
      )
      await publishState(db, completedKey)
      return true
    }
    case 't.subagent.missed_steer': {
      // Sends to a finished child land on the parent session thread, never
      // relaunching. The session comes from the parent partition.
      const payload = SubagentMissedSteer.parse(event.payload)
      const sessionId = event.partition.replace(/^session:/, '')
      if (await isSessionDeleted(db, sessionId)) return true
      const missed = {
        text: payload.text,
        missedSteer: true,
        target: `agent:${payload.childId}`,
      }
      const missedSeq = await appendMessage(db, sessionId, 'text', missed, at)
      await publishOutboxFrame(db, sessionId, 'message', { seq: missedSeq, kind: 'text', message: missed, at })
      return true
    }
    case 't.message.appended': {
      const payload = MessageAppended.parse(event.payload)
      const scope = sessionScopeOf(event, payload.threadKey)
      if (scope && (await isSessionDeleted(db, scope))) return true
      const seq = await appendMessage(db, payload.threadKey, payload.kind, payload.message, at)
      await publishOutboxFrame(db, payload.threadKey, 'message', {
        seq,
        kind: payload.kind,
        message: payload.message,
        at,
      })
      return true
    }
    case 't.send.received': {
      const payload = SendReceived.parse(event.payload)
      if (await isSessionDeleted(db, payload.sessionId)) return true
      const target = routeSend(payload.sessionId, payload.text, await childRefs(db, payload.sessionId))
      if (target !== payload.sessionId && (await threadStatus(db, target)) === 'FINISHED') {
        // Finished children never silently relaunch: the text lands as
        // missed_steer on the session thread.
        const missed = { text: payload.text, missedSteer: true, target }
        const missedSeq = await appendMessage(db, payload.sessionId, 'text', missed, at)
        await publishOutboxFrame(db, payload.sessionId, 'message', { seq: missedSeq, kind: 'text', message: missed, at })
      } else {
        const message = { text: payload.text }
        const seq = await appendMessage(db, target, 'text', message, at)
        await publishOutboxFrame(db, target, 'message', { seq, kind: 'text', message, at })
      }
      return true
    }
    case 't.queue.enqueued': {
      const payload = QueueEnqueued.parse(event.payload)
      const scope = sessionScopeOf(event, payload.threadKey)
      if (scope && (await isSessionDeleted(db, scope))) return true
      const message = { text: payload.text, queued: true }
      const seq = await appendMessage(db, payload.threadKey, 'text', message, at)
      await db.query(
        'UPDATE threads SET queue_depth = queue_depth + 1, updated_at = $2::timestamptz WHERE key = $1',
        [payload.threadKey, at],
      )
      await publishOutboxFrame(db, payload.threadKey, 'message', { seq, kind: 'text', message, at })
      return true
    }
    case 't.queue.released': {
      const payload = QueueReleased.parse(event.payload)
      await db.query(
        "UPDATE thread_messages SET payload = payload || '{\"queued\": false}'::jsonb WHERE thread_key = $1 AND seq = $2",
        [payload.threadKey, payload.seq],
      )
      await db.query(
        'UPDATE threads SET queue_depth = GREATEST(queue_depth - 1, 0), updated_at = $2::timestamptz WHERE key = $1',
        [payload.threadKey, at],
      )
      const { rows } = await db.query<MessageRow>(
        'SELECT seq, kind, payload, at FROM thread_messages WHERE thread_key = $1 AND seq = $2',
        [payload.threadKey, payload.seq],
      )
      const updated = rows[0]
      if (updated) {
        await publishOutboxFrame(db, payload.threadKey, 'message', {
          seq: Number(updated.seq),
          kind: updated.kind,
          message: updated.payload,
          at: updated.at.toISOString(),
        })
      }
      return true
    }
    case 't.thread.finished': {
      const payload = ThreadFinished.parse(event.payload)
      await db.query(
        "UPDATE threads SET status = 'FINISHED', accepting_steer = FALSE, state_reason = NULL, updated_at = $2::timestamptz WHERE key = $1",
        [payload.threadKey, at],
      )
      await publishState(db, payload.threadKey)
      return true
    }
    case 't.thread.state': {
      const payload = ThreadState.parse(event.payload)
      await db.query('UPDATE threads SET status = $2, state_reason = $4, updated_at = $3::timestamptz WHERE key = $1', [
        payload.threadKey,
        payload.status,
        at,
        payload.reasonCode ?? null,
      ])
      if (payload.acceptingSteer !== undefined) {
        await db.query('UPDATE threads SET accepting_steer = $2, updated_at = $3::timestamptz WHERE key = $1', [
          payload.threadKey,
          payload.acceptingSteer,
          at,
        ])
      }
      await publishState(db, payload.threadKey)
      return true
    }
    case 'sector.created':
    case 'sector.state_changed':
    case 'sector.research_started':
    case 'company.found':
    case 'company.stage_changed':
    case 'company.state_changed': {
      return projectSectorEvent(db, event)
    }
    case 't.provider.round': {
      return projectProviderRound(db, event)
    }
    case 't.tool.call': {
      return projectToolCall(db, event)
    }
    default:
      return false
  }
}

export interface ProjectionResult {
  applied: number
  ignored: string[]
}

/** Applies a batch of stored events in seq order. Unknown types are ignored. */
export async function projectBatch(db: Db, events: ProjectableEvent[]): Promise<ProjectionResult> {
  if (!Array.isArray(events)) throw new DbContractError('events must be an array')
  let applied = 0
  const ignored: string[] = []
  for (const event of events) {
    if (await applyEvent(db, event)) applied += 1
    else ignored.push(event.type)
  }
  return { applied, ignored }
}

/** Full rebuild: truncates projections and replays every event. Dependent
 * projection tables (documents reference sectors, units reference
 * documents) truncate in the same statement or Postgres refuses the
 * rebuild on the foreign keys. */
export async function rebuildFromEvents(db: Db, events: StoredEvent[]): Promise<ProjectionResult> {
  if (!Array.isArray(events)) throw new DbContractError('events must be an array')
  // Sector source files and workspace state are authoritative owner data,
  // not disposable projections. Replay upserts sector identity in place.
  await db.query('TRUNCATE thread_messages, threads, companies')
  return projectBatch(db, events)
}

export async function getThread(db: Db, threadKey: string): Promise<ThreadView | undefined> {
  if (!ThreadKeySchema.safeParse(threadKey).success) {
    throw new DbContractError('threadKey must be a non-empty string')
  }
  const { rows } = await db.query<ThreadRow>('SELECT * FROM threads WHERE key = $1', [threadKey])
  const thread = rows[0]
  if (!thread) return undefined
  const { rows: messages } = await db.query<MessageRow>(
    'SELECT seq, kind, payload, at FROM thread_messages WHERE thread_key = $1 ORDER BY seq ASC',
    [threadKey],
  )
  const launch = messages.map((row) => row.payload).find((payload) => typeof payload === 'object' && payload !== null && 'launched' in payload)
  const name = typeof launch === 'object' && launch !== null && 'name' in launch && typeof launch.name === 'string' ? launch.name : undefined
  return {
    ...(name ? { name } : {}),
    key: thread.key,
    sessionId: thread.session_id,
    kind: thread.kind,
    status: thread.status,
    ...(thread.state_reason ? { stateReason: thread.state_reason } : {}),
    acceptingSteer: thread.accepting_steer,
    queueDepth: Number(thread.queue_depth),
    updatedAt: thread.updated_at.toISOString(),
    messages: messages.map((message) => ({
      seq: Number(message.seq),
      kind: message.kind,
      payload: message.payload,
      at: message.at.toISOString(),
    })),
  }
}

/** Bounded cross-chat read: the full getThread shape with messages
 * sliced to seq > fromSeq, at most limit (default 100). Reads only. */
export async function readSectorThread(
  db: Db,
  threadKey: string,
  opts: { fromSeq?: number; limit?: number } = {},
): Promise<ThreadView | undefined> {
  const fromSeq = opts.fromSeq ?? 0
  const limit = opts.limit ?? 100
  if (!Number.isInteger(fromSeq) || fromSeq < 0) throw new DbContractError('fromSeq must be a non-negative integer')
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new DbContractError('limit must be an integer 1..100')
  const thread = await getThread(db, threadKey)
  if (!thread) return undefined
  return { ...thread, messages: thread.messages.filter((message) => message.seq > fromSeq).slice(0, limit) }
}

export async function getThreadHeader(db: Db, threadKey: string): Promise<ThreadView | undefined> {
  if (!ThreadKeySchema.safeParse(threadKey).success) throw new DbContractError('threadKey must be non-empty')
  const { rows } = await db.query<ThreadRow>('SELECT * FROM threads WHERE key = $1', [threadKey])
  const thread = rows[0]
  return thread ? { key: thread.key, sessionId: thread.session_id, kind: thread.kind, status: thread.status, ...(thread.state_reason ? { stateReason: thread.state_reason } : {}), acceptingSteer: thread.accepting_steer, queueDepth: Number(thread.queue_depth), updatedAt: thread.updated_at.toISOString(), messages: [] } : undefined
}

export async function listThreads(db: Db, sessionId: string): Promise<ThreadView[]> {
  if (!SessionIdSchema.safeParse(sessionId).success) {
    throw new DbContractError('sessionId must be a non-empty string')
  }
  const { rows } = await db.query<{ key: string }>(
    'SELECT key FROM threads WHERE session_id = $1 ORDER BY key',
    [sessionId],
  )
  const views: ThreadView[] = []
  for (const row of rows) {
    const view = await getThread(db, row.key)
    if (view) views.push(view)
  }
  return views
}
/** Metadata lists never hydrate each child's complete transcript. */
export async function listThreadHeaders(db: Db, sessionId: string): Promise<ThreadView[]> {
  if (!SessionIdSchema.safeParse(sessionId).success) throw new DbContractError('sessionId must be non-empty')
  const { rows } = await db.query<ThreadRow & { name: string | null }>(`SELECT t.*,
    CASE WHEN t.kind='subagent' THEN (SELECT m.payload->>'name' FROM thread_messages m
      WHERE m.thread_key=t.key AND m.payload->>'launched'='true' ORDER BY m.seq ASC LIMIT 1) END AS name
    FROM threads t WHERE t.session_id=$1 ORDER BY t.key`, [sessionId])
  return rows.map((thread) => ({ key: thread.key, sessionId: thread.session_id, kind: thread.kind, status: thread.status, ...(thread.state_reason ? { stateReason: thread.state_reason } : {}), acceptingSteer: thread.accepting_steer, queueDepth: Number(thread.queue_depth), updatedAt: thread.updated_at.toISOString(), ...(thread.name ? { name: thread.name } : {}), messages: [] }))
}

/** Outbound thread messaging for Karbot steering. The messenger is the
 * runs gateway (send = runSend signal queues the message, steer =
 * runSteer interrupts a running turn); it rides the tool context exactly
 * like SectorSweepRunner, so unit tests inject fakes and production wires
 * the gateway. Structural typing keeps this module free of temporal
 * imports: any {send, steer} pair with command results qualifies. */
export interface ThreadMessenger {
  send(threadKey: string, text: string): Promise<{ commandId: string; state: 'accepted' | 'missed_steer' }>
  steer(threadKey: string, text: string): Promise<{ commandId: string; state: 'accepted' | 'missed_steer' }>
  pauseRun(runId: string): Promise<{ commandId: string; state: 'accepted' | 'missed_steer' }>
  resumeRun(runId: string, extendedBudgetMs?: number): Promise<{ commandId: string; state: 'accepted' | 'missed_steer' }>
  cancelRun(runId: string): Promise<{ commandId: string; state: 'accepted' | 'missed_steer' }>
  /** Run inspection (the production gateway implements all five; minimal
   * fakes omit them and the wrappers below fail closed). Structural
   * shapes keep this module free of temporal imports. */
  listRuns?(sessionId?: string): Promise<Array<{ id: string; sessionId: string; threadKey: string; state: string; updatedAt: string }>>
  getRun?(runId: string): Promise<{ id: string; sessionId: string; threadKey: string; state: string; updatedAt: string } | null>
  listQueue?(threadKey: string): Promise<Array<{ id: string; text: string; queuedAt: number }>>
  removeQueued?(threadKey: string, id: string): Promise<boolean>
  reorderQueue?(threadKey: string, ids: string[]): Promise<void>
}

const ThreadTextSchema = z.string().min(1).max(8000)
const RunIdSchema = z.string().min(1)

function requireMessenger(messenger: ThreadMessenger | undefined, tool: string): ThreadMessenger {
  if (!messenger) {
    throw new DbContractError(`${tool} needs a message runner: the server wires the runs gateway, tests inject a fake`)
  }
  return messenger
}

/** Queue a message onto a thread (runSend): delivered to the run, or
 * missed_steer when nothing is listening. Fail-closed without a runner. */
export async function sendThreadMessage(
  messenger: ThreadMessenger | undefined,
  threadKey: string,
  text: string,
): Promise<{ commandId: string; state: 'accepted' | 'missed_steer' }> {
  if (!ThreadKeySchema.safeParse(threadKey).success) {
    throw new DbContractError('threadKey must be a non-empty string')
  }
  if (!ThreadTextSchema.safeParse(text).success) {
    throw new DbContractError('text must be 1-8000 characters')
  }
  return requireMessenger(messenger, 'db.send_message').send(threadKey, text)
}

/** Interrupt a running turn with new direction (runSteer). Same contract
 * and fail-closed posture as send. */
export async function steerThread(
  messenger: ThreadMessenger | undefined,
  threadKey: string,
  text: string,
): Promise<{ commandId: string; state: 'accepted' | 'missed_steer' }> {
  if (!ThreadKeySchema.safeParse(threadKey).success) {
    throw new DbContractError('threadKey must be a non-empty string')
  }
  if (!ThreadTextSchema.safeParse(text).success) {
    throw new DbContractError('text must be 1-8000 characters')
  }
  return requireMessenger(messenger, 'db.steer_thread').steer(threadKey, text)
}

/** Pause a run (session/research lanes). Fail-closed without a runner. */
export async function pauseThreadRun(
  messenger: ThreadMessenger | undefined,
  runId: string,
): Promise<{ commandId: string; state: 'accepted' | 'missed_steer' }> {
  if (!RunIdSchema.safeParse(runId).success) {
    throw new DbContractError('runId must be a non-empty string')
  }
  return requireMessenger(messenger, 'db.pause_run').pauseRun(runId)
}

/** Resume a run (guarded runs approve the resume). Fail-closed without a runner. */
export async function resumeThreadRun(
  messenger: ThreadMessenger | undefined,
  runId: string,
  extendedBudgetMs?: number,
): Promise<{ commandId: string; state: 'accepted' | 'missed_steer' }> {
  if (!RunIdSchema.safeParse(runId).success) {
    throw new DbContractError('runId must be a non-empty string')
  }
  if (extendedBudgetMs !== undefined && !z.number().int().positive().safeParse(extendedBudgetMs).success) {
    throw new DbContractError('extendedBudgetMs must be a positive integer')
  }
  return requireMessenger(messenger, 'db.resume_run').resumeRun(runId, extendedBudgetMs)
}

/** Cancel a session run. Fail-closed without a runner. */
export async function cancelThreadRun(
  messenger: ThreadMessenger | undefined,
  runId: string,
): Promise<{ commandId: string; state: 'accepted' | 'missed_steer' }> {
  if (!RunIdSchema.safeParse(runId).success) {
    throw new DbContractError('runId must be a non-empty string')
  }
  return requireMessenger(messenger, 'db.cancel_run').cancelRun(runId)
}

function requireInspection<K extends 'listRuns' | 'getRun' | 'listQueue' | 'removeQueued' | 'reorderQueue'>(
  messenger: ThreadMessenger | undefined,
  tool: string,
  method: K,
): NonNullable<ThreadMessenger[K]> {
  const runner = requireMessenger(messenger, tool)
  const fn = runner[method]
  if (typeof fn !== 'function') throw new DbContractError(`${tool} needs a run-inspection runner: the server wires the runs gateway, tests inject a fake`)
  return fn as NonNullable<ThreadMessenger[K]>
}

/** List runs fleet-wide (filtering is the caller's job). Fail-closed
 * without an inspection runner. */
export async function listThreadRuns(messenger: ThreadMessenger | undefined) {
  return requireInspection(messenger, 'ops.list_runs', 'listRuns')()
}

/** Read one run; null when unknown. Fail-closed without a runner. */
export async function getThreadRun(messenger: ThreadMessenger | undefined, runId: string) {
  if (!RunIdSchema.safeParse(runId).success) {
    throw new DbContractError('runId must be a non-empty string')
  }
  return requireInspection(messenger, 'ops.get_run', 'getRun')(runId)
}

/** List a thread's queued messages. Fail-closed without a runner. */
export async function listThreadQueue(messenger: ThreadMessenger | undefined, threadKey: string) {
  if (!ThreadKeySchema.safeParse(threadKey).success) {
    throw new DbContractError('threadKey must be a non-empty string')
  }
  return requireInspection(messenger, 'ops.thread_queue', 'listQueue')(threadKey)
}

/** Remove one queued message; false when the id is unknown. */
export async function removeThreadQueueItem(messenger: ThreadMessenger | undefined, threadKey: string, id: string): Promise<boolean> {
  if (!ThreadKeySchema.safeParse(threadKey).success) {
    throw new DbContractError('threadKey must be a non-empty string')
  }
  if (!z.string().min(1).safeParse(id).success) {
    throw new DbContractError('id must be a non-empty string')
  }
  return requireInspection(messenger, 'ops.queue_remove', 'removeQueued')(threadKey, id)
}

/** Reorder a thread's queue; the id set must match exactly. */
export async function reorderThreadQueue(messenger: ThreadMessenger | undefined, threadKey: string, ids: string[]): Promise<void> {
  if (!ThreadKeySchema.safeParse(threadKey).success) {
    throw new DbContractError('threadKey must be a non-empty string')
  }
  if (!z.array(z.string().min(1)).safeParse(ids).success) {
    throw new DbContractError('ids must be an array of non-empty strings')
  }
  return requireInspection(messenger, 'ops.queue_reorder', 'reorderQueue')(threadKey, ids)
}
