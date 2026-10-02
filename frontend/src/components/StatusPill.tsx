import { cn } from '@/lib/utils'

export type StatusTone = 'ok' | 'working' | 'paused' | 'failed' | 'idle'

export const toneDot: Record<StatusTone, string> = {
  ok: 'bg-emerald-500',
  working: 'bg-sky-500',
  paused: 'bg-amber-500',
  failed: 'bg-red-500',
  idle: 'bg-muted-foreground',
}

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
  const clickable = onClick !== undefined
  const Tag = clickable ? 'button' : 'span'
  return (
    <Tag
      type={clickable ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm select-none',
        clickable &&
          'cursor-pointer transition-shadow hover:shadow-md hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <span
        aria-hidden
        data-tone={tone}
        className={cn('size-2 rounded-full', toneDot[tone])}
      />
      <span>{label}</span>
    </Tag>
  )
}
