// Sector global context: versioned sections, proposals, decisions, file
// blocks, AI usage, compaction, and restore. Notified changes fan out to
// watchers via notifyWorkspace.
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Scope } from '../auth/keys.js'
import { appendEvent, listSessions, type Db } from './events.js'
import { listThreadHeaders } from './threads.js'
import { type TransactableDb } from './checkpoints.js'
import { WorkspaceError } from './errors.js'
import { publishOutboxFrame } from './outbox.js'
import { listDocumentUnits } from './document-units.js'
import { assertThreadFileContext, ContextFileBlocked, mergeFileRefs, threadFileRefs, validateFileRefs, insertContextFileBlock, listContextFileBlocks, readContextFileBlock, resetContextFileBlock, type ContextFileRef } from './context-files.js'

import {
  type ContextChange,
  ContextSections,
  type GlobalContext,
  type GlobalContextUsage,
  PartialContextSections,
  checked,
  globalContextUsageFrom,
  requireSector,
  requireThread,
  sessionKind,
  workspaceRow,
  workspaceTransaction,
  Id,
} from './workspace.js'
import { listSectorLibrary } from './workspace-library.js'

export interface ContextFileBlockView { fileId: string; filename: string; summary: string; addedVersion: number | null }
export function formatGlobalContext(sections: ContextSections, blocks?: ContextFileBlockView[]): string {
  const parts = (['scope', 'instructions', 'decisions', 'findings', 'questions'] as const).flatMap((key) => {
    const title = { scope: 'Scope', instructions: 'Instructions', decisions: 'Decisions', findings: 'Findings', questions: 'Open questions' }[key]
    return sections[key].trim() ? [`## ${title}\n\n${sections[key].trim()}`] : []
  })
  // Files are not a text section: ready block summaries render here,
  // ordered by added version then filename.
  const ready = (blocks ?? []).filter((block) => block.summary.trim()).sort((a, b) => (a.addedVersion ?? 0) - (b.addedVersion ?? 0) || a.filename.localeCompare(b.filename))
  if (ready.length) parts.push(`## Files\n\n${ready.map((block) => block.summary.trim()).join('\n\n')}`)
  return parts.join('\n\n')
}

