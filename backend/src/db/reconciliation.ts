// Durable supervision reads/mutations stay behind the established DB boundary.
import { createHash } from 'node:crypto'

/** Heartbeat-fail floor (P3.4): pinned equal to
 * SUPERVISION_THRESHOLDS.turnWallMs by test. The db layer cannot import
 * temporal/timeouts (dependency boundary), so the value is duplicated
 * here and the fault suite fails if they drift. */
export const HEARTBEAT_FAIL_FLOOR_MS = 20 * 60_000
import { raiseAlert } from './alerts.js'
import { DbContractError } from './errors.js'
import { appendEvent, type Db } from './events.js'
import { workspaceTransaction } from './workspace.js'
import type { TransactableDb } from './checkpoints.js'

export interface ReconciliationCandidate {
  threadKey: string
  sessionId: string
  workflowId: string | null
  status: string
  queueDepth: number
  updatedAtMs: number
  heartbeatAtMs: number | null
  progressAtMs: number | null
  activeRun: string | null
  lease: string | null
  currentEpoch?: string | null
  activeEpoch?: string | null
  activeExecutionId?: string | null
  intentExecutionId?: string | null
  intentState?: string | null
  intentCreatedAtMs?: number | null
  runStartedAtMs?: number | null
  unresolvedStart?: boolean
  sessionDeleted: boolean
}

/** Keyset pages, including queued logical agents. No fleet heartbeat can
 * stand in for this thread's owner. Heartbeats are never semantic progress. */
export async function listReconciliationCandidates(db: Db, after = '', limit = 100): Promise<ReconciliationCandidate[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new DbContractError('reconciliation page limit must be 1–500')
  const { rows } = await db.query<{
    key: string; session_id: string; workflow_id: string | null; status: string; queue_depth: number
    updated_at: Date; heartbeat_at: Date | null; progress_at: Date | null; active_run: string | null; active_lease: string | null
    current_epoch: string | null; active_epoch: string | null; active_execution_id: string | null; intent_execution_id: string | null; intent_state: string | null; intent_created_at: Date | null; run_started_at: Date | null; unresolved_start: boolean; session_deleted: boolean
  }>(`SELECT t.key,t.session_id,t.status,t.queue_depth,t.updated_at,c.active_run,c.active_lease,c.active_run_started_at AS run_started_at,
      owner.workflow_id,beat.at AS heartbeat_at,progress.at AS progress_at,h.epoch AS current_epoch,c.active_epoch,c.active_execution_id,
      intent.execution_id AS intent_execution_id,intent.state AS intent_state,intent.created_at AS intent_created_at,
      EXISTS(SELECT 1 FROM execution_intents pending WHERE pending.thread_key=t.key AND pending.state IN ('pending','uncertain')) AS unresolved_start,
      EXISTS(SELECT 1 FROM events d WHERE d.type='t.session.deleted' AND d.partition='session:'||t.session_id) AS session_deleted
    FROM threads t LEFT JOIN thread_context c ON c.thread_key=t.key
    LEFT JOIN thread_execution_heads h ON h.thread_key=t.key LEFT JOIN execution_intents intent ON intent.epoch=h.epoch
    LEFT JOIN LATERAL (SELECT payload->>'sectorId' AS sector_id FROM events
      WHERE partition='session:'||t.session_id AND type='t.session.created' AND payload->>'sectorId' IS NOT NULL
      ORDER BY seq ASC LIMIT 1) binding ON true
    CROSS JOIN LATERAL (SELECT COALESCE(c.active_workflow_id,CASE WHEN t.kind='subagent' THEN substr(t.key,7)
      WHEN left(c.active_run,5)='plan:' THEN CASE
        WHEN c.active_run='plan:'||binding.sector_id OR left(c.active_run,length(binding.sector_id)+6)='plan:'||binding.sector_id||':'
        THEN 'sector-plan-'||binding.sector_id ELSE NULL END
      ELSE 'session-run-'||t.session_id END) AS workflow_id) owner
    LEFT JOIN LATERAL (SELECT max(at) AS at FROM heartbeats WHERE run_id=owner.workflow_id) beat ON true
    LEFT JOIN LATERAL (SELECT max(at) AS at FROM thread_messages WHERE thread_key=t.key
      AND ((kind='text' AND payload->>'role'='agent') OR (kind='tool' AND payload->>'name' IS DISTINCT FROM 'execution.recovery'))) progress ON true
    WHERE t.key>$1 AND t.status NOT IN ('FINISHED','ERROR','PAUSED','SUSPENDED')
      AND (c.active_lease IS NOT NULL OR t.queue_depth>0 OR intent.state IN ('pending','uncertain'))
    ORDER BY t.key LIMIT $2`, [after, limit])
  const ms = (at: Date | null): number | null => at === null ? null : new Date(at).getTime()
  return rows.map((r) => ({ threadKey: r.key, sessionId: r.session_id, workflowId: r.workflow_id, status: r.status,
    queueDepth: r.queue_depth, updatedAtMs: ms(r.updated_at)!, heartbeatAtMs: ms(r.heartbeat_at), progressAtMs: ms(r.progress_at), activeRun: r.active_run, lease: r.active_lease,
    currentEpoch: r.current_epoch, activeEpoch: r.active_epoch, activeExecutionId: r.active_execution_id, intentExecutionId: r.intent_execution_id, intentState: r.intent_state, intentCreatedAtMs: ms(r.intent_created_at), runStartedAtMs: ms(r.run_started_at), unresolvedStart: r.unresolved_start, sessionDeleted: r.session_deleted }))
}

