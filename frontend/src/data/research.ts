// Research data bundles (staging-only). Components render ResearchData
// bundles from the backend; without credentials the flag-off path renders
// a not-configured notice, never sample data.
import { useCallback, useEffect, useState } from 'react'
import {
  getSectorDetail,
  listCompanies,
  listSectors,
  apiErrorStatus,
  StagingApiError,
  type CompanyResearch,
  type SectorActivityEntry,
  type SectorDetail,
  type SectorResearch,
  type StagingConfig,
} from './staging-api'

export type { CompanyResearch, SectorActivityEntry, SectorDetail, SectorResearch }

export type ResearchStatus = 'loading' | 'ready' | 'error' | 'denied' | 'offline'

export interface ResearchData<T> {
  status: ResearchStatus
  items: T[]
  /** Server-side total; equals items.length when unpaged. Absent until loaded. */
  total: number | undefined
  retry: () => void
}

function useRefetch(): [number, () => void] {
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  return [attempt, retry]
}

/** Staging failures keep their meaning. 401/403 reached the API and was
 * refused: a key problem, never "no data" and never a connection problem.
 * A thrown TypeError (blocked CORS preflight, refused socket) is 'error';
 * only the browser offline flag is 'offline'. */
function stagingStatus(error: unknown): ResearchStatus {
  return apiErrorStatus(error)
}

/** Backend fetches with loading/error/denied/offline states. A null config
 * disables fetching with an empty ready bundle; callers render the
 * not-configured notice for that case. */
export function useStagingSectors(config: StagingConfig | null): ResearchData<SectorResearch> {
  const [status, setStatus] = useState<ResearchStatus>('loading')
  const [items, setItems] = useState<SectorResearch[]>([])
  const [attempt, retry] = useRefetch()

  // Reset during render, never in the fetch effect: when the query
  // changes the previous rows no longer belong to it.
  const query = config ? `${config.baseUrl} ${config.apiKey} ${attempt}` : null
  const [activeQuery, setActiveQuery] = useState<string | null>(null)
  if (activeQuery !== query) {
    setActiveQuery(query)
    if (query === null) {
      setItems([])
      setStatus('ready')
    } else {
      setStatus('loading')
    }
  }

  useEffect(() => {
    if (!config) return
    let live = true
    listSectors(config)
      .then((rows) => {
        if (!live) return
        setItems(rows)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (!live) return
        setStatus(stagingStatus(error))
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.baseUrl, config?.apiKey, attempt])

  return { status, items, total: items.length, retry }
}

export interface CompanyFilters {
  state?: string
  query?: string
  sectorId?: string
}

/** Client window size: matches the server default page. */
export const COMPANY_WINDOW = 100

export interface CompanyData extends ResearchData<CompanyResearch> {
  /** True while the next window appends; the loaded rows stay visible. */
  loadingMore: boolean
  /** Fetch the next window and append it (id-deduped). No-op at the total. */
  showMore: () => void
}

export function useStagingCompanies(
  config: StagingConfig | null,
  filters: CompanyFilters = {},
): CompanyData {
  const [status, setStatus] = useState<ResearchStatus>('loading')
  const [items, setItems] = useState<CompanyResearch[]>([])
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [attempt, retry] = useRefetch()
  const [moreNonce, setMoreNonce] = useState(0)
  const state = filters.state ?? ''
  const needle = filters.query ?? ''
  const sector = filters.sectorId ?? ''

  function serverFilters(): { state?: CompanyResearch['state']; query?: string; sectorId?: string } {
    return {
      ...(state === '' || state === 'all' ? {} : { state: state as CompanyResearch['state'] }),
      ...(needle === '' ? {} : { query: needle }),
      ...(sector === '' ? {} : { sectorId: sector }),
    }
  }

  // Reset during render, never in the fetch effect: when the query
  // changes the previous rows no longer belong to it.
  const query = config ? `${config.baseUrl} ${config.apiKey} ${state} ${needle} ${sector} ${attempt}` : null
  const [activeQuery, setActiveQuery] = useState<string | null>(null)
  if (activeQuery !== query) {
    setActiveQuery(query)
    if (query === null) {
      setItems([])
      setTotal(undefined)
      setLoadingMore(false)
      setStatus('ready')
    } else {
      setStatus('loading')
    }
  }

  useEffect(() => {
    if (!config) return
    let live = true
    listCompanies(config, { ...serverFilters(), limit: COMPANY_WINDOW, offset: 0 })
      .then((page) => {
        if (!live) return
        setItems(page.companies)
        setTotal(page.total)
        setLoadingMore(false)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (!live) return
        setStatus(stagingStatus(error))
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.baseUrl, config?.apiKey, state, needle, sector, attempt])

  useEffect(() => {
    if (!config || moreNonce === 0) return
    let live = true
    listCompanies(config, { ...serverFilters(), limit: COMPANY_WINDOW, offset: items.length })
      .then((page) => {
        if (!live) return
        setItems((current) => {
          const seen = new Set(current.map((row) => row.id))
          return [...current, ...page.companies.filter((row) => !seen.has(row.id))]
        })
        setTotal(page.total)
        setLoadingMore(false)
      })
      .catch(() => {
        if (!live) return
        setLoadingMore(false)
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moreNonce])

  function showMore(): void {
    if (loadingMore) return
    if (total !== undefined && items.length >= total) return
    setLoadingMore(true)
    setMoreNonce((value) => value + 1)
  }

  return { status, items, total, loadingMore, showMore, retry }
}

export interface SectorDetailData {
  status: ResearchStatus
  detail: SectorDetail | undefined
  retry: () => void
  refresh: () => void
}

export function useStagingSectorDetail(
  config: StagingConfig | null,
  sectorId: string | null,
): SectorDetailData {
  const [status, setStatus] = useState<ResearchStatus>('loading')
  const [detail, setDetail] = useState<SectorDetail | undefined>(undefined)
  const [attempt, retry] = useRefetch()

  // Reset during render, never in the fetch effect: when the query
  // changes the previous detail no longer belongs to it.
  const query = config && sectorId ? `${config.baseUrl} ${config.apiKey} ${sectorId} ${attempt}` : null
  const [activeQuery, setActiveQuery] = useState<string | null>(null)
  if (activeQuery !== query) {
    setActiveQuery(query)
    if (query === null) {
      setDetail(undefined)
      setStatus('ready')
    } else {
      setStatus('loading')
    }
  }

  useEffect(() => {
    if (!config || !sectorId) return
    let live = true
    getSectorDetail(config, sectorId)
      .then((row) => {
        if (!live) return
        setDetail(row)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (!live) return
        // A 404 is not a failure: the sector is gone, so the not-found
        // empty state renders instead of an error panel.
        if (error instanceof StagingApiError && error.status === 404) {
          setDetail(undefined)
          setStatus('ready')
          return
        }
        setStatus(stagingStatus(error))
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.baseUrl, config?.apiKey, sectorId, attempt])

  return { status, detail, retry, refresh: retry }
}
