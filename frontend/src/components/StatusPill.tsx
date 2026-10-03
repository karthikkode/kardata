import { cn } from '@/lib/utils'
import { Badge } from './ui/badge'

export type StatusTone = 'ok' | 'working' | 'paused' | 'failed' | 'idle'

export const toneDot: Record<StatusTone, string> = {
  ok: 'bg-success',
  working: 'bg-info',
  paused: 'bg-warning',
  failed: 'bg-danger',
  idle: 'bg-muted-foreground',
}

/**
 * Status pill. Visual treatment is delegated to the shared Badge; the
 * interactive variant remains an actual button with distinct hover behavior.
 * Status is never color alone: the dot is decorative, the label carries it.
 */
export function StatusPill({
  tone,
  label,
  className,
  onClick,
}: {
  tone: StatusTone
  label: string
  className?: string
  onClick?: () => void
}) {
  const dot = (
    <span aria-hidden data-tone={tone} className={cn('size-2 rounded-full', toneDot[tone])} />
  )
  if (onClick !== undefined) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'inline-flex cursor-pointer items-center gap-2 rounded-full border border-border px-3 py-1 text-sm transition-shadow select-none hover:border-muted-foreground hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
      >
        {dot}
        <span>{label}</span>
      </button>
    )
  }
  return (
    <Badge tone="neutral" className={cn('px-3 py-1 text-sm', className)}>
      {dot}
      <span>{label}</span>
    </Badge>
  )
}
