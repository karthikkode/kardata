// Readable lifecycle state: icon plus text, never color alone.
// Noninteractive by default (span); set asChild/button at the call site only
// when the badge is explicitly implemented as a control.
import * as React from 'react'
import { cn } from 'cn'

const tones = {
  neutral: 'border-border bg-muted/40 text-muted-foreground',
  info: 'border-primary/30 bg-primary/10 text-primary',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  danger: 'border-destructive/40 bg-destructive/10 text-destructive',
} as const

export type BadgeTone = keyof typeof tones

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      data-slot="badge"
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap select-none [&_svg]:size-3.5 [&_svg]:shrink-0',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}
