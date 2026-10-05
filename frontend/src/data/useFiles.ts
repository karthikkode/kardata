// Components-facing files seam (P6.1): artifacts, library files, processing status.
export { createArtifact, getArtifactBody, listSessionArtifacts } from './api/artifacts'
export type { ArtifactSummary } from './api/artifacts'
export type {
  FileProcessingProgress,
  FileUnitsPage,
  LibraryFile,
  SectorFileBody,
} from './api/files'
