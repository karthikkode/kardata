// CORS boundary tests. The staging UI runs on a different origin than the
// API, so the browser preflights every authorized call; without these
// headers the UI can only show a connection error. Pure inject, no DB.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../backend/src/app.js'
import { corsHeadersFor, DEFAULT_CORS_ORIGINS, parseCorsOrigins } from '../../backend/src/http/cors.js'

const ORIGIN = 'http://localhost:5173'
const STRANGER = 'http://evil.test'

describe('CORS boundary', () => {
  let app: FastifyInstance
  beforeAll(() => {
    app = buildApp({ corsOrigins: [ORIGIN] })
  })
  afterAll(() => app.close())

  it('answers an allowed preflight with an origin echo', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/sectors',
      headers: { origin: ORIGIN },
    })
    expect(response.statusCode).toBe(204)
    expect(response.headers['access-control-allow-origin']).toBe(ORIGIN)
    expect(response.headers['access-control-allow-methods']).toContain('POST')
    // PATCH /v1/sessions/:id/model is the UI's only non-GET/POST call:
    // without it the model picker can never save from the browser.
    expect(response.headers['access-control-allow-methods']).toContain('PATCH')
    // DELETE /v1/sessions/:id is the other one: preflight must allow it
    // or session deletes die in the browser while curl keeps working.
    expect(response.headers['access-control-allow-methods']).toContain('DELETE')
    expect(response.headers['access-control-allow-headers']).toContain('Authorization')
  })

  it('rejects a preflight from an unknown origin without an echo', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/v1/sectors',
      headers: { origin: STRANGER },
    })
    expect(response.statusCode).toBe(403)
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('reflects the origin on real responses, and only then', async () => {
    const allowed = await app.inject({ method: 'GET', url: '/healthz', headers: { origin: ORIGIN } })
    expect(allowed.statusCode).toBe(200)
    expect(allowed.headers['access-control-allow-origin']).toBe(ORIGIN)
    expect(allowed.headers.vary).toBe('Origin')
    const plain = await app.inject({ method: 'GET', url: '/healthz' })
    expect(plain.headers['access-control-allow-origin']).toBeUndefined()
    const stranger = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: STRANGER },
    })
    expect(stranger.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('reflects the allow-list on hijacked stream responses, never strangers', () => {
    // The SSE thread stream hijacks the socket, skipping the onSend hook:
    // without these headers browsers block the stream and sent messages
    // never arrive (the UI does not echo locally).
    const allowed = corsHeadersFor({ headers: { origin: ORIGIN } }, [ORIGIN])
    expect(allowed).toEqual({ 'access-control-allow-origin': ORIGIN, vary: 'Origin' })
    expect(corsHeadersFor({ headers: { origin: STRANGER } }, [ORIGIN])).toEqual({})
    expect(corsHeadersFor({ headers: {} }, [ORIGIN])).toEqual({})
  })

  it('stores the configured origins for the hijacked stream route', () => {
    // The stream route must read the stored list, never re-parse env:
    // injected test origins and production agree by construction.
    const stored = (app as FastifyInstance & { kardataCorsOrigins?: string[] }).kardataCorsOrigins
    expect(stored).toEqual([ORIGIN])
  })

  it('parses KARDATA_CORS_ORIGINS with local dev defaults', () => {
    expect(parseCorsOrigins(undefined)).toEqual(DEFAULT_CORS_ORIGINS)
    expect(parseCorsOrigins('')).toEqual(DEFAULT_CORS_ORIGINS)
    expect(parseCorsOrigins('  ')).toEqual(DEFAULT_CORS_ORIGINS)
    expect(parseCorsOrigins('https://app.test,, https://admin.test ')).toEqual([
      'https://app.test',
      'https://admin.test',
    ])
  })
})