export interface ReconciliationFinding {
  kind: 'closed-owner' | 'missing-heartbeat' | 'stalled-progress' | 'queue-starvation' | 'owner-unavailable' | 'loop-detected' | 'turn-wall-exceeded' | 'orphan-workflow' | 'orphan-child'
  response: 'observe' | 'fail' | 'nudge' | 'pause' | 'stop' | 'cancel' | 'alert'
  reason: string
  ownerExecutionId?: string
}

/** A control effect already recorded for this thread, kind, response and
 * lease: signals and cancels never repeat while the lease stands. */
export async function controlRecorded(db: Db, threadKey: string, kind: string, response: string, lease: string | null): Promise<boolean> {
  const { rows } = await db.query<{ one: number }>(
    `SELECT 1 AS one FROM events WHERE type = 't.reconciliation.finding'
     AND payload->>'threadKey' = $1 AND payload->>'kind' = $2 AND payload->>'response' = $3
     AND payload->>'lease' IS NOT DISTINCT FROM $4 LIMIT 1`,
    [threadKey, kind, response, lease],
  )
  return rows.length > 0
}

export interface TurnLoopEvidence {
  tools: Array<{ name: string; args: unknown }>
  texts: string[]
}

/** Recent tool calls + agent texts per thread for the loop rule: one
 * batched read per page, newest first, capped per thread. */
export async function recentTurnLoopEvidence(db: Db, threadKeys: string[]): Promise<Map<string, TurnLoopEvidence>> {
  const evidence = new Map<string, TurnLoopEvidence>()
  if (threadKeys.length === 0) return evidence
  for (const key of threadKeys) evidence.set(key, { tools: [], texts: [] })
  const { rows } = await db.query<{ thread_key: string; kind: string; payload: { name?: unknown; args?: unknown; detail?: unknown; text?: unknown; role?: unknown } }>(
    `SELECT thread_key, kind, payload FROM (
       SELECT thread_key, kind, payload, ROW_NUMBER() OVER (PARTITION BY thread_key ORDER BY seq DESC) AS rn
       FROM thread_messages WHERE thread_key = ANY($1::text[]) AND kind IN ('tool', 'text')
     ) ranked WHERE rn <= 12`,
    [threadKeys],
  )
  for (const row of rows) {
    const slot = evidence.get(row.thread_key)
    if (!slot) continue
    if (row.kind === 'tool' && typeof row.payload.name === 'string' && row.payload.name) {
      slot.tools.push({ name: row.payload.name, args: row.payload.args ?? row.payload.detail ?? null })
    } else if (row.kind === 'text' && row.payload.role === 'agent' && typeof row.payload.text === 'string') {
      slot.texts.push(row.payload.text)
    }
  }
  return evidence
}

export interface OrphanedWorkflow {
  threadKey: string
  sessionId: string | null
  workflowId: string | null
  lease: string
}

/** Active leases whose thread row is gone (no FOREIGN KEYs guard this,
 * deliberate). The workflow itself may still run: the page describes each
 * and cancels the runners, then clears the lease. Session-deleted threads
 * keep their rows, so they flow through the candidate path instead. */
