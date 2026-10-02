// Shared text primitives: the only allowed prose scale. Every feature
// surface composes these instead of hand-rolling text sizes, so the type
// system cannot drift. Layout-only className accepted; color and font
// overrides are rejected by convention (tokens live here, not at call sites).
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

function withClass(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base
}

/** Small caps section label, e.g. rail headers and card eyebrows. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={withClass('text-xs font-medium uppercase tracking-wider text-muted-foreground', className)}>
      {children}
    </p>
  )
}

/** Page-level title. Exactly one per view. */
export function PageTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h1 className={withClass('text-xl font-semibold tracking-tight', className)}>{children}</h1>
  )
}

/** Section heading inside cards and panels. */
export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={withClass('text-base font-semibold tracking-tight', className)}>{children}</h2>
  )
}

/** Card-level heading. */
export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={withClass('text-sm font-semibold tracking-tight', className)}>{children}</h3>
  )
}

/** Standard body copy. */
export function Body({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={withClass('text-sm leading-relaxed', className)}>{children}</p>
}

/** Muted secondary copy: captions, counts, helper lines. */
export function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('text-xs text-muted-foreground', className)}>{children}</p>
  )
}

/** Tabular-nums mono for versions, counts, ids, budgets, timestamps. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('font-mono tabular-nums', className)}>{children}</span>
  )
}
