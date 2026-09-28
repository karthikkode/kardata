// Product provider catalog. Live Meta /models availability intersects with
// verified capability profiles; no unconfigured or stale models are shown.
import type { FastifyInstance } from 'fastify'
import { readLiveConfig } from '@kardata/agents'
import type { ModelCatalog } from '../providers/catalog.js'
import { defaultModelFor } from '../providers/registry.js'
import { authorize, route, sendError } from './http.js'

export function providerRoutes(app: FastifyInstance, catalog: ModelCatalog): void {
  route(app, 'get', '/v1/providers', async (request, reply, app) => {
    const auth = await authorize(app, request, reply, 'viewer')
    if (!auth) return undefined
    const config = readLiveConfig()
    if (!config.metaApiKey) return { ok: true, data: { defaultProvider: 'meta', providers: [] } }
    let models
    try {
      models = await catalog()
    } catch {
      return sendError(reply, 503, 'overload', 'Meta model catalog unavailable. Try again.')
    }
    return {
      ok: true,
      data: {
        defaultProvider: 'meta',
        providers: [
          {
            name: 'meta',
            hasKey: true,
            defaultModel: defaultModelFor('meta'),
            models,
          },
        ],
      },
    }
  })
}
