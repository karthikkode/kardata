// Sector plan panel: props → render → states. The versioned research
// plan artifact with its lifecycle copy; the section reads its own
// artifact (panel-key pattern: resets during render, fetch in effect)
// and re-reads while a plan run is away.
import { useEffect, useState } from 'react'
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
}: {
  config: StagingConfig | null
  sectorId: string
  sectorName: string
  sectorState: ResearchState
  researchBusy: boolean
  planError: string | null
  onPlan: () => Promise<void>
}) {
  const [state, setState] = useState<PlanState>({ status: 'closed' })
  const [attempt, setAttempt] = useState(0)
  const panelKey = config ? `${config.baseUrl} ${config.apiKey} ${sectorId} ${attempt}` : null
  const [activePanelKey, setActivePanelKey] = useState<string | null>(null)
  if (activePanelKey !== panelKey) {
    setActivePanelKey(panelKey)
    setState(panelKey ? { status: 'loading' } : { status: 'closed' })
  }
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
  }, [config, sectorId, attempt])
  // While a plan run is away, the artifact re-reads so versions land.
  useEffect(() => {
    if (sectorState !== 'planning' || !config) return
    const timer = setInterval(() => setAttempt((value) => value + 1), PLAN_POLL_MS)
    return () => clearInterval(timer)
  }, [sectorState, config])
  if (state.status === 'closed') return null
  return (
    <section aria-label={`Research plan for ${sectorName}`} className="rounded-xl border border-border bg-background px-4 py-3">
      <h2 className="text-base font-semibold">Research plan</h2>
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
              <p className="text-xs text-muted-foreground">v{state.plan.latest.version}</p>
              <div className="mt-1 text-sm">
                <Markdown text={state.plan.latest.markdown} />
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No research plan yet for {sectorName}.</p>
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
        </div>
      )}
    </section>
  )
}
