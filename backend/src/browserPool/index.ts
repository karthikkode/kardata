// Browser-pool barrel: the single import point for agent browser use.
// Callers import the facade; pool and cache internals stay behind it
// except for tests and the retrieval session registry.
export {
  BROWSER_POOL_ABSOLUTE_MAX,
  BROWSER_POOL_DEFAULT_MAX,
  BROWSER_SLOT_TIMEOUT_MS,
  acquireBrowserSlot,
  browserPoolMax,
  browserPoolStats,
  resetBrowserPoolForTests,
  setBrowserPoolMaxForTests,
  type BrowserSlot,
} from './pool.js'
export {
  BROWSER_DOC_TTL_MS,
  BROWSER_QUERY_TTL_MS,
  clearBrowserCacheForTests,
  dedupInflight,
  getCachedDoc,
  getCachedQuery,
  normalizeBrowserUrl,
  queryCacheKey,
  setCachedDoc,
  setCachedQuery,
  type CachedDoc,
  type CachedSearchHit,
} from './cache.js'
export {
  browserPoolStats as facadePoolStats,
  linksFromSnapshot,
  pooledBrowserAct,
  pooledBrowserClose,
  pooledBrowserNavigate,
  pooledBrowserScreenshot,
  pooledBrowserSnapshot,
  pooledSearchWebPage,
  pooledWebFetch,
  pooledWebSearch,
  type SweepSearchDeps,
  type SweepSearchHit,
  type SweepSearchVia,
} from './facade.js'
