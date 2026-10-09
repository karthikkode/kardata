// Sector plan client: explicit planning runs and versioned artifact
// reads. API answers are stubbed; no fixture imports.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { planSector, approveSectorPlan, readSectorPlan, updateSectorPlan } from '@/data/api/plans'
import { type StagingConfig } from '@/data/api/client'

const config: StagingConfig = { baseUrl: 'https://staging.test', apiKey: 'key' }

afterEach(() => vi.unstubAllGlobals())


describe('sector plan client', () => {
  it('starts planning and reads versions back', async () => {
    const calls: Array<{ url: string; method: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { method?: string } = {}) => {
        const method = init.method ?? 'GET'
        calls.push({ url, method })
        if (url === 'https://staging.test/v1/sectors/s-1/plan' && method === 'POST') {
          return { ok: true, status: 200, json: async () => ({ ok: true, data: { id: 's-1', state: 'planning' } }) }
        }
        if (url === 'https://staging.test/v1/sectors/s-1/plan' && method === 'GET') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              data: {
                sectorId: 's-1',
                versions: [{ version: 1, markdown: '## scope\nFoods.', at: '2026-09-30T00:00:00.000Z' }],
                latest: { version: 1, markdown: '## scope\nFoods.', at: '2026-09-30T00:00:00.000Z' },
              },
            }),
          }
        }
        return { ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'not_found', message: 'no' } }) }
      }),
    )
    expect(await planSector(config, 's-1')).toMatchObject({ id: 's-1', state: 'planning' })
    expect(await readSectorPlan(config, 's-1')).toMatchObject({ sectorId: 's-1', latest: { version: 1 } })
    expect(calls).toContainEqual({ url: 'https://staging.test/v1/sectors/s-1/plan', method: 'POST' })
    expect(calls).toContainEqual({ url: 'https://staging.test/v1/sectors/s-1/plan', method: 'GET' })
  })

  it('surfaces plan conflicts and missing sectors as errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 409,
        json: async () => ({ ok: false, error: { code: 'conflict', message: 'not draft or failed' } }),
      })),
    )
    // NOTE (2026-10-10): do not rewrite as .rejects.toThrow(/.../):
    // under the current frontend runner (5.0.3; green under 5.0.1) it
    // reports "got ''" for this exact rejection, whose message was
    // verified present via direct catch. These assertions are equivalent.
    const error = await planSector(config, 's-1').then(
      () => { throw new Error('planSector resolved, expected rejection') },
      (e: unknown) => e as { constructor?: { name?: string }; message?: string; status?: unknown; code?: unknown },
    )
    expect(error?.constructor?.name).toBe('StagingApiError')
    expect(error?.status).toBe(409)
    expect(error?.code).toBe('conflict')
    expect(error?.message ?? '').toMatch(/not draft or failed/)
  })
})

describe('sector plan edits', () => {
  it('appends versions through PATCH', async () => {
    const calls: Array<{ url: string; method: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { method?: string } = {}) => {
        calls.push({ url, method: init.method ?? 'GET' })
        return { ok: true, status: 200, json: async () => ({ ok: true, data: { version: 2 } }) }
      }),
    )
    expect(await updateSectorPlan(config, 's-1', '## scope\nEdited.')).toEqual({ version: 2 })
    expect(calls).toEqual([{ url: 'https://staging.test/v1/sectors/s-1/plan', method: 'PATCH' }])
  })
})

it('pins the displayed context version in the owner approval request', async () => {
  const calls: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body?: string }) => { calls.push(JSON.parse(init.body ?? '{}')); return { ok: true, status: 200, json: async () => ({ ok: true, data: { id: 's-1', state: 'approved' } }) } }))
  await approveSectorPlan(config, 's-1', 2, 7)
  expect(calls).toEqual([{ version: 2, contextVersion: 7 }])
})
