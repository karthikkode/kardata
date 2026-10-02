// Shared text primitives: the only allowed prose scale. Every feature
// surface composes these instead of hand-rolling text sizes, so the type
// system cannot drift. Layout-only className accepted; color and font
// overrides are rejected by convention (tokens live here, not at call sites).
//
// Scale (handoff 2.3): page title 24/32 semibold; workspace and section
// titles 16/24 semibold; card titles 14/20 semibold; body 14/22; caption
// and helper 12/18; eyebrow 12/16 medium, uppercase only for short
// structural labels; values/versions/timestamps in Mono with tabular nums.
// Heading semantics follow nesting, not visual size: PageTitle is always
// h1 (exactly one per view), section/workspace titles h2, card titles h3.
// Refs, tabIndex, and IDs forward so focus management (e.g. moving focus to
// the new heading after page replacement) keeps working.
import * as React from 'react'
import { cn } from '@/lib/utils'

function withClass(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base
}

type SharedAttrs = {
  id?: string
  tabIndex?: number
}

/** Small caps section label, e.g. rail headers and card eyebrows. */
export const Eyebrow = React.forwardRef<
  HTMLParagraphElement,
  { children: React.ReactNode; className?: string } & SharedAttrs & React.HTMLAttributes<HTMLParagraphElement>
>(function Eyebrow({ children, className, ...rest }, ref) {
  return (
    <p
      ref={ref}
      className={withClass('text-xs font-medium uppercase tracking-wider text-muted-foreground', className)}
      {...rest}
    >
      {children}
    </p>
  )
})

/** Page-level title. Exactly one per view. */
export const PageTitle = React.forwardRef<
  HTMLHeadingElement,
  { children: React.ReactNode; className?: string } & SharedAttrs & React.HTMLAttributes<HTMLHeadingElement>
>(function PageTitle({ children, className, ...rest }, ref) {
  return (
    <h1 ref={ref} className={withClass('text-2xl font-semibold tracking-tight', className)} {...rest}>
      {children}
    </h1>
  )
})

/** Workspace title inside workspace headers. */
export const WorkspaceTitle = React.forwardRef<
  HTMLHeadingElement,
  { children: React.ReactNode; className?: string } & SharedAttrs & React.HTMLAttributes<HTMLHeadingElement>
>(function WorkspaceTitle({ children, className, ...rest }, ref) {
  return (
    <h2 ref={ref} className={withClass('text-base font-semibold tracking-tight', className)} {...rest}>
      {children}
    </h2>
  )
})

/** Section heading inside cards and panels. */
export const SectionTitle = React.forwardRef<
  HTMLHeadingElement,
  { children: React.ReactNode; className?: string } & SharedAttrs & React.HTMLAttributes<HTMLHeadingElement>
>(function SectionTitle({ children, className, ...rest }, ref) {
  return (
    <h2 ref={ref} className={withClass('text-base font-semibold tracking-tight', className)} {...rest}>
      {children}
    </h2>
  )
})

/** Card-level heading. */
export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  { children: React.ReactNode; className?: string } & SharedAttrs & React.HTMLAttributes<HTMLHeadingElement>
>(function CardTitle({ children, className, ...rest }, ref) {
  return (
    <h3 ref={ref} className={withClass('text-sm font-semibold tracking-tight', className)} {...rest}>
      {children}
    </h3>
  )
})

/** Standard body copy. */
export const Body = React.forwardRef<
  HTMLParagraphElement,
  { children: React.ReactNode; className?: string } & SharedAttrs & React.HTMLAttributes<HTMLParagraphElement>
>(function Body({ children, className, ...rest }, ref) {
  return (
    <p ref={ref} className={withClass('text-sm leading-[22px]', className)} {...rest}>
      {children}
    </p>
  )
})

/** Muted secondary copy: captions, counts, helper lines. */
export const Caption = React.forwardRef<
  HTMLParagraphElement,
  { children: React.ReactNode; className?: string } & SharedAttrs & React.HTMLAttributes<HTMLParagraphElement>
>(function Caption({ children, className, ...rest }, ref) {
  return (
    <p ref={ref} className={cn('text-xs leading-[18px] text-muted-foreground', className)} {...rest}>
      {children}
    </p>
  )
})

/** Tabular-nums mono for versions, counts, ids, budgets, timestamps. */
export const Mono = React.forwardRef<
  HTMLSpanElement,
  { children: React.ReactNode; className?: string } & SharedAttrs & React.HTMLAttributes<HTMLSpanElement>
>(function Mono({ children, className, ...rest }, ref) {
  return (
    <span ref={ref} className={cn('font-mono tabular-nums', className)} {...rest}>
      {children}
    </span>
  )
})
