// Artifact API: session artifacts, tenant artifacts, references, bodies.
import { LONG_REQUEST_TIMEOUT_MS, request, type StagingConfig } from './client'

export interface ArtifactSummary {
  artifactId: string
  name?: string
  kind?: string
  bytes?: number
  sha256?: string
  detail?: string
  indexed: boolean
}

export interface ArtifactReference {
  artifactId: string
  name?: string
  kind?: string
  reason?: string
  producedBy?: string
  referencedFrom?: { kind: string; id: string }
  sessionId?: string
  indexed: boolean
}

export interface ArtifactBody {
  body: string
  meta: Record<string, unknown>
}

export interface CreateArtifactInput {
  name: string
  content: string
  kind?: 'file' | 'proposal' | 'report'
  detail?: string
  reason?: 'subagent_output' | 'user_upload' | 'report' | 'proposal'
}

export function createArtifact(
  config: StagingConfig,
  sessionId: string,
  input: CreateArtifactInput,
): Promise<ArtifactSummary> {
  // File bytes upload inline and index synchronously: the long budget,
  // like sector document attach.
  return request<ArtifactSummary>(
    config,
    'POST',
    `/v1/sessions/${encodeURIComponent(sessionId)}/artifacts`,
    input,
    undefined,
    LONG_REQUEST_TIMEOUT_MS,
  )
}

export function listSessionArtifacts(config: StagingConfig, sessionId: string): Promise<ArtifactSummary[]> {
  return request<ArtifactSummary[]>(
    config,
    'GET',
    `/v1/sessions/${encodeURIComponent(sessionId)}/artifacts`,
  )
}

export function listTenantArtifacts(config: StagingConfig): Promise<ArtifactReference[]> {
  return request<ArtifactReference[]>(config, 'GET', '/v1/artifacts')
}

export function referenceArtifact(
  config: StagingConfig,
  sessionId: string,
  artifactId: string,
  fromScope: { kind: 'session' | 'task'; id: string },
): Promise<ArtifactReference> {
  return request<ArtifactReference>(
    config,
    'POST',
    `/v1/sessions/${encodeURIComponent(sessionId)}/artifacts/references`,
    { artifactId, fromScope },
  )
}

export function getArtifactBody(
  config: StagingConfig,
  sessionId: string,
  artifactId: string,
): Promise<ArtifactBody> {
  return request<ArtifactBody>(
    config,
    'GET',
    `/v1/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}/body`,
  )
}
