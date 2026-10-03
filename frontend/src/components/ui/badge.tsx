// Readable lifecycle status: icon plus text, never color alone.
// Scannable lifecycle only (running, queued, needs approval, failed,
// complete, stale); at most one badge per row. Noninteractive by default
// (span); set asChild/button at the call site only when the badge is
// explicitly implemented as a control.
import * as React from 'react'
import { cn } from '@/lib/utils'

const tones = {
  neutral: 'bg-surface-active text-muted-foreground',
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
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
        'inline-flex h-5 max-w-full items-center gap-1 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap select-none [&_svg]:size-3.5 [&_svg]:shrink-0',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}
