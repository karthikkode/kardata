// Shared feature shells: explicit presentational compositions over the
// owned primitives. They receive props and never fetch. Data hooks own
// requests; these own layout, hierarchy, and state copy only.
import * as React from 'react'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { Resource } from '@/data/useWorkspace'
import { Body, Caption, CardTitle, Description, Mono, PageDescription, PageTitle, SectionTitle } from './text'
import { Badge, type BadgeTone } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Separator } from './ui/separator'
import { Skeleton } from './ui/skeleton'
import { noticeEnter } from '@/lib/motion'
import { IconButton } from './IconButton'

/** PageHeader (SH-01): optional breadcrumb row, title row with an
 * inline status badge and right-aligned actions centred on the title,
 * then a muted description line. Exactly one h1 per view. Forwards its
 * ref to the heading so page replacement can move focus to the new
 * title after commit. `loading` swaps the title text for a skeleton
 * (async titles never flash a raw id or a fallback string). */
export const PageHeader = React.forwardRef<
 HTMLHeadingElement,
 {
 title: string
 description?: string
 actions?: React.ReactNode
 badge?: React.ReactNode
 crumbs?: Array<{ label: string; onSelect?: () => void }>
 meta?: string
 loading?: boolean
 className?: string
 titleClassName?: string
 tabIndex?: number
 } & React.HTMLAttributes<HTMLHeadingElement>