export interface ChangeRow { id: string; sector_id: string; base_version: number; sections: unknown; source_thread: string; author: string; state: ContextChange['state']; version: number | null; at: Date | string; file_ref: ContextChange['fileRef']; source_refs?: ContextFileRef[] | null }
function changeView(row: ChangeRow): ContextChange {
  return { id: row.id, baseVersion: row.base_version, sections: checked(ContextSections, row.sections), sourceThread: row.source_thread, author: row.author, state: row.state, version: row.version, at: new Date(row.at).toISOString(), fileRef: row.file_ref, ...(row.source_refs ? { sourceRefs: row.source_refs } : {}) }
}
async function persistSectionFileRefs(db: Db, sectorId: string, current: ContextSections, proposed: ContextSections, refs: ContextFileRef[], previous?: Record<string, ContextFileRef[] | null>) {
  const sections = { ...(previous ?? {}) }
  for (const key of ['scope','instructions','decisions','findings','questions'] as const) if (current[key] !== proposed[key]) sections[key] = refs
  await db.query('UPDATE sector_workspace SET section_file_refs=$2::jsonb WHERE sector_id=$1', [sectorId, JSON.stringify(sections)])
}
export async function assertGlobalFileContext(db: Db, sectorId: string, scope?: Scope): Promise<void> {
  await requireSector(db, sectorId, scope)
  const row = await workspaceRow(db, sectorId)
  const sections = checked(ContextSections, row.sections)
  for (const key of ['scope','instructions','decisions','findings','questions'] as const) if (sections[key] && row.section_file_refs?.[key] === null) throw new ContextFileBlocked('Legacy shared context has unverified file provenance. Owner must review and republish its current content before agents can use it.')
  await validateFileRefs(db, sectorId, mergeFileRefs(...Object.values(row.section_file_refs ?? {})), scope)
}
export async function readGlobalContext(db: Db, sectorId: string, scope?: Scope, includeHistory = true): Promise<GlobalContext> {
  const sector = await requireSector(db, sectorId, scope)
  const row = await workspaceRow(db, sectorId)
  const sections = checked(ContextSections, row.sections)
  if (!sections.scope && row.context_version === 0) sections.scope = sector.topic || sector.name
  const changes = includeHistory ? await db.query<ChangeRow>('SELECT * FROM workspace_changes WHERE sector_id=$1 ORDER BY at DESC LIMIT 100', [sectorId]) : { rows: [] }
  const library = new Map((await listSectorLibrary(db, sectorId, scope)).map((file) => [file.id, file]))
  const blocks = await listContextFileBlocks(db, sectorId)
  const views = blocks
    .filter((block) => {
      if (block.state !== 'ready') return false
      const file = library.get(block.fileId)
      return !!file && !file.hidden && file.hash === block.hash
    })
    .sort((a, b) => (a.addedVersion ?? 0) - (b.addedVersion ?? 0) || a.filename.localeCompare(b.filename))
    .map((block) => ({ fileId: block.fileId, filename: block.filename, summary: block.summary, addedVersion: block.addedVersion }))
  return {
    sectorId, version: row.context_version, sections, markdown: formatGlobalContext(sections, views),
    researchSessionId: row.research_session_id, changes: changes.rows.map(changeView),
    files: blocks.map((block) => ({ fileId: block.fileId, filename: block.filename, state: block.state, tokens: block.tokens, summary: block.summary, error: block.error })),
    usage: { ...globalContextUsageFrom(sections, blocks), aiUsage: await readContextAiUsage(db, sectorId, scope) },
  }
}
export async function notifyWorkspace(db: Db, sectorId: string, type: 'context-version' | 'approval' | 'work-progress', payload: unknown): Promise<void> {
  checked(Id, sectorId)
  checked(z.enum(['context-version', 'approval', 'work-progress']), type)
  const sessions = await listSessions(db, undefined, sectorId)
  for (const session of sessions) {
    for (const thread of await listThreadHeaders(db, session.id)) await publishOutboxFrame(db, thread.key, type, payload)
  }
}
export async function proposeGlobalContext(db: TransactableDb, input: {
  sectorId: string; baseVersion: number; sections: PartialContextSections; sourceThread: string; owner: boolean; scope?: Scope; id?: string
  fileRef?: NonNullable<ContextChange['fileRef']>
  trustedResearch?: boolean
}): Promise<ContextChange> {
  const patch = checked(PartialContextSections, input.sections)
  checked(z.number().int().nonnegative(), input.baseVersion)
  checked(Id, input.sectorId)
  checked(Id, input.sourceThread)
  await requireSector(db, input.sectorId, input.scope)
  const identity = input.owner ? undefined : await requireThread(db, input.sourceThread, input.scope)
  if (identity && identity.session.sectorId !== input.sectorId) throw new WorkspaceError('permission_denied', 'Conversation belongs to another sector.')
  if (identity && !input.fileRef) await assertThreadFileContext(db, input.sourceThread, input.scope)
  return workspaceTransaction(db, input.sectorId, async (tx) => {
    await tx.query('INSERT INTO sector_workspace(sector_id) VALUES($1) ON CONFLICT DO NOTHING', [input.sectorId])
    const row = await workspaceRow(tx, input.sectorId)
    const id = checked(Id, input.id ?? randomUUID())
    const old = await tx.query<ChangeRow>('SELECT * FROM workspace_changes WHERE id=$1 AND sector_id=$2', [id, input.sectorId])
    if (old.rows[0]) return changeView(old.rows[0])
    if (row.context_version !== input.baseVersion) throw new WorkspaceError('conflict', 'Global context changed. Review the latest version.')
    const researchParent = input.trustedResearch === true && identity?.session.id === row.research_session_id && identity.thread.kind === 'session'
    // Every agent write needs owner approval: only the owner approves
    // directly. Research subagents land in parent-review first; the
    // parent commit forwards them as pending owner proposals.
    let state: ContextChange['state'] = input.owner ? 'approved' : input.trustedResearch && identity?.session.id === row.research_session_id && identity.thread.kind === 'subagent' ? 'parent-review' : 'pending'
    const currentSections = checked(ContextSections, row.sections)
    if (!currentSections.scope && row.context_version === 0) { const sector = await requireSector(tx, input.sectorId, input.scope); currentSections.scope = sector.topic || sector.name }
    // PATCH semantics: provided keys merge onto current; omitted keys
    // stay byte-identical; explicit '' clears. The stored proposal is
    // the merged whole, so approval applies a complete document.
    const sections: ContextSections = { ...currentSections }
    for (const [key, value] of Object.entries(patch)) if (value !== undefined) sections[key as keyof ContextSections] = value
    if (!input.fileRef && (['scope','instructions','decisions','findings','questions'] as const).every((key) => sections[key] === currentSections[key])) throw new WorkspaceError('validation_failed', 'Proposal changes no section.')
    const onlyFileInclusion = Boolean(input.fileRef) && (['scope','instructions','decisions','findings','questions'] as const).every((key) => sections[key] === currentSections[key])
    if (identity && input.fileRef && !onlyFileInclusion) await assertThreadFileContext(tx, input.sourceThread, input.scope)
    const sourceRefs = mergeFileRefs(input.owner || onlyFileInclusion ? [] : await threadFileRefs(tx, input.sourceThread, input.scope), input.fileRef ? [input.fileRef] : [])
    await validateFileRefs(tx, input.sectorId, sourceRefs, input.scope)
    if (sourceRefs.length) state = 'pending'
    const version = state === 'approved' ? row.context_version + 1 : null
    const author = input.owner ? 'owner' : researchParent ? 'research' : 'session'
    // Idempotent replay: same id replays the first row (appendEvent idiom).
    // Callers needing retry-safety must pass stable ids; without one a
    // retry is a new proposal by definition.
    const result = await tx.query<ChangeRow>(`INSERT INTO workspace_changes(id,sector_id,base_version,sections,source_thread,author,state,version,file_ref,source_refs)
      VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb,$10::jsonb) ON CONFLICT(id) DO NOTHING RETURNING *`, [id, input.sectorId, input.baseVersion, JSON.stringify(sections), input.sourceThread, author, state, version, JSON.stringify(input.fileRef ?? null), JSON.stringify(sourceRefs)])
    const inserted = result.rows[0]
    if (!inserted) {
      // Lost race after the pre-SELECT: another writer claimed this id.
      // Replay the winner when it belongs to this sector; a stray cross-
      // sector collision fails loudly instead of merging contexts.
      const winner = (await tx.query<ChangeRow>('SELECT * FROM workspace_changes WHERE id=$1', [id])).rows[0]
      if (!winner || winner.sector_id !== input.sectorId) throw new WorkspaceError('conflict', 'context change id collision')
      return changeView(winner)
    }
    if (state === 'approved') await persistSectionFileRefs(tx, input.sectorId, checked(ContextSections, row.sections), sections, sourceRefs, row.section_file_refs)
    if (state === 'approved') await tx.query('UPDATE sector_workspace SET context_version=$2, sections=$3::jsonb, protected_decisions=CASE WHEN $4 THEN $5 ELSE protected_decisions END WHERE sector_id=$1', [input.sectorId, version, JSON.stringify(sections), input.owner, sections.decisions])
    await appendEvent(tx, { idempotencyKey: `workspace-change:${id}`, partition: `sector:${input.sectorId}`, type: 'sector.context.changed', payload: { changeId: id, state, version, sourceThread: input.sourceThread } })
    await notifyWorkspace(tx, input.sectorId, state === 'approved' ? 'context-version' : 'approval', { sectorId: input.sectorId, id, state, version })
    return changeView(inserted)
  })
}
export async function decideContextChange(db: TransactableDb, input: { sectorId: string; id: string; approve: boolean; scope?: Scope }): Promise<ContextChange> {
  await requireSector(db, input.sectorId, input.scope)
  checked(Id, input.id)
  return workspaceTransaction(db, input.sectorId, async (tx) => {
    const found = await tx.query<ChangeRow>('SELECT * FROM workspace_changes WHERE id=$1 AND sector_id=$2', [input.id, input.sectorId])
    const proposal = found.rows[0]
    if (!proposal) throw new WorkspaceError('not_found', 'Proposal not found.')
    if (proposal.state === 'approved' || proposal.state === 'denied') {
      if ((proposal.state === 'approved') !== input.approve) throw new WorkspaceError('conflict', 'This proposal already has a different decision.')
      return changeView(proposal)
    }
    const current = await workspaceRow(tx, input.sectorId)
    if (input.approve && current.context_version !== proposal.base_version) throw new WorkspaceError('conflict', 'Proposal is stale. Submit it against the current context.')
    const state = input.approve ? 'approved' : 'denied'
    const version = input.approve ? current.context_version + 1 : null
    if (input.approve) await validateFileRefs(tx, input.sectorId, proposal.source_refs ?? (proposal.file_ref ? [proposal.file_ref] : []), input.scope)
    if (input.approve && proposal.source_refs === null && !proposal.file_ref) throw new ContextFileBlocked('Legacy proposal has no source receipt. Submit a fresh owner-reviewed proposal.')
    if (input.approve && proposal.file_ref) {
      // Agent file inclusion: summarize into a block, never inject raw
      // units. The version bumps when the summary lands, not now.
      const visibility = await tx.query<{ hidden: boolean }>('SELECT hidden FROM workspace_files WHERE sector_id=$1 AND file_id=$2', [input.sectorId, proposal.file_ref.fileId])
      if (visibility.rows[0]?.hidden) throw new WorkspaceError('conflict', 'Reveal the file before including it.')
      const file = (await listSectorLibrary(tx, input.sectorId, input.scope)).find((entry) => entry.id === proposal.file_ref?.fileId)
      if (!file || file.hash !== proposal.file_ref.hash) throw new WorkspaceError('conflict', 'The file version changed. Review a new proposal.')
      if (file.kind !== 'document' && !file.documentId) throw new WorkspaceError('conflict', 'Only processed documents can be included as shared context.')
      if (!proposal.file_ref.ords.length) throw new WorkspaceError('conflict', 'This file proposal names no readable units.')
      await insertContextFileBlock(tx, { sectorId: input.sectorId, fileId: file.id, documentId: file.kind === 'document' ? file.id : (file.documentId ?? file.id), hash: proposal.file_ref.hash, filename: proposal.file_ref.filename, requestedBy: `decision:${input.id}` })
      await resetContextFileBlock(tx, { sectorId: input.sectorId, fileId: file.id, hash: proposal.file_ref.hash, filename: proposal.file_ref.filename, documentId: file.kind === 'document' ? file.id : (file.documentId ?? file.id), requestedBy: `decision:${input.id}` })
      const updated = await tx.query<ChangeRow>(`UPDATE workspace_changes SET state='approved',version=NULL WHERE id=$1 RETURNING *`, [input.id])
      await appendEvent(tx, { idempotencyKey: `workspace-decision:${input.id}`, partition: `sector:${input.sectorId}`, type: 'sector.context.decided', payload: { changeId: input.id, state: 'approved', version: null } })
      await notifyWorkspace(tx, input.sectorId, 'context-version', { sectorId: input.sectorId, state: 'approved', version: null })
      const row = updated.rows[0]
      if (!row) throw new WorkspaceError('conflict', 'context decision missing')
      return changeView(row)
    }
    const previousSections = checked(ContextSections, current.sections)
    if (!previousSections.scope && current.context_version === 0) { const sector = await requireSector(tx, input.sectorId, input.scope); previousSections.scope = sector.topic || sector.name }
    if (input.approve) await persistSectionFileRefs(tx, input.sectorId, previousSections, checked(ContextSections, proposal.sections), proposal.source_refs ?? (proposal.file_ref ? [proposal.file_ref] : []), current.section_file_refs)
    if (input.approve) await tx.query('UPDATE sector_workspace SET context_version=$2,sections=$3::jsonb,protected_decisions=$4 WHERE sector_id=$1', [input.sectorId, version, JSON.stringify(proposal.sections), checked(ContextSections, proposal.sections).decisions])
    const updated = await tx.query<ChangeRow>('UPDATE workspace_changes SET state=$2,version=$3 WHERE id=$1 RETURNING *', [input.id, state, version])
    await appendEvent(tx, { idempotencyKey: `workspace-decision:${input.id}`, partition: `sector:${input.sectorId}`, type: 'sector.context.decided', payload: { changeId: input.id, state, version } })
    await notifyWorkspace(tx, input.sectorId, 'context-version', { sectorId: input.sectorId, state, version })
    const row = updated.rows[0]
    if (!row) throw new WorkspaceError('conflict', 'context decision missing')
    return changeView(row)
  })
}