export async function listOrphanedWorkflows(db: Db): Promise<OrphanedWorkflow[]> {
  const { rows } = await db.query<{ thread_key: string; workflow_id: string | null; lease: string }>(
    `SELECT c.thread_key, c.active_workflow_id AS workflow_id, c.active_lease AS lease
     FROM thread_context c LEFT JOIN threads t ON t.key = c.thread_key
     WHERE c.active_lease IS NOT NULL AND t.key IS NULL`,
  )
  return rows.map((row) => ({ threadKey: row.thread_key, sessionId: null, workflowId: row.workflow_id, lease: row.lease }))
}

/** Parent workflow ids for child threads in one read: null when the
 * launch is unknown. */
export async function parentWorkflowsForChildren(db: Db, threadKeys: string[]): Promise<Map<string, string | null>> {
  const parents = new Map<string, string | null>()
  const childIds = threadKeys.filter((key) => key.startsWith('agent:')).map((key) => key.slice('agent:'.length))
  for (const key of threadKeys) parents.set(key, null)
  if (childIds.length === 0) return parents
  const { rows } = await db.query<{ child_id: string; parent_workflow_id: string | null }>(
    `SELECT DISTINCT ON (payload->>'childId') payload->>'childId' AS child_id, payload->>'parentWorkflowId' AS parent_workflow_id
     FROM events WHERE type = 't.subagent.launched' AND payload->>'childId' = ANY($1::text[]) ORDER BY payload->>'childId', seq DESC`,
    [childIds],
  )
  for (const row of rows) {
    parents.set(`agent:${row.child_id}`, row.parent_workflow_id && row.parent_workflow_id !== 'unknown' ? row.parent_workflow_id : null)
  }
  return parents
}

/** Parent thread of a subagent thread: session children resolve to the
 * session thread, nested children to the parent agent thread. Null for
 * session threads and unknown launches. */
async function parentThreadKey(db: Db, threadKey: string): Promise<string | null> {
  if (!threadKey.startsWith('agent:')) return null
  const { rows } = await db.query<{ payload: { parentWorkflowId?: unknown; parentSessionId?: unknown } }>(
    `SELECT payload FROM events WHERE type = 't.subagent.launched' AND payload->>'childId' = $1 ORDER BY seq DESC LIMIT 1`,
    [threadKey.slice('agent:'.length)],
  )
  const launch = rows[0]?.payload
  const parentWorkflowId = typeof launch?.parentWorkflowId === 'string' ? launch.parentWorkflowId : undefined
  if (!parentWorkflowId || parentWorkflowId === 'unknown') {
    return typeof launch?.parentSessionId === 'string' ? launch.parentSessionId : null
  }
  return parentWorkflowId.startsWith('session-run-') ? parentWorkflowId.slice('session-run-'.length) : `agent:${parentWorkflowId}`
}

interface FencedRow {
  status: string; updated_at: Date; active_run: string | null; active_lease: string | null
  active_epoch: string | null; active_execution_id: string | null; active_workflow_id: string | null
  current_epoch: string | null; intent_execution_id: string | null; intent_state: string | null
  unresolved_start: boolean
}

/** Exact execution recovery rechecks both pre-start head and active lease;
 * unresolved concurrent starts cannot slip between the read and the commit. */
function exactOwnerFenced(row: FencedRow, candidate: ReconciliationCandidate, finding: ReconciliationFinding): boolean {
  return !!candidate.activeEpoch && !!candidate.activeExecutionId && !!candidate.lease
    && row.current_epoch === candidate.currentEpoch && row.current_epoch === candidate.activeEpoch
    && row.active_epoch === candidate.activeEpoch && row.active_execution_id === candidate.activeExecutionId
    && row.active_workflow_id === candidate.workflowId && row.intent_execution_id === candidate.activeExecutionId
    && finding.ownerExecutionId === candidate.activeExecutionId && row.intent_state === 'bound' && !row.unresolved_start
}

async function findingFenceHolds(tx: Db, row: FencedRow, candidate: ReconciliationCandidate, finding: ReconciliationFinding): Promise<boolean> {
  if (finding.response !== 'fail') return true
  if (finding.kind === 'closed-owner') {
    return exactOwnerFenced(row, candidate, finding)
  }
  if (finding.kind === 'turn-wall-exceeded') {
    return row.intent_state === 'bound' && !!candidate.lease
  }
  if (finding.kind === 'missing-heartbeat') {
    if (!candidate.lease || !candidate.workflowId) return false
    const beat = await tx.query<{ at: Date | null }>('SELECT max(at) AS at FROM heartbeats WHERE run_id = $1', [candidate.workflowId])
    const lastBeatMs = beat.rows[0]?.at ? new Date(beat.rows[0].at).getTime() : new Date(row.updated_at).getTime()
    return Date.now() - lastBeatMs >= HEARTBEAT_FAIL_FLOOR_MS
  }
  return true
}

