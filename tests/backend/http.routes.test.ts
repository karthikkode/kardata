// Route event-client plumbing (P3.2.6). The route() wrapper enters the
// ambient caller client from the registered URL, so every event a
// handler appends lands labeled without threading a parameter.
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { currentEventClient } from '../../backend/src/observability/ambient.js'
import { eventClientForRoute, route } from '../../backend/src/routes/http.js'

describe('event client derivation (P3.2.6)', () => {
  it('maps /v1 to ui, /mcp to agent-mcp, the rest to other', () => {
    expect(eventClientForRoute('/v1/threads')).toBe('ui')
    expect(eventClientForRoute('/v1/threads/:threadKey/operations/:operationId')).toBe('ui')
    expect(eventClientForRoute('/mcp')).toBe('agent-mcp')
    expect(eventClientForRoute('/healthz')).toBe('other')
    expect(eventClientForRoute('/metrics')).toBe('other')
  })

  it('enters the ambient client around the handler', async () => {
    const seen: Array<string | undefined> = []
    const app = Fastify()
    route(app, 'post', '/v1/TEST_probe', async () => {
      seen.push(currentEventClient())
      return { ok: true }
    })
    route(app, 'post', '/mcp', async () => {
      seen.push(currentEventClient())
      return { ok: true }
    })
    await app.inject({ method: 'POST', url: '/v1/TEST_probe', payload: {} })
    await app.inject({ method: 'POST', url: '/mcp', payload: {} })
    expect(seen).toEqual(['ui', 'agent-mcp'])
    await app.close()
  })
})
