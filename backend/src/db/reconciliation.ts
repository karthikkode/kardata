// Durable supervision reads/mutations stay behind the established DB boundary.
import { createHash } from 'node:crypto'
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
  unresolvedStart?: boolean
}

/** Keyset pages, including queued logical agents. No fleet heartbeat can
 * stand in for this thread's owner. Heartbeats are never semantic progress. */
export async function listReconciliationCandidates(db: Db, after = '', limit = 100): Promise<ReconciliationCandidate[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new DbContractError('reconciliation page limit must be 1–100')
  const { rows } = await db.query<{
    key: string; session_id: string; workflow_id: string | null; status: string; queue_depth: number
    updated_at: Date; heartbeat_at: Date | null; progress_at: Date | null; active_run: string | null; active_lease: string | null
    current_epoch: string | null; active_epoch: string | null; active_execution_id: string | null; intent_execution_id: string | null; intent_state: string | null; unresolved_start: boolean
  }>(`SELECT t.key,t.session_id,t.status,t.queue_depth,t.updated_at,c.active_run,c.active_lease,
      owner.workflow_id,beat.at AS heartbeat_at,progress.at AS progress_at,h.epoch AS current_epoch,c.active_epoch,c.active_execution_id,
      intent.execution_id AS intent_execution_id,intent.state AS intent_state,
      EXISTS(SELECT 1 FROM execution_intents pending WHERE pending.thread_key=t.key AND pending.state IN ('pending','uncertain')) AS unresolved_start
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
    currentEpoch: r.current_epoch,activeEpoch: r.active_epoch,activeExecutionId: r.active_execution_id,intentExecutionId: r.intent_execution_id,intentState: r.intent_state,unresolvedStart: r.unresolved_start }))
}

export interface ReconciliationFinding {
  kind: 'closed-owner' | 'missing-heartbeat' | 'stalled-progress' | 'queue-starvation' | 'owner-unavailable'
  response: 'observe' | 'park'
  reason: string
  ownerExecutionId?: string
}

/** Exact execution recovery rechecks both pre-start head and active lease;
 * unresolved concurrent starts cannot slip between the read and the commit. */
export async function recordReconciliation(db: TransactableDb, candidate: ReconciliationCandidate, finding: ReconciliationFinding, observationBucket: number): Promise<boolean> {
  return workspaceTransaction(db, candidate.threadKey, async (tx) => {
    const current = await tx.query<{ status: string; updated_at: Date; active_run: string | null; active_lease: string | null; active_epoch: string | null; active_execution_id: string | null; active_workflow_id: string | null; current_epoch: string | null; intent_execution_id: string | null; intent_state: string | null; unresolved_start: boolean }>(
      `SELECT t.status,t.updated_at,c.active_run,c.active_lease,c.active_epoch,c.active_execution_id,c.active_workflow_id,h.epoch AS current_epoch,i.execution_id AS intent_execution_id,i.state AS intent_state,
        EXISTS(SELECT 1 FROM execution_intents pending WHERE pending.thread_key=t.key AND pending.state IN ('pending','uncertain')) AS unresolved_start
       FROM threads t LEFT JOIN thread_context c ON c.thread_key=t.key LEFT JOIN thread_execution_heads h ON h.thread_key=t.key LEFT JOIN execution_intents i ON i.epoch=h.epoch WHERE t.key=$1`, [candidate.threadKey])
    const row = current.rows[0]
    if (!row || row.status !== candidate.status || new Date(row.updated_at).getTime() !== candidate.updatedAtMs || row.active_lease !== candidate.lease || row.active_run !== candidate.activeRun) return false
    if (finding.response === 'park' && (finding.kind !== 'closed-owner' || !candidate.activeEpoch || !candidate.activeExecutionId || !candidate.lease || row.current_epoch !== candidate.currentEpoch || row.current_epoch !== candidate.activeEpoch || row.active_epoch !== candidate.activeEpoch || row.active_execution_id !== candidate.activeExecutionId || row.active_workflow_id !== candidate.workflowId || row.intent_execution_id !== candidate.activeExecutionId || finding.ownerExecutionId !== candidate.activeExecutionId || row.intent_state !== 'bound' || row.unresolved_start)) return false
    const identity = createHash('sha256').update(JSON.stringify([candidate.threadKey,candidate.lease,candidate.activeRun,finding.ownerExecutionId ?? null,finding.kind,finding.response,finding.kind === 'closed-owner' ? 0 : observationBucket])).digest('hex')
    const key = `reconcile:${identity}`
    const partition = `session:${candidate.sessionId}`
    const recorded = await appendEvent(tx, { idempotencyKey: key, partition, type: 't.reconciliation.finding', payload: { threadKey: candidate.threadKey, workflowId: candidate.workflowId, ...finding } })
    if (finding.kind === 'closed-owner') {
      await appendEvent(tx, { idempotencyKey: `${key}:message`, partition, type: 't.message.appended', payload: { threadKey: candidate.threadKey, kind: 'tool', message: { id: key, name: 'execution.recovery', state: 'failed', detail: finding.reason } } })
    }
    if (finding.response === 'park') {
      await tx.query('UPDATE thread_context SET active_run=NULL,active_lease=NULL,active_epoch=NULL,active_workflow_id=NULL,active_execution_id=NULL WHERE thread_key=$1',[candidate.threadKey])
      await appendEvent(tx,{ idempotencyKey: `${key}:state`,partition,type: 't.thread.state',payload: { threadKey: candidate.threadKey,status: 'PAUSED',acceptingSteer: false,recoveryEpoch: candidate.activeEpoch } })
    }
    return !recorded.duplicate
  })
}
