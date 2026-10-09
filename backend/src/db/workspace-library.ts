// Sector file library: reads, visibility, and artifact indexing.
import { serveArtifact } from '../artifacts/pipeline.js'
import type { ArchiveTarget } from '../archive/targets.js'
import type { Scope } from '../auth/types.js'
import { appendEvent, findEventByKey, type Db } from './events.js'
import { listArtifactsForSessions, resolveArtifactScope } from './event-artifacts.js'
import { listSessions } from './sessions.js'
import { checked, Id, WorkspaceError } from './errors.js'
import { assertFileVisible, listSectorDocuments, readOriginalSectorDocument } from './sector-documents.js'
import { listSectorFileProcessing, type FileProcessingProgress } from './file-jobs.js'
import { createLogger, logOp } from '../observability/logging.js'

import { requireSector } from './workspace.js'

const workspaceLogger = createLogger({ op: 'workspace' })

export interface LibraryFile {
  id: string; filename: string; status: string; source: string; hash: string
  hidden: boolean; included: boolean; kind: 'document' | 'artifact'; sessionId?: string; documentId?: string
  processing?: FileProcessingProgress
  authorThread?: string
}
export async function readSectorLibraryFile(db: Db, sectorId: string, fileId: string, archive: ArchiveTarget, scope?: Scope) {
  return logOp(workspaceLogger, 'workspace.file.read', () => readLibraryFile(db, sectorId, fileId, archive, scope), { sectorId, fileId })
}
async function readLibraryFile(db: Db, sectorId: string, fileId: string, archive: ArchiveTarget, scope?: Scope) {
  checked(Id, fileId)
  const file = (await listSectorLibrary(db, sectorId, scope)).find((entry) => entry.id === fileId)
  if (!file) throw new WorkspaceError('not_found', 'File not found in this sector.')
  await assertFileVisible(db, sectorId, fileId)
  if (file.kind === 'document') return readOriginalSectorDocument(db, sectorId, fileId, archive, scope)
  if (!file.sessionId) throw new WorkspaceError('conflict', 'File origin is unavailable.')
  const origin = await resolveArtifactScope(db, file.sessionId, fileId)
  if (!origin) throw new WorkspaceError('not_found', 'File origin is unavailable.')
  const result = await serveArtifact(archive, origin.scope, fileId, {
    log: (fields) => workspaceLogger.info(fields),
    findEvent: (key) => findEventByKey(db, key),
    record: async (event) => { await appendEvent(db, event) },
  })
  return { filename: file.filename, mediaType: 'text/plain', text: result.body, contentBase64: Buffer.from(result.body, 'utf8').toString('base64'), originalAvailable: true }
}
export async function listSectorLibrary(db: Db, sectorId: string, scope?: Scope): Promise<LibraryFile[]> {
  await requireSector(db, sectorId, scope)
  const flags = await db.query<{ file_id: string; hidden: boolean; included: boolean; document_id: string | null }>('SELECT * FROM workspace_files WHERE sector_id=$1', [sectorId])
  const files = new Map<string, LibraryFile>()
  const arrivedAt = new Map<string, number>()
  for (const doc of await listSectorDocuments(db, sectorId, scope, true)) {
    files.set(doc.id, { id: doc.id, filename: doc.filename, status: doc.status, hash: doc.sha256, source: 'Uploaded', hidden: false, included: false, kind: 'document', ...(doc.authorThread ? { authorThread: doc.authorThread } : {}) })
    arrivedAt.set(doc.id, new Date(doc.createdAt).getTime())
  }
  const sessions = await listSessions(db, scope, sectorId)
  const batched = await listArtifactsForSessions(db, sessions.map((session) => session.id))
  for (const session of sessions) {
    for (const artifact of batched.summaries.get(session.id) ?? []) {
      if (files.has(artifact.artifactId)) continue
      files.set(artifact.artifactId, { id: artifact.artifactId, filename: artifact.name ?? 'Untitled file', status: artifact.indexed ? 'indexed' : 'processing', hash: artifact.sha256 ?? '', source: artifact.producedBy ?? session.title, hidden: false, included: false, kind: 'artifact', sessionId: session.id })
      const at = batched.arrivedAt.get(artifact.artifactId)
      if (at !== undefined) arrivedAt.set(artifact.artifactId, at)
    }
  }
  for (const flag of flags.rows) {
    const file = files.get(flag.file_id)
    if (file) {
      file.hidden = flag.hidden; file.included = flag.included && !flag.hidden
      if (flag.document_id) { file.documentId = flag.document_id; const indexed = files.get(flag.document_id); if (indexed) { file.hash = indexed.hash; if (indexed.authorThread) file.authorThread = indexed.authorThread } files.delete(flag.document_id) }
    }
  }
  for (const file of files.values()) if (file.kind === 'artifact' && !file.documentId) file.status = 'processing'
  const processing = await listSectorFileProcessing(db, sectorId, scope)
  for (const file of files.values()) if (processing[file.documentId ?? file.id]) file.processing = processing[file.documentId ?? file.id]
  return [...files.values()].sort((a, b) => (arrivedAt.get(b.id) ?? 0) - (arrivedAt.get(a.id) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

