// Shared semantic attachment boundary. SQL, scope and durable receipts remain
// inside db/. HTTP and MCP must not choose different PDF processing behavior.
import type { Logger } from 'pino'
import type { ArchiveTarget } from './archive/targets.js'
import type { Scope } from './auth/types.js'
import { classifyUpload, SECTOR_DOCUMENT_MAX_BYTES, createFileProcessingJob, failFileProcessingJob, fileProcessingProgress, readFileProcessingJob, ingestSectorDocument, listSectorDocuments, countDocumentUnits, DbContractError, WorkspaceError, type OcrAdapter, type TransactableDb } from './db/index.js'
import { documentImageSelection } from './ocr.js'
import { createLogger, logOp } from './observability/logging.js'

export interface FileProcessorRunner { startFileProcessing(jobId: string, revision: number): Promise<void> }
export class FileIngestionUnavailable extends Error {
  readonly code = 'overload'
  constructor(message: string) { super(message) }
}
/** Pure input/capability preflight. It is safe before a mutation replay guard is
 * released; malformed/over-budget input never starts archive or provider work. */
export function isPdfDocumentUpload(filename: string, contentBase64: string): boolean {
  if (typeof filename !== 'string' || !filename.trim() || filename.length > 255) throw new DbContractError('filename must be1–255 characters')
  if (typeof contentBase64 !== 'string' || !contentBase64 || contentBase64.length > 12 * 1024 * 1024) throw new DbContractError('contentBase64 must be nonempty and within the upload transport budget')
  const bytes = Buffer.from(contentBase64, 'base64')
  if (!bytes.length || bytes.length > SECTOR_DOCUMENT_MAX_BYTES) throw new DbContractError('Original file must be1–8MiB.')
  return classifyUpload(filename, bytes).kind === 'pdf'
}
export async function attachSectorDocument(db: TransactableDb, input: { sectorId: string; filename: string; contentBase64: string; scope?: Scope; archive?: ArchiveTarget; fileProcessor?: FileProcessorRunner; ocr?: OcrAdapter; sourceThread?: string; logger?: Logger }) {
  const logger = input.logger ?? createLogger({ op: 'file.attach' })
  return logOp(logger, 'file.attach', async () => {
    if (!isPdfDocumentUpload(input.filename, input.contentBase64)) return ingestSectorDocument(db, { sectorId: input.sectorId, filename: input.filename, contentBase64: input.contentBase64, scope: input.scope, archive: input.archive, ocr: input.ocr })
    // A configured capability is required before publication. A worker process
    // can be offline while its gateway remains valid: that is honest queued work.
    if (typeof input.fileProcessor?.startFileProcessing !== 'function') throw new FileIngestionUnavailable('File processing runner unavailable.')
    if (!input.archive) throw new FileIngestionUnavailable('File archive unavailable.')
    const { document, job } = await createFileProcessingJob(db, { sectorId: input.sectorId, filename: input.filename, contentBase64: input.contentBase64, scope: input.scope, archive: input.archive, ...documentImageSelection(), ...(input.sourceThread ? { sourceThread: input.sourceThread } : {}) })
    if (job.state === 'queued') {
      try { await logOp(logger, 'file.attach.dispatch', () => input.fileProcessor!.startFileProcessing(job.jobId, job.revision), { jobId: job.jobId, revision: job.revision }) }
      catch {
        // The dispatch boundary logged/rethrew its coded failure. Retain the
        // original and surface durable failed/uncertain progress, never success.
        await failFileProcessingJob(db, job.jobId, 'dispatch_outcome_unknown', job.revision, input.scope)
      }
    }
    const current = await readFileProcessingJob(db, job.jobId, input.scope)
    const stored = (await listSectorDocuments(db, input.sectorId, input.scope, true)).find((entry) => entry.id === document.id)
    if (!stored) throw new WorkspaceError('not_found', 'The retained file is unavailable in this sector.')
    const unitCount = stored.status === 'indexed' ? await countDocumentUnits(db, stored.id) : 0
    return { ...stored, unitCount, processing: fileProcessingProgress(current) }
  }, { sectorId: input.sectorId })
}
