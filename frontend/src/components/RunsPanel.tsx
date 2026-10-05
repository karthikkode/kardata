// Runs view: real agent runs from the backend, nothing staged. Rows show
// run state, thread link, and stage; running runs can be cancelled after
// an explicit confirm. There is no launching: the backend exposes no
// primitive for it, so the view observes and stops only.
import { useCallback, useEffect, useState } from 'react'
import { Icons } from '@/lib/icons'
import { humanizeKey } from '@/lib/format'
import { notify } from '@/lib/toast'
import { cancelRun } from '../data/api/commands'
import { listRuns, type RunSummary, type RunState } from '../data/api/runs'
import { StagingApiError, type StagingConfig } from '../data/api/client'
import { DataTable, type DataTableColumn } from './DataTable'
import { IconButton } from './IconButton'
import { DeniedNotice, PanelError, SkeletonRows, UnavailableNotice } from './research-parts'
import { SearchField, SectionCard } from './shells'
import { StatusPill, type StatusTone } from './StatusPill'
import { BodySm, Caption, Mono } from './text'
import { ConfirmAction } from './ui/alert-dialog'
import { Button } from './ui/button'

function toneFor(state: RunState): StatusTone {
  switch (state) {
    case 'RUNNING':
      return 'working'
    case 'PAUSED':
    case 'SUSPENDED':
    case 'CANCELLING':
      return 'paused'
    case 'FINISHED':
      return 'ok'
    case 'ERROR':
      return 'failed'
    default:
      return 'idle'
  }
}

function labelFor(state: RunState): string {
  switch (state) {
    case 'IDLE':
      return 'Idle'
    case 'RUNNING':
      return 'Running'
    case 'PAUSED':
      return 'Paused'
    case 'SUSPENDED':
      return 'Suspended'
    case 'CANCELLING':
      return 'Cancelling'
    case 'FINISHED':
      return 'Finished'
    case 'ERROR':
      return 'Error'
  }
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id
}

