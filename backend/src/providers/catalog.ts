// Meta is the sole product provider. Its /models endpoint decides which
// verified model ids are currently available; local profiles supply only
// capabilities the endpoint does not report (effort and wire mode).
import { readLiveConfig, type LiveProviderConfig } from '@kardata/agents'
import { defaultModelFor, modelsFor, type ModelEntry } from './registry.js'

export class ModelCatalogUnavailable extends Error {
  constructor() {
    super('Meta model catalog is unavailable')
    this.name = 'ModelCatalogUnavailable'
  }
}

export type ModelCatalog = () => Promise<ModelEntry[]>

export async function fetchMetaModels(
  config: Pick<LiveProviderConfig, 'metaApiKey' | 'metaBaseUrl'> = readLiveConfig(),
  fetchFn: typeof fetch = fetch,
): Promise<ModelEntry[]> {
  if (!config.metaApiKey) return []
  let response: Response
  try {
    response = await fetchFn(`${config.metaBaseUrl}/models`, {
      headers: { authorization: `Bearer ${config.metaApiKey}` },
      signal: AbortSignal.timeout(5_000),
    })
  } catch {
    throw new ModelCatalogUnavailable()
  }
  if (!response.ok) throw new ModelCatalogUnavailable()
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ModelCatalogUnavailable()
  }
  if (typeof body !== 'object' || body === null || !('data' in body) || !Array.isArray(body.data)) {
    throw new ModelCatalogUnavailable()
  }
  const ids = new Set<string>()
  for (const item of body.data) {
    if (typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string') ids.add(item.id)
  }
  const models = modelsFor('meta').filter((entry) => ids.has(entry.model))
  if (!models.some((entry) => entry.model === defaultModelFor('meta'))) throw new ModelCatalogUnavailable()
  return models
}
