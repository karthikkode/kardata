import { useState } from 'react'
import { ArrowLeft, ArrowUpRight, ChartNoAxesCombined } from 'lucide-react'
import type { ResearchStatus, SectorDetail } from '../data/research'
import type { StagingConfig } from '../data/staging-api'
import type { Resource } from '../data/useWorkspace'
import type { ResearchProgress } from '../data/workspace-api'
import { Button } from './ui/button'
import { CompanySection } from './SectorDetailPage'
import { PlanProgress, ResourceNotice, WorkspaceOverlay } from './workspace-parts'
import { Markdown } from './Markdown'
import { stateLabel } from './research-parts'

export function SectorLanding({ sector, status, config, progress, onOpen, onBack, onRetry }: {
  sector?: SectorDetail; status: ResearchStatus; config: StagingConfig | null; progress: Resource<ResearchProgress>; onOpen(): void; onBack(): void; onRetry(): void
}) {
  const [open, setOpen] = useState(false)
  const live = sector?.state === 'running' || sector?.state === 'planning' || sector?.state === 'queued'
  const notStarted = sector && ['draft','planning','planned','approved'].includes(sector.state)
  return <div className="mx-auto max-w-4xl space-y-6"><Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="size-4" aria-hidden />Researches</Button><ResourceNotice resource={{ status, refresh: onRetry }} label="Sector" />{status === 'ready' && sector ? <>
    <section aria-label="Research status" className="overflow-hidden rounded-2xl border border-border bg-background"><div className="flex flex-wrap items-start justify-between gap-4 px-6 pt-6 sm:px-8"><div><p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Research status</p><h2 className="text-xl font-semibold">{stateLabel[sector.state]}</h2></div><Button variant="outline" size="sm" onClick={() => setOpen(true)}><ChartNoAxesCombined className="size-4" aria-hidden />View progress</Button></div>
      <div className="px-6 pt-4 pb-6 sm:px-8"><p className="max-w-lg rounded-lg bg-muted/30 px-3 py-2 text-sm leading-relaxed text-muted-foreground">{sector.state === 'draft' ? 'Start with a conversation. Build and approve a research plan when the direction is clear.' : sector.state === 'planning' ? 'Your research agent is preparing a plan for review.' : sector.state === 'planned' ? 'The research plan is ready for your review and approval.' : sector.state === 'approved' ? 'The approved plan is ready. Open the workspace to start research.' : sector.state === 'paused' ? 'Research is paused. Your work and conversations are saved.' : sector.state === 'running' || sector.state === 'queued' ? 'Research is in progress. Open the workspace to follow the agent or steer its work.' : sector.state === 'failed' ? 'Research needs attention. Open the workspace to review what happened.' : 'Research has finished. Review the results and saved conversations.'}</p><div className="mt-6 flex items-end justify-between gap-4"><div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">{progress.status === 'ready' && progress.data?.estimatedPercent !== null && progress.data?.estimatedPercent !== undefined ? `Estimated ${progress.data.estimatedPercent}% complete` : progress.status === 'loading' ? 'Loading progress' : progress.status === 'ready' ? 'Estimate pending' : 'Progress unavailable'}</div><Button onClick={onOpen}>Open<ArrowUpRight className="size-4" aria-hidden /></Button></div></div>
    </section>
    {sector.companiesFound > 0 ? <CompanySection staging={config} sectorId={sector.id} sectorName={sector.name} pollActive={live} /> : <section aria-label="Companies" className="rounded-2xl border border-dashed border-border bg-background p-6 sm:p-8"><h2 className="text-sm font-semibold">Companies</h2><p className="mt-3 rounded-lg bg-muted/20 p-3 text-sm text-muted-foreground">{notStarted ? 'Company research has not started yet.' : sector.state === 'failed' ? 'No companies were recorded before research stopped.' : sector.state === 'complete' ? 'Research completed without discovering companies.' : 'Companies will appear as research discovers them.'}</p></section>}
  </> : status === 'ready' ? <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">Sector research not found. It may have been removed.</p> : null}
  {open ? <WorkspaceOverlay title="Research progress" onClose={() => setOpen(false)}><div className="space-y-6">{progress.status === 'ready' && progress.data?.plan?.latest ? <section className="rounded-xl border border-border p-4"><div className="mb-3 flex justify-between"><h3 className="text-sm font-semibold">Research plan</h3><span className="font-mono text-xs text-muted-foreground">v{progress.data.plan.latest.version}</span></div><Markdown text={progress.data.plan.latest.markdown} /></section> : null}<PlanProgress resource={progress} /></div></WorkspaceOverlay> : null}</div>
}
