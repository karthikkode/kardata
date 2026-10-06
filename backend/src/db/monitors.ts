// Karbot monitor registry (Phase 5.2): one active monitor per sector or
// thread, ticking on a durable timer workflow. The runner starts/stops
// the workflow; without one every entry point fails closed.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Scope } from '../auth/types.js'
import type { TransactableDb } from './checkpoints.js'
import { checked, DbContractError, Id, WorkspaceError } from './errors.js'
import type { Db } from './events.js'
import { requireSector, requireThread } from './workspace.js'

export interface MonitorRunner {
  startMonitorWorkflow(input: { monitorId: string; everyMs: number; untilMs: number }): Promise<{ workflowId: string }>
  stopMonitorWorkflow(workflowId: string): Promise<void>
}

function requireRunner(runner: MonitorRunner | undefined): MonitorRunner {
  if (!runner) throw new DbContractError('monitor lifecycle unavailable: no monitor runner attached')
  return runner
}

export interface MonitorRecord {
  id: string
  targetSectorId: string | null
  targetThreadKey: string | null
  everyMinutes: number
  brief: string
  until: string
  karbotSessionId: string
  karbotThreadKey: string
  workflowId: string
  tenantId: string
  projectId: string | null
  createdAt: string
  stoppedAt: string | null
  lastTickAt: string | null
}

interface MonitorDbRow {
  id: string; target_sector_id: string | null; target_thread_key: string | null
  every_minutes: number; brief: string; until: Date; karbot_session_id: string
  karbot_thread_key: string; workflow_id: string; tenant_id: string; project_id: string | null
  created_at: Date; stopped_at: Date | null; last_tick_at: Date | null
}

function toRecord(row: MonitorDbRow): MonitorRecord {
  return {
    id: row.id, targetSectorId: row.target_sector_id, targetThreadKey: row.target_thread_key,
    everyMinutes: row.every_minutes, brief: row.brief, until: new Date(row.until).toISOString(),
    karbotSessionId: row.karbot_session_id, karbotThreadKey: row.karbot_thread_key,
    workflowId: row.workflow_id, tenantId: row.tenant_id, projectId: row.project_id,
    createdAt: new Date(row.created_at).toISOString(),
    stoppedAt: row.stopped_at ? new Date(row.stopped_at).toISOString() : null,
    lastTickAt: row.last_tick_at ? new Date(row.last_tick_at).toISOString() : null,
  }
}

export interface StartMonitorInput {
  sectorId?: string
  threadKey?: string
  everyMinutes: number
  brief: string
  until?: string
  karbotSessionId: string
  karbotThreadKey: string
  scope: Scope
}

/** Start one monitor. Exactly one target; a live monitor on the same
 * target conflicts. A failed workflow start compensates by deleting
 * the row, so a retry never sees a phantom monitor. */
export async function startMonitor(db: TransactableDb, runner: MonitorRunner | undefined, input: StartMonitorInput): Promise<MonitorRecord> {
  const targets = [input.sectorId, input.threadKey].filter((target): target is string => typeof target === 'string')
  if (targets.length !== 1) throw new DbContractError('exactly one of sectorId, threadKey is required')
  if (!Number.isInteger(input.everyMinutes) || input.everyMinutes < 5 || input.everyMinutes > 120) throw new DbContractError('everyMinutes must be an integer 5..120')
  if (!z.string().min(1).max(2000).safeParse(input.brief).success) throw new DbContractError('brief must be 1..2000 characters')
  checked(Id, input.karbotSessionId)
  checked(Id, input.karbotThreadKey)
  const untilMs = input.until === undefined ? Date.now() + 24 * 60 * 60 * 1000 : new Date(input.until).getTime()
  if (!Number.isFinite(untilMs) || untilMs <= Date.now()) throw new DbContractError('until must be a future timestamp')
  const sectorId = input.sectorId
  const threadKey = input.threadKey
  if (sectorId) await requireSector(db, sectorId, input.scope)
  if (threadKey) await requireThread(db, threadKey, input.scope)
  // A row whose workflow died with it (a failed finishMonitorActivity
  // closes the execution) never finishes itself: retire expired rows on
  // this target so the unique index stops blocking new monitors. Live
  // rows still conflict below.
  if (sectorId) await db.query('UPDATE monitors SET stopped_at = now() WHERE stopped_at IS NULL AND until < now() AND target_sector_id = $1', [sectorId])
  else await db.query('UPDATE monitors SET stopped_at = now() WHERE stopped_at IS NULL AND until < now() AND target_thread_key = $1', [threadKey as string])
  const id = randomUUID()
  try {
    await db.query(
      `INSERT INTO monitors(id, target_sector_id, target_thread_key, every_minutes, brief, until, karbot_session_id, karbot_thread_key, workflow_id, tenant_id, project_id)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9, $10, $11)`,
      [id, sectorId ?? null, threadKey ?? null, input.everyMinutes, input.brief, new Date(untilMs).toISOString(), input.karbotSessionId, input.karbotThreadKey, `karbot-monitor-${id}`, input.scope.tenantId, input.scope.projectId],
    )
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as { code: string }).code === '23505') throw new WorkspaceError('conflict', 'A monitor is already running on this target.')
    throw error
  }
  try {
    await requireRunner(runner).startMonitorWorkflow({ monitorId: id, everyMs: input.everyMinutes * 60 * 1000, untilMs })
  } catch (error) {
    await db.query('DELETE FROM monitors WHERE id = $1', [id])
    throw error
  }
  const row = (await db.query<MonitorDbRow>('SELECT * FROM monitors WHERE id = $1', [id])).rows[0]
  if (!row) throw new WorkspaceError('not_found', `monitor ${id} vanished after start`)
  return toRecord(row)
}

