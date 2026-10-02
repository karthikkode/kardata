// Shared feature shells: explicit presentational compositions over the
// owned primitives. They receive props and never fetch. Data hooks own
// requests; these own layout, hierarchy, and state copy only.
import * as React from 'react'
import { Search, X } from 'lucide-react'
import { cn } from 'cn'
import type { Resource } from '@/data/useWorkspace'
import { Body, Caption, Mono, PageTitle, SectionTitle } from './text'
import { Badge, type BadgeTone } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Separator } from './ui/separator'
import { noticeEnter } from '@/lib/motion'

/** PageHeader: title, optional description, actions. Exactly one h1 per view.
 * Forwards its ref to the heading so page replacement can move focus to
 * the new title after commit. */
export const PageHeader = React.forwardRef<
  HTMLHeadingElement,
  {
    title: string
    description?: string
    actions?: React.ReactNode
    className?: string
    titleClassName?: string
    tabIndex?: number
  } & React.HTMLAttributes<HTMLHeadingElement>
>(function PageHeader({ title, description, actions, className, titleClassName, ...rest }, ref) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <PageTitle ref={ref} className={titleClassName} {...rest}>
          {title}
        </PageTitle>
        {description ? <Body className="mt-1 text-muted-foreground">{description}</Body> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
})

/** SectionCard: heading, optional metadata, content, optional footer. */
export function SectionCard({
  title,
  metadata,
  actions,
  children,
  footer,
  className,
}: {
  title: string
  metadata?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
}) {
  return (
    <section
      aria-label={title}
      className={cn('flex flex-col overflow-hidden rounded-2xl border border-border bg-background', className)}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
        <SectionTitle className="min-w-0 flex-1">{title}</SectionTitle>
        {metadata}
        {actions}
      </div>
      <Separator />
      <div className="min-w-0 flex-1 px-4 py-4 sm:px-6">{children}</div>
      {footer ? (
        <>
          <Separator />
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
            {footer}
          </div>
        </>
      ) : null}
    </section>
  )
}

export type EmptyKind = 'first' | 'filtered' | null

/**
 * ResourceState: loading, first-run empty, filtered empty, error, denied,
 * offline. A failed fetch never renders as empty: error branches first.
 * Pass retained `children` to keep populated content visible behind a
 * recoverable failure with a quiet refresh action.
 */
export function ResourceState({
  resource,
  label,
  emptyKind = null,
  emptyTitle,
  emptyBody,
  emptyAction,
  onClearFilter,
  children,
  className,
}: {
  resource: Resource<unknown>
  label: string
  emptyKind?: EmptyKind
  emptyTitle?: string
  emptyBody?: string
  emptyAction?: React.ReactNode
  onClearFilter?: () => void
  children?: React.ReactNode
  className?: string
}) {
  if (resource.status === 'loading') {
    return (
      <div
        role="status"
        aria-label={`${label} is loading`}
        className={cn('space-y-3 rounded-xl border border-border/60 p-4', className)}
      >
        <div className="h-3 w-2/3 rounded bg-muted motion-safe:animate-pulse motion-reduce:animate-none" />
        <div className="h-3 w-full rounded bg-muted motion-safe:animate-pulse motion-reduce:animate-none" />
        <span className="sr-only">Loading {label}</span>
      </div>
    )
  }
  if (resource.status === 'denied') {
    return (
      <div role="alert" className={cn('rounded-xl border border-border bg-muted/30 p-4', className)}>
        <p className="text-sm font-medium">{label} is not shared with this key.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask an owner for access, then try again.
        </p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={resource.refresh}>
          Try again
        </Button>
      </div>
    )
  }
  if (resource.status === 'offline') {
    return (
      <div className={cn(className)}>
        {children}
        <p role="alert" className="mt-2 rounded-xl border border-border bg-muted/30 p-4 text-sm">
          No connection. Reconnect and try again.{' '}
          <Button variant="ghost" size="sm" className="ml-1" onClick={resource.refresh}>
            Try again
          </Button>
        </p>
      </div>
    )
  }
  if (resource.status === 'error') {
    return (
      <div className={cn(className)}>
        {children}
        <div role="alert" className="mt-2 rounded-xl border border-border bg-muted/30 p-4">
          <p className="text-sm">{resource.error ?? `${label} did not load.`}</p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={resource.refresh}>
            Try again
          </Button>
        </div>
      </div>
    )
  }
  if (emptyKind === 'filtered') {
    return (
      <div className={cn('rounded-xl border border-dashed border-border p-6 text-center', className)}>
        <p className="text-sm font-semibold">No matching {label.toLowerCase()}.</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          {emptyBody ?? 'Try a different search.'}
        </p>
        {onClearFilter ? (
          <Button variant="outline" size="sm" className="mt-3" onClick={onClearFilter}>
            Clear search
          </Button>
        ) : null}
      </div>
    )
  }
  if (emptyKind === 'first') {
    return (
      <div className={cn('rounded-xl border border-dashed border-border p-6 text-center', className)}>
        <p className="text-sm font-semibold">{emptyTitle ?? `No ${label.toLowerCase()} yet`}</p>
        {emptyBody ? (
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{emptyBody}</p>
        ) : null}
        {emptyAction ? <div className="mt-3 flex justify-center">{emptyAction}</div> : null}
      </div>
    )
  }
  return <>{children}</>
}

