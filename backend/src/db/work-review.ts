import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Scope } from '../auth/types.js'
import type { TransactableDb } from './checkpoints.js'
import { appendEvent, type Db } from './events.js'
import { WorkspaceError } from './errors.js'
import { readSectorExecutionState } from './sectors.js'
import { readSectorPlan } from './sector-plan.js'
import { notifyWorkspace } from './workspace-global-context.js'
import { readResearchWorkItem } from './workspace-research.js'
import { requireSector, workspaceTransaction } from './workspace.js'
import { createLogger, logOp } from '../observability/logging.js'

export const WorkReviewDecision = z.object({ planVersion: z.number().int().positive(), receiptVersion: z.string().regex(/^[a-f0-9]{64}$/), decision: z.enum(['retry','exclude']), reason: z.string().trim().min(1).max(4000) }).strict()
const logger = createLogger({ op: 'research.work.review' })
/** Only approver HTTP routes call this; no model/MCP binding exists. */
export async function reviewResearchWork(db: TransactableDb, input: z.infer<typeof WorkReviewDecision> & { sectorId: string; workId: string; author: string; scope?: Scope }) {
  const decision = WorkReviewDecision.parse({ planVersion: input.planVersion, receiptVersion: input.receiptVersion, decision: input.decision, reason: input.reason })
  return logOp(logger, 'research.work.review', () => workspaceTransaction(db, input.sectorId, async (tx) => {
    await requireSector(tx, input.sectorId, input.scope)
    await tx.query('SELECT id FROM sectors WHERE id=$1 FOR UPDATE', [input.sectorId])
    if (!['paused','failed'].includes(await readSectorExecutionState(tx, input.sectorId, input.scope))) throw new WorkspaceError('conflict', 'Pause research before reviewing candidate work.')
    const plan = await readSectorPlan(tx, input.sectorId, input.scope)
    if (plan?.latest?.version !== decision.planVersion || plan.approvedVersion !== decision.planVersion) throw new WorkspaceError('conflict', 'The approved plan changed. Review the latest plan before deciding.')
    await tx.query('SELECT id FROM research_work WHERE sector_id=$1 AND plan_version=$2 AND id=$3 FOR UPDATE', [input.sectorId, decision.planVersion, input.workId])
    const before = await readResearchWorkItem(tx, input.sectorId, decision.planVersion, input.workId, input.scope)
    if (before.receiptVersion !== decision.receiptVersion) throw new WorkspaceError('conflict', 'This work changed. Review its latest receipt before deciding.')
    if (before.kind !== 'discovery' || !before.id.startsWith(`${input.sectorId}:v${decision.planVersion}:intake:`) || !['blocked','failed'].includes(before.state)) throw new WorkspaceError('conflict', 'Only unresolved candidate intake work can be retried or excluded.')
    if (before.childId) {
      const executing = await tx.query(`SELECT 1 FROM thread_context WHERE thread_key=$1 AND active_lease IS NOT NULL UNION ALL SELECT 1 FROM execution_intents WHERE thread_key=$1 AND state IN ('pending','uncertain') LIMIT 1`, [`agent:${before.childId}`])
      if (executing.rows.length) throw new WorkspaceError('conflict', 'The candidate child is still executing or its start is unresolved. Wait for a safe boundary.')
    }
    const state = decision.decision === 'exclude' ? 'excluded' : 'pending'
    await tx.query('UPDATE research_work SET state=$4 WHERE sector_id=$1 AND plan_version=$2 AND id=$3', [input.sectorId, decision.planVersion, input.workId, state])
    await appendEvent(tx, { idempotencyKey: `work-review:${randomUUID()}`, partition: `sector:${input.sectorId}`, type: 'sector.research.work_reviewed', payload: { workId: input.workId, ...decision, author: input.author, before, state } })
    await notifyWorkspace(tx, input.sectorId, 'work-progress', { sectorId: input.sectorId, id: input.workId, state })
    return readResearchWorkItem(tx, input.sectorId, decision.planVersion, input.workId, input.scope)
  }), { sectorId: input.sectorId, planVersion: decision.planVersion })
}

/** A bounded marker for parent safe-boundary reload, scoped to one approved version. */
export async function readResearchWorkReviewSequence(db: Db, sectorId: string, planVersion: number, scope?: Scope): Promise<number> {
  z.number().int().positive().parse(planVersion)
  await requireSector(db, sectorId, scope)
  const row = (await db.query<{ seq: string | null }>("SELECT max(seq)::text AS seq FROM events WHERE partition=$1 AND type='sector.research.work_reviewed' AND payload->>'planVersion'=$2::text", [`sector:${sectorId}`, planVersion])).rows[0]
  return z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(Number(row?.seq ?? 0))
}
