// Components-facing error seam (P6.1): error classification for data/api.
// Components import error utilities from here, never from data/api/*.
import { StagingApiError } from './api/client'

export { StagingApiError, apiErrorStatus } from './api/client'
export type { StagingConfig } from './api/client'

/** True for 401/403 API failures (session/key rejected). */
export function isAuthError(error: unknown): boolean {
  return (
    error instanceof StagingApiError && (error.status === 401 || error.status === 403)
  )
}