export const ContextAiUsage = z.object({
  kind: z.enum(['file-summary', 'compaction']),
  fileId: z.string().min(1).optional(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  model: z.string().min(1),
}).strict()
export type ContextAiUsage = z.infer<typeof ContextAiUsage>
// Background AI spend lives on the event log, never on deletable rows:
// removing a file must not erase what its summary cost.
export async function recordContextAiUsage(db: Db, input: { sectorId: string; idempotencyKey: string; usage: ContextAiUsage; scope?: Scope }): Promise<void> {
  await requireSector(db, input.sectorId, input.scope)
  await appendEvent(db, { idempotencyKey: checked(Id, input.idempotencyKey), partition: `sector:${input.sectorId}`, type: 'sector.context.ai_usage', payload: checked(ContextAiUsage, input.usage) })
}
export async function readContextAiUsage(db: Db, sectorId: string, scope?: Scope): Promise<{ calls: number; inputTokens: number; outputTokens: number }> {
  await requireSector(db, sectorId, scope)
  const rows = await db.query<{ payload: unknown }>(`SELECT payload FROM events WHERE partition=$1 AND type='sector.context.ai_usage'`, [`sector:${sectorId}`])
  const total = { calls: 0, inputTokens: 0, outputTokens: 0 }
  for (const row of rows.rows) {
    const parsed = ContextAiUsage.safeParse(row.payload)
    if (!parsed.success) continue
    total.calls += 1
    total.inputTokens += parsed.data.inputTokens
    total.outputTokens += parsed.data.outputTokens
  }
  return total
}
export async function readGlobalContextUsage(db: Db, sectorId: string, scope?: Scope): Promise<GlobalContextUsage> {
  return (await readGlobalContext(db, sectorId, scope, false)).usage
}
export async function applyReadyContextFileBlock(db: TransactableDb, input: { sectorId: string; fileId: string; summary: string; tokens: number; inputTokens?: number; outputTokens?: number }): Promise<{ version: number } | null> {
  return workspaceTransaction(db, `context-block:${input.sectorId}:${input.fileId}`, async (tx) => {
    // Late completion after an owner removal: the row is gone, stay gone.
    const block = await readContextFileBlock(tx, input.sectorId, input.fileId)
    if (!block) return null
    // The first block may land before any text edit creates the row.
    await tx.query('INSERT INTO sector_workspace(sector_id) VALUES($1) ON CONFLICT DO NOTHING', [input.sectorId])
    const row = await workspaceRow(tx, input.sectorId)
    const version = row.context_version + 1
    await tx.query(`UPDATE context_file_blocks SET state='ready',summary=$3,tokens=$4,added_version=$5,error=NULL,input_tokens=$6,output_tokens=$7,updated_at=now()
      WHERE sector_id=$1 AND file_id=$2`, [input.sectorId, input.fileId, input.summary, input.tokens, version, input.inputTokens ?? 0, input.outputTokens ?? 0])
    const id = randomUUID()
    await tx.query(`INSERT INTO workspace_changes(id,sector_id,base_version,sections,source_thread,author,state,version,file_ref,source_refs)
      VALUES($1,$2,$3,$4::jsonb,'owner','owner','approved',$3,$5::jsonb,'[]'::jsonb)`,
      [id, input.sectorId, version, JSON.stringify(checked(ContextSections, row.sections)), JSON.stringify({ fileId: input.fileId, hash: block.hash, filename: block.filename, ords: [] })])
    await tx.query('UPDATE sector_workspace SET context_version=$2 WHERE sector_id=$1', [input.sectorId, version])
    await tx.query('INSERT INTO workspace_files(sector_id,file_id,included,approval_id) VALUES($1,$2,true,$3) ON CONFLICT(sector_id,file_id) DO UPDATE SET included=true,approval_id=$3', [input.sectorId, input.fileId, id])
    await appendEvent(tx, { idempotencyKey: `context-block-ready:${input.sectorId}:${input.fileId}:${version}`, partition: `sector:${input.sectorId}`, type: 'sector.context.changed', payload: { changeId: id, state: 'approved', version, fileId: input.fileId } })
    await notifyWorkspace(tx, input.sectorId, 'context-version', { sectorId: input.sectorId, id, state: 'approved', version })
    return { version }
  })
}
export async function removeContextFileBlock(db: TransactableDb, input: { sectorId: string; fileId: string; scope?: Scope }): Promise<{ version: number; filename: string; hash: string; state: string }> {
  await requireSector(db, input.sectorId, input.scope)
  return workspaceTransaction(db, `context-block:${input.sectorId}:${input.fileId}`, async (tx) => {
    const block = await readContextFileBlock(tx, input.sectorId, input.fileId)
    if (!block) throw new WorkspaceError('not_found', 'File is not in the global context.')
    await tx.query('DELETE FROM context_file_blocks WHERE sector_id=$1 AND file_id=$2', [input.sectorId, input.fileId])
    await tx.query('UPDATE workspace_files SET included=false,approval_id=NULL WHERE sector_id=$1 AND file_id=$2', [input.sectorId, input.fileId])
    await tx.query('INSERT INTO sector_workspace(sector_id) VALUES($1) ON CONFLICT DO NOTHING', [input.sectorId])
    const row = await workspaceRow(tx, input.sectorId)
    const stripped: Record<string, ContextFileRef[] | null> = {}
    for (const [key, refs] of Object.entries(row.section_file_refs ?? {})) stripped[key] = refs === null ? null : refs.filter((ref) => ref.fileId !== input.fileId)
    const version = row.context_version + 1
    const id = randomUUID()
    await tx.query('UPDATE sector_workspace SET context_version=$2,section_file_refs=$3::jsonb WHERE sector_id=$1', [input.sectorId, version, JSON.stringify(stripped)])
    await tx.query(`INSERT INTO workspace_changes(id,sector_id,base_version,sections,source_thread,author,state,version,file_ref,source_refs)
      VALUES($1,$2,$3,$4::jsonb,'owner','owner','approved',$3,$5::jsonb,'[]'::jsonb)`,
      [id, input.sectorId, version, JSON.stringify(checked(ContextSections, row.sections)), JSON.stringify({ fileId: input.fileId, hash: block.hash, filename: block.filename, ords: [] })])
    await appendEvent(tx, { idempotencyKey: `context-block-removed:${input.sectorId}:${input.fileId}:${version}`, partition: `sector:${input.sectorId}`, type: 'sector.context.changed', payload: { changeId: id, state: 'approved', version, fileId: input.fileId, removed: true } })
    await notifyWorkspace(tx, input.sectorId, 'context-version', { sectorId: input.sectorId, id, state: 'approved', version })
    return { version, filename: block.filename, hash: block.hash, state: block.state }
  })
}
export async function applySystemCompaction(db: TransactableDb, input: {
  sectorId: string; baseVersion: number; reason: 'auto' | 'manual'
  baseScope: string; baseInstructions: string; baseBlocks: Array<{ fileId: string; hash: string; state: string }>
  sections: { decisions: string; findings: string; questions: string }
  inputTokens?: number; outputTokens?: number
}): Promise<{ version: number }> {
  return workspaceTransaction(db, `context-compaction:${input.sectorId}`, async (tx) => {
    const row = await workspaceRow(tx, input.sectorId)
    const current = checked(ContextSections, row.sections)
    if (row.context_version !== input.baseVersion) throw new WorkspaceError('conflict', 'Global context changed during compaction.')
    if (current.scope !== input.baseScope || current.instructions !== input.baseInstructions) {
      throw new WorkspaceError('conflict', 'Compaction must leave scope and instructions byte-identical.')
    }
    const blocks = await listContextFileBlocks(tx, input.sectorId)
    const canon = (entries: Array<{ fileId: string; hash: string; state: string }>) => entries.map((entry) => `${entry.fileId}:${entry.hash}:${entry.state}`).sort().join('\n')
    if (canon(blocks) !== canon(input.baseBlocks)) throw new WorkspaceError('conflict', 'Context files changed during compaction.')
    const sections: ContextSections = { scope: current.scope, instructions: current.instructions, ...input.sections }
    const version = row.context_version + 1
    const id = randomUUID()
    await tx.query('UPDATE sector_workspace SET context_version=$2,sections=$3::jsonb WHERE sector_id=$1', [input.sectorId, version, JSON.stringify(sections)])
    await tx.query(`INSERT INTO workspace_changes(id,sector_id,base_version,sections,source_thread,author,state,version,file_ref,source_refs,input_tokens,output_tokens)
      VALUES($1,$2,$3,$4::jsonb,$5,'system:compaction','approved',$3,NULL,'[]'::jsonb,$6,$7)`,
      [id, input.sectorId, version, JSON.stringify(sections), `compaction:${input.reason}`, input.inputTokens ?? 0, input.outputTokens ?? 0])
    await appendEvent(tx, { idempotencyKey: `context-compaction:${input.sectorId}:${version}`, partition: `sector:${input.sectorId}`, type: 'sector.context.changed', payload: { changeId: id, state: 'approved', version, reason: input.reason } })
    await notifyWorkspace(tx, input.sectorId, 'context-version', { sectorId: input.sectorId, id, state: 'approved', version })
    return { version }
  })
}
export async function restoreGlobalContextVersion(db: TransactableDb, input: { sectorId: string; version: number; scope?: Scope }): Promise<{ version: number; sections: ContextSections }> {
  await requireSector(db, input.sectorId, input.scope)
  return workspaceTransaction(db, `context-restore:${input.sectorId}`, async (tx) => {
    const found = await tx.query<ChangeRow>(`SELECT * FROM workspace_changes WHERE sector_id=$1 AND version=$2 AND state='approved' ORDER BY at DESC LIMIT 1`, [input.sectorId, input.version])
    const source = found.rows[0]
    if (!source) throw new WorkspaceError('not_found', 'Unknown context version.')
    await tx.query('INSERT INTO sector_workspace(sector_id) VALUES($1) ON CONFLICT DO NOTHING', [input.sectorId])
    const row = await workspaceRow(tx, input.sectorId)
    // Text sections only: file blocks keep their current state, and the
    // current file refs stay as they are (a removed file must not regain
    // provenance through a restore).
    const sections = checked(ContextSections, source.sections)
    const version = row.context_version + 1
    const id = randomUUID()
    await tx.query('UPDATE sector_workspace SET context_version=$2,sections=$3::jsonb WHERE sector_id=$1', [input.sectorId, version, JSON.stringify(sections)])
    await tx.query(`INSERT INTO workspace_changes(id,sector_id,base_version,sections,source_thread,author,state,version,file_ref,source_refs)
      VALUES($1,$2,$3,$4::jsonb,'owner','owner','approved',$3,NULL,'[]'::jsonb)`,
      [id, input.sectorId, version, JSON.stringify(sections)])
    await appendEvent(tx, { idempotencyKey: `context-restore:${input.sectorId}:${version}`, partition: `sector:${input.sectorId}`, type: 'sector.context.changed', payload: { changeId: id, state: 'approved', version, restoredFrom: input.version } })
    await notifyWorkspace(tx, input.sectorId, 'context-version', { sectorId: input.sectorId, id, state: 'approved', version })
    return { version, sections }
  })
}

export async function setFileVisibility(db: TransactableDb, sectorId: string, fileId: string, hidden: boolean, scope?: Scope) {
  checked(Id, fileId); checked(z.boolean(), hidden)
  const file = (await listSectorLibrary(db, sectorId, scope)).find((item) => item.id === fileId)
  if (!file) throw new WorkspaceError('not_found', 'File not found.')
  return workspaceTransaction(db, sectorId, async (tx) => {
    await tx.query('INSERT INTO workspace_files(sector_id,file_id,hidden) VALUES($1,$2,$3) ON CONFLICT(sector_id,file_id) DO UPDATE SET hidden=$3', [sectorId, fileId, hidden])
    await notifyWorkspace(tx, sectorId, 'context-version', { fileId, hidden })
    return { ...file, hidden, included: file.included && !hidden }
  })
}

export async function proposeFileContext(db: TransactableDb, input: { sectorId: string; fileId: string; baseVersion: number; sourceThread: string; scope?: Scope; ords?: number[] }) {
  checked(Id, input.sectorId)
  checked(Id, input.fileId)
  checked(z.number().int().nonnegative(), input.baseVersion)
  checked(Id, input.sourceThread)
  const file = (await listSectorLibrary(db, input.sectorId, input.scope)).find((item) => item.id === input.fileId)
  if (!file || file.hidden || file.status !== 'indexed') throw new WorkspaceError('conflict', 'Only visible indexed files can be included.')
  const documentId = file.documentId ?? (file.kind === 'document' ? file.id : undefined)
  if (!documentId) throw new WorkspaceError('conflict', 'This file needs document indexing before inclusion.')
  const all = await listDocumentUnits(db, documentId)
  const ords = input.ords ?? all.map((unit) => unit.ord)
  checked(z.array(z.number().int().nonnegative()).min(1), ords)
  if (ords.some((ord) => !all.some((unit) => unit.ord === ord))) throw new WorkspaceError('validation_failed', 'Unknown file unit.')
  const current = await readGlobalContext(db, input.sectorId, input.scope)
  return proposeGlobalContext(db, { ...input, owner: false, sections: current.sections, fileRef: { fileId: file.id, hash: file.hash, filename: file.filename, ords } })
}

export async function previewContextChange(db: Db, sectorId: string, id: string, scope?: Scope) {
  await requireSector(db, sectorId, scope)
  checked(Id, id)
  const result = await db.query<ChangeRow>('SELECT * FROM workspace_changes WHERE sector_id=$1 AND id=$2', [sectorId, id])
  const row = result.rows[0]
  if (!row) throw new WorkspaceError('not_found', 'Proposal not found.')
  const change = changeView(row)
  const sources = []
  for (const ref of mergeFileRefs(change.sourceRefs, change.fileRef ? [change.fileRef] : [])) {
    await validateFileRefs(db, sectorId, [ref], scope)
    const file = (await listSectorLibrary(db, sectorId, scope)).find((entry) => entry.id === ref.fileId)!
    const units = (await listDocumentUnits(db, file.documentId ?? file.id)).filter((unit) => ref.ords.includes(unit.ord))
    sources.push({ ref, units: units.map((unit) => ({ ord: unit.ord, text: unit.text, uncertain: unit.uncertain })) })
  }
  return { change, units: sources.find((source) => source.ref.fileId === change.fileRef?.fileId)?.units ?? [], sources }

}

export async function commitChildContext(db: TransactableDb, threadKey: string, id: string, scope?: Scope) {
  checked(Id, threadKey)
  checked(Id, id)
  const { thread, session } = await requireThread(db, threadKey, scope)
  if (!session.sectorId || thread.kind !== 'session' || await sessionKind(db, session.id) !== 'research') throw new WorkspaceError('permission_denied', 'Only the research parent can commit a child update.')
  // Retry-safe: a replayed commit returns the first result instead of
  // re-entering the parent-review guard on the now-approved child row.
  const committed = await db.query<ChangeRow>(`SELECT * FROM workspace_changes WHERE id=$1 AND sector_id=$2`, [`parent-commit:${id}`, session.sectorId])
  if (committed.rows[0]) return changeView(committed.rows[0])
  const preview = await previewContextChange(db, session.sectorId, id, scope)
  if (preview.change.state !== 'parent-review' || preview.change.fileRef || preview.change.sourceRefs?.length) throw new WorkspaceError('permission_denied', 'This update requires owner approval.')
  // The parent commit forwards the child update as a NEW pending owner
  // proposal. It never approves: the child row stays parent-review until
  // the owner decides the forwarded proposal.
  return proposeGlobalContext(db, { sectorId: session.sectorId, baseVersion: preview.change.baseVersion, sections: preview.change.sections, sourceThread: threadKey, owner: false, trustedResearch: true, scope, id: `parent-commit:${id}` })
}