/** SearchField: search icon, input, clear button. */
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  clearLabel = 'Clear search',
  className,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
  clearLabel?: string
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="text"
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="pr-9 pl-9"
      />
      {value ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={clearLabel}
          onClick={() => onChange('')}
          className="absolute top-1/2 right-1 -translate-y-1/2"
        >
          <X aria-hidden />
        </Button>
      ) : null}
    </div>
  )
}

/** ListFooter: shown/total counts with pagination/loading-more controls. */
export function ListFooter({
  shown,
  total,
  filtered,
  loadingMore = false,
  onMore,
  moreLabel = 'Show more',
}: {
  shown: number
  total: number
  filtered?: boolean
  loadingMore?: boolean
  onMore?: () => void
  moreLabel?: string
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Caption aria-live="polite" className="tabular-nums">
        Showing {shown} of {total}
        {filtered ? ' matching' : ''}
      </Caption>
      {onMore && shown < total ? (
        <Button variant="outline" size="sm" disabled={loadingMore} onClick={onMore}>
          {loadingMore ? 'Loading more…' : `${moreLabel} (${shown} of ${total})`}
        </Button>
      ) : null}
    </div>
  )
}

/** OperationNotice: local action progress, success, or recoverable failure. */
export function OperationNotice({
  phase,
  title,
  detail,
  onRetry,
  onDismiss,
}: {
  phase: 'working' | 'success' | 'error'
  title: string
  detail?: string
  onRetry?: () => void
  onDismiss?: () => void
}) {
  return (
    <div
      role={phase === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-xl border p-3 text-sm',
        noticeEnter,
        phase === 'error'
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-border bg-muted/30',
      )}
    >
      <p className="font-medium">{title}</p>
      {detail ? <p className="mt-1 text-muted-foreground">{detail}</p> : null}
      {(onRetry || onDismiss) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {onRetry && phase === 'error' ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          {onDismiss ? (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Dismiss
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}

/** StatusBadge: readable lifecycle state, icon plus text, never color alone. */
export function StatusBadge({
  label,
  tone = 'neutral',
  icon,
  className,
}: {
  label: string
  tone?: BadgeTone
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <Badge tone={tone} className={className}>
      {icon}
      {label}
    </Badge>
  )
}

/**
 * ConversationComposer: shared visual layout around caller-owned drafts and
 * commands. The draft, send/steer/stop callbacks, IME handling, and mention
 * routing stay with the caller; this shell owns the sticky region, the
 * single separator, and control alignment only.
 */
export function ConversationComposer({
  label,
  input,
  controls,
  status,
}: {
  label: string
  input: React.ReactNode
  controls?: React.ReactNode
  status?: React.ReactNode
}) {
  return (
    <div className="shrink-0 border-t border-border bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-3 sm:px-6">
        <span className="sr-only">{label}</span>
        {input}
        {(controls || status) && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">{controls}</div>
            {status}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * PlanDocument: shared plan presentation for the workspace Plan tab, the
 * landing progress dialog, and legacy plan views. Same data, same
 * interpretation: version/status header, narrative brief, executable work,
 * progress, and history as distinct sections.
 */
export function PlanDocument({
  heading,
  version,
  status,
  children,
}: {
  heading: string
  version: string
  status?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section aria-label={heading} className="overflow-hidden rounded-2xl border border-border bg-background shadow-xs">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-5 py-4">
        <h2 className="min-w-0 flex-1 text-sm font-semibold tracking-tight">{heading}</h2>
        <Mono className="inline-flex shrink-0 items-center rounded-full border border-border bg-background px-2.5 py-0.5 text-xs text-muted-foreground select-none">
          {version}
        </Mono>
        {status}
      </div>
      <div className="space-y-4 px-5 py-5 sm:px-6">{children}</div>
    </section>
  )
}

/** PlanSection: labeled narrative block inside a PlanDocument. */
export function PlanSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <div className="mt-2 min-w-0">
        <Body className="text-foreground [overflow-wrap:anywhere]">{children}</Body>
      </div>
    </div>
  )
}
