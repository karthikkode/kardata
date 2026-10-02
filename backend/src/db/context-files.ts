import { createHash } from 'node:crypto'
// Server-derived provenance. Agent text and arguments never grant inclusion.
import { z } from 'zod'
import type { Scope } from '../auth/keys.js'
import { appendEvent, listArtifacts, type Db } from './events.js'
import type { TransactableDb } from './checkpoints.js'
import { WorkspaceError } from './errors.js'
import { listDocumentUnitOrdinals } from './document-units.js'
import { listSectorLibrary, requireThread, workspaceTransaction } from './workspace.js'

export const ContextFileRef = z.object({ readSectorId: z.string().min(1).optional(), fileId: z.string().min(1), hash: z.string().min(1), filename: z.string().min(1), ords: z.array(z.number().int().nonnegative()) }).strict()
export type ContextFileRef = z.infer<typeof ContextFileRef>
export class ContextFileBlocked extends WorkspaceError {
  constructor(message = 'Context depends on a hidden, changed, or unverified file. Reveal the exact source version or safely rebuild context before resuming.') { super('conflict', message) }
}
export function mergeFileRefs(...groups: Array<ContextFileRef[] | null | undefined>): ContextFileRef[] {
  const merged = new Map<string, ContextFileRef>()
  for (const group of groups) for (const ref of group ?? []) {
    const id = `${ref.readSectorId ?? ""}:${ref.fileId}:${ref.hash}`
    const prior = merged.get(id)
    merged.set(id, { ...ref, ords: [...new Set([...(prior?.ords ?? []), ...ref.ords])].sort((a, b) => a - b) })
  }
  return [...merged.values()].sort((a,b) => a.fileId.localeCompare(b.fileId) || a.hash.localeCompare(b.hash))
}
export async function validateFileRefs(db: Db, sectorId: string, refs: ContextFileRef[], scope?: Scope): Promise<void> {
  if (!refs.length) return
  const files = new Map((await listSectorLibrary(db, sectorId, scope)).map((file) => [file.id, file]))
  for (const ref of refs) {
    if (ref.readSectorId && ref.readSectorId !== sectorId) throw new ContextFileBlocked('The file dependency belongs to another read scope. Import and review its target-library version explicitly.')
    const file = files.get(ref.fileId)
    if (!file || file.hidden || file.hash !== ref.hash || file.status !== 'indexed') throw new ContextFileBlocked(`Source ${ref.filename} is hidden, changed, or unavailable. Reveal its exact version or start a clean conversation; stored history is retained.`)
    const units = new Set(await listDocumentUnitOrdinals(db, file.documentId ?? file.id))
    if (ref.ords.some((ord) => !units.has(ord))) throw new ContextFileBlocked('Context source units changed. Review the exact file version before resuming.')
  }
}
export async function threadFileRefs(db: Db, threadKey: string, scope?: Scope): Promise<ContextFileRef[]> {
  const { thread, session } = await requireThread(db, threadKey, scope)
  const { rows } = await db.query<{ file_exposures: ContextFileRef[]; file_inheritance_set: boolean }>('SELECT file_exposures,file_inheritance_set FROM thread_context WHERE thread_key=$1', [threadKey])
  const own = rows[0]
  if (thread.kind !== 'subagent' || own?.file_inheritance_set) return mergeFileRefs(own?.file_exposures)
  const parent = await db.query<{ file_exposures: ContextFileRef[] }>('SELECT file_exposures FROM thread_context WHERE thread_key=$1', [session.id])
  return mergeFileRefs(own?.file_exposures, parent.rows[0]?.file_exposures)

}
export async function recordThreadFileExposure(db: TransactableDb, threadKey: string, sectorId: string, fileId: string, ords?: number[], scope?: Scope, expectedHash?: string): Promise<ContextFileRef> {
  const actor = await requireThread(db, threadKey, scope)
  if (actor.session.sectorId && actor.session.sectorId !== sectorId) throw new WorkspaceError('permission_denied', 'File exposure belongs to another sector.')
  return workspaceTransaction(db, sectorId, async (tx) => {
    const file = (await listSectorLibrary(tx, sectorId, scope)).find((entry) => entry.id === fileId || entry.documentId === fileId)
    if (!file || file.hidden || file.status !== 'indexed') throw new ContextFileBlocked('File is hidden, unavailable, or unindexed. No content was exposed.')
    if (expectedHash !== undefined && file.hash !== expectedHash) {
      // Indexed artifacts use the extraction-version hash in the library, while
      // serveArtifact verifies their immutable archive-body hash.
      const artifact = file.kind === 'artifact' && file.sessionId ? (await listArtifacts(tx, file.sessionId, true)).find((entry) => entry.artifactId === file.id) : undefined
      if (!artifact || artifact.sha256 !== expectedHash) throw new ContextFileBlocked('The source version changed before its content was exposed.')
    }
    const all = await listDocumentUnitOrdinals(tx, file.documentId ?? file.id)
    const ref = { readSectorId: sectorId, fileId: file.id, hash: file.hash, filename: file.filename, ords: ords ?? all }
    if (ref.ords.some((ord) => !all.includes(ord))) throw new ContextFileBlocked('The returned file units changed before exposure.')
    await tx.query('INSERT INTO thread_context(thread_key) VALUES($1) ON CONFLICT DO NOTHING', [threadKey])
    const prior = await tx.query<{ file_exposures: ContextFileRef[] }>('SELECT file_exposures FROM thread_context WHERE thread_key=$1 FOR UPDATE', [threadKey])
    const refs = mergeFileRefs(prior.rows[0]?.file_exposures, await threadFileRefs(tx, threadKey, scope), [ref])
    await tx.query('UPDATE thread_context SET file_exposures=$2::jsonb,file_inheritance_set=true WHERE thread_key=$1', [threadKey, JSON.stringify(refs)])
    await appendEvent(tx, { idempotencyKey: `file-exposure:${createHash('sha256').update(JSON.stringify([threadKey, ref])).digest('hex')}`, partition: threadKey, type: 't.file.exposed', payload: { threadKey, ref } })
    return ref
  })
}
export async function assertThreadFileContext(db: Db, threadKey: string, scope?: Scope): Promise<void> {
  const { session } = await requireThread(db, threadKey, scope)
  const refs = await threadFileRefs(db, threadKey, scope)
  if (session.sectorId) await validateFileRefs(db, session.sectorId, refs, scope)
  else for (const ref of refs) {
    if (!ref.readSectorId) throw new ContextFileBlocked('This file dependency has no verified read scope. Owner must safely rebuild context before resuming.')
    await validateFileRefs(db, ref.readSectorId, [ref], scope)
  }

  const { rows } = await db.query<{ summary: string; summary_file_refs: ContextFileRef[] | null; working_messages: unknown; working_file_refs: ContextFileRef[] | null; history_provenance_known: boolean }>('SELECT summary,summary_file_refs,working_messages,working_file_refs,history_provenance_known FROM thread_context WHERE thread_key=$1', [threadKey])
  const row = rows[0]
  if (row?.history_provenance_known === false || row?.summary && row.summary_file_refs === null || row?.working_messages && row.working_file_refs === null) throw new ContextFileBlocked('This legacy context has unverified file provenance. Keep its history and start a clean conversation, or safely rebuild its context before resuming.')
  if (session.sectorId) await validateFileRefs(db, session.sectorId, mergeFileRefs(row?.summary_file_refs, row?.working_file_refs), scope)
}

export async function inheritThreadFileRefs(db: TransactableDb, threadKey: string, scope?: Scope): Promise<void> {
  await workspaceTransaction(db, threadKey, async (tx) => {
    const refs = await threadFileRefs(tx, threadKey, scope)
    await tx.query('UPDATE thread_context SET file_exposures=$2::jsonb,file_inheritance_set=true WHERE thread_key=$1 AND NOT file_inheritance_set', [threadKey, JSON.stringify(refs)])
  })
}

export async function agentHistoryBoundary(db: Db, threadKey: string): Promise<{ coveredSeq: number; outboxAfter: number }> {
  const { rows } = await db.query<{ covered_seq: number; rebuilt_outbox_floor: number; rebuilt_history: boolean }>('SELECT covered_seq,rebuilt_outbox_floor,rebuilt_history FROM thread_context WHERE thread_key=$1', [threadKey])
  return rows[0]?.rebuilt_history ? { coveredSeq: Number(rows[0].covered_seq), outboxAfter: Number(rows[0].rebuilt_outbox_floor) } : { coveredSeq: 0, outboxAfter: 0 }
}
