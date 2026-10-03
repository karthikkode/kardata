// Settled reasoning disclosure (CV-06), shared by the workspace and
// Karbot. Compact ghost button sized to its content; the live thinking
// row (ThinkingRow) hands its open state here so expanding during a
// stream stays expanded after the reply settles.
import { useEffect, useRef, useState } from 'react'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { BodySm, Caption } from '../text'
import { CollapsiblePanel, CollapsibleRoot, CollapsibleTrigger } from '../ui/collapsible'

/** Shared expansion state for the live thinking row and the settled
 * disclosure (CV-06). Sticky across the settle; resets when a new turn
 * starts (busy rises) so the next turn mounts collapsed. */
export function useReasoningOpen(busy: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false)
  const prevBusy = useRef(busy)
  useEffect(() => {
    if (busy && !prevBusy.current) setOpen(false)
    prevBusy.current = busy
  }, [busy])
  return [open, setOpen]
}

export function ReasoningDisclosure({
  reasoning,
  durationText,
  open,
  onOpenChange,
  defaultOpen = false,
}: {
  /** Provider thinking trace; the disclosure renders only when non-empty. */
  reasoning: string
  /** e.g. "12s"; "Thought for 12s", else plain "Reasoning". */
  durationText?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultOpen?: boolean
}) {
  const [internal, setInternal] = useState(defaultOpen)
  const expanded = open ?? internal
  function setExpanded(next: boolean): void {
    setInternal(next)
    onOpenChange?.(next)
  }
  if (!reasoning) return null
  return (
    <CollapsibleRoot open={expanded} onOpenChange={(next) => { if (typeof next === 'boolean') setExpanded(next) }}>
      <CollapsibleTrigger
        aria-label={`${expanded ? 'Hide' : 'Show'} reasoning`}
        className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors duration-120 ease-out hover:bg-surface-hover pointer-coarse:min-h-10"
      >
        <Icons.thinking aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <Caption as="span">{durationText ? `Thought for ${durationText}` : 'Reasoning'}</Caption>
        <Icons.chevronDown aria-hidden className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-180 ease-out', expanded && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="scroll-slim mt-1 max-h-80 overflow-y-auto border-l-2 border-border pl-3">
          <BodySm className="text-muted-foreground whitespace-pre-wrap">{reasoning}</BodySm>
        </div>
      </CollapsiblePanel>
    </CollapsibleRoot>
  )
}