/** Stop by id or by target. Unknown selectors are not_found; an
 * already-stopped monitor accepts quietly. */
export async function stopMonitor(
  db: TransactableDb,
  runner: MonitorRunner | undefined,
  selector: { monitorId?: string; sectorId?: string; threadKey?: string },
  scope: Scope,
): Promise<MonitorRecord> {
  const row = await findMonitor(db, selector, scope)
  if (!row) throw new WorkspaceError('not_found', 'No such monitor.')
  if (!row.stopped_at) {
    await requireRunner(runner).stopMonitorWorkflow(row.workflow_id)
    await db.query('UPDATE monitors SET stopped_at = now() WHERE id = $1', [row.id])
    const updated = (await db.query<MonitorDbRow>('SELECT * FROM monitors WHERE id = $1', [row.id])).rows[0]
    if (!updated) throw new WorkspaceError('not_found', `monitor ${row.id} vanished while stopping`)
    return toRecord(updated)
  }
  return toRecord(row)
}

async function findMonitor(db: Db, selector: { monitorId?: string; sectorId?: string; threadKey?: string }, scope: Scope): Promise<MonitorDbRow | undefined> {
  const picked = [selector.monitorId, selector.sectorId, selector.threadKey].filter((value): value is string => typeof value === 'string')
  if (picked.length !== 1) throw new DbContractError('exactly one of monitorId, sectorId, threadKey is required')
  const [column, value] = selector.monitorId ? ['id', selector.monitorId] : selector.sectorId ? ['target_sector_id', selector.sectorId] : ['target_thread_key', selector.threadKey as string]
  const { rows } = await db.query<MonitorDbRow>(
    `SELECT * FROM monitors WHERE ${column} = $1 AND tenant_id = $2 AND (project_id = $3 OR ($3::text IS NULL AND project_id IS NULL)) ORDER BY created_at DESC LIMIT 1`,
    [value, scope.tenantId, scope.projectId],
  )
  return rows[0]
}

export async function listMonitors(db: Db, scope: Scope): Promise<MonitorRecord[]> {
  const { rows } = await db.query<MonitorDbRow>(
    'SELECT * FROM monitors WHERE tenant_id = $1 AND (project_id = $2 OR ($2::text IS NULL AND project_id IS NULL)) ORDER BY created_at DESC LIMIT 100',
    [scope.tenantId, scope.projectId],
  )
  return rows.map(toRecord)
}

export async function getMonitor(db: Db, monitorId: string): Promise<MonitorRecord | undefined> {
  const { rows } = await db.query<MonitorDbRow>('SELECT * FROM monitors WHERE id = $1', [monitorId])
  const row = rows[0]
  return row ? toRecord(row) : undefined
}

/** Atomically claim a tick; null when a previous tick is still running
 * (the caller skips) or the monitor is gone/stopped. A claim older than
 * one interval is stale — its tick crashed between claim and release —
 * so the escape reclaims it instead of wedging the monitor forever. */
export async function claimMonitorTick(db: Db, monitorId: string): Promise<MonitorRecord | null> {
  const { rows } = await db.query<MonitorDbRow>(
    `UPDATE monitors SET last_tick_done = FALSE, last_tick_at = now()
     WHERE id = $1 AND stopped_at IS NULL
       AND (last_tick_done OR last_tick_at < now() - make_interval(mins => every_minutes))
     RETURNING *`,
    [monitorId],
  )
  const row = rows[0]
  return row ? toRecord(row) : null
}

export async function releaseMonitorTick(db: Db, monitorId: string): Promise<void> {
  await db.query('UPDATE monitors SET last_tick_done = TRUE WHERE id = $1', [monitorId])
}

/** Mark stopped when the workflow observes `until`. */
export async function finishMonitor(db: Db, monitorId: string): Promise<void> {
  await db.query('UPDATE monitors SET stopped_at = now() WHERE id = $1 AND stopped_at IS NULL', [monitorId])
}
