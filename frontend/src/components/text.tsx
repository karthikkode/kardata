// Shared text primitives: the only allowed prose scale (plan 2.2). Every
// feature surface composes these instead of hand-rolling text sizes, so the
// type system cannot drift. Layout-only className accepted; color and font
// overrides are rejected by convention (tokens live here, not at call sites).
//
// Scale: Display 28/36 (reserved), PageTitle 20/28, PageDescription 14/22,
// WorkspaceTitle and SectionTitle 16/24, CardTitle 14/20, Body 14/22,
// BodySm and Description 13/20, Caption 12/16, Label 13/20 medium, Overline
// 11/16 tracked uppercase (group headers only), Numeric (tabular), Mono,
// Kbd. Weights: 400 body, 500 titles/labels/controls; 600 lives only here
// (never in feature code). Every primitive renders data-type for audits.
// Heading semantics follow nesting: PageTitle is h1 (one per view),
// section/workspace titles h2, card titles h3. Refs, tabIndex, and IDs
// forward so focus management keeps working.
import * as React from 'react'
import { cn } from '@/lib/utils'

type SharedAttrs = {
  id?: string
  tabIndex?: number
}

/** Display title. Reserved; not used in shell pages. */
export const Display = React.forwardRef<
  HTMLHeadingElement,
  { children: React.ReactNode; className?: string } & SharedAttrs & React.HTMLAttributes<HTMLHeadingElement>
>(function Display({ children, className, ...rest }, ref) {
  return (
    <h1
      ref={ref}
      data-type="Display"
      className={cn('text-display font-medium tracking-[-0.015em] text-foreground', className)}
      {...rest}
    >
      {children}
    </h1>
  )
})

/** Page-level title. Exactly one per view. */
export const PageTitle = React.forwardRef<
  HTMLHeadingElement,
  { children: React.ReactNode; className?: string } & SharedAttrs & React.HTMLAttributes<HTMLHeadingElement>
>(function PageTitle({ children, className, ...rest }, ref) {
  return (
    <h1
      ref={ref}
      data-type="PageTitle"
      className={cn('text-xl font-medium tracking-[-0.01em] text-foreground', className)}
      {...rest}
    >
      {children}
    </h1>
  )
})

/** One-line page summary under the PageTitle. */
export const PageDescription = React.forwardRef<
  HTMLParagraphElement,
  { children: React.ReactNode; className?: string } & SharedAttrs & React.HTMLAttributes<HTMLParagraphElement>
>(function PageDescription({ children, className, ...rest }, ref) {
  return (
    <p
      ref={ref}
      data-type="PageDescription"
      className={cn('max-w-160 text-sm leading-[22px] text-muted-foreground', className)}
      {...rest}
    >
      {children}
    </p>
  )
})

/** Workspace title inside workspace headers. */
export const WorkspaceTitle = React.forwardRef<
  HTMLHeadingElement,
  { children: React.ReactNode; className?: string } & SharedAttrs & React.HTMLAttributes<HTMLHeadingElement>
>(function WorkspaceTitle({ children, className, ...rest }, ref) {
  return (
    <h2 ref={ref} data-type="WorkspaceTitle" className={cn('text-base font-medium text-foreground', className)} {...rest}>
      {children}
    </h2>
  )
})

/** Section heading inside pages and panels. */
export const SectionTitle = React.forwardRef<
  HTMLHeadingElement,
  { children: React.ReactNode; className?: string } & SharedAttrs & React.HTMLAttributes<HTMLHeadingElement>
>(function SectionTitle({ children, className, ...rest }, ref) {
  return (
    <h2 ref={ref} data-type="SectionTitle" className={cn('text-base font-medium text-foreground', className)} {...rest}>
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
    <h3 ref={ref} data-type="CardTitle" className={cn('text-sm font-medium text-foreground', className)} {...rest}>
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
    <p ref={ref} data-type="Body" className={cn('text-sm leading-[22px] text-foreground', className)} {...rest}>
      {children}
    </p>
  )
})

/** Dense body copy: list rows, cells, sidebar items. */
export const BodySm = React.forwardRef<
  HTMLParagraphElement,
  { children: React.ReactNode; className?: string; as?: 'p' | 'span' | 'div' } & SharedAttrs & React.HTMLAttributes<HTMLElement>