async function writePause(tx: Db, key: string, partition: string, candidate: ReconciliationCandidate, finding: ReconciliationFinding): Promise<void> {
  await tx.query('UPDATE thread_context SET active_run=NULL,active_lease=NULL,active_epoch=NULL,active_workflow_id=NULL,active_execution_id=NULL,active_run_started_at=NULL WHERE thread_key=$1', [candidate.threadKey])
  await appendEvent(tx, { idempotencyKey: `${key}:state`, partition, type: 't.thread.state', payload: { threadKey: candidate.threadKey, status: 'PAUSED', acceptingSteer: false, recoveryEpoch: candidate.activeEpoch } })
  await raiseAlert(tx, { kind: finding.kind, severity: 'high', subject: `No progress on ${candidate.threadKey}: paused, owner review needed`, threadKey: candidate.threadKey })
}

async function writeStop(tx: Db, key: string, partition: string, candidate: ReconciliationCandidate, finding: ReconciliationFinding): Promise<void> {
  await appendEvent(tx, { idempotencyKey: `${key}:loop`, partition, type: 't.loop.detected', payload: { threadKey: candidate.threadKey, reason: finding.reason } })
  await appendEvent(tx, { idempotencyKey: `${key}:reply`, partition, type: 't.message.appended', payload: { threadKey: candidate.threadKey, kind: 'text', message: { role: 'agent', text: `I stopped this turn because I detected a loop (${finding.reason}). Tell me how to proceed and I will continue.` } } })
  await raiseAlert(tx, { kind: finding.kind, severity: 'high', subject: `Loop stopped on ${candidate.threadKey}: ${finding.reason}`, threadKey: candidate.threadKey })
}

async function writeCancel(tx: Db, key: string, partition: string, candidate: ReconciliationCandidate, finding: ReconciliationFinding): Promise<void> {
  await appendEvent(tx, { idempotencyKey: `${key}:message`, partition, type: 't.message.appended', payload: { threadKey: candidate.threadKey, kind: 'text', message: { text: `Supervisor cancelled this run: ${finding.reason}` } } })
  await raiseAlert(tx, { kind: finding.kind, severity: 'high', subject: `Run cancelled on ${candidate.threadKey}: ${finding.reason}`, threadKey: candidate.threadKey })
}

async function writeFail(tx: Db, key: string, partition: string, candidate: ReconciliationCandidate, finding: ReconciliationFinding): Promise<void> {
  await appendEvent(tx, { idempotencyKey: `${key}:message`, partition, type: 't.message.appended', payload: { threadKey: candidate.threadKey, kind: 'tool', message: { id: key, name: 'execution.recovery', state: 'failed', detail: finding.reason } } })
  await tx.query('UPDATE thread_context SET active_run=NULL,active_lease=NULL,active_epoch=NULL,active_workflow_id=NULL,active_execution_id=NULL,active_run_started_at=NULL WHERE thread_key=$1', [candidate.threadKey])
  await appendEvent(tx, { idempotencyKey: `${key}:state`, partition, type: 't.thread.state', payload: { threadKey: candidate.threadKey, status: 'ERROR', acceptingSteer: false, recoveryEpoch: candidate.activeEpoch ?? undefined, reason: finding.reason, reasonCode: finding.kind } })
  await raiseAlert(tx, { kind: finding.kind, severity: 'high', subject: `Thread failed on ${candidate.threadKey}: ${finding.reason}`, threadKey: candidate.threadKey })
  if (!candidate.threadKey.startsWith('agent:')) return
  const parent = await parentThreadKey(tx, candidate.threadKey)
  if (parent) {
    await appendEvent(tx, { idempotencyKey: `${key}:parent`, partition, type: 't.message.appended', payload: { threadKey: parent, kind: 'text', message: { text: `Supervisor: subagent ${candidate.threadKey} failed: ${finding.reason}` } } })
  }
}

