import { useState, type ReactNode } from 'react'
import { Icons } from '@/lib/icons'
import { companyStageLabel } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { researchStages } from '../data/stages'
import type { CompanyResearch } from '../data/research'
import { CardTitle, Description, Label } from './text'
import { Badge, type BadgeTone } from './ui/badge'
import { Button } from './ui/button'
import { Skeleton } from './ui/skeleton'
import { IconButton } from './IconButton'

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

/** Badge tone for a research state. Only lifecycle status ever wears a badge. */
export function stateToBadgeTone(state: keyof typeof stateLabel): BadgeTone {
  switch (state) {
    case 'running':
    case 'planning':
    case 'approved':
      return 'info'
    case 'planned':
    case 'paused':
      return 'warning'
    case 'failed':
      return 'danger'
    case 'complete':
      return 'success'
    default:
      return 'neutral'
  }
}

/** One subtle status badge with a dot, for the right cluster of overview rows. */
export function StateBadge({ state }: { state: keyof typeof stateLabel }) {
  return (
    <Badge tone={stateToBadgeTone(state)}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {stateLabel[state]}
    </Badge>
  )
}

/** Four-segment stage indicator: filled up to the current stage. */
export function StageSteps({ stage }: { stage: CompanyResearch['stage'] }) {
  const current = researchStages.findIndex((name) => name === stage)
  const label = companyStageLabel(stage)
  return (
    <ol
      aria-label={current >= 0 ? `Stage ${current + 1} of ${researchStages.length}: ${label}` : `Stage: ${label}`}
      className="flex items-center gap-1"
    >
      {researchStages.map((name, index) => (
        <li
          key={name}
          title={`Stage ${index + 1} of ${researchStages.length}: ${companyStageLabel(name)}`}
          aria-current={index === current ? 'step' : undefined}
          className={cn(
            'h-1 w-6 rounded-full',
            current >= 0 && index <= current ? 'bg-primary' : 'bg-surface-active',
          )}
        />
      ))}
    </ol>
  )
}

// Skeleton rows match the row metric they stand in for (min-h-14
// comfortable rows), so arrival does not shift layout. See SkeletonCards below.
export function SkeletonRows({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label}>
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-14" />
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
  const StatusIcon = state === 'running' ? Icons.loading : state === 'done' ? Icons.approve : Icons.deny
  const badgeTint =
    state === 'running'
      ? 'bg-primary-soft text-primary border-primary-border'
      : state === 'done'
        ? 'bg-success-soft text-success border-success-border'
        : 'bg-danger-soft text-danger border-danger-border'

  return (
    <div className="my-1 rounded-lg border border-border bg-card px-2.5 py-1.5 shadow-2xs transition-colors hover:border-border">
      <div className="flex items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
          <Icons.toolActivity className="size-3" aria-hidden />
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
          <IconButton label={open ? `Hide ${name} detail` : `Show ${name} detail`} size="icon-sm" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}
          >
            <Icons.chevronDown
              className={`size-3.5 motion-safe:transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </IconButton>
        ) : null}
      </div>
      {open && hasDetail ? (
        <pre className="scroll-slim mt-2 overflow-x-auto rounded bg-surface-sunken p-2 font-mono text-xs text-muted-foreground whitespace-pre-wrap">
          {detail}
        </pre>
      ) : null}
      {state === 'failed' && onRetry ? (
        <div className="mt-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={onRetry} className="text-xs">
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
  const AlertIcon = Icons.alertError
  const RetryIcon = Icons.retry
  return (
    <div
      role="alert"
      className="mt-2 flex gap-2 rounded-md border border-danger-border bg-danger-soft p-3"
    >
      <span className="flex h-5 shrink-0 items-center">
        <AlertIcon className="size-4 text-danger" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <Label as="span" className="block">{heading}</Label>
        <Description className="mt-0.5">{detail}</Description>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRetry}
        className="shrink-0 self-start"
      >
        <RetryIcon className="size-4" aria-hidden="true" />
        Try again
      </Button>
    </div>
  )
}

// Overflow standard: past OVERFLOW_THRESHOLD rows the list scrolls in
// place under a truthful total chip instead of growing the page. One
// implementation for every surface; small lists render plain rows.
const OVERFLOW_THRESHOLD = 50

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
  const OfflineIcon = Icons.offline
  const RetryIcon = Icons.retry
  return (
    <div className="flex flex-col items-center py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted">
        <OfflineIcon className="size-5 text-muted-foreground" aria-hidden="true" />
      </span>
      <CardTitle className="mt-3">No connection</CardTitle>
      <Description className="mt-1 max-w-80">
        Check your connection and try again.
      </Description>
      <Button variant="secondary" size="sm" onClick={onRetry} className="mt-4">
        <RetryIcon className="size-4" aria-hidden="true" />
        Try again
      </Button>
    </div>
  )
}

// The request reached the API and was refused (a key without access).
// Retry cannot help: an owner must grant access first.
export function DeniedNotice({ heading, onRetry }: { heading: string; onRetry?: () => void }) {
  const DeniedIcon = Icons.denied
  return (
    <div className="flex flex-col items-center py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted">
        <DeniedIcon className="size-5 text-muted-foreground" aria-hidden="true" />
      </span>
      <CardTitle className="mt-3">{heading}</CardTitle>
      <Description className="mt-1 max-w-80">
        Ask an owner for access, then try again.
      </Description>
      {onRetry ? (
        <div className="mt-4">
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  )
}
