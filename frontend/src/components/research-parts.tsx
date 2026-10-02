import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, LoaderCircle, Lock, WifiOff, Wrench, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { researchStages } from '../data/stages'
import type { CompanyResearch, SectorResearch } from '../data/research'
import { StatusPill } from './StatusPill'
import { Button } from './ui/button'

export const stateLabel = {
  draft: 'Draft',
  planning: 'Planning',
  planned: 'Planned',
  approved: 'Approved',
  running: 'In progress',
  paused: 'Paused',
  queued: 'Queued',
  failed: 'Failed',
  complete: 'Complete',
} as const

export const stateTone = {
  draft: 'idle',
  planning: 'working',
  planned: 'paused',
  approved: 'ok',
  running: 'working',
  paused: 'paused',
  queued: 'idle',
  failed: 'failed',
  complete: 'ok',
} as const

export const firstRunCopy = {
  sectors:
    'No sector researches yet. Start one from Researches to see companies found here.',
  companies:
    'No company researches yet. Companies picked from a sector research show up here.',
} as const

// Both row anatomies share one height so side-by-side lists keep the same
// rhythm. Content centers vertically; sector rows gain even breathing room,
// never filler content.
export function SectorRow({
  research,
  onOpen,
}: {
  research: SectorResearch
  onOpen: (id: string) => void
}) {
  return (
    <li className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => onOpen(research.id)}
        aria-label={`Open ${research.name}`}
        className="flex min-h-19 w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:bg-muted/60 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
      >
        <span className="min-w-32 flex-1 basis-32">
          <span className="block truncate text-sm font-medium">{research.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {research.topic}
          </span>
        </span>
        <span className="inline-flex h-7 w-24 shrink-0 items-center justify-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-sm">
          <span className="font-medium tabular-nums">{research.companiesFound}</span>
          <span className="text-muted-foreground">found</span>
        </span>
        <StatusPill tone={stateTone[research.state]} label={stateLabel[research.state]} className="h-7 w-32 justify-center" />
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </li>
  )
}

function StageDots({ stage }: { stage: CompanyResearch['stage'] }) {
  const current = researchStages.findIndex((name) => name === stage)
  return (
    <ol
      aria-label={`Stage: ${stage}`}
      className="mt-2 flex items-center gap-1.5"
    >
      {researchStages.map((name, index) => (
        <li
          key={name}
          title={name}
          aria-current={index === current ? 'step' : undefined}
          className={cn(
            'h-1.5 flex-1 rounded-full',
            index <= current ? 'bg-primary' : 'bg-muted',
          )}
        />
      ))}
    </ol>
  )
}

export function CompanyRow({
  research,
}: {
  research: CompanyResearch
}) {
  return (
    <li className="flex min-h-19 flex-col justify-center border-b border-border py-3 last:border-0 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-32 flex-1 basis-32">
          <p className="truncate text-sm font-medium">{research.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {research.sectorName} : {research.stage}
          </p>
        </div>
        <StatusPill tone={stateTone[research.state]} label={stateLabel[research.state]} className="h-7 w-32 justify-center" />
      </div>
      <StageDots stage={research.stage} />
    </li>
  )
}

// Skeleton rows match the row metric they stand in for (min-h-19 flush
// rows), so arrival does not shift layout. See SkeletonCards below.
export function SkeletonRows({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label}>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          aria-hidden
          className="h-19 rounded-lg bg-muted motion-safe:animate-pulse"
        />
      ))}
    </div>
  )
}

