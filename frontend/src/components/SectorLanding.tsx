// Sector landing (SL-01..06): research status plus the sector's
// companies. The page header lives in App (single SH-01 frame); this
// file owns the status panel, the companies section, the progress
// dialog, and the not-found state.
import { useState } from 'react'
import { Icons } from '@/lib/icons'
import { formatDurationMs, formatShortDate, relativeAge } from '@/lib/format'
import { researchNextStep, statusSummary } from '@/lib/labels'
import { useWorkReview } from '../data/useWorkReview'
import type { ResearchStatus, SectorDetail } from '../data/research'
import type { StagingConfig } from '../data/staging-api'
import type { Resource } from '../data/useWorkspace'
import type { ResearchProgress } from '../data/workspace-api'
import { CompaniesSection } from './CompaniesSection'
import { IconButton } from './IconButton'
import { ExecutablePlanDetails, NarrativePlanWarning, PlanBriefTimeline } from './ResearchPlanEditor'
import { StateBadge } from './research-parts'
import { PlanDocument, ResourceState, SectionCard } from './shells'
import { Body, BodySm, Label, Numeric } from './text'
import { Button } from './ui/button'
import { CollapsiblePanel, CollapsibleRoot, CollapsibleTrigger } from './ui/collapsible'
import { ProgressRoot } from './ui/progress'
import { Skeleton } from './ui/skeleton'
import { CounterTile, PlanProgress, ResourceNotice, WorkspaceOverlay } from './workspace-parts'