>(function PageHeader({ title, description, actions, badge, crumbs, meta, loading, className, titleClassName, ...rest }, ref) {
 return (
 <div className={cn('mb-6', className)}>
 {crumbs && crumbs.length > 0 ? (
 <nav aria-label="Breadcrumb" className="mb-1">
 <ol className="flex min-w-0 flex-wrap items-center gap-1">
 {crumbs.map((crumb, index) => {
 const last = index === crumbs.length - 1
 return (
 <li key={crumb.label} className="flex min-w-0 items-center gap-1">
 {index > 0 ? (
 <span aria-hidden className="text-xs text-foreground-subtle">
 /
 </span>
 ) : null}
 {last || !crumb.onSelect ? (
 <span aria-current={last ? 'page' : undefined} className="truncate text-xs text-muted-foreground">
 {crumb.label}
 </span>
 ) : (
 <button
 type="button"
 onClick={crumb.onSelect}
 className="cursor-pointer truncate text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
 >
 {crumb.label}
 </button>
 )}
 </li>
 )
 })}
 </ol>
 </nav>
 ) : null}
 <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-3">
 <div className="flex min-w-0 items-center gap-2">
 <PageTitle ref={ref} className={titleClassName} {...rest}>
 {loading ? (
 <>
 <span className="sr-only">Loading</span>
 <Skeleton aria-hidden className="h-7 w-48" />
 </>
 ) : (
 title
 )}
 </PageTitle>
 {badge}
 </div>
 {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:w-full">{actions}</div> : null}
 </div>
 {description ? <PageDescription className="mt-1 max-w-160">{description}</PageDescription> : null}
 {meta ? <Caption className="mt-1">{meta}</Caption> : null}
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
 data-card=""
 className={cn('flex flex-col overflow-hidden rounded-lg border border-border bg-card', className)}
 >
 <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-3">
 <SectionTitle className="min-w-0 flex-1">{title}</SectionTitle>
 {metadata}
 {actions}
 </div>
 <Separator />
 <div className="min-w-0 flex-1 px-4 py-2">{children}</div>
 {footer ? (
 <>
 <Separator />
 <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-3">
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
 clearLabel = 'Clear search',
 icon,
 iconClassName,
 compact = false,
 skeleton,
 notice,
 hideTitle = false,
 deniedBody,
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
 clearLabel?: string
 icon?: React.ReactNode
 iconClassName?: string
 compact?: boolean
 skeleton?: React.ReactNode
 notice?: React.ReactNode
 /** Skip the state title when the page header already carries it. */
 hideTitle?: boolean
 /** Override the denied explanation (default assumes a singular label). */
 deniedBody?: string
 children?: React.ReactNode
 className?: string
}) {
 if (resource.status === 'loading') {
 return (
 <div role="status" aria-label={`${label} is loading`} className={cn('flex min-w-0 flex-col gap-3', className)}>
 <span className="sr-only">Loading {label}</span>
 {skeleton ?? <DefaultResourceSkeleton />}
 </div>
 )
 }
 if (resource.status === 'denied') {
 return (
 <div role="alert" className={cn('flex min-w-0 flex-col items-center py-12 text-center', className)}>
 <span className="flex size-10 items-center justify-center rounded-full bg-muted">
 <Icons.denied aria-hidden className="size-5 text-muted-foreground" />
 </span>
 {hideTitle ? null : <CardTitle className="mt-3">Access denied</CardTitle>}
 <Description className={hideTitle ? 'mt-3 max-w-80' : 'mt-1 max-w-80'}>
 {deniedBody ?? `${label} is not shared with this key. Ask an owner for access, then try again.`}
 </Description>
 <div className="mt-4">
 <Button variant="secondary" size="sm" onClick={resource.refresh}>
 <Icons.retry aria-hidden />
 Try again
 </Button>
 </div>
 </div>
 )
 }
 if (resource.status === 'offline') {
 return (
 <div className={cn('flex min-w-0 flex-col gap-4', className)}>
 {children}
 <div role="alert" className="flex min-w-0 flex-col items-center py-12 text-center">
 <span className="flex size-10 items-center justify-center rounded-full bg-muted">
 <Icons.offline aria-hidden className="size-5 text-muted-foreground" />
 </span>
 {hideTitle ? null : <CardTitle className="mt-3">You are offline</CardTitle>}
 <Description className={hideTitle ? 'mt-3 max-w-80' : 'mt-1 max-w-80'}>No connection. Reconnect and try again.</Description>
 <div className="mt-4">
 <Button variant="secondary" size="sm" onClick={resource.refresh}>
 <Icons.retry aria-hidden />
 Try again
 </Button>
 </div>
 </div>
 </div>
 )
 }
 if (resource.status === 'error') {
 return (
 <div className={cn('flex min-w-0 flex-col gap-4', className)}>
 {children}
 <div role="alert" className="flex min-w-0 flex-col items-center py-12 text-center">
 <span className="flex size-10 items-center justify-center rounded-full bg-danger-soft">
 <Icons.alertError aria-hidden className="size-5 text-danger" />
 </span>
 {hideTitle ? null : <CardTitle className="mt-3">{resource.error ?? `${label} did not load.`}</CardTitle>}
 <div className="mt-4">
 <Button variant="secondary" size="sm" onClick={resource.refresh}>
 <Icons.retry aria-hidden />
 Try again
 </Button>
 </div>
 </div>
 </div>
 )
 }
 if (emptyKind === 'filtered') {
 return (
 <div className={cn(`flex min-w-0 flex-col items-center text-center ${compact ? 'py-6' : 'py-12'}`, className)}>
 {hideTitle ? null : <CardTitle>{`No matching ${label.toLowerCase()}.`}</CardTitle>}
 <Description className={hideTitle ? 'max-w-80' : 'mt-1 max-w-80'}>{emptyBody ?? 'Try a different search.'}</Description>
 {onClearFilter ? (
 <div className="mt-4">
 <Button variant="ghost" size="sm" onClick={onClearFilter}>
 {clearLabel}
 </Button>
 </div>
 ) : null}
 </div>
 )
 }
 if (emptyKind === 'first') {
 return (
 <div className={cn(`flex min-w-0 flex-col items-center text-center ${compact ? 'py-6' : 'py-12'}`, className)}>
 {icon && !compact ? (
 <span className={cn('flex size-10 items-center justify-center rounded-full bg-muted [&_svg]:size-5 [&_svg]:text-muted-foreground', iconClassName)}>
 {icon}
 </span>
 ) : null}
 {hideTitle ? null : <CardTitle className={icon && !compact ? 'mt-3' : undefined}>{emptyTitle ?? `No ${label.toLowerCase()} yet`}</CardTitle>}
 {emptyBody ? <Description className={hideTitle ? (icon && !compact ? 'mt-3 max-w-80' : 'max-w-80') : 'mt-1 max-w-80'}>{emptyBody}</Description> : null}
 {emptyAction ? <div className="mt-4">{emptyAction}</div> : null}
 </div>
 )
 }
 if (notice) {
 return (
 <div className={cn('flex min-w-0 flex-col gap-4', className)}>
 {notice}
 {children}
 </div>
 )
 }
 return <>{children}</>
}

const SKELETON_WIDTHS = ['64%', '48%', '72%', '56%', '64%']

function DefaultResourceSkeleton() {
 return (
 <div className="flex min-w-0 flex-col gap-3" aria-hidden>
 {SKELETON_WIDTHS.map((width, index) => (
 <div key={index} className="flex min-h-11 items-center gap-3">
 <Skeleton className="size-8 rounded-md" />
 <div className="flex min-w-0 flex-1 flex-col gap-1.5">
 <Skeleton className="h-3.5" style={{ width }} />
 <Skeleton className="h-3 w-1/3" />
 </div>
 </div>
 ))}
 </div>
 )
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
 <Icons.search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
 <Input
 type="text"
 aria-label={label}
 placeholder={placeholder ?? label}
 value={value}
 onChange={(event) => onChange(event.target.value)}
 className="pr-10 pl-9"
 />
 {value ? (
 <span className="absolute top-1/2 right-1 -translate-y-1/2">
 <IconButton label={clearLabel} onClick={() => onChange('')}>
 <Icons.deny aria-hidden />
 </IconButton>
 </span>
 ) : null}
 </div>
 )
}
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
 ? 'border-danger-border bg-danger-soft text-danger'
 : 'border-border bg-surface-sunken',
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
 surface = 'bg-background',
}: {
 label: string
 input: React.ReactNode
 controls?: React.ReactNode
 status?: React.ReactNode
 /** Footer band surface: the workspace default, or the dock popover. */
 surface?: string
}) {
 return (
 <div className={cn('shrink-0 border-t border-border', surface)}>
 <div className="mx-auto flex w-full max-w-prose-kd flex-col gap-2 px-4 py-3 sm:px-6">
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
 actions,
 children,
}: {
 heading: string
 version: string
 status?: React.ReactNode
 actions?: React.ReactNode
 children: React.ReactNode
}) {
 return (
 <section aria-label={heading} data-card="" className="overflow-hidden rounded-lg border border-border bg-card">
 <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3">
 <SectionTitle className="min-w-0 flex-1">{heading}</SectionTitle>
 <Mono className="shrink-0 text-xs text-muted-foreground tabular-nums">{version}</Mono>
 {status}
 {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
 </div>
 <Separator />
 <div className="px-4 py-4">{children}</div>
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
 <h3 className="text-sm font-medium">{title}</h3>
 <div className="mt-2 min-w-0">
 <Body className="text-foreground [overflow-wrap:anywhere]">{children}</Body>
 </div>
 </div>
 )
}
