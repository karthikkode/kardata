import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Eye, EyeOff, FileImage, FileSpreadsheet, FileText, Loader2, Upload } from 'lucide-react'
import type { ResearchStatus, SectorDetail } from '../data/research'
import { useStagingCompanies } from '../data/research'
import {
  getSectorContext,
  patchSectorContext,
  type ResearchState,
  type SectorDocumentSummary,
  type StagingConfig,
} from '../data/staging-api'
import {
  CompanyRow,
  DeniedNotice,
  OverflowList,
  PanelError,
  SkeletonRows,
  stateLabel,
  UnavailableNotice,
} from './research-parts'
import { SectorChatPanel } from './SectorChatPanel'
import { SectorContextDrawer } from './SectorContextDrawer'
import { SectorPlanSection } from './SectorPlanSection'
import { RunConsole } from './RunConsole'
import { Button } from './ui/button'
import { Input } from './ui/input'

const stateFilters = [
  'draft',
  'running',
  'paused',
  'queued',
  'failed',
  'complete',
] as const satisfies readonly ResearchState[]

type StateFilter = ResearchState | 'all'

// Research runs are owner-started from the sector chat strip; this page
// keeps discovery output (companies, files, context). While a sweep is
// active the page re-reads on a quiet interval so the strip, the state,
// and the company window follow the run instead of freezing.

// Re-read cadence while a sweep is active: prompt enough to watch
// companies land, quiet enough to stay out of the sweep's way.
const RESEARCH_POLL_MS = 5000

export function CompanySection({
  staging,
  sectorId,
  sectorName,
  pollActive = false,
}: {
  staging: StagingConfig | null
  sectorId: string
  sectorName: string
  /** While a sweep runs, the company window re-reads so arrivals appear. */
  pollActive?: boolean
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<StateFilter>('all')
  const needle = query.trim()
  // Server-filtered window: the list never silently truncates, and the
  // count line reads the server total, not the window length.
  const companies = useStagingCompanies(staging, {
    sectorId,
    ...(active === 'all' ? {} : { state: active }),
    ...(needle === '' ? {} : { query: needle }),
  })
  const { retry: refetchCompanies } = companies
  useEffect(() => {
    if (!pollActive || !staging) return
    const timer = setInterval(refetchCompanies, RESEARCH_POLL_MS)
    return () => clearInterval(timer)
  }, [pollActive, staging, refetchCompanies])
  const filtered = needle !== '' || active !== 'all'
  const total = companies.total
  const rows = companies.items
  const showCount = filtered || rows.length > 50 || (total ?? 0) > rows.length
  return (
    <section
      aria-label={`Companies in ${sectorName}`}
      className="rounded-xl border border-border bg-background px-4 py-3"
    >
      <h2 className="text-base font-semibold">Companies</h2>
      <div className="mt-3 max-w-sm">
        <label htmlFor="sector-companies-filter" className="mb-1 block text-sm font-medium">
          Filter companies
        </label>
        <Input
          id="sector-companies-filter"
          placeholder="Type to filter"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div role="group" aria-label="Filter by state" className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant={active === 'all' ? 'default' : 'outline'}
          size="sm"
          aria-pressed={active === 'all'}
          onClick={() => setActive('all')}
        >
          All
        </Button>
        {stateFilters.map((state) => (
          <Button
            key={state}
            type="button"
            variant={active === state ? 'default' : 'outline'}
            size="sm"
            aria-pressed={active === state}
            onClick={() => setActive(active === state ? 'all' : state)}
          >
            {stateLabel[state]}
          </Button>
        ))}
      </div>
      <div className="mt-2">
        {companies.status === 'loading' ? (
          <SkeletonRows label={`Companies in ${sectorName} are loading`} />
        ) : companies.status === 'error' ? (
          <PanelError
            heading="Companies did not load."
            detail="Check your connection and try again."
            onRetry={companies.retry}
          />
        ) : companies.status === 'denied' ? (
          <DeniedNotice heading="Companies are not shared with this key." />
        ) : (
          <>
        {showCount ? (
          <p aria-live="polite" className="mb-2 text-xs text-muted-foreground">
            Showing {rows.length} of {total ?? rows.length} companies
          </p>
        ) : null}
        {rows.length ? (
          <>
          <OverflowList total={total ?? rows.length}>
            {rows.map((item) => (
              <CompanyRow key={item.id} research={item} />
            ))}
          </OverflowList>
          {(total ?? rows.length) > rows.length ? (
            <div className="mt-2 flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={companies.showMore}
                disabled={companies.loadingMore}
              >
                {companies.loadingMore ? 'Loading more…' : `Show more (${rows.length} of ${total})`}
              </Button>
            </div>
          ) : null}
          </>
        ) : (
          <div className="mt-2 rounded-lg border border-dashed border-border p-4">
            <p className="text-sm text-muted-foreground">
              {filtered
                ? 'No companies match these filters. Clear them to see everything.'
                : `No companies picked for ${sectorName} yet.`}
            </p>
            {filtered ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery('')
                  setActive('all')
                }}
                className="mt-3"
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        )}
          </>
        )}
      </div>
    </section>
  )
}

