// [F:frontend.hook.useApi]
import { describe, expect, it } from 'vitest'
import { isAuthError, StagingApiError } from '@/data/useApi'

describe('useApi error seam', () => {
  it('flags 401/403 as auth errors only', () => {
    expect(isAuthError(new StagingApiError(401, 'unauthorized', 'no'))).toBe(true)
    expect(isAuthError(new StagingApiError(403, 'permission_denied', 'no'))).toBe(true)
    expect(isAuthError(new StagingApiError(500, 'internal', 'no'))).toBe(false)
    expect(isAuthError(new StagingApiError(429, 'rate_limited', 'no'))).toBe(false)
    expect(isAuthError(new Error('nope'))).toBe(false)
    expect(isAuthError(null)).toBe(false)
  })
})
