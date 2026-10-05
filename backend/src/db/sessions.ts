// Session repository: session reads and lifecycle over the event log.
// Sessions have no projection table: identity and title come from
// t.session.created, freshness from the latest partition event.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Scope } from '../auth/keys.js'
import { DbContractError } from './errors.js'
import { sessionKind, WorkspaceError } from './workspace.js'

import {
  appendEvent,
  readPartition,
  type Db,
} from './events.js'

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

const SESSION_MODEL_EVENT = 't.session.model'

/** Tombstone: deleted sessions stay in the log but vanish from reads. */
const SESSION_DELETED_EVENT = 't.session.deleted'

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