export interface AttachResult {
  filename: string
  status: 'indexed' | 'needs-ocr'
  unitCount: number
  detail?: string
}

function DocumentsSection({
  config,
  sectorId,
  sectorName,
  documents,
  documentsFailed,
  attaching,
  attachingName,
  attachError,
  attachResult,
  onAttach,
}: {
  config: StagingConfig | null
  sectorId: string
  sectorName: string
  documents: SectorDocumentSummary[]
  documentsFailed: boolean
  attaching: boolean
  attachingName: string | null
  attachError: string | null
  attachResult: AttachResult | null
  onAttach: (file: File) => void
}) {
  const filePicker = useRef<HTMLInputElement | null>(null)
  // Whole-document exclusion lives in the context view (same source the
  // drawer toggles); absent means included. Unknown until it loads, so
  // toggles stay hidden rather than guessing.
  const [excludedIds, setExcludedIds] = useState<Set<string> | null>(null)
  const [unitCounts, setUnitCounts] = useState<Map<string, number> | null>(null)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const contextKey = config ? `${config.baseUrl} ${sectorId} ${documents.length}` : null
  useEffect(() => {
    if (!config || !contextKey || loadedKey === contextKey) return undefined
    let live = true
    getSectorContext(config, sectorId).then(
      (view) => {
        if (!live) return
        if (!Array.isArray(view.files)) {
          setExcludedIds(null)
          setUnitCounts(null)
          setLoadedKey(contextKey)
          return
        }
        setExcludedIds(new Set(view.files.filter((file) => file.excluded).map((file) => file.id)))
        setUnitCounts(
          new Map(view.files.map((file) => [file.id, file.units.length])),
        )
        setToggleError(null)
        setLoadedKey(contextKey)
      },
      () => {
        if (!live) return
        setExcludedIds(null)
        setUnitCounts(null)
        setLoadedKey(contextKey)
      },
    )
    return () => {
      live = false
    }
  }, [config, contextKey, loadedKey, sectorId, documents.length])
  const contextKnown = excludedIds !== null && loadedKey === contextKey

  async function toggleDocument(documentId: string, excluded: boolean) {
    if (!config || togglingId) return
    setTogglingId(documentId)
    setToggleError(null)
    try {
      const ref = { documentId }
      const view = await patchSectorContext(config, sectorId, excluded ? { exclude: [ref] } : { include: [ref] })
      setExcludedIds(new Set(view.files.filter((file) => file.excluded).map((file) => file.id)))
      setUnitCounts(new Map(view.files.map((file) => [file.id, file.units.length])))
    } catch (error: unknown) {
      setToggleError(error instanceof Error ? error.message : 'Could not update context.')
    } finally {
      setTogglingId(null)
    }
  }

  const showPending = attaching && attachingName
  return (
    <section aria-label={`Context documents for ${sectorName}`} className="px-4 py-3">
      <h2 className="text-base font-semibold">Files</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The sweep reads these when research runs. The eye toggle adds or removes a file from context.
      </p>
      <div className="mt-3">
        {documentsFailed ? (
          <p className="text-sm text-muted-foreground">Context documents did not load.</p>
        ) : documents.length || showPending ? (
          <ul className="space-y-2">
            {showPending ? (
              <li className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2 text-sm">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{attachingName}</span>
                  <span role="status" className="mt-0.5 block text-xs text-muted-foreground">
                    Processing…
                  </span>
                </span>
              </li>
            ) : null}
            {documents.map((doc) => {
              const excluded = excludedIds?.has(doc.id) ?? false
              const known = contextKnown
              const units = unitCounts?.get(doc.id)
              const status =
                doc.status === 'needs-ocr'
                  ? 'Needs OCR'
                  : `Indexed${units === undefined ? '' : ` · ${units} ${units === 1 ? 'unit' : 'units'}`}`
              const meta = `${status} · ${(doc.chars / 1000).toFixed(1)}k chars${excluded ? ' · excluded from context' : ''}`
              const Icon =
                doc.mediaType.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(doc.filename)
                  ? FileImage
                  : /\.csv$/i.test(doc.filename)
                    ? FileSpreadsheet
                    : FileText
              return (
                <li
                  key={doc.id}
                  className={`flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm ${excluded ? 'opacity-60' : ''}`}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Icon className="size-4 text-muted-foreground" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{doc.filename}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{meta}</span>
                  </span>
                  {known ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={excluded ? `Include ${doc.filename}` : `Exclude ${doc.filename}`}
                      title={excluded ? `Include ${doc.filename} in context` : `Exclude ${doc.filename} from context`}
                      disabled={togglingId === doc.id}
                      onClick={() => void toggleDocument(doc.id, !excluded)}
                      className="size-7 shrink-0"
                    >
                      {excluded ? (
                        <Eye className="size-4" aria-hidden />
                      ) : (
                        <EyeOff className="size-4" aria-hidden />
                      )}
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No context attached yet.</p>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Attach a context file"
          disabled={attaching}
          onClick={() => filePicker.current?.click()}
        >
          <Upload className="size-4" aria-hidden />
        </Button>
        <input
          ref={filePicker}
          type="file"
          className="sr-only"
          tabIndex={-1}
          accept=".md,.markdown,.txt,.csv,.json,.pdf,.docx,.png,.jpg,.jpeg,.webp,.gif"
          disabled={attaching}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            onAttach(file)
          }}
        />
        {toggleError ? (
          <p role="alert" className="mt-1 text-sm text-muted-foreground">
            {toggleError}
          </p>
        ) : null}
        {attachError ? (
          <p role="alert" className="mt-1 text-sm text-muted-foreground">
            {attachError}
          </p>
        ) : null}
        {attachResult && !attaching && !attachError ? (
          <p role="status" className="mt-1 text-sm text-muted-foreground">
            {attachResult.filename} {attachResult.status === 'indexed' ? `indexed · ${attachResult.unitCount} units` : `needs OCR${attachResult.detail ? `: ${attachResult.detail}` : ''}`}
          </p>
        ) : null}
      </div>
    </section>
  )
}

export function SectorDetailPage({
  detail,
  status,
  documents,
  documentsFailed,
  attaching,
  attachingName,
  attachError,
  attachResult = null,
  researchBusy,
  researchError,
  staging,
  onRetry,
  onPauseResearch,
  onResumeResearch,
  onStartResearch,
  onRestartResearch,
  onPlanResearch,
  onApproveResearch,
  onEditResearchPlan,
  onAttach,
  onBack,
}: {
  detail: SectorDetail | undefined
  status: ResearchStatus
  documents: SectorDocumentSummary[]
  documentsFailed: boolean
  attaching: boolean
  attachingName: string | null
  attachError: string | null
  attachResult?: AttachResult | null
  researchBusy: boolean
  researchError: string | null
  staging: StagingConfig | null
  onRetry: () => void
  onPauseResearch: () => Promise<void>
  onResumeResearch: () => Promise<void>
  onStartResearch: () => Promise<void>
  onRestartResearch: () => Promise<void>
  onPlanResearch: () => Promise<void>
  onApproveResearch: (version: number) => Promise<void>
  onEditResearchPlan: (markdown: string) => Promise<void>
  onAttach: (file: File) => void
  onBack: () => void
}) {
  type PillarTab = 'all' | 'research' | 'chat' | 'context' | 'files'
  const [activePillar, setActivePillar] = useState<PillarTab>('all')

  // While a sweep or plan run is away, the detail (strip, state,
  // embedded companies) re-reads so the page follows the run. Terminal
  // and pre-start states stay quiet: no polling on draft, paused,
  // complete, failed, planned, or approved.
  const researchLive = detail?.state === 'queued' || detail?.state === 'running' || detail?.state === 'planning'
  useEffect(() => {
    if (!researchLive || !staging) return
    const timer = setInterval(onRetry, RESEARCH_POLL_MS)
    return () => clearInterval(timer)
  }, [researchLive, staging, onRetry])
  if (!detail && status === 'ready') {
    return (
      <div className="space-y-6">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          Back to Researches
        </Button>
        <p className="rounded-xl border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
          Sector research not found. It may have been removed.
        </p>
      </div>
    )
  }
  if (status === 'denied') {
    return (
      <div className="space-y-6">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          Back to Researches
        </Button>
        <DeniedNotice heading="This sector research is not shared with this key." />
      </div>
    )
  }
  if (status === 'loading' || !detail) {
    return (
      <div className="space-y-6">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          Back to Researches
        </Button>
        <SkeletonRows label={`${detail?.name ?? 'Sector research'} is loading`} />
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="space-y-6">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          Back to Researches
        </Button>
        <PanelError
          heading={`${detail.name} did not load.`}
          detail="Check your connection and try again."
          onRetry={onRetry}
        />
      </div>
    )
  }
  if (status === 'offline') {
    return (
      <div className="space-y-6">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden />
          Back to Researches
        </Button>
        <UnavailableNotice onRetry={onRetry} />
      </div>
    )
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-border pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={onBack} className="-ml-2 gap-1.5 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden />
            <span>Back to Researches</span>
          </Button>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${
                detail.state === 'running'
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : detail.state === 'paused'
                    ? 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : detail.state === 'failed'
                      ? 'border-destructive/20 bg-destructive/10 text-destructive'
                      : detail.state === 'complete'
                        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'border-border bg-muted text-muted-foreground'
              }`}
            >
              {detail.state === 'running' ? (
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
              ) : null}
              {stateLabel[detail.state]}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-lg font-bold tracking-tight text-foreground sm:text-xl">{detail.name}</p>
            {detail.topic ? (
              <p className="text-xs text-muted-foreground sm:text-sm">{detail.topic}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2 sm:pt-0">
            <div role="tablist" aria-label="Sector view modes" className="inline-flex rounded-lg border border-border bg-muted/60 p-1 text-xs">
              <button
                type="button"
                role="tab"
                aria-selected={activePillar === 'all'}
                onClick={() => setActivePillar('all')}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  activePillar === 'all'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Workbench (All)
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activePillar === 'research'}
                onClick={() => setActivePillar('research')}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  activePillar === 'research'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Research Activity
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activePillar === 'chat'}
                onClick={() => setActivePillar('chat')}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  activePillar === 'chat'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Sector Chat
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activePillar === 'context'}
                onClick={() => setActivePillar('context')}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  activePillar === 'context'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Context Studio
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activePillar === 'files'}
                onClick={() => setActivePillar('files')}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  activePillar === 'files'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Files Hub
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={activePillar === 'all' || activePillar === 'research' ? 'block' : 'hidden'}>
        <SectorPlanSection
          config={staging}
          sectorId={detail.id}
          sectorName={detail.name}
          sectorState={detail.state}
          researchBusy={researchBusy}
          planError={researchError}
          onPlan={onPlanResearch}
          onApprove={onApproveResearch}
          onEdit={onEditResearchPlan}
        />
      </div>

      <div
        className={
          activePillar === 'all'
            ? 'grid grid-cols-1 items-start gap-6 md:grid-cols-2'
            : 'space-y-6'
        }
      >
        <section
          aria-label={`Sector chat for ${detail.name}`}
          className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background px-4 py-3 ${
            activePillar === 'all'
              ? 'md:h-[calc(100vh-14rem)] md:min-h-[480px]'
              : activePillar === 'chat'
                ? 'block h-[calc(100vh-16rem)] min-h-[540px]'
                : 'hidden'
          }`}
        >
          <h2 className="text-base font-semibold">Sector chat</h2>
          <div className="mt-3 min-h-0 flex-1">
            <SectorChatPanel
              config={staging}
              sectorId={detail.id}
              sectorName={detail.name}
              researchState={detail.state}
              researchSessionId={detail.researchSessionId ?? null}
              researchBusy={researchBusy}
              researchError={researchError}
              onPauseResearch={onPauseResearch}
              onResumeResearch={onResumeResearch}
              onStartResearch={onStartResearch}
              onRestartResearch={onRestartResearch}
              onPlanResearch={onPlanResearch}
            />
          </div>
        </section>

        <div
          className={`flex min-h-0 flex-col gap-6 ${
            activePillar === 'all'
              ? 'md:h-[calc(100vh-14rem)] md:min-h-[480px]'
              : activePillar === 'context' || activePillar === 'files'
                ? 'block'
                : 'hidden'
          }`}
        >
          <div
            className={`scroll-slim min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-background ${
              activePillar === 'all' || activePillar === 'files' ? 'block' : 'hidden'
            }`}
          >
            <DocumentsSection
              config={staging}
              sectorId={detail.id}
              sectorName={detail.name}
              documents={documents}
              documentsFailed={documentsFailed}
              attaching={attaching}
              attachingName={attachingName}
              attachError={attachError}
              attachResult={attachResult}
              onAttach={onAttach}
            />
          </div>
          <div
            className={`scroll-slim min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-background ${
              activePillar === 'all' || activePillar === 'context' ? 'block' : 'hidden'
            }`}
          >
            <SectorContextDrawer config={staging} sectorId={detail.id} sectorName={detail.name} />
          </div>
        </div>
      </div>

      <div className={activePillar === 'all' || activePillar === 'research' ? 'space-y-6' : 'hidden'}>
        <CompanySection staging={staging} sectorId={detail.id} sectorName={detail.name} pollActive={researchLive} />
        <RunConsole config={staging} sector={detail} activity={detail.activity} activityTotal={detail.activityTotal} />
      </div>
    </div>
  )
}