export function RunsPanel({
  config,
  refreshSignal = 0,
  onLoadingChange,
}: {
  /** Null until the staging flag carries credentials: runs are
   * backend-only, so without a config the view explains instead. */
  config: StagingConfig | null
  /** Bumped by the page header Refresh to reload outside the poll. */
  refreshSignal?: number
  /** Reports the loading state so the header Refresh can spin honestly. */
  onLoadingChange?: (loading: boolean) => void
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'denied' | 'offline'>('loading')
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [query, setQuery] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<RunSummary | null>(null)

  // Reset during render, never in the load callback: when the query
  // changes the previous rows no longer belong to it.
  const queryKey = config ? `${config.baseUrl} ${config.apiKey} ${attempt} ${refreshSignal}` : null
  const [activeQuery, setActiveQuery] = useState<string | null>(null)
  if (activeQuery !== queryKey) {
    setActiveQuery(queryKey)
    if (queryKey === null) {
      setRuns([])
      setStatus('ready')
    } else {
      setStatus('loading')
    }
  }

  const load = useCallback(() => {
    if (!config) return () => undefined
    let live = true
    listRuns(config)
      .then((rows) => {
        if (!live) return
        setRuns(rows)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (!live) return
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          setStatus('offline')
        } else if (
          error instanceof StagingApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          setStatus('denied')
        } else {
          setStatus('error')
        }
      })
    return () => {
      live = false
    }
  }, [config?.baseUrl, config?.apiKey, attempt, refreshSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cleanup = load()
    return cleanup
  }, [load])

  useEffect(() => {
    onLoadingChange?.(status === 'loading')
  }, [status, onLoadingChange])

  // Live list while the tab is visible; hidden tabs keep their rows
  // without churning the backend.
  useEffect(() => {
    if (!config) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [config, load])

  async function confirmCancel() {
    const run = confirming
    if (!config || !run) return
    setCancelling(run.id)
    try {
      await cancelRun(config, run.id)
      setConfirming(null)
      load()
    } catch {
      notify.error(`Could not cancel run ${shortId(run.id)}. Try again.`)
    } finally {
      setCancelling(null)
    }
  }

  const needle = query.trim().toLowerCase()
  const rows = runs.filter(
    (run) =>
      !needle ||
      run.id.toLowerCase().includes(needle) ||
      run.threadKey.toLowerCase().includes(needle),
  )

  const columns: DataTableColumn<RunSummary>[] = [
    {
      id: 'run',
      header: 'Run',
      cell: (run) => (
        <span className="group/run inline-flex min-w-0 items-center gap-1">
          <Mono title={run.id}>{shortId(run.id)}</Mono>
          <IconButton
            label={`Copy run id ${shortId(run.id)}`}
            size="icon-sm"
            className="opacity-0 group-hover/run:opacity-100 focus-visible:opacity-100"
            onClick={() => void navigator.clipboard.writeText(run.id)}
          >
            <Icons.copy aria-hidden className="size-4" />
          </IconButton>
        </span>
      ),
      sortValue: (run) => run.id,
    },
    {
      id: 'conversation',
      header: 'Conversation',
      cell: (run) => <BodySm as="span" className="block truncate">{run.threadKey}</BodySm>,
      sortValue: (run) => run.threadKey,
    },
    {
      id: 'stage',
      header: 'Stage',
      cell: (run) => (
        <BodySm as="span" className="block truncate">
          {run.stageCursor ? humanizeKey(run.stageCursor) : <span className="text-muted-foreground">Not reported</span>}
        </BodySm>
      ),
      sortValue: (run) => run.stageCursor ?? null,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (run) => <StatusPill tone={toneFor(run.state)} label={labelFor(run.state)} />,
      sortValue: (run) => run.state,
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (run) =>
        run.state === 'RUNNING' || run.state === 'PAUSED' ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-danger hover:text-danger"
            disabled={cancelling === run.id}
            onClick={() => setConfirming(run)}
          >
            {cancelling === run.id ? 'Cancelling' : 'Cancel'}
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="space-y-6">
      <SectionCard
        title="Runs"
        metadata={
          <Caption as="span" aria-live="polite" className="shrink-0 tabular-nums">
            {status === 'ready' ? `${rows.length} of ${runs.length} runs` : null}
          </Caption>
        }
        actions={<SearchField value={query} onChange={setQuery} label="Search runs" clearLabel="Clear search" className="w-full sm:w-64" />}
      >
        {!config ? (
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm font-medium">Runs need a backend connection.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Set the staging API URL and key, then reload.
            </p>
          </div>
        ) : status === 'loading' ? (
          <SkeletonRows label="Agent runs are loading" />
        ) : status === 'error' ? (
          <PanelError
            heading="Agent runs did not load."
            detail="Check your connection and try again."
            onRetry={() => setAttempt((value) => value + 1)}
          />
        ) : status === 'denied' ? (
          <DeniedNotice heading="Agent runs are not shared with this key." />
        ) : status === 'offline' ? (
          <UnavailableNotice onRetry={() => setAttempt((value) => value + 1)} />
        ) : rows.length ? (
          <DataTable
            data={rows}
            columns={columns}
            rowKey={(run) => run.id}
            ariaLabel="Agent runs"
            empty={null}
          />
        ) : needle ? (
          <div className="flex min-w-0 flex-col items-center py-12 text-center">
            <p className="text-sm font-medium">No runs match this filter.</p>
            <div className="mt-4">
              <Button type="button" variant="ghost" size="sm" onClick={() => setQuery('')}>
                Clear
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col items-center py-12 text-center">
            <p className="text-sm font-medium">No runs yet</p>
            <p className="mt-1 max-w-80 text-sm text-muted-foreground">
              Runs appear here once sessions start working.
            </p>
          </div>
        )}
        {/* Budget/context ratios stay out of the rows: the backend reports
            0 until it measures them, and a permanent "budget 0%" would
            present a placeholder as live telemetry. */}
      </SectionCard>
      <ConfirmAction
        open={confirming !== null}
        onOpenChange={(next) => { if (!next) setConfirming(null) }}
        title="Cancel this run?"
        description="The agent stops after its current step."
        confirmLabel="Cancel run"
        pending={cancelling !== null}
        onConfirm={confirmCancel}
      />
    </div>
  )
}
