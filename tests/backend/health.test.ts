import { describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'

describe('health (B0.1)', () => {
  it('reports build sha and uptime on /healthz', async () => {
    const app = buildApp({ buildSha: 'test-sha' })
    const response = await app.inject({ method: 'GET', url: '/healthz' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      ok: true,
      data: { status: 'ok', buildSha: 'test-sha', uptimeSecs: expect.any(Number) },
    })
    await app.close()
  })

  it('returns the denied-shaped 404 envelope on unknown routes', async () => {
    const app = buildApp()
    const response = await app.inject({ method: 'GET', url: '/nope' })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'no route GET /nope' },
    })
    await app.close()
  })
})
