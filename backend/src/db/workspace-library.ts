// Sector file library: reads, visibility, and artifact indexing.
import { serveArtifact } from '../artifacts/pipeline.js'
import type { ArchiveTarget } from '../archive/targets.js'
import type { Scope } from '../auth/keys.js'
import { appendEvent, findEventByKey, listArtifacts, listSessions, resolveArtifactScope, type Db } from './events.js'
import { DbContractError, WorkspaceError } from './errors.js'
import { ingestSectorDocument, listSectorDocuments, readOriginalSectorDocument } from './sector-documents.js'
import { listSectorFileProcessing, type FileProcessingProgress } from './file-jobs.js'
import { createLogger, logOp } from '../observability/logging.js'

import {
  checked,
  requireSector,
  Id,
} from './workspace.js'

const workspaceLogger = createLogger({ op: 'workspace' })

export interface LibraryFile {
  id: string; filename: string; status: string; source: string; hash: string
  hidden: boolean; included: boolean; kind: 'document' | 'artifact'; sessionId?: string; documentId?: string
  processing?: FileProcessingProgress
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
    files.set(doc.id, { id: doc.id, filename: doc.filename, status: doc.status, hash: doc.sha256, source: 'Uploaded', hidden: false, included: false, kind: 'document' })
    arrivedAt.set(doc.id, new Date(doc.createdAt).getTime())
  }
  const sessions = await listSessions(db, scope, sectorId)
  for (const session of sessions) {
    for (const artifact of await listArtifacts(db, session.id, true)) {
      if (!files.has(artifact.artifactId)) files.set(artifact.artifactId, { id: artifact.artifactId, filename: artifact.name ?? 'Untitled file', status: artifact.indexed ? 'indexed' : 'processing', hash: artifact.sha256 ?? '', source: artifact.producedBy ?? session.title, hidden: false, included: false, kind: 'artifact', sessionId: session.id })
    }
  }
  const artifactIds = [...files.values()].filter((file) => file.kind === 'artifact').map((file) => file.id)
  if (artifactIds.length) {
    const arrivals = await db.query<{ id: string; created_at: Date }>(`SELECT payload->>'artifactId' AS id,min(at) AS created_at
      FROM events WHERE partition=ANY($1::text[]) AND type=ANY($2::text[]) AND payload->>'artifactId'=ANY($3::text[])
      GROUP BY payload->>'artifactId'`, [sessions.map((session) => `artifact:session:${session.id}`), ['t.artifact.stored', 't.artifact.referenced', 't.artifact.indexed'], artifactIds])
    for (const arrival of arrivals.rows) arrivedAt.set(arrival.id, new Date(arrival.created_at).getTime())
  }
  for (const flag of flags.rows) {
    const file = files.get(flag.file_id)
    if (file) {
      file.hidden = flag.hidden; file.included = flag.included && !flag.hidden
      if (flag.document_id) { file.documentId = flag.document_id; const indexed = files.get(flag.document_id); if (indexed) file.hash = indexed.hash; files.delete(flag.document_id) }
    }
  }
  for (const file of files.values()) if (file.kind === 'artifact' && !file.documentId) file.status = 'processing'
  const processing = await listSectorFileProcessing(db, sectorId, scope)
  for (const file of files.values()) if (processing[file.documentId ?? file.id]) file.processing = processing[file.documentId ?? file.id]
  return [...files.values()].sort((a, b) => (arrivedAt.get(b.id) ?? 0) - (arrivedAt.get(a.id) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export async function assertFileVisible(db: Db, sectorId: string, fileId: string): Promise<void> {
  checked(Id, sectorId); checked(Id, fileId)
  const { rows } = await db.query<{ hidden: boolean }>('SELECT hidden FROM workspace_files WHERE sector_id=$1 AND (file_id=$2 OR document_id=$2)', [sectorId, fileId])
  if (rows.some((row) => row.hidden)) throw new WorkspaceError('permission_denied', 'This file is hidden from agents.')
}
export async function hiddenFileIds(db: Db, sectorId: string): Promise<Set<string>> {
  checked(Id, sectorId)
  const { rows } = await db.query<{ file_id: string; document_id: string | null }>('SELECT file_id,document_id FROM workspace_files WHERE sector_id=$1 AND hidden', [sectorId])
  return new Set(rows.flatMap((row) => row.document_id ? [row.file_id, row.document_id] : [row.file_id]))
}

export async function indexSectorArtifact(db: Db, sectorId: string, artifactId: string, name: string, body: string, scope?: Scope): Promise<void> {
  checked(Id, sectorId)
  checked(Id, artifactId)
  if (typeof name !== 'string' || !name) throw new DbContractError('name must be a non-empty string')
  if (typeof body !== 'string' || !body) throw new DbContractError('body must be a non-empty string')
  await requireSector(db, sectorId, scope)
  const filename = /\.(md|txt|csv|json)$/i.test(name) ? name : `${name}.txt`
  const doc = await ingestSectorDocument(db, { sectorId, filename, contentBase64: Buffer.from(body).toString('base64'), source: 'artifact', scope })
  await db.query('INSERT INTO workspace_files(sector_id,file_id,document_id) VALUES($1,$2,$3) ON CONFLICT(sector_id,file_id) DO UPDATE SET document_id=$3', [sectorId, artifactId, doc.id])
}
