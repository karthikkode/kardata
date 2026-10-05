// Research plan tab (PL-01/PL-05): plan header with status and
// actions, narrative brief plus executable steps, version history, and
// the work ledger below. Extracted from the workspace so the tab reads
// as one composition; behaviour matches the previous inline version.
import { useState } from 'react'
import { Icons } from '@/lib/icons'
import type { Resource } from '../../data/useWorkspace'
import type { ResearchState, SectorPlanView } from '../../data/staging-api'
import type { GlobalContext, ResearchProgress } from '../../data/workspace-api'
import type { ResearchActions } from '../SectorWorkspace'
import type { WorkReview } from '../workspace-parts'
import { formatFullDate, relativeAge } from '../../lib/format'
import { PlanDocument } from '../shells'
import { PlanProgress, ResourceNotice } from '../workspace-parts'
import {
  ExecutablePlanDetails,
  NarrativePlanWarning,
  PlanBriefTimeline,
  PlanVersionTimeline,
  ResearchPlanEditor,
} from '../ResearchPlanEditor'
import { PlanTimelineSkeleton } from './PlanSteps'
import { Caption, CardTitle, Description } from '../text'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { TooltipPopup, TooltipRoot, TooltipTrigger } from '../ui/tooltip'

export function ResearchPlanTab({
  sectorState,
  plan,
  progress,
  global,
  actions,
  workReview,
}: {
  sectorState: ResearchState
  plan: Resource<SectorPlanView>
  progress: Resource<ResearchProgress>
  global: Resource<GlobalContext>
  actions: ResearchActions
  workReview: WorkReview
}) {
  const [editorOpen, setEditorOpen] = useState(false)
  const latest = plan.status === 'ready' ? (plan.data?.latest ?? null) : null
  const approved = latest !== null && plan.data?.approvedVersion === latest.version
  const editable = sectorState === 'planned' || sectorState === 'approved' || sectorState === 'paused'
  const approvalBlocked = global.status !== 'ready' || !global.data

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ResourceNotice resource={plan} label="Research plan" />
      {plan.status === 'ready' && latest ? (
        <PlanDocument
          heading="Research plan"
          version={`v${latest.version}`}
          status={
            <>
              {approved ? (
                <Badge tone="success">
                  <Icons.approve aria-hidden />
                  Approved
                </Badge>
              ) : sectorState === 'planned' ? (
                <Badge tone="warning">Awaiting approval</Badge>
              ) : (
                <Badge tone="neutral">Draft</Badge>
              )}
              <Caption as="span" className="shrink-0 tabular-nums">
                <time dateTime={latest.at} title={formatFullDate(latest.at)}>
                  Updated {relativeAge(latest.at)}
                </time>
              </Caption>
            </>
          }
          actions={
            editable ? (
              <>
                {sectorState === 'planned' ? (
                  approvalBlocked ? (
                    <TooltipRoot>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            aria-disabled
                            pending={actions.busy}
                            onClick={() => {
                              if (!approvalBlocked && !actions.busy) actions.approve(latest.version, global.data?.version)
                            }}
                          >
                            <Icons.approve aria-hidden />
                            {actions.busy ? 'Approving…' : `Approve v${latest.version}`}
                          </Button>
                        }
                      />
                      <TooltipPopup>Approval unlocks when shared context loads.</TooltipPopup>
                    </TooltipRoot>
                  ) : (
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      pending={actions.busy}
                      onClick={() => actions.approve(latest.version, global.data?.version)}
                    >
                      <Icons.approve aria-hidden />
                      {actions.busy ? 'Approving…' : `Approve v${latest.version}`}
                    </Button>
                  )
                ) : null}
                <ResearchPlanEditor
                  markdown={latest.markdown}
                  executable={latest.executable}
                  busy={actions.busy}
                  error={actions.error}
                  onSave={actions.edit}
                  open={editorOpen}
                  onOpenChange={setEditorOpen}
                />
              </>
            ) : undefined
          }
        >
          <PlanBriefTimeline text={latest.markdown} />
          {!latest.executable ? (
            <div className="mt-4">
              <NarrativePlanWarning onEdit={editable ? () => setEditorOpen(true) : undefined} />
            </div>
          ) : null}
          {latest.executable ? (
            <ExecutablePlanDetails
              plan={latest.executable}
              workItems={progress.data?.items ?? []}
              researchState={sectorState}
              onStart={actions.start}
            />
          ) : null}
          <div className="mt-6 border-t border-border-subtle pt-2">
            <PlanVersionTimeline
              versions={(plan.data?.versions ?? []).map((entry) => ({ version: entry.version, at: entry.at }))}
              latestVersion={latest.version}
              approvedVersion={plan.data?.approvedVersion ?? null}
            />
          </div>
        </PlanDocument>
      ) : plan.status === 'ready' ? (
        <PlanEmpty planning={actions.busy} onPlan={actions.plan} />
      ) : null}
      <PlanProgress resource={progress} review={workReview} />
    </div>
  )
}

/** Empty plan (PL-05): first-run empty, or the planning skeleton while
 * the agent drafts. */
function PlanEmpty({ planning, onPlan }: { planning: boolean; onPlan(): void }) {
  if (planning) {
    return (
      <div>
        <PlanTimelineSkeleton steps={5} />
        <Caption className="mt-3">Your research agent is drafting the plan.</Caption>
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-col items-center py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Icons.plan aria-hidden className="size-5 text-muted-foreground" />
      </span>
      <CardTitle className="mt-3">No research plan yet</CardTitle>
      <Description className="mt-1 max-w-80">
        Create a plan to lock search queries, limits and acceptance criteria before research starts.
      </Description>
      <div className="mt-4">
        <Button type="button" variant="primary" onClick={onPlan}>
          <Icons.plan aria-hidden />
          Create plan
        </Button>
      </div>
    </div>
  )
}
