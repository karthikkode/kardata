// Model catalog: the provider list behind the picker (toolbar) and the
// Models tab (panel). One fetch, one status; each surface seeds its own
// drafts from the returned providers.
import { useCallback, useEffect, useState } from 'react'
import { apiErrorStatus, listProviders, type ProviderEntry, type StagingConfig } from './staging-api'

export type CatalogStatus = 'loading' | 'ready' | 'error' | 'denied' | 'offline'

export function useModelCatalog(config: StagingConfig | null) {
  const [providers, setProviders] = useState<ProviderEntry[]>([])
  const [defaultProvider, setDefaultProvider] = useState('')
  const [status, setStatus] = useState<CatalogStatus>(() => (config ? 'loading' : 'ready'))
  const [attempt, setAttempt] = useState(0)

  const reload = useCallback(() => {
    setStatus('loading')
    setAttempt((value) => value + 1)
  }, [])

  useEffect(() => {
    if (!config) return undefined
    let live = true
    listProviders(config)
      .then((catalog) => {
        if (!live) return
        setProviders(catalog.providers)
        setDefaultProvider(catalog.defaultProvider)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (!live) return
        setStatus(apiErrorStatus(error))
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.baseUrl, config?.apiKey, attempt])

  return { providers, defaultProvider, status, reload }
}
