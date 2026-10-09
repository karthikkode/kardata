/**
 * @file agents/src/http.ts
 * @purpose The one HTTP client in the agents workspace: default fetch,
 * deadline/abort handling, and HTTP status error mapping.
 * @invariants Throws HttpError (never a bare Error) for non-2xx statuses;
 * tokens stay out of errors (status only, never headers or body echoes).
 * @inputs Request init plus timeoutMs, an optional parent signal, and an
 * optional injected fetch for unit tests.
 * @outputs Response body text.
 */

export interface McpHttpResponse {
  ok: boolean
  status: number
  text(): Promise<string>
}

export type McpFetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<McpHttpResponse>

export function defaultFetchFn(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
): Promise<McpHttpResponse> {
  return fetch(url, init)
}

/** Non-2xx failure. Callers map {@link status} to domain semantics. */
export class HttpError extends Error {
  readonly status: number

  constructor(describe: string, status: number) {
    super(`${describe} failed with HTTP ${status}`)
    this.name = 'HttpError'
    this.status = status
  }
}

export interface PostWithDeadlineOptions {
  /** Human label used in errors, e.g. `mcp request 'tools/list'`. */
  describe: string
  url: string
  init: { method: string; headers: Record<string, string>; body: string }
  timeoutMs: number
  signal?: AbortSignal
  fetchFn?: McpFetchFn
}

/**
 * POST with a deadline timer racing the parent signal, then map the HTTP
 * outcome to text or a thrown error (HttpError for non-2xx).
 */
export async function postWithDeadline(options: PostWithDeadlineOptions): Promise<string> {
  const { describe, url, init, timeoutMs, signal: parentSignal, fetchFn = defaultFetchFn } = options
  // Already-cancelled callers fail fast with the dispatch error: without
  // this the pre-rejected abort branch wins the race below and reports
  // a deadline instead.
  if (parentSignal?.aborted) throw new Error(`${describe} cancelled before dispatch`)
  const controller = new AbortController()
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal
  let rejectAbort: (() => void) | undefined
  const timer = setTimeout(() => controller.abort(new Error('request deadline exceeded')), timeoutMs)
  try {
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new Error(`${describe} aborted or exceeded its deadline`))
      if (signal.aborted) rejectAbort()
      else signal.addEventListener('abort', rejectAbort, { once: true })
    })
    return await Promise.race([
      aborted,
      (async () => {
        if (signal.aborted) throw new Error(`${describe} cancelled before dispatch`)
        const response = await fetchFn(url, { signal, ...init })
        // Token stays out of errors: status only, never headers or body echoes.
        if (!response.ok) throw new HttpError(describe, response.status)
        return response.text()
      })(),
    ])
  } finally {
    clearTimeout(timer)
    if (rejectAbort) signal.removeEventListener('abort', rejectAbort)
    controller.abort()
  }
}