// One tool call as one plain inline row: no card, no pill, just an icon,
// the tool name, a dot plus a plain status word, and a detail toggle.
// Pills mean "agent" everywhere; rows mean "tool call". Used in chat
// history and inside each agent card.
export function ToolRow({
  name,
  detail,
  state,
  elapsed,
  onRetry,
}: {
  name: string
  detail: string
  state: 'running' | 'done' | 'failed'
  /** Live in-flight age (e.g. "4s"); shown only while running. */
  elapsed?: string
  onRetry?: () => void
}) {
  const [open, setOpen] = useState(false)
  const hasDetail = detail.trim().length > 0
  const status =
    state === 'running'
      ? { tone: 'working', label: 'Running' }
      : state === 'done'
        ? { tone: 'ok', label: 'Done' }
        : { tone: 'failed', label: 'Failed' }
  const StatusIcon = state === 'running' ? LoaderCircle : state === 'done' ? Check : X
  const badgeTint =
    state === 'running'
      ? 'bg-primary/10 text-primary border-primary/20'
      : state === 'done'
        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
        : 'bg-destructive/10 text-destructive border-destructive/20'

  return (
    <div className="my-1 rounded-lg border border-border/70 bg-card/60 px-2.5 py-1.5 shadow-2xs transition-colors hover:border-border">
      <div className="flex items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
          <Wrench className="size-3" aria-hidden />
        </span>
        <p className="min-w-0 flex-1 truncate text-xs font-medium font-mono text-foreground">{name}</p>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${badgeTint}`}>
          <StatusIcon
            aria-hidden
            className={`size-3 ${state === 'running' ? 'motion-safe:animate-spin' : ''}`}
          />
          {status.label}
          {state === 'running' && elapsed ? <span aria-hidden>· {elapsed}</span> : null}
        </span>
        {hasDetail ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={open ? `Hide ${name} detail` : `Show ${name} detail`}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="size-6 shrink-0 rounded"
          >
            <ChevronDown
              className={`size-3.5 motion-safe:transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </Button>
        ) : null}
      </div>
      {open && hasDetail ? (
        <pre className="scroll-slim mt-2 overflow-x-auto rounded bg-muted/70 p-2 font-mono text-xs text-muted-foreground whitespace-pre-wrap">
          {detail}
        </pre>
      ) : null}
      {state === 'failed' && onRetry ? (
        <div className="mt-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={onRetry} className="h-6 text-xs">
            Retry tool
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function PanelError({
  heading,
  detail,
  onRetry,
}: {
  heading: string
  detail: string
  onRetry: () => void
}) {
  return (
    <div
      role="alert"
      className="mt-2 rounded-lg border border-dashed border-border p-4"
    >
      <p className="text-sm font-medium">{heading}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="mt-3"
      >
        Try again
      </Button>
    </div>
  )
}

// Overflow standard: past OVERFLOW_THRESHOLD rows the list scrolls in
// place under a truthful total chip instead of growing the page. One
// implementation for every surface; small lists render plain rows.
export const OVERFLOW_THRESHOLD = 50

export function OverflowList({
  total,
  children,
  listClassName,
}: {
  total: number
  children: ReactNode
  listClassName?: string
}) {
  if (total <= OVERFLOW_THRESHOLD) {
    return <ul className={listClassName}>{children}</ul>
  }
  return (
    <div>
      <p className="mt-2">
        <span className="inline-flex h-6 shrink-0 cursor-default items-center gap-1 rounded-full border border-border px-2.5 text-xs">
          <span className="font-medium tabular-nums">{total}</span>
          <span className="text-muted-foreground">total</span>
        </span>
      </p>
      <ul className={`scroll-slim max-h-96 overflow-y-auto pr-1${listClassName ? ` ${listClassName}` : ''}`}>{children}</ul>
    </div>
  )
}

// One shared offline pattern for every list: the panel name stays, the body
// becomes a connection notice, and retry lands on content. Error and offline
// copy never mix.
export function UnavailableNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 py-6">
      <p className="flex items-center gap-2 text-sm font-medium">
        <WifiOff className="size-4" aria-hidden />
        No connection
      </p>
      <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

// The request reached the API and was refused (bad key or a role without
// access). Retry cannot help: the key or its access must change in
// frontend/.env, then the dev server restarts.
export function DeniedNotice({ heading }: { heading: string }) {
  return (
    <div className="flex flex-col items-start gap-3 py-6">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Lock className="size-4" aria-hidden />
        {heading}
      </p>
      <p className="text-sm text-muted-foreground">
        Ask an admin for access, or check the API key in frontend/.env.
      </p>
    </div>
  )
}
