// Research workspace: budgets, work items, discovery state, progress,
// and reference snapshots for turns.
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Scope } from '../auth/types.js'
import { appendEvent, findEventByKey, type Db } from './events.js'
import { type TransactableDb } from './checkpoints.js'
import { DbContractError, WorkspaceError } from './errors.js'
import { listDocumentUnits } from './document-units.js'
import { progressSummary, type WorkItem } from '../temporal/research-plan.js'
import { discoverySample } from '../temporal/discovery-acceptance.js'
import { readSectorPlan, type SectorPlan } from './sector-plan.js'
import { assertThreadFileContext, mergeFileRefs, recordThreadFileExposure, listContextFileBlocks, markContextFileBlockFailed } from './context-files.js'
import { createLogger, logOp } from '../observability/logging.js'

import {
  checked,
  requireSector,
  workspaceRow,
  workspaceTransaction,
  Id,
} from './workspace.js'
import { assertGlobalFileContext, notifyWorkspace, readGlobalContext, type ChangeRow } from './workspace-global-context.js'
import { listSectorLibrary } from './workspace-library.js'

const workspaceLogger = createLogger({ op: 'workspace' })

const ResearchBudget = z.object({ runId: Id, spentMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict()
export async function readResearchBudget(db: Db, sectorId: string, scope?: Scope): Promise<number> {
  await requireSector(db, sectorId, scope)
  const { rows } = await db.query<{ payload: unknown }>("SELECT payload FROM events WHERE partition=$1 AND type='sector.research.budget_recorded' ORDER BY seq", [`sector:${sectorId}`])
  const runs = new Map<string, number>()
  for (const row of rows) {
    const budget = checked(ResearchBudget, row.payload)
    runs.set(budget.runId, Math.max(runs.get(budget.runId) ?? 0, budget.spentMs))
  }
  const total = [...runs.values()].reduce((sum, spent) => sum + spent, 0)
  if (!Number.isSafeInteger(total)) throw new WorkspaceError('validation_failed', 'Research budget usage exceeds its supported range.')
  return total
}
export async function recordResearchBudget(db: TransactableDb, input: { sectorId: string; runId: string; spentMs: number; checkpoint: number; scope?: Scope }): Promise<void> {
  checked(ResearchBudget, { runId: input.runId, spentMs: input.spentMs })
  checked(z.number().int().positive(), input.checkpoint)
  await workspaceTransaction(db, input.sectorId, async (tx) => {
    await requireSector(tx, input.sectorId, input.scope)
    const idempotencyKey = `research-budget:${input.sectorId}:${input.runId}:${input.checkpoint}`
    const existing = await findEventByKey(tx, idempotencyKey)
    if (existing) {
      if (ResearchBudget.parse(existing.payload).spentMs !== input.spentMs) throw new WorkspaceError('conflict', 'Research budget checkpoint changed on replay.')
      return
    }
    await appendEvent(tx, { idempotencyKey, partition: `sector:${input.sectorId}`, type: 'sector.research.budget_recorded', payload: { runId: input.runId, spentMs: input.spentMs } })
  })
}
interface ResearchWorkRow { id: string; kind: WorkItem['kind']; title: string; state: WorkItem['state']; attempts: number; child_id: string | null; evidence: string[]; detail: string; cursor: WorkItem['cursor']; source_url: string | null }
function researchWorkView(row: ResearchWorkRow): WorkItem {
  const item: WorkItem = { id: row.id, kind: row.kind, title: row.title, state: row.state, attempts: row.attempts, childId: row.child_id, evidence: row.evidence, detail: row.detail, ...(row.source_url ? { sourceUrl: row.source_url } : {}), ...(row.cursor ? { cursor: row.cursor } : {}) }
  return { ...item, receiptVersion: researchWorkReceiptVersion(item) }
}
function researchWorkReceiptVersion(item: WorkItem): string {
  const { receiptVersion: _version, ...receipt } = item
  return createHash('sha256').update(JSON.stringify(receipt)).digest('hex')
}
export async function readResearchProgress(db: Db, sectorId: string, scope?: Scope) {
  const sector = await requireSector(db, sectorId, scope)
  const plan = await readSectorPlan(db, sectorId, scope)
  const version = ['planning', 'planned'].includes(sector.state) ? plan?.latest?.version ?? 0 : plan?.approvedVersion ?? plan?.latest?.version ?? 0
  const { rows } = await db.query<ResearchWorkRow>('SELECT * FROM research_work WHERE sector_id=$1 AND plan_version=$2 ORDER BY at,id', [sectorId, version])
  const items: WorkItem[] = rows.map(researchWorkView)
  const workspace = await db.query<{ discovery_closed: boolean }>('SELECT discovery_closed FROM sector_workspace WHERE sector_id=$1', [sectorId])
  const approved = plan?.versions.find((entry) => entry.version === version)?.executable
  const expected = approved?.discovery.map((direction) => `${sectorId}:v${version}:discovery:${direction.id}`) ?? []
  const closed = (workspace.rows[0]?.discovery_closed ?? false) && expected.length > 0 && expected.every((id) => items.some((item) => item.id === id && item.state === 'complete'))
  return { sectorId, state: sector.state, planVersion: version, plan, items, budgetUsedMs: await readResearchBudget(db, sectorId, scope), ...progressSummary(items, closed, sector.state === 'complete') }
}
/** Publication guard reads counts/identity, never every receipt body under the lock. */
export async function readDiscoveryPublicationState(db: Db, sectorId: string, version: number, intakeId: string, scope?: Scope) {
  await requireSector(db, sectorId, scope); checked(z.number().int().positive(), version); checked(Id, intakeId)
  const { rows } = await db.query<{ companies: string; accepted: boolean }>(`SELECT count(*) FILTER(WHERE kind='company') AS companies,bool_or(id=$3 AND state='complete' AND left(detail,7)='accept:') AS accepted FROM research_work WHERE sector_id=$1 AND plan_version=$2`, [sectorId, version, intakeId])
  return { companyCount: Number(rows[0]?.companies ?? 0), accepted: rows[0]?.accepted ?? false }
}

/** Compact Temporal state; API progress continues to expose the exact DB records. */
export async function readResearchCoordinatorProgress(db: Db, sectorId: string, version: number, scope?: Scope, afterIntakeId?: string) {
  const sector = await requireSector(db, sectorId, scope)
  checked(z.number().int().positive(), version)
  if (afterIntakeId !== undefined) checked(Id, afterIntakeId)
  const plan = await readSectorPlan(db, sectorId, scope)
  if (!plan?.versions.some((entry) => entry.version === version)) throw new DbContractError('Unknown research plan version.')
  const counters = await db.query<{ total: string; completed: string; unresolved: string; companies: string; intakes: string }>(`SELECT count(*) FILTER(WHERE state<>'excluded') AS total,count(*) FILTER(WHERE state='complete') AS completed,count(*) FILTER(WHERE state IN ('blocked','failed')) AS unresolved,count(*) FILTER(WHERE kind='company') AS companies,count(*) FILTER(WHERE kind='discovery' AND position(':intake:' in id)>0 AND state NOT IN ('complete','excluded')) AS intakes FROM research_work WHERE sector_id=$1 AND plan_version=$2`, [sectorId, version])
  const count = counters.rows[0]!
  const companyRows = await db.query<{ id: string; kind: 'company'; source_url: string | null }>('SELECT id,kind,COALESCE(source_url,evidence->>0) AS source_url FROM research_work WHERE sector_id=$1 AND plan_version=$2 AND kind=\'company\'', [sectorId, version])
  const knownDomains = [...new Set(companyRows.rows.flatMap((row) => { const url = row.source_url; if (!url) return []; try { return [new URL(url).hostname.toLowerCase().replace(/^www\./, '')] } catch { return [] } }))]
  const sampleIds = discoverySample(companyRows.rows).map((row) => row.id)
  const work = await db.query<ResearchWorkRow>(`SELECT id,kind,left(title,240) AS title,state,attempts,child_id,CASE WHEN source_url IS NULL THEN evidence ELSE '[]'::jsonb END AS evidence,left(detail,160) AS detail,CASE WHEN cursor IS NULL THEN NULL ELSE jsonb_build_object('queryIndex',cursor->'queryIndex','page',cursor->'page','seenDomains','[]'::jsonb) END AS cursor,source_url
    FROM research_work WHERE sector_id=$1 AND plan_version=$2 AND (id=ANY($3::text[]) OR (kind='discovery' AND position(':intake:' in id)=0)) ORDER BY at,id`, [sectorId, version, sampleIds])
  const retries = await db.query<{ id: string; kind: 'discovery'; title: string; state: WorkItem['state']; attempts: number; child_id: string | null; detail: string }>(`SELECT id,kind,left(title,240) AS title,state,attempts,child_id,left(detail,160) AS detail FROM research_work WHERE sector_id=$1 AND plan_version=$2 AND kind='discovery' AND position(':intake:' in id)>0 AND state IN ('pending','running','blocked','failed') AND (state='pending' OR left(detail,10)<>'uncertain:') AND ($3::text IS NULL OR id COLLATE "C">$3 COLLATE "C") ORDER BY id COLLATE "C" LIMIT 101`, [sectorId, version, afterIntakeId ?? null])
  const items: WorkItem[] = work.rows.map(researchWorkView)
  items.push(...retries.rows.slice(0,100).map((row) => ({ id: row.id, kind: row.kind, title: row.title, state: row.state, attempts: row.attempts, childId: row.child_id, evidence: [], detail: row.detail })))
  return { sectorId, state: sector.state, planVersion: version, plan: undefined, items, budgetUsedMs: await readResearchBudget(db, sectorId, scope), completed: Number(count.completed), total: Number(count.total), unresolved: Number(count.unresolved), discoveryClosed: false, estimatedPercent: null, companyCount: Number(count.companies), knownDomains, unresolvedIntakeCount: Number(count.intakes), ...(retries.rows.length > 100 ? { retryNextId: retries.rows[99]!.id } : {}) }
}

export async function readResearchWorkItem(db: Db, sectorId: string, version: number, id: string, scope?: Scope): Promise<WorkItem> {
  await requireSector(db, sectorId, scope); checked(Id, id); checked(z.number().int().positive(), version)
  const { rows } = await db.query<ResearchWorkRow>('SELECT * FROM research_work WHERE sector_id=$1 AND plan_version=$2 AND id=$3', [sectorId, version, id])
  const row = rows[0]
  if (!row) throw new WorkspaceError('not_found', 'Research work is not in this sector and plan version.')
  return researchWorkView(row)
}

/** Existing PK identities make batch dedup bounded by search-page size. */
export async function researchIntakeReceipts(db: Db, sectorId: string, version: number, ids: string[], scope?: Scope): Promise<string[]> {
  await requireSector(db, sectorId, scope); checked(z.number().int().positive(), version); checked(z.array(Id).max(20), ids)
  const { rows } = await db.query<{ id: string }>('SELECT id FROM research_work WHERE sector_id=$1 AND plan_version=$2 AND id=ANY($3::text[])', [sectorId, version, ids])
  return rows.map((row) => row.id)
}

/** Called inside the owner approval transaction; never infer semantic scope compatibility. */
export async function retainCompatibleDiscovery(db: Db, input: { sectorId: string; version: number; plan: SectorPlan; contextScope: string; contextDecisions: string; scope?: Scope }): Promise<number> {
  return logOp(workspaceLogger, 'research.work.retain', async () => {
    checked(z.number().int().positive(), input.version)
    if (input.plan.sectorId !== input.sectorId) throw new WorkspaceError('permission_denied', 'Plan belongs to another sector.')
    await requireSector(db, input.sectorId, input.scope)
    const previousVersion = input.plan.approvedVersion
    const previous = input.plan.versions.find((version) => version.version === previousVersion)?.executable
    const next = input.plan.versions.find((version) => version.version === input.version)?.executable
    if (!previousVersion || previousVersion >= input.version || !previous || !next || previous.researchDepth !== 'discovery' || next.researchDepth !== 'discovery' || !input.plan.approvedContext || input.plan.approvedContext.scope !== input.contextScope || input.plan.approvedContext.decisions !== input.contextDecisions || previous.companyBrief !== next.companyBrief || JSON.stringify(previous.acceptance) !== JSON.stringify(next.acceptance)) return 0
    const oldPrefix = `${input.sectorId}:v${previousVersion}:`
    const newPrefix = `${input.sectorId}:v${input.version}:`
    const counts = await db.query<{ n: string }>(`SELECT count(*) AS n FROM research_work WHERE sector_id=$1 AND plan_version=$2 AND state='complete' AND kind='company' AND source_url IS NOT NULL AND jsonb_array_length(evidence)>=3 AND left(id,length($3))=$3`, [input.sectorId, previousVersion, oldPrefix])
    if (Number(counts.rows[0]?.n ?? 0) > next.budgets.maxCompanies) throw new WorkspaceError('conflict', 'The revised limit is below the completed discoveries. Review their retention before reducing the limit.')
    const directionIds = previous.budgets.maxCompanies === next.budgets.maxCompanies && previous.discoveryTarget === next.discoveryTarget ? next.discovery.filter((direction) => previous.discovery.some((old) => JSON.stringify(old) === JSON.stringify(direction))).map((direction) => `${oldPrefix}discovery:${direction.id}`) : []
    const copied = await db.query(`INSERT INTO research_work(id,sector_id,plan_version,kind,title,state,attempts,child_id,evidence,detail,cursor,source_url)
      SELECT $4||substring(id from length($3)+1),sector_id,$5,kind,title,state,attempts,child_id,evidence,detail||$6,cursor,source_url
      FROM research_work WHERE sector_id=$1 AND plan_version=$2 AND left(id,length($3))=$3 AND (
        (state='complete' AND kind='company' AND source_url IS NOT NULL AND jsonb_array_length(evidence)>=3) OR
        (kind='discovery' AND position(':intake:' in id)>0) OR (state='complete' AND id=ANY($7::text[])))
      ON CONFLICT(id) DO NOTHING`, [input.sectorId, previousVersion, oldPrefix, newPrefix, input.version, `\nRetained from approved plan v${previousVersion}; scope and acceptance unchanged.`, directionIds])
    const count = copied.rowCount ?? 0
    await appendEvent(db, { idempotencyKey: `research-retained:${input.sectorId}:v${input.version}`, partition: `sector:${input.sectorId}`, type: 'sector.research.work_retained', payload: { sourceVersion: previousVersion, planVersion: input.version, count, sourcePrefix: oldPrefix, destinationPrefix: newPrefix } })
    return count
  }, { sectorId: input.sectorId, planVersion: input.version })
}

export async function recordResearchWork(db: Db, input: { sectorId: string; planVersion: number; item: WorkItem; scope?: Scope }) {
  await requireSector(db, input.sectorId, input.scope)
  checked(z.number().int().positive(), input.planVersion)
  checked(z.object({ id: Id, kind: z.enum(['discovery','company']), title: z.string().min(1), receiptVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(), state: z.enum(['pending','running','complete','blocked','failed','excluded']), attempts: z.number().int().nonnegative(), childId: z.string().nullable(), evidence: z.array(z.string()), detail: z.string(), sourceUrl: z.string().url().optional(), cursor: z.object({ queryIndex: z.number().int().nonnegative(), page: z.number().int().nonnegative(), seenDomains: z.array(z.string()) }).optional() }).strict(), input.item)
  const item = input.item
  const written = await db.query(`INSERT INTO research_work(id,sector_id,plan_version,kind,title,state,attempts,child_id,evidence,detail,cursor,source_url)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12) ON CONFLICT(id) DO UPDATE SET state=$6,attempts=GREATEST(research_work.attempts,$7),child_id=$8,evidence=$9::jsonb,detail=$10,cursor=$11::jsonb,source_url=COALESCE(research_work.source_url,$12)
    WHERE research_work.state NOT IN ('complete','excluded') AND research_work.sector_id=EXCLUDED.sector_id AND research_work.plan_version=EXCLUDED.plan_version`, [item.id, input.sectorId, input.planVersion, item.kind, item.title, item.state, item.attempts, item.childId, JSON.stringify(item.evidence), item.detail, JSON.stringify(item.cursor ?? null), item.sourceUrl ?? null])
  if (!written.rowCount) {
    const existing = await db.query<{ sector_id: string; plan_version: number; state: WorkItem['state'] }>('SELECT sector_id,plan_version,state FROM research_work WHERE id=$1', [item.id])
    const row = existing.rows[0]
    if (!row || row.sector_id !== input.sectorId) throw new WorkspaceError('permission_denied', 'Work identity belongs to another sector.')
    if (row.plan_version !== input.planVersion) throw new WorkspaceError('conflict', 'Work identity belongs to another plan version.')
    return // A completed receipt is immutable; do not emit a false new state.
  }
  await notifyWorkspace(db, input.sectorId, 'work-progress', { sectorId: input.sectorId, id: item.id, state: item.state })
}
export async function closeDiscovery(db: Db, sectorId: string): Promise<void> {
  checked(Id, sectorId)
  await db.query('UPDATE sector_workspace SET discovery_closed=true WHERE sector_id=$1', [sectorId])
  await notifyWorkspace(db, sectorId, 'work-progress', { sectorId, discoveryClosed: true })
}
export async function workspaceReferences(db: Db, sectorId: string, scope?: Scope, threadKey?: string): Promise<string[]> {
  checked(Id, sectorId)
  await assertGlobalFileContext(db, sectorId, scope)
  const context = await readGlobalContext(db, sectorId, scope, false)
  if (threadKey) { const row = await workspaceRow(db, sectorId); for (const ref of mergeFileRefs(...Object.values(row.section_file_refs ?? {}))) await recordThreadFileExposure(db as TransactableDb, threadKey, sectorId, ref.fileId, ref.ords, scope) }
  const references = context.markdown ? [context.markdown] : []
  const blocks = await listContextFileBlocks(db, sectorId)
  const library = (await listSectorLibrary(db, sectorId, scope)).sort((a, b) => a.id.localeCompare(b.id))
  const libraryById = new Map(library.map((file) => [file.id, file]))
  for (const block of blocks) {
    const file = libraryById.get(block.fileId)
    if (block.state === 'ready' && file && !file.hidden && file.hash !== block.hash) await markContextFileBlockFailed(db, sectorId, block.fileId, 'file changed')
  }
  // Ready blocks ride in the markdown above; raw unit lines survive only for
  // legacy blocks until they are summarized.
  const legacy = new Set(blocks.filter((block) => block.state === 'legacy').map((block) => block.fileId))
  for (const file of library) {
    if (!file.included || file.hidden || (file.kind !== 'document' && !file.documentId)) continue
    if (!legacy.has(file.id)) continue
    const approved = await db.query<ChangeRow>('SELECT c.* FROM workspace_changes c JOIN workspace_files f ON f.approval_id=c.id WHERE f.sector_id=$1 AND f.file_id=$2', [sectorId, file.id])
    const approval = approved.rows[0]?.file_ref
    if (!approval || approval.hash !== file.hash) continue
    if (threadKey) await recordThreadFileExposure(db as TransactableDb, threadKey, sectorId, file.id, approval.ords, scope)
    const units = await listDocumentUnits(db, file.documentId ?? file.id)
    for (const unit of units.filter((entry) => approval.ords.includes(entry.ord))) references.push(`[${file.filename}:${unit.ord}] ${unit.text}`)
  }
  return references
}
/** Optimistic boundary read: references may record exposures in their own
 * transaction. Never label a mixed global document with an unrelated version. */
export async function workspaceReferenceSnapshot(db: Db, sectorId: string, threadKey: string): Promise<{ references: string[]; contextVersion: number; planVersion: number | null }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await readGlobalContext(db, sectorId, undefined, false)
    const planBefore = await readSectorPlan(db, sectorId)
    const references = await workspaceReferences(db, sectorId, undefined, threadKey)
    const after = await readGlobalContext(db, sectorId, undefined, false)
    const planAfter = await readSectorPlan(db, sectorId)
    await assertThreadFileContext(db, threadKey)
    if (before.version === after.version && planBefore?.approvedVersion === planAfter?.approvedVersion) return { references, contextVersion: before.version, planVersion: planBefore?.approvedVersion ?? null }
  }
  throw new WorkspaceError('conflict', 'Shared context changed repeatedly while preparing this round. Retry at the next boundary.')
}