export async function recordReconciliation(db: TransactableDb, candidate: ReconciliationCandidate, finding: ReconciliationFinding, observationBucket: number): Promise<boolean> {
  return workspaceTransaction(db, candidate.threadKey, async (tx) => {
    const current = await tx.query<FencedRow>(
      `SELECT t.status,t.updated_at,c.active_run,c.active_lease,c.active_epoch,c.active_execution_id,c.active_workflow_id,h.epoch AS current_epoch,i.execution_id AS intent_execution_id,i.state AS intent_state,
        EXISTS(SELECT 1 FROM execution_intents pending WHERE pending.thread_key=t.key AND pending.state IN ('pending','uncertain')) AS unresolved_start
       FROM threads t LEFT JOIN thread_context c ON c.thread_key=t.key LEFT JOIN thread_execution_heads h ON h.thread_key=t.key LEFT JOIN execution_intents i ON i.epoch=h.epoch WHERE t.key=$1`, [candidate.threadKey])
    const row = current.rows[0]
    if (!row || row.status !== candidate.status || new Date(row.updated_at).getTime() !== candidate.updatedAtMs || row.active_lease !== candidate.lease || row.active_run !== candidate.activeRun) return false
    if (!(await findingFenceHolds(tx, row, candidate, finding))) return false
    const identity = createHash('sha256').update(JSON.stringify([candidate.threadKey, candidate.lease, candidate.activeRun, finding.ownerExecutionId ?? null, finding.kind, finding.response, ['fail', 'nudge', 'pause', 'stop', 'cancel'].includes(finding.response) ? 0 : observationBucket])).digest('hex')
    const key = `reconcile:${identity}`
    const partition = `session:${candidate.sessionId}`
    const recorded = await appendEvent(tx, { idempotencyKey: key, partition, type: 't.reconciliation.finding', payload: { threadKey: candidate.threadKey, workflowId: candidate.workflowId, lease: candidate.lease, activeRun: candidate.activeRun, ...finding } })
    if (finding.response === 'observe') return !recorded.duplicate
    if (finding.response === 'alert') {
      await raiseAlert(tx, { kind: finding.kind, severity: 'warning', subject: `Queue starved on ${candidate.threadKey}: ${finding.reason}`, threadKey: candidate.threadKey })
      return !recorded.duplicate
    }
    if (finding.response === 'nudge') {
      await raiseAlert(tx, { kind: finding.kind, severity: 'info', subject: `No progress on ${candidate.threadKey}: steering nudge sent`, threadKey: candidate.threadKey })
      return !recorded.duplicate
    }
    if (finding.response === 'pause') {
      await writePause(tx, key, partition, candidate, finding)
      return !recorded.duplicate
    }
    if (finding.response === 'stop') {
      await writeStop(tx, key, partition, candidate, finding)
      return !recorded.duplicate
    }
    if (finding.response === 'cancel') {
      await writeCancel(tx, key, partition, candidate, finding)
      return !recorded.duplicate
    }
    await writeFail(tx, key, partition, candidate, finding)
    return !recorded.duplicate
  })
}

/** Orphan-workflow record: no thread row to transact on, so the matched
 * lease update is the fence. The finding lands only when the session is
 * known; the alert and lease clear always land. */
export async function recordOrphanWorkflow(db: TransactableDb, orphan: OrphanedWorkflow, finding: ReconciliationFinding): Promise<boolean> {
  return workspaceTransaction(db, orphan.threadKey, async (tx) => {
    const cleared = await tx.query('UPDATE thread_context SET active_run=NULL,active_lease=NULL,active_epoch=NULL,active_workflow_id=NULL,active_execution_id=NULL,active_run_started_at=NULL WHERE thread_key=$1 AND active_lease=$2 AND active_workflow_id IS NOT DISTINCT FROM $3', [orphan.threadKey, orphan.lease, orphan.workflowId])
    if ((cleared.rowCount ?? 0) !== 1) return false
    const identity = createHash('sha256').update(JSON.stringify([orphan.threadKey, orphan.lease, orphan.workflowId, finding.kind, finding.response])).digest('hex')
    const key = `reconcile:${identity}`
    if (orphan.sessionId) {
      await appendEvent(tx, { idempotencyKey: key, partition: `session:${orphan.sessionId}`, type: 't.reconciliation.finding', payload: { threadKey: orphan.threadKey, workflowId: orphan.workflowId, lease: orphan.lease, ...finding } })
    }
    await raiseAlert(tx, { kind: finding.kind, severity: 'high', subject: `Orphan workflow ${orphan.workflowId} cancelled (thread ${orphan.threadKey})`, threadKey: orphan.threadKey })
    return true
  })
}
