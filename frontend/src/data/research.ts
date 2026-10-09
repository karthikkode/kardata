// Research data bundles (staging-only). Components render ResearchData
// bundles from the backend; without credentials the flag-off path renders
// a not-configured notice, never sample data.
import { useCallback, useEffect, useRef, useState } from 'react'
import { getSectorDetail, listSectors, type CompanyResearch, type SectorDetail, type SectorResearch } from './api/sectors'
import { listCompanies } from './api/companies'
import { apiErrorStatus, StagingApiError, type StagingConfig } from './api/client'

export type { CompanyResearch, SectorDetail, SectorResearch }

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
  // A null config starts ready (empty bundle), never stuck loading: the
  // render reset below only fires when the query key changes.
  const [status, setStatus] = useState<ResearchStatus>(() => (config ? 'loading' : 'ready'))
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
const COMPANY_WINDOW = 100

export interface CompanyData extends ResearchData<CompanyResearch> {
  moreError: string | null
  /** True while the next window appends; the loaded rows stay visible. */
  loadingMore: boolean
  /** Fetch the next window and append it (id-deduped). No-op at the total. */
  showMore: () => void
}

export function useStagingCompanies(
  config: StagingConfig | null,
  filters: CompanyFilters = {},
): CompanyData {
  // A null config starts ready (empty bundle), never stuck loading: the
  // render reset below only fires when the query key changes.
  const [status, setStatus] = useState<ResearchStatus>(() => (config ? 'loading' : 'ready'))
  const [items, setItems] = useState<CompanyResearch[]>([])
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  const wantedWindow = useRef(COMPANY_WINDOW)
  const nextOffset = useRef(0)
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
  const query = config ? `${config.baseUrl} ${config.apiKey} ${state} ${needle} ${sector}` : null
  const [activeQuery, setActiveQuery] = useState<string | null>(null)
  if (activeQuery !== query) {
    setActiveQuery(query)
    setItems([])
    setMoreNonce(0)
    setLoadingMore(false)
    setMoreError(null)
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
    wantedWindow.current = COMPANY_WINDOW
    nextOffset.current = 0
  }, [query])

  // The fetch trigger lives outside render state (same shape as
  // useWorkspaceResource): the section polls retry every 5s, and an
  // attempt counter would re-render the table with identical UI. A
  // generation counter supersedes stale attempts exactly like the old
  // per-effect live flag did.
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const generation = useRef(0)
  const fetchWindow = useCallback(() => {
    if (!config) return
    generation.current += 1
    const mine = generation.current
    const wanted = wantedWindow.current
    const readWindow = async () => {
      const companies: CompanyResearch[] = []
      let count = 0
      let consumed = 0
      for (let offset = 0; offset < wanted; offset += COMPANY_WINDOW) {
        const page = await listCompanies(config, { ...serverFilters(), limit: COMPANY_WINDOW, offset })
        if (!mounted.current || mine !== generation.current) return undefined
        companies.push(...page.companies)
        consumed = offset + page.companies.length
        count = page.total
        if (companies.length >= count || page.companies.length === 0) break
      }
      return { companies: [...new Map(companies.map((company) => [company.id, company])).values()], total: count, nextOffset: consumed }
    }
    readWindow()
      .then((page) => {
        if (!mounted.current || mine !== generation.current || !page || wanted !== wantedWindow.current) return
        setItems(page.companies)
        nextOffset.current = page.nextOffset
        setTotal(page.total)
        setLoadingMore(false)
        setMoreError(null)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (!mounted.current || mine !== generation.current) return
        setStatus(stagingStatus(error))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.baseUrl, config?.apiKey, state, needle, sector])

  useEffect(() => {
    fetchWindow()
  }, [fetchWindow])

  useEffect(() => {
    if (!config || moreNonce === 0) return
    let live = true
    const offset = nextOffset.current
    listCompanies(config, { ...serverFilters(), limit: COMPANY_WINDOW, offset })
      .then((page) => {
        if (!live) return
        nextOffset.current = offset + page.companies.length
        setItems((current) => {
          const seen = new Set(current.map((row) => row.id))
          return [...current, ...page.companies.filter((row) => !seen.has(row.id))]
        })
        setTotal(page.total)
        setLoadingMore(false)
      })
      .catch((error: unknown) => {
        if (!live) return
        setLoadingMore(false)
        setMoreError(error instanceof Error ? error.message : 'More companies did not load. Try again.')
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moreNonce, query])

  function showMore(): void {
    if (loadingMore) return
    if (total !== undefined && items.length >= total) return
    setLoadingMore(true)
    setMoreError(null)
    wantedWindow.current = nextOffset.current + COMPANY_WINDOW
    setMoreNonce((value) => value + 1)
  }

  return { status, items, total, loadingMore, moreError, showMore, retry: fetchWindow }
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

  // Reset during render, never in the fetch effect: when the query
  // changes the previous detail no longer belongs to it.
  const query = config && sectorId ? `${config.baseUrl} ${config.apiKey} ${sectorId}` : null
  const [activeQuery, setActiveQuery] = useState<string | null>(null)
  if (activeQuery !== query) {
    setActiveQuery(query)
    if (query === null) {
      setDetail(undefined)
      setStatus('ready')
    } else {
      setDetail(undefined)
      setStatus('loading')
    }
  }

  // The fetch trigger lives outside render state (same shape as
  // useWorkspaceResource): App polls this hook every 5s, and an attempt
  // counter would re-render the whole tree with identical UI. A
  // generation counter supersedes stale attempts exactly like the old
  // per-effect live flag did.
  const queryRef = useRef(query)
  useEffect(() => { queryRef.current = query }, [query])
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const generation = useRef(0)
  const fetchDetail = useCallback(() => {
    if (!config || !sectorId) return
    generation.current += 1
    const mine = generation.current
    const startedQuery = queryRef.current
    getSectorDetail(config, sectorId)
      .then((row) => {
        if (!mounted.current || mine !== generation.current || queryRef.current !== startedQuery) return
        setDetail(row)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (!mounted.current || mine !== generation.current || queryRef.current !== startedQuery) return
        // A 404 is not a failure: the sector is gone, so the not-found
        // empty state renders instead of an error panel.
        if (error instanceof StagingApiError && error.status === 404) {
          setDetail(undefined)
          setStatus('ready')
          return
        }
        const next = stagingStatus(error)
        if (next === 'denied') setDetail(undefined)
        setStatus(next)
      })
  }, [config, sectorId])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  return { status, detail, retry: fetchDetail, refresh: fetchDetail }
}
