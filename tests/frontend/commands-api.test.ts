// Discard-blocked-operations client: owner escape from a recovery park.
// API answers are stubbed; no fixture imports.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { discardBlockedOperations } from '@/data/api/commands'
import { type StagingConfig } from '@/data/api/client'

const config: StagingConfig = { baseUrl: 'https://staging.test', apiKey: 'key' }

afterEach(() => vi.unstubAllGlobals())

describe('discard blocked operations client', () => {
  it('posts the run id and reads the acceptance back', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { method?: string; body?: string } = {}) => {
        calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null })
        return { ok: true, status: 202, json: async () => ({ ok: true, data: { commandId: 'cmd-1', state: 'accepted' } }) }
      }),
    )
    await expect(discardBlockedOperations(config, 'session-run-s-1')).resolves.toMatchObject({ state: 'accepted' })
    expect(calls).toContainEqual({ url: 'https://staging.test/v1/commands/discard-blocked-operations', method: 'POST', body: { runId: 'session-run-s-1' } })
  })
  it('surfaces missing blocks and missing runs as errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ ok: false, error: { code: 'conflict', message: 'no blocked operation to discard' } }) })),
    )
    // Direct catch, not .rejects.toThrow: see the plan-api NOTE on the
    // 5.0.3 runner reporting "got ''" for this exact shape.
    const error = await discardBlockedOperations(config, 'session-run-s-1').then(
      () => { throw new Error('discardBlockedOperations resolved, expected rejection') },
      (e: unknown) => e as { constructor?: { name?: string }; message?: string; status?: unknown; code?: unknown },
    )
    expect(error?.constructor?.name).toBe('StagingApiError')
    expect(error?.status).toBe(409)
    expect(error?.code).toBe('conflict')
    expect(error?.message ?? '').toMatch(/no blocked operation to discard/)
  })
})