>(function BodySm({ children, className, as = 'p', ...rest }, ref) {
  const Tag = as as 'p'
  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      data-type="BodySm"
      className={cn('text-ui text-foreground', className)}
      {...rest}
    >
      {children}
    </Tag>
  )
})

/** Muted secondary copy: card subtitles, dialog descriptions, row meta. */
export const Description = React.forwardRef<
  HTMLParagraphElement,
  { children: React.ReactNode; className?: string; as?: 'p' | 'span' | 'div' } & SharedAttrs & React.HTMLAttributes<HTMLElement>
>(function Description({ children, className, as = 'p', ...rest }, ref) {
  const Tag = as as 'p'
  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      data-type="Description"
      className={cn('text-ui text-muted-foreground', className)}
      {...rest}
    >
      {children}
    </Tag>
  )
})

/** Timestamps, footnotes, helper text. */
export const Caption = React.forwardRef<
  HTMLParagraphElement,
  { children: React.ReactNode; className?: string; as?: 'p' | 'span' | 'div' | 'time' } & SharedAttrs & React.HTMLAttributes<HTMLElement>
>(function Caption({ children, className, as = 'p', ...rest }, ref) {
  const Tag = as as 'p'
  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      data-type="Caption"
      className={cn('text-xs text-foreground-subtle', className)}
      {...rest}
    >
      {children}
    </Tag>
  )
})

/** Form labels and keys in key-value lists. */
export const Label = React.forwardRef<
  HTMLElement,
  { children: React.ReactNode; className?: string; as?: 'label' | 'span' } & SharedAttrs & React.HTMLAttributes<HTMLElement>
>(function Label({ children, className, as = 'span', ...rest }, ref) {
  const Tag = as as 'span'
  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      data-type="Label"
      className={cn('text-ui font-medium text-foreground', className)}
      {...rest}
    >
      {children}
    </Tag>
  )
})

/** Tracked uppercase group header. Sidebar and table groups only. */
export const Overline = React.forwardRef<
  HTMLParagraphElement,
  { children: React.ReactNode; className?: string } & SharedAttrs & React.HTMLAttributes<HTMLParagraphElement>
>(function Overline({ children, className, ...rest }, ref) {
  return (
    <p
      ref={ref}
      data-type="Overline"
      className={cn('text-2xs font-medium tracking-[0.05em] text-foreground-subtle uppercase', className)}
      {...rest}
    >
      {children}
    </p>
  )
})

/** Every number: tabular figures, optional stat size. */
export const Numeric = React.forwardRef<
  HTMLSpanElement,
  { children: React.ReactNode; className?: string; size?: 'inherit' | 'stat' } & SharedAttrs & React.HTMLAttributes<HTMLSpanElement>
>(function Numeric({ children, className, size = 'inherit', ...rest }, ref) {
  return (
    <span
      ref={ref}
      data-type="Numeric"
      className={cn(size === 'stat' ? 'text-2xl font-medium tracking-[-0.01em] tabular-nums' : 'tabular-nums', className)}
      {...rest}
    >
      {children}
    </span>
  )
})

/** Mono for ids, versions, hashes, model ids, code. */
export const Mono = React.forwardRef<
  HTMLSpanElement,
  { children: React.ReactNode; className?: string } & SharedAttrs & React.HTMLAttributes<HTMLSpanElement>
>(function Mono({ children, className, ...rest }, ref) {
  return (
    <span ref={ref} data-type="Mono" className={cn('font-mono text-ui tabular-nums', className)} {...rest}>
      {children}
    </span>
  )
})

/** Keyboard shortcut chip for tooltips and the palette. */
export const Kbd = React.forwardRef<
  HTMLElement,
  { children: React.ReactNode; className?: string } & SharedAttrs & React.HTMLAttributes<HTMLElement>
>(function Kbd({ children, className, ...rest }, ref) {
  return (
    <kbd
      ref={ref}
      data-type="Kbd"
      className={cn('inline-flex h-5 items-center rounded-sm border border-border bg-surface-sunken px-1 font-mono text-2xs text-muted-foreground', className)}
      {...rest}
    >
      {children}
    </kbd>
  )
})
