// Sector file API: attached documents, library files, units, processing.
import { z } from 'zod'
import { request, requestValidated, sectorPath, type StagingConfig } from './client'

export interface SectorDocumentSummary {
  id: string
  sectorId: string
  filename: string
  mediaType: string
  chars: number
  sha256: string
  createdAt: string
  status: 'indexed' | 'needs-ocr'
}

export interface AttachedDocument extends SectorDocumentSummary {
  status: 'indexed' | 'needs-ocr'
  detail?: string
  unitCount?: number
}

/** Attach one context document (base64 bytes) to a sector. The response
 * carries extraction status: indexed with a unit count, or needs-ocr. */
export function attachSectorDocument(
  config: StagingConfig,
  sectorId: string,
  input: { filename: string; contentBase64: string },
): Promise<AttachedDocument> {
  return request<AttachedDocument>(
    config,
    'POST',
    `/v1/sectors/${encodeURIComponent(sectorId)}/documents`,
    input,
  )
}

export function listSectorDocuments(config: StagingConfig, sectorId: string): Promise<SectorDocumentSummary[]> {
  return request<SectorDocumentSummary[]>(config, 'GET', `/v1/sectors/${encodeURIComponent(sectorId)}/documents`)
}

export const FileProcessingProgress = z.object({ jobId: z.string(), state: z.enum(['queued','processing','paused','failed','uncertain','complete']), revision: z.number().int().nonnegative(), totalImages: z.number().int().nonnegative().nullable(), completedImages: z.number().int().nonnegative(), failedImages: z.number().int().nonnegative(), uncertainImages: z.number().int().nonnegative(), errorCode: z.string().nullable(), retryRequiresApproval: z.boolean() })
export type FileProcessingProgress = z.infer<typeof FileProcessingProgress>
const File = z.object({ id: z.string(), filename: z.string(), status: z.string(), source: z.string(), hash: z.string(), hidden: z.boolean(), included: z.boolean(), kind: z.enum(['document','artifact']), sessionId: z.string().optional(), processing: FileProcessingProgress.optional() })
export type LibraryFile = z.infer<typeof File>
const FileBody = z.object({ filename: z.string(), mediaType: z.string(), text: z.string(), originalAvailable: z.boolean(), contentBase64: z.string().optional(), fullChars: z.number().nonnegative().optional(), textTruncated: z.boolean().optional(), nextOrd: z.number().int().nonnegative().nullable().optional() })
export type SectorFileBody = z.infer<typeof FileBody>

export const getSectorFiles = (config: StagingConfig, id: string) => requestValidated(config, 'GET', `${sectorPath(id)}/files`, z.array(File))
export const getSectorFileBody = (config: StagingConfig, id: string, fileId: string) => requestValidated(config, 'GET', `${sectorPath(id)}/files/${encodeURIComponent(fileId)}/body`, FileBody)
export const hideSectorFile = (config: StagingConfig, id: string, fileId: string, hidden: boolean) => requestValidated(config, 'PATCH', `${sectorPath(id)}/files/${encodeURIComponent(fileId)}`, File, { hidden })

export const retryFileProcessing = (config: StagingConfig, sectorId: string, fileId: string, jobId: string, revision: number, allowDuplicatePaid: boolean) => requestValidated(config, 'POST', `${sectorPath(sectorId)}/files/${encodeURIComponent(fileId)}/retry`, FileProcessingProgress, { jobId, revision, allowDuplicatePaid })

export const FileUnitsPage = z.object({ status: z.string(), units: z.array(z.object({ ord: z.number().int().nonnegative(), kind: z.string(), text: z.string(), uncertain: z.boolean(), page: z.number().int().positive().optional(), imageOrdinal: z.number().int().nonnegative().optional(), imageRole: z.enum(['embedded','page-visual']).optional(), imageId: z.string().optional() })).max(100), nextOrd: z.number().int().nonnegative().nullable(), fullChars: z.number().nonnegative() })
export type FileUnitsPage = z.infer<typeof FileUnitsPage>
export const getFileUnitsPage = (config: StagingConfig, sectorId: string, fileId: string, fromOrd: number) => requestValidated(config, 'GET', `${sectorPath(sectorId)}/files/${encodeURIComponent(fileId)}/units?fromOrd=${fromOrd}&limit=20`, FileUnitsPage)
