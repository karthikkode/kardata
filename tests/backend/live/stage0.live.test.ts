// Live harness proof (L-A19): sector create/list/detail/companies/progress
// against the isolated live stack. No model calls; proves the harness,
// auth, namespace isolation and per-suite database before Stage 1.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LIVE_META_ENABLED, startLiveStack, type LiveStack } from './harness.js'

function dataOf(body: unknown): Record<string, unknown> {
  return (body as { data: Record<string, unknown> }).data
}

describe.skipIf(!LIVE_META_ENABLED)('live sector basics (L-A19)', () => {
  let stack: LiveStack

  beforeAll(async () => {
    stack = await startLiveStack('stage0')
  }, 300_000)

  afterAll(async () => {
    await stack?.close()
  }, 120_000)

  it('L-A19: creates and reads a consistent empty sector', async () => {
    const created = await stack.api('POST', '/v1/sectors', { name: 'Live HVAC', topic: 'hvac live test' })
    expect(created.status).toBe(201)
    const sector = dataOf(created.body)
    expect(sector['state']).toBe('draft')
    const id = sector['id'] as string
    expect(typeof id).toBe('string')

    const list = await stack.api('GET', '/v1/sectors')
    expect(list.status).toBe(200)
    const ids = ((list.body as { data: Array<{ id: string }> }).data).map((entry) => entry.id)
    expect(ids).toContain(id)

    const detail = await stack.api('GET', `/v1/sectors/${id}`)
    expect(detail.status).toBe(200)
    expect(dataOf(detail.body)).toMatchObject({ id, name: 'Live HVAC', state: 'draft' })

    const companies = await stack.api('GET', `/v1/companies?sectorId=${id}`)
    expect(companies.status).toBe(200)
    expect(dataOf(companies.body)).toMatchObject({ companies: [], total: 0 })

    const progress = await stack.api('GET', `/v1/sectors/${id}/progress`)
    expect(progress.status).toBe(200)
  }, 600_000)
})
