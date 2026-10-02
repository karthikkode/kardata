// Sector plan panel: props → render → states. The versioned research
// plan artifact with its lifecycle copy; the section reads its own
// artifact (panel-key pattern: resets during render, fetch in effect)
// and re-reads while a plan run is away.
import { useEffect, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import {
  apiErrorStatus,
  readSectorPlan,
  type ResearchState,
  type SectorPlanView,
  type StagingConfig,
} from '../data/staging-api'
import { Markdown } from './Markdown'
import { Button } from './ui/button'
import { DeniedNotice, PanelError, SkeletonRows, UnavailableNotice } from './research-parts'

type PlanState =
  | { status: 'closed' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'denied' }
  | { status: 'offline' }
  | { status: 'ready'; plan: SectorPlanView }

const PLAN_POLL_MS = 5000

export function SectorPlanSection({
  config,
  sectorId,
  sectorName,
  sectorState,
  researchBusy,
  planError,
  onPlan,
  onApprove,
  onEdit,
}: {
  config: StagingConfig | null
  sectorId: string
  sectorName: string
  sectorState: ResearchState
  researchBusy: boolean
  planError: string | null
  onPlan: () => Promise<void>
  onApprove: (version: number) => Promise<void>
  onEdit: (markdown: string) => Promise<void>
}) {
  const [state, setState] = useState<PlanState>({ status: 'closed' })
  const [attempt, setAttempt] = useState(0)
  const panelKey = config ? `${config.baseUrl} ${config.apiKey} ${sectorId} ${attempt}` : null
  const [activePanelKey, setActivePanelKey] = useState<string | null>(null)
  if (activePanelKey !== panelKey) {
    setActivePanelKey(panelKey)
    setState(panelKey ? { status: 'loading' } : { status: 'closed' })
  }
  // Re-read on every state transition (artifact writes land with
  // transitions) and on demand; plus a quiet poll while planned, when
  // brainstorm collaborators may version underneath an open panel.
  useEffect(() => {
    if (!config) return
    let live = true
    readSectorPlan(config, sectorId).then(
      (plan) => {
        if (live) setState({ status: 'ready', plan })
      },
      (error: unknown) => {
        if (!live) return
        const kind = apiErrorStatus(error)
        if (kind === 'denied') setState({ status: 'denied' })
        else if (kind === 'offline') setState({ status: 'offline' })
        else setState({ status: 'error', message: error instanceof Error ? error.message : 'Plan did not load.' })
      },
    )
    return () => {
      live = false
    }
  }, [config, sectorId, attempt, sectorState])
  useEffect(() => {
    if (sectorState !== 'planned' || !config) return
    const timer = setInterval(() => setAttempt((value) => value + 1), PLAN_POLL_MS)
    return () => clearInterval(timer)
  }, [sectorState, config])
  if (state.status === 'closed') return null
  return (
    <section aria-label={`Research plan for ${sectorName}`} className="overflow-hidden rounded-2xl border border-border bg-background shadow-xs">
      <div className="flex items-center gap-2.5 border-b border-border bg-muted/30 px-4 py-3.5">
        <ClipboardList className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="min-w-0 flex-1 text-sm font-semibold tracking-tight">Research plan</h2>
      </div>
      <div className="px-4 py-4">
      {state.status === 'loading' ? (
        <div className="mt-3">
          <SkeletonRows label="Research plan is loading" />
        </div>
      ) : state.status === 'denied' ? (
        <div className="mt-3">
          <DeniedNotice heading="The research plan is not shared with this key." />
        </div>
      ) : state.status === 'offline' ? (
        <div className="mt-3">
          <UnavailableNotice onRetry={() => setAttempt((value) => value + 1)} />
        </div>
      ) : state.status === 'error' ? (
        <div className="mt-3">
          <PanelError
            heading="Research plan did not load."
            detail="Check your connection and try again."
            onRetry={() => setAttempt((value) => value + 1)}
          />
        </div>
      ) : (
        <div className="mt-2">
          {planError ? (
            <p role="alert" className="mb-2 text-sm text-muted-foreground">
              {planError}
            </p>
          ) : null}
          {state.plan.latest ? (
            <>
              <p className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2.5 py-0.5 font-mono text-xs tabular-nums text-muted-foreground select-none">v{state.plan.latest.version}</p>
              <div className="mt-3 text-sm">
                <Markdown text={state.plan.latest.markdown} />
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-5 text-center">
              <ClipboardList className="mx-auto size-6 text-muted-foreground" aria-hidden />
              <p className="mt-2 text-sm font-semibold">No research plan yet</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">Create a plan for {sectorName} to lock queries, limits, and acceptance criteria.</p>
            </div>
          )}
          {sectorState === 'draft' || sectorState === 'failed' ? (
            <Button
              type="button"
              variant="default"
              size="sm"
              className="mt-3"
              disabled={researchBusy}
              onClick={() => void onPlan()}
            >
              {researchBusy ? 'Planning…' : 'Plan research'}
            </Button>
          ) : null}
          {sectorState === 'planned' && state.plan.latest ? (
            <Button
              type="button"
              variant="default"
              size="sm"
              className="mt-3"
              disabled={researchBusy}
              onClick={() => void onApprove(state.plan.latest?.version ?? 0)}
            >
              Approve v{state.plan.latest.version}
            </Button>
          ) : null}
          {sectorState === 'planned' || sectorState === 'approved' ? (
            <PlanEdit
              key={state.plan.latest?.version ?? 0}
              initial={state.plan.latest?.markdown ?? ''}
              disabled={researchBusy}
              onSave={(markdown) => {
                void onEdit(markdown).then(() => setAttempt((value) => value + 1))
              }}
            />
          ) : null}
        </div>
      )}
      </div>
    </section>
  )
}

function PlanEdit({
  initial,
  disabled,
  onSave,
}: {
  initial: string
  disabled: boolean
  onSave: (markdown: string) => void
}) {
  const [draft, setDraft] = useState(initial)
  return (
    <div className="mt-3 grid max-w-md gap-2">
      <label htmlFor="sector-plan-edit" className="mb-1 block text-sm font-medium">
        Edit plan
      </label>
      <textarea
        id="sector-plan-edit"
        rows={6}
        className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || !draft.trim()}
        onClick={() => onSave(draft)}
      >
        Save plan edit
      </Button>
    </div>
  )
}
