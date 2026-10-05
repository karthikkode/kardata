// Approval client proof: decideApproval posts the decision to the live
// backend route (POST /v1/commands/approve, appends t.approval.decided).
// fetch is stubbed; the wire shape is what is pinned here.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decideApproval } from '@/data/api/commands'
import { type StagingConfig } from '@/data/api/client'

const config: StagingConfig = { baseUrl: 'https://staging.test', apiKey: 'k' }

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(status: number, payload: unknown): Array<{ url: string; method: string; body?: string }> {
  const calls: Array<{ url: string; method: string; body?: string }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body })
      return { ok: status >= 200 && status < 300, status, json: async () => payload } as Response
    }),
  )
  return calls
}

describe('decideApproval', () => {
  it('posts approved decisions to the approve command', async () => {
    const calls = stubFetch(202, { ok: true, data: { commandId: 'cmd-a1', state: 'accepted' } })
    const outcome = await decideApproval(config, 'a1', 'approved')
    expect(outcome).toMatchObject({ commandId: 'cmd-a1' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://staging.test/v1/commands/approve')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.body).toBe(JSON.stringify({ approvalId: 'a1', decision: 'approved' }))
  })

  it('posts denied decisions with the same envelope', async () => {
    const calls = stubFetch(202, { ok: true, data: { commandId: 'cmd-a2', state: 'accepted' } })
    await decideApproval(config, 'a2', 'denied')
    expect(calls[0]?.body).toBe(JSON.stringify({ approvalId: 'a2', decision: 'denied' }))
  })
})
