// Inset row hover recipe (plan 2.5.1). The list pulls 8px out of the
// 16px card padding; each row pads 8px back so the rounded highlight
// never touches text. Dividers are inset top rules that vanish around
// hovered and selected rows (see the .v2-list block in index.css: the
// structural selectors need real CSS because rows nest in <li>).
// No feature code hand-rolls row hover: rows use this, tables use
// tableRowClassName on <tr>, nav items use the 2.5 nav recipe.
import * as React from 'react'
import { cn } from '@/lib/utils'

export type ListDensity = 'dense' | 'default' | 'comfortable'

const densityClass: Record<ListDensity, string> = {
  dense: 'min-h-9 pointer-coarse:min-h-10',
  default: 'min-h-11',
  comfortable: 'min-h-14',
}

const rowBase =
  'relative flex w-full items-center gap-3 rounded-md px-2 text-left transition-colors duration-120 ease-out-soft hover:bg-surface-hover data-[selected]:border data-[selected]:border-border-strong data-[selected]:bg-surface-raised data-[selected]:shadow-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'

export function listRowClassName(options: { density?: ListDensity; interactive?: boolean } = {}): string {
  const { density = 'default', interactive = true } = options
  return cn(rowBase, densityClass[density], interactive && 'cursor-pointer')
}

/** Table-row hover: same recipe on <tr>, with first/last cell padding. */
export function tableRowClassName(options: { selected?: boolean; interactive?: boolean } = {}): string {
  const { selected = false, interactive = true } = options
  return cn(
    'rounded-md transition-colors duration-120 ease-out-soft hover:bg-surface-hover data-[selected]:border data-[selected]:border-border-strong data-[selected]:bg-surface-raised data-[selected]:shadow-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
    interactive && 'cursor-pointer',
    selected && 'border border-border-strong bg-surface-raised shadow-sm',
  )
}

export function List({ children, className, ...props }: React.HTMLAttributes<HTMLUListElement>) {
  return (
    <ul className={cn('v2-list -mx-2 flex flex-col', className)} {...props}>
      {children}
    </ul>
  )
}

type ListRowProps = {
  selected?: boolean
  density?: ListDensity
  href?: string
  /** Anchor-only: external rows open out of the app. */
  target?: string
  rel?: string
  onClick?: (event: React.MouseEvent) => void
  children: React.ReactNode
  className?: string
} & Omit<React.HTMLAttributes<HTMLElement>, 'onClick'>

export function ListRow({ selected = false, density = 'default', href, target, rel, onClick, children, className, ref, ...rest }: ListRowProps & { ref?: React.Ref<HTMLLIElement> }) {
  const cls = listRowClassName({ density, interactive: href !== undefined || onClick !== undefined })
  const inner =
    href !== undefined ? (
      <a href={href} target={target} rel={rel} data-list-row="" data-selected={selected || undefined} className={cn(cls, className)}>
        {children}
      </a>
    ) : onClick !== undefined ? (
      <button type="button" data-list-row="" data-selected={selected || undefined} onClick={onClick} className={cn(cls, className)}>
        {children}
      </button>
    ) : (
      <div data-list-row="" data-selected={selected || undefined} className={cn(cls, className)}>
        {children}
      </div>
    )
  return (
    <li ref={ref} className="flex min-w-0 flex-col" {...rest}>
      {inner}
    </li>
  )
}
