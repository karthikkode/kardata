// Runs view: real agent runs from the backend, nothing staged. Rows show
// run state, thread link, and budget/context ratios; running runs can be
// cancelled. There is no launching: the backend exposes no primitive for
// it, so the view observes and stops only.
import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Square } from 'lucide-react'
import {
  cancelRun,
  listRuns,
  StagingApiError,
  type RunSummary,
  type RunState,
  type StagingConfig,
} from '../data/staging-api'
import { DeniedNotice, PanelError, SkeletonRows, UnavailableNotice } from './research-parts'
import { StatusPill, type StatusTone } from './StatusPill'
import { Button } from './ui/button'
import { Input } from './ui/input'

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

function RunRow({
  run,
  cancelling,
  onCancel,
}: {
  run: RunSummary
  cancelling: boolean
  onCancel: (run: RunSummary) => void
}) {
  const live = run.state === 'RUNNING' || run.state === 'PAUSED'
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-background px-4 py-3 shadow-xs motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{run.id}</p>
        <p className="truncate text-xs text-muted-foreground">
          thread {run.threadKey}
          {run.stageCursor ? ` · ${run.stageCursor}` : ''}
        </p>
        {/* Budget/context ratios stay out of the row: the backend reports
            0 until it measures them, and a permanent "budget 0%" would
            present a placeholder as live telemetry. */}
      </div>
      <StatusPill tone={toneFor(run.state)} label={labelFor(run.state)} />
      {live ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={cancelling}
          onClick={() => onCancel(run)}
        >
          {cancelling ? 'Cancelling' : <><Square className="size-4" aria-hidden />Cancel</>}
        </Button>
      ) : null}
    </li>
  )
}

export function RunsPanel({
  config,
  onBack,
}: {
  /** Null until the staging flag carries credentials: runs are
   * backend-only, so without a config the view explains instead. */
  config: StagingConfig | null
  onBack: () => void
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'denied' | 'offline'>('loading')
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [query, setQuery] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)

  // Reset during render, never in the load callback: when the query
  // changes the previous rows no longer belong to it.
  const queryKey = config ? `${config.baseUrl} ${config.apiKey} ${attempt}` : null
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
  }, [config?.baseUrl, config?.apiKey, attempt]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cleanup = load()
    return cleanup
  }, [load])

  function cancel(run: RunSummary) {
    if (!config) return
    setCancelling(run.id)
    setCancelError(null)
    cancelRun(config, run.id)
      .then(() => load())
      .catch(() => setCancelError(`Could not cancel run ${run.id}. Try again.`))
      .finally(() => setCancelling(null))
  }

  const needle = query.trim().toLowerCase()
  const rows = runs.filter(
    (run) =>
      !needle ||
      run.id.toLowerCase().includes(needle) ||
      run.threadKey.toLowerCase().includes(needle),
  )

  return (
    <div className="space-y-6">
      <Button type="button" variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="size-4" aria-hidden />
        Back to Overview
      </Button>
      <section
        aria-label="Agent runs"
        className="rounded-xl border border-border bg-background px-4 py-3"
      >
        <div className="max-w-sm">
          <label htmlFor="runs-filter" className="mb-1 block text-sm font-medium">
            Filter runs
          </label>
          <Input
            id="runs-filter"
            placeholder="Type to filter"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="mt-4">
          {cancelError ? (
            <p role="alert" className="mb-2 text-sm text-muted-foreground">
              {cancelError}
            </p>
          ) : null}
          {!config ? (
            <div className="rounded-lg border border-dashed border-border p-4">
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
            <ul className="space-y-2">
              {rows.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  cancelling={cancelling === run.id}
                  onCancel={cancel}
                />
              ))}
            </ul>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-4">
              <p className="text-sm text-muted-foreground">
                {needle
                  ? 'No runs match this filter. Clear it to see everything.'
                  : 'No runs yet. Runs appear here once sessions start working.'}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
