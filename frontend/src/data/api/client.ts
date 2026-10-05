// Frontend API client: typed fetch wrapper over the backend v1 routes.
// The UI renders a not-connected state until VITE_STAGING_API=1.
// Every function takes its config explicitly: no ambient base URL, no
// stored key. Non-2xx responses throw StagingApiError with status + code.
// requestEnvelope returns the envelope (data + cursor); request returns
// data; requestValidated also checks the payload against a zod schema.
// Streams open through openStreamReader (EventSource cannot set headers).
import { z } from 'zod'

export interface StagingConfig {
  baseUrl: string
  apiKey: string
}

export function stagingEnabled(): boolean {
  return import.meta.env.VITE_STAGING_API === '1'
}

/** Client config from the environment. Null unless the staging flag is on
 * and both values are present; callers show the not-connected state. */
export function stagingConfig(): StagingConfig | null {
  if (!stagingEnabled()) return null
  const baseUrl = import.meta.env.VITE_STAGING_URL as string | undefined
  const apiKey = import.meta.env.VITE_STAGING_KEY as string | undefined
  if (!baseUrl || !apiKey) return null
  return { baseUrl, apiKey }
}

export class StagingApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'StagingApiError'
    this.status = status
    this.code = code
  }
}

/** One error-meaning mapper for every surface: offline (browser flag),
 * denied (the API refused this key), error (everything else). Components
 * keep their own status unions but never their own copy of this rule. */
export function apiErrorStatus(error: unknown): 'offline' | 'denied' | 'error' {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
  if (error instanceof StagingApiError && (error.status === 401 || error.status === 403)) {
    return 'denied'
  }
  return 'error'
}

/** Unary requests fail at 30s with a retryable timeout (P6.4). Streams are
 * excluded: SSE holds the socket open by design. */
export const REQUEST_TIMEOUT_MS = 30_000

export async function requestEnvelope<T>(config: StagingConfig, method: string, path: string, body?: unknown, signal?: AbortSignal, idempotencyKey?: string): Promise<{ data: T; nextAfterSeq?: number }> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  let response: Response
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method,
      signal: combined,
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    // Caller-initiated cancels and network failures keep their existing
    // paths; only a fired timeout becomes a retryable 408 with safe copy.
    if (signal?.aborted) throw error
    if (timeout.aborted) throw new StagingApiError(408, 'timeout', `request timed out: ${method} ${path}`)
    throw error
  }
  const parsed = (await response.json()) as {
    ok: boolean
    data?: T
    nextAfterSeq?: number
    error?: { code?: string; message?: string }
  }
  if (!response.ok || !parsed.ok) {
    throw new StagingApiError(
      response.status,
      parsed.error?.code ?? 'unknown',
      parsed.error?.message ?? `request failed: ${method} ${path}`,
    )
  }
  return { data: parsed.data as T, nextAfterSeq: parsed.nextAfterSeq }
}

export async function request<T>(config: StagingConfig, method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  return (await requestEnvelope<T>(config, method, path, body, undefined, idempotencyKey)).data
}

export async function requestValidated<T>(config: StagingConfig, method: string, path: string, schema: z.ZodType<T>, body?: unknown, idempotencyKey?: string): Promise<T> {
  const result = schema.safeParse(await request(config, method, path, body, idempotencyKey))
  if (!result.success) throw new StagingApiError(502, 'invalid_response', 'The server returned an invalid workspace response.')
  return result.data
}

export const sectorPath = (id: string) => `/v1/sectors/${encodeURIComponent(id)}`

/** Open an SSE stream response: fetch with the client key, then map a
 * failed open to StagingApiError. Frame parsing stays with the caller. */
export async function openStreamReader(config: StagingConfig, path: string, signal: AbortSignal | undefined, describe: string): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    headers: { authorization: `Bearer ${config.apiKey}` }, signal,
  })
  if (!response.ok || !response.body) {
    throw new StagingApiError(response.status, 'unknown', `stream failed for ${describe}`)
  }
  return response.body.getReader()
}