function ProgressTile({
  progress,
  state,
}: {
  progress: Resource<ResearchProgress>
  state: SectorDetail['state']
}) {
  if (progress.status === 'loading') {
    return (
      <div className="rounded-lg border border-border bg-card px-3 py-2">
        <Label>Progress</Label>
        <Skeleton className="mt-0.5 h-5 w-16" />
      </div>
    )
  }
  if (progress.status !== 'ready' || !progress.data) {
    return (
      <div className="rounded-lg border border-border bg-card px-3 py-2">
        <Label>Progress</Label>
        <span className="mt-0.5 flex items-center gap-1">
          <BodySm as="span" className="text-muted-foreground">
            Unavailable
          </BodySm>
          <IconButton label="Retry progress" size="icon-sm" onClick={progress.refresh}>
            <Icons.retry className="size-4" aria-hidden />
          </IconButton>
        </span>
      </div>
    )
  }
  // Terminal states win over any estimate the progress payload carries:
  // a finished run never shows a stale percentage.
  if (state === 'complete') return <CounterTile label="Progress" value="Finished" />
  if (state === 'failed') return <CounterTile label="Progress" value="Stopped" tone="danger" />
  const percent = progress.data.estimatedPercent
  if (percent !== null && percent !== undefined) {
    return (
      <div className="rounded-lg border border-border bg-card px-3 py-2">
        <Label>Progress</Label>
        <Numeric className="mt-0.5 block text-md font-medium">{percent}%</Numeric>
        <ProgressRoot value={percent} aria-label="Estimated progress" className="mt-2" />
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <Label>Progress</Label>
      <span className="mt-0.5 flex items-center gap-1">
        <BodySm as="span" className="text-muted-foreground">
          Not estimated yet
        </BodySm>
        <IconButton
          label="The estimate appears once discovery has bounded the remaining work."
          size="icon-sm"
        >
          <Icons.alertInfo className="size-4" aria-hidden />
        </IconButton>
      </span>
    </div>
  )
}

/** Loading shape mirrors the landing: status card with tiles, then the companies card. */
function SectorLandingSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-hidden>
      <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="px-4 py-3">
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="border-t border-border-subtle px-4 py-2">
          <Skeleton className="mt-2 h-3.5 w-2/3" />
          <div className="grid grid-cols-2 gap-2 py-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((tile) => (
              <div key={tile} className="rounded-lg border border-border bg-card px-3 py-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-1.5 h-4 w-12" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="px-4 py-3">
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="border-t border-border-subtle px-4 py-2">
          <div className="flex gap-2 py-2">
            <Skeleton className="h-10 w-56" />
            <Skeleton className="h-10 w-40" />
          </div>
          <table className="v2-table-stack w-full border-collapse">
            <tbody>
              {[0, 1, 2, 3, 4].map((row) => (
                <tr key={row} className="h-11 border-b border-border-subtle last:border-b-0">
                  <td data-label="" className="px-2 py-2 sm:w-1/3">
                    <Skeleton className="h-3.5 w-3/4" />
                  </td>
                  <td data-label="Stage" className="px-2 py-2">
                    <Skeleton className="h-3 w-1/2" />
                  </td>
                  <td data-label="Status" className="px-2 py-2">
                    <Skeleton className="ml-auto h-5 w-20 rounded-sm" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export function SectorLanding({
  sector,
  status,
  config,
  progress,
  progressOpen,
  onProgressOpenChange,
  onOpen,
  onReviewPlan,
  onBack,
  onRetry,
}: {
  sector?: SectorDetail
  status: ResearchStatus
  config: StagingConfig | null
  progress: Resource<ResearchProgress>
  progressOpen: boolean
  onProgressOpenChange(open: boolean): void
  onOpen(): void
  onReviewPlan(): void
  onBack(): void
  onRetry(): void
}) {
  const [planOpen, setPlanOpen] = useState(false)
  const workReview = useWorkReview(config, progress)
  const live = sector?.state === 'running' || sector?.state === 'planning' || sector?.state === 'queued'
  const nextStep = sector ? researchNextStep(sector.state) : null
  const latestPlan = progress.status === 'ready' ? progress.data?.plan?.latest : undefined

  // The App page header already carries the state title (and a title
  // skeleton while loading), so these bodies suppress their own title
  // instead of repeating it.
  if (status !== 'ready') {
    return (
      <ResourceNotice
        resource={{ status, refresh: onRetry }}
        label="Sector"
        hideTitle
        skeleton={<SectorLandingSkeleton />}
      />
    )
  }
  if (!sector) {
    return (
      <ResourceState
        resource={{ status: 'ready', refresh: onRetry }}
        label="Sector"
        emptyKind="first"
        hideTitle
        icon={<Icons.notFound aria-hidden />}
        emptyTitle="Sector not found"
        emptyBody="This sector may have been removed."
        emptyAction={
          <Button type="button" variant="primary" size="sm" onClick={onBack}>
            Back to researches
          </Button>
        }
      />
    )
  }
  return (
    <>
      <div className="flex flex-col gap-8">
        <SectionCard title="Research status">
          <Body className="pt-2 text-muted-foreground">{statusSummary(sector.state)}</Body>
          <div aria-label="Research numbers" role="group" className="grid grid-cols-2 gap-2 py-2 lg:grid-cols-4">
            <CounterTile label="Companies found" value={sector.companiesFound} />
            <ProgressTile progress={progress} state={sector.state} />
            {progress.status === 'ready' && progress.data?.budgetUsedMs !== undefined ? (
              <CounterTile label="Active time" value={formatDurationMs(progress.data.budgetUsedMs)} />
            ) : null}
            <CounterTile label="Last activity" value={relativeAge(sector.updatedAt)} />
          </div>
          {nextStep ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pb-2">
              <BodySm as="span" className="text-muted-foreground">
                {nextStep.text}
              </BodySm>
              <Button
                type="button"
                variant="link"
                onClick={nextStep.action === 'review-plan' ? onReviewPlan : onOpen}
              >
                {nextStep.label}
              </Button>
            </div>
          ) : null}
        </SectionCard>
        <CompaniesSection
          staging={config}
          sectorId={sector.id}
          sectorState={sector.state}
          pollActive={live}
        />
      </div>
      <WorkspaceOverlay
        title="Research progress"
        titleBadge={<StateBadge state={sector.state} />}
        size="large"
        open={progressOpen}
        onClose={() => onProgressOpenChange(false)}
        footer={
          <Button type="button" variant="primary" onClick={onOpen}>
            Open workspace
            <Icons.openExternal className="size-4" aria-hidden />
          </Button>
        }
      >
        <div className="space-y-6">
          {latestPlan ? (
            <PlanDocument heading="Research plan" version={`v${latestPlan.version}`}>
              <CollapsibleRoot open={planOpen} onOpenChange={setPlanOpen}>
                <CollapsibleTrigger>
                  <Icons.chevronDown data-chevron className="size-4 text-muted-foreground" aria-hidden />
                  {planOpen ? 'Hide plan details' : 'Show plan details'}
                </CollapsibleTrigger>
                <CollapsiblePanel>
                  <div className="space-y-4 pt-2">
                    <PlanBriefTimeline text={latestPlan.markdown} />
                    {latestPlan.executable ? (
                      <ExecutablePlanDetails
                        plan={latestPlan.executable}
                        workItems={progress.data?.items ?? []}
                        researchState={sector.state}
                      />
                    ) : (
                      <NarrativePlanWarning onEdit={onReviewPlan} />
                    )}
                  </div>
                </CollapsiblePanel>
              </CollapsibleRoot>
            </PlanDocument>
          ) : null}
          <PlanProgress resource={progress} review={workReview} />
        </div>
      </WorkspaceOverlay>
    </>
  )
}

export function sectorMetaLine(sector: SectorDetail): string {
  return `Created ${formatShortDate(sector.createdAt)} · Updated ${relativeAge(sector.updatedAt)}`
}
